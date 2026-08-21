import type { ClientMsg, PlayerDto, ServerMsg } from '@pp/shared'
import { MINIGAMES_BY_ID, PROTOCOL_VERSION, TEAM_IDS } from '@pp/shared'
import type { ServerWebSocket } from 'bun'
import type { Clock } from '../../../application/ports/Clock'
import type { LiveRoomRegistry } from '../../../application/ports/LiveRoomRegistry'
import type { Publisher } from '../../../application/ports/Publisher'
import type { SessionConfig } from '../../../application/session/SessionEngine'
import { SessionManager } from '../../../application/session/SessionManager'
import type { CreateRoomUseCase } from '../../../application/use-cases/CreateRoomUseCase'
import type { JoinRoomUseCase } from '../../../application/use-cases/JoinRoomUseCase'
import { config } from '../../../config'
import type { Player } from '../../../domain/entities/Player'
import type { Room } from '../../../domain/entities/Room'
import type { Random } from '../../../domain/ports/Random'
import { balancedTeams, smallerTeam } from '../../../domain/services/teamAssignment'
import { reapIdleRooms } from '../../live/roomSweeper'
import type { Logger } from '../../observability/logger'
import type { Metrics } from '../../observability/metrics'
import { handleHttp } from '../http/httpRoutes'
import { buildSimulationLoop } from './simulationLoop'
import { isValidClientMsg } from './validate'

// Identity is resolved server-side and attached here — never client-asserted. `roomCode` comes from the
// upgrade URL; `playerId`/`isHost` are set once the JOIN intent runs. `connId` is a per-socket nonce.
export interface SocketData {
  roomCode: string
  connId: string
  playerId?: string
  isHost: boolean
}

export const roomTopic = (code: string): string => `room:${code}`
export const playerTopic = (id: string): string => `player:${id}`

export interface GameSocketDeps {
  rooms: LiveRoomRegistry
  createRoom: CreateRoomUseCase
  joinRoom: JoinRoomUseCase
  clock: Clock
  random: Random
  sessionConfig: SessionConfig
  logger: Logger
  metrics: Metrics
  roomIdleTimeoutSec: number
  port?: number
}

type LobbyStateMsg = Extract<ServerMsg, { type: 'LOBBY_STATE' }>

const warnedUnknownIntents = new Set<string>()

function toPlayerDto(p: Player): PlayerDto {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    avatar: p.avatar,
    ready: p.ready,
    connected: p.connected,
    team: p.team,
  }
}

// True when the configured line-up includes a team-format game (drives team assignment + lobby UI).
function lineupUsesTeams(room: Room): boolean {
  return room.minigameIds.some((id) => MINIGAMES_BY_ID.get(id)?.format === 'team')
}

function lobbyState(room: Room): LobbyStateMsg {
  return {
    type: 'LOBBY_STATE',
    phase: room.phase,
    players: room.list().map(toPlayerDto),
    hostId: room.hostId ?? '',
    minigameIds: [...room.minigameIds],
    rounds: room.rounds,
    usesTeams: lineupUsesTeams(room),
    handicap: room.handicap,
  }
}

export function startGameServer(deps: GameSocketDeps) {
  // Assigned right after Bun.serve returns (synchronously, before any socket message can arrive), so
  // the handlers below can close over it. The publisher fans engine output over the room topic.
  // biome-ignore lint/style/useConst: forward-declared; assigned after the server it depends on exists.
  let manager: SessionManager

  const send = (ws: ServerWebSocket<SocketData>, msg: ServerMsg): void => {
    ws.send(JSON.stringify(msg))
  }

  const broadcastLobby = (room: Room): void => {
    server.publish(roomTopic(room.code), JSON.stringify(lobbyState(room)))
  }

  // Counters plus live gauges the counters can't hold (active rooms, running sessions).
  const metricsSnapshot = (): Record<string, number> => ({
    ...deps.metrics.snapshot(),
    active_rooms: deps.rooms.list().length,
    running_sessions: manager.runningCount,
  })

  // Keep team assignment in sync with the line-up: a balanced split appears when a team game is added
  // (and none is set yet); teams are cleared when the line-up drops back to FFA-only.
  const ensureTeams = (room: Room): void => {
    if (!lineupUsesTeams(room)) {
      if (room.hasTeams) room.clearTeams()
      return
    }
    if (!room.hasTeams && room.list().length > 0) {
      room.setTeams(
        balancedTeams(
          room.list().map((p) => p.id),
          deps.random,
        ),
      )
    }
  }

  // JOIN mints identity: run the use case, attach the resolved id/host flag, subscribe, then WELCOME.
  const handleJoin = (
    ws: ServerWebSocket<SocketData>,
    msg: Extract<ClientMsg, { type: 'JOIN' }>,
  ): void => {
    if (ws.data.playerId) return // already joined on this socket
    const result = deps.joinRoom.execute({
      code: ws.data.roomCode,
      name: msg.name,
      color: msg.color,
      avatar: msg.avatar,
    })
    if (!result.ok) {
      send(ws, { type: 'JOIN_REJECTED', reason: result.reason })
      deps.logger.info('join_rejected', { room: ws.data.roomCode, reason: result.reason })
      ws.close()
      return
    }
    ws.data.playerId = result.playerId
    ws.data.isHost = result.isHost
    ws.subscribe(roomTopic(ws.data.roomCode))
    ws.subscribe(playerTopic(result.playerId))
    deps.metrics.inc('players_joined')
    deps.logger.info('player_joined', {
      room: ws.data.roomCode,
      playerId: result.playerId,
      host: result.isHost,
    })
    send(ws, {
      type: 'WELCOME',
      protocolVersion: PROTOCOL_VERSION,
      playerId: result.playerId,
      roomCode: ws.data.roomCode,
      isHost: result.isHost,
    })
    const room = deps.rooms.get(ws.data.roomCode)
    if (room) {
      // Team line-up: slot the newcomer into the smaller team without reshuffling everyone else.
      if (lineupUsesTeams(room)) {
        const p = room.get(result.playerId)
        if (p && !p.team) p.setTeam(smallerTeam(room.teamCounts()))
      }
      broadcastLobby(room)
    }
  }

  // REJOIN reclaims an existing seat after a socket drop: re-attach the id, mark it connected, then
  // replay the current session state to this one socket so its screen is restored.
  const handleRejoin = (
    ws: ServerWebSocket<SocketData>,
    msg: Extract<ClientMsg, { type: 'REJOIN' }>,
  ): void => {
    if (ws.data.playerId) return
    const room = deps.rooms.get(ws.data.roomCode)
    const player = room?.get(msg.playerId)
    if (!room || !player) {
      // Seat is gone (e.g. dropped from the lobby). Tell the client so it can fall back to a fresh JOIN.
      send(ws, { type: 'ACK', intent: 'REJOIN', ok: false, reason: 'unknown_player' })
      return
    }
    ws.data.playerId = player.id
    ws.data.isHost = room.isHost(player.id)
    player.setConnected(true)
    ws.subscribe(roomTopic(ws.data.roomCode))
    ws.subscribe(playerTopic(player.id))
    deps.metrics.inc('rejoins')
    deps.logger.info('player_rejoined', { room: ws.data.roomCode, playerId: player.id })
    send(ws, {
      type: 'WELCOME',
      protocolVersion: PROTOCOL_VERSION,
      playerId: player.id,
      roomCode: ws.data.roomCode,
      isHost: ws.data.isHost,
    })
    broadcastLobby(room)
    for (const m of manager.resumeMessages(room.code)) send(ws, m)
  }

  const handleSetReady = (
    ws: ServerWebSocket<SocketData>,
    msg: Extract<ClientMsg, { type: 'SET_READY' }>,
  ): void => {
    const room = deps.rooms.get(ws.data.roomCode)
    const player = ws.data.playerId ? room?.get(ws.data.playerId) : undefined
    if (!room || !player) return
    player.setReady(msg.ready)
    broadcastLobby(room)
  }

  const handleHostConfig = (
    ws: ServerWebSocket<SocketData>,
    msg: Extract<ClientMsg, { type: 'HOST_CONFIG' }>,
  ): void => {
    const room = deps.rooms.get(ws.data.roomCode)
    if (!room || !ws.data.playerId || !room.isHost(ws.data.playerId)) {
      send(ws, { type: 'ACK', intent: 'HOST_CONFIG', ok: false, reason: 'not_host' })
      return
    }
    // Domain refinement at the boundary: keep only known distinct games and clamp the round count. With
    // no-repeat sessions a game never plays twice, so rounds is capped at the number of distinct games.
    const ids = [...new Set(msg.minigameIds.filter((id) => MINIGAMES_BY_ID.has(id)))]
    const cap = ids.length > 0 ? Math.min(20, ids.length) : 20
    const rounds = Math.max(1, Math.min(cap, Math.floor(msg.rounds) || 1))
    room.configure(ids, rounds, msg.handicap ?? room.handicap)
    ensureTeams(room)
    broadcastLobby(room)
  }

  const handleSetTeam = (
    ws: ServerWebSocket<SocketData>,
    msg: Extract<ClientMsg, { type: 'SET_TEAM' }>,
  ): void => {
    const room = deps.rooms.get(ws.data.roomCode)
    if (!room || !ws.data.playerId || !room.isHost(ws.data.playerId)) {
      send(ws, { type: 'ACK', intent: 'SET_TEAM', ok: false, reason: 'not_host' })
      return
    }
    const target = room.get(msg.playerId)
    if (!target || !(TEAM_IDS as readonly string[]).includes(msg.team)) {
      send(ws, { type: 'ACK', intent: 'SET_TEAM', ok: false, reason: 'invalid' })
      return
    }
    target.setTeam(msg.team)
    broadcastLobby(room)
  }

  const handleShuffleTeams = (ws: ServerWebSocket<SocketData>): void => {
    const room = deps.rooms.get(ws.data.roomCode)
    if (!room || !ws.data.playerId || !room.isHost(ws.data.playerId)) {
      send(ws, { type: 'ACK', intent: 'SHUFFLE_TEAMS', ok: false, reason: 'not_host' })
      return
    }
    room.setTeams(
      balancedTeams(
        room.list().map((p) => p.id),
        deps.random,
      ),
    )
    broadcastLobby(room)
  }

  const handleStartSession = (ws: ServerWebSocket<SocketData>): void => {
    const room = deps.rooms.get(ws.data.roomCode)
    if (!room || !ws.data.playerId || !room.isHost(ws.data.playerId)) {
      send(ws, { type: 'ACK', intent: 'START_SESSION', ok: false, reason: 'not_host' })
      return
    }
    if (room.phase !== 'lobby' || manager.isRunning(room.code)) {
      send(ws, { type: 'ACK', intent: 'START_SESSION', ok: false, reason: 'already_started' })
      return
    }
    // The engine drives the round loop and sets the room phase; it publishes ROUND_INTRO immediately.
    manager.start(room)
    deps.metrics.inc('sessions_started')
    deps.logger.info('session_started', {
      room: room.code,
      games: [...room.minigameIds],
      rounds: room.rounds,
      players: room.list().length,
    })
    send(ws, { type: 'ACK', intent: 'START_SESSION', ok: true })
  }

  const handleTransferHost = (
    ws: ServerWebSocket<SocketData>,
    msg: Extract<ClientMsg, { type: 'TRANSFER_HOST' }>,
  ): void => {
    const room = deps.rooms.get(ws.data.roomCode)
    if (!room || !ws.data.playerId || !room.isHost(ws.data.playerId)) {
      send(ws, { type: 'ACK', intent: 'TRANSFER_HOST', ok: false, reason: 'not_host' })
      return
    }
    if (!room.transferHost(msg.playerId)) {
      send(ws, { type: 'ACK', intent: 'TRANSFER_HOST', ok: false, reason: 'unknown_player' })
      return
    }
    deps.metrics.inc('host_transfers')
    deps.logger.info('host_transferred', {
      room: room.code,
      from: ws.data.playerId,
      to: msg.playerId,
    })
    broadcastLobby(room)
  }

  const handleKick = (
    ws: ServerWebSocket<SocketData>,
    msg: Extract<ClientMsg, { type: 'KICK_PLAYER' }>,
  ): void => {
    const room = deps.rooms.get(ws.data.roomCode)
    if (!room || !ws.data.playerId || !room.isHost(ws.data.playerId)) {
      send(ws, { type: 'ACK', intent: 'KICK_PLAYER', ok: false, reason: 'not_host' })
      return
    }
    if (msg.playerId === ws.data.playerId || !room.get(msg.playerId)) {
      send(ws, { type: 'ACK', intent: 'KICK_PLAYER', ok: false, reason: 'unknown_player' })
      return
    }
    // Notify the kicked seat over its own topic (it may still be listening), then drop it from the
    // roster. Their client returns to the entry screen; if they re-enter the code they can rejoin —
    // this is a "remove now", not a ban (no accounts/ban list in Phase 1).
    server.publish(
      playerTopic(msg.playerId),
      JSON.stringify({ type: 'KICKED' } satisfies ServerMsg),
    )
    room.remove(msg.playerId)
    deps.metrics.inc('kicks')
    deps.logger.info('player_kicked', {
      room: room.code,
      by: ws.data.playerId,
      playerId: msg.playerId,
    })
    broadcastLobby(room)
  }

  const handleMinigameInput = (
    ws: ServerWebSocket<SocketData>,
    msg: Extract<ClientMsg, { type: 'MINIGAME_INPUT' }>,
  ): void => {
    if (!ws.data.playerId) return
    manager.input(ws.data.roomCode, ws.data.playerId, msg.input)
  }

  const dispatch = (ws: ServerWebSocket<SocketData>, msg: ClientMsg): void => {
    // Any inbound intent keeps the room alive against the idle sweeper.
    deps.rooms.get(ws.data.roomCode)?.touch(deps.clock.now())
    deps.metrics.inc('messages')
    switch (msg.type) {
      case 'JOIN':
        handleJoin(ws, msg)
        break
      case 'REJOIN':
        handleRejoin(ws, msg)
        break
      case 'SET_READY':
        handleSetReady(ws, msg)
        break
      case 'HOST_CONFIG':
        handleHostConfig(ws, msg)
        break
      case 'SET_TEAM':
        handleSetTeam(ws, msg)
        break
      case 'SHUFFLE_TEAMS':
        handleShuffleTeams(ws)
        break
      case 'TRANSFER_HOST':
        handleTransferHost(ws, msg)
        break
      case 'KICK_PLAYER':
        handleKick(ws, msg)
        break
      case 'START_SESSION':
        handleStartSession(ws)
        break
      case 'MINIGAME_INPUT':
        handleMinigameInput(ws, msg)
        break
      case 'LEAVE':
        ws.close()
        break
      default: {
        const type = (msg as { type: string }).type
        if (!warnedUnknownIntents.has(type)) {
          warnedUnknownIntents.add(type)
          console.warn(`[ws] unknown intent type: ${type}`)
        }
      }
    }
  }

  const teardown = (ws: ServerWebSocket<SocketData>): void => {
    const room = deps.rooms.get(ws.data.roomCode)
    if (!room || !ws.data.playerId) return
    const player = room.get(ws.data.playerId)
    deps.metrics.inc('disconnects')
    // During a live session keep the seat (and its score) so the player can rejoin; only mark it
    // disconnected. Tear the room down once nobody is left connected.
    if (manager.isRunning(room.code) && player) {
      player.setConnected(false)
      if (!room.hasConnectedPlayers) {
        manager.stop(room.code)
        deps.rooms.remove(room.code)
        deps.logger.info('room_closed', { room: room.code, reason: 'all_disconnected' })
        return
      }
      // If the host is the one that dropped, hand the role to a still-connected member.
      const newHost = room.reassignHostIfDisconnected()
      if (newHost)
        deps.logger.info('host_transferred', { room: room.code, to: newHost, reason: 'disconnect' })
      broadcastLobby(room)
      return
    }
    room.remove(ws.data.playerId)
    deps.logger.info('player_left', { room: room.code, playerId: ws.data.playerId })
    if (room.isEmpty) {
      manager.stop(room.code)
      deps.rooms.remove(room.code)
      deps.logger.info('room_closed', { room: room.code, reason: 'empty' })
      return
    }
    broadcastLobby(room)
  }

  const server = Bun.serve<SocketData, never>({
    port: deps.port ?? config.port,
    async fetch(req, srv) {
      const url = new URL(req.url)

      if (url.pathname.startsWith('/api')) {
        return handleHttp(req, { ...deps, metricsSnapshot })
      }

      if (url.pathname === '/ws') {
        // Origin allowlist (fail-closed): reject cross-origin upgrades. A missing Origin is a non-browser
        // client — exactly what the allowlist scrutinizes.
        const origin = req.headers.get('origin')
        if (origin === null || !config.allowedOrigins.includes(origin)) {
          return new Response('Forbidden origin', { status: 403 })
        }
        const code = (url.searchParams.get('room') ?? '').toUpperCase()
        if (!deps.rooms.get(code)) return new Response('Room not found', { status: 404 })

        const data: SocketData = { roomCode: code, connId: crypto.randomUUID(), isHost: false }
        if (srv.upgrade(req, { data })) return undefined
        return new Response('Upgrade failed', { status: 426 })
      }

      return new Response('Not found', { status: 404 })
    },
    websocket: {
      idleTimeout: config.wsIdleTimeoutSec,
      // Bun's automatic ping/pong keepalive. Without it, a connection with no application traffic for
      // `wsIdleTimeoutSec` (e.g. a player idling in the lobby, or reading a self-paced puzzle round)
      // gets force-closed as idle even though the player is still there.
      sendPings: true,
      open() {
        // Nothing to do until JOIN mints identity; the client sends JOIN as its first frame.
      },
      message(ws, raw) {
        let parsed: unknown
        try {
          parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString())
        } catch {
          deps.metrics.inc('errors')
          send(ws, { type: 'ERROR', reason: 'malformed message' })
          return
        }
        if (!isValidClientMsg(parsed)) {
          deps.metrics.inc('errors')
          send(ws, { type: 'ERROR', reason: 'malformed message' })
          return
        }
        dispatch(ws, parsed)
      },
      close(ws) {
        teardown(ws)
      },
    },
  })

  const publisher: Publisher = {
    toRoom(code, msg) {
      server.publish(roomTopic(code), JSON.stringify(msg))
    },
  }
  manager = new SessionManager(publisher, deps.clock, deps.random, deps.sessionConfig)
  const loop = buildSimulationLoop(manager, deps.sessionConfig.tickHz)

  // Idle-room reaper: sweep on a coarse interval (min of the idle window and 60 s) so abandoned lobbies
  // and never-joined rooms don't leak in the in-memory store. Notifies any lingering listener, then
  // drops the room.
  const idleMs = deps.roomIdleTimeoutSec * 1000
  const sweepTimer = setInterval(
    () => {
      const reaped = reapIdleRooms({
        rooms: deps.rooms,
        manager,
        now: deps.clock.now(),
        idleMs,
        onReap: (code) => {
          server.publish(roomTopic(code), JSON.stringify({ type: 'ERROR', reason: 'room_closed' }))
          deps.logger.info('room_reaped', { room: code })
        },
      })
      if (reaped.length) deps.metrics.inc('rooms_reaped', reaped.length)
    },
    Math.min(idleMs, 60_000),
  )

  return Object.assign(server, {
    // Exposed for a clean shutdown (tests / signal handling).
    stopLoop: () => {
      loop.stop()
      clearInterval(sweepTimer)
    },
  })
}

export type GameServerHandle = ReturnType<typeof startGameServer>
