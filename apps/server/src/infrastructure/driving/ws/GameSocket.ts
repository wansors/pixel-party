import type { ClientMsg, PlayerDto, ServerMsg } from '@pp/shared'
import { MINIGAMES_BY_ID, PROTOCOL_VERSION } from '@pp/shared'
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
  }
}

function lobbyState(room: Room): LobbyStateMsg {
  return {
    type: 'LOBBY_STATE',
    phase: room.phase,
    players: room.list().map(toPlayerDto),
    hostId: room.hostId ?? '',
    minigameIds: [...room.minigameIds],
    rounds: room.rounds,
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
      ws.close()
      return
    }
    ws.data.playerId = result.playerId
    ws.data.isHost = result.isHost
    ws.subscribe(roomTopic(ws.data.roomCode))
    ws.subscribe(playerTopic(result.playerId))
    send(ws, {
      type: 'WELCOME',
      protocolVersion: PROTOCOL_VERSION,
      playerId: result.playerId,
      roomCode: ws.data.roomCode,
      isHost: result.isHost,
    })
    const room = deps.rooms.get(ws.data.roomCode)
    if (room) broadcastLobby(room)
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
    // Domain refinement at the boundary: keep only known games and clamp the round count.
    const ids = msg.minigameIds.filter((id) => MINIGAMES_BY_ID.has(id))
    const rounds = Math.max(1, Math.min(20, Math.floor(msg.rounds) || 1))
    room.configure(ids, rounds)
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
    send(ws, { type: 'ACK', intent: 'START_SESSION', ok: true })
  }

  const handleMinigameInput = (
    ws: ServerWebSocket<SocketData>,
    msg: Extract<ClientMsg, { type: 'MINIGAME_INPUT' }>,
  ): void => {
    if (!ws.data.playerId) return
    manager.input(ws.data.roomCode, ws.data.playerId, msg.input)
  }

  const dispatch = (ws: ServerWebSocket<SocketData>, msg: ClientMsg): void => {
    switch (msg.type) {
      case 'JOIN':
        handleJoin(ws, msg)
        break
      case 'SET_READY':
        handleSetReady(ws, msg)
        break
      case 'HOST_CONFIG':
        handleHostConfig(ws, msg)
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
    room.remove(ws.data.playerId)
    if (room.isEmpty) {
      manager.stop(room.code)
      deps.rooms.remove(room.code)
      return
    }
    broadcastLobby(room)
  }

  const server = Bun.serve<SocketData, never>({
    port: deps.port ?? config.port,
    async fetch(req, srv) {
      const url = new URL(req.url)

      if (url.pathname.startsWith('/api')) {
        return handleHttp(req, deps)
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
      sendPings: false,
      open() {
        // Nothing to do until JOIN mints identity; the client sends JOIN as its first frame.
      },
      message(ws, raw) {
        let parsed: unknown
        try {
          parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString())
        } catch {
          send(ws, { type: 'ERROR', reason: 'malformed message' })
          return
        }
        if (!isValidClientMsg(parsed)) {
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

  return Object.assign(server, {
    // Exposed for a clean shutdown (tests / signal handling).
    stopLoop: () => loop.stop(),
  })
}

export type GameServerHandle = ReturnType<typeof startGameServer>
