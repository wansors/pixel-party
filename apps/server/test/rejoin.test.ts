import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ServerMsg } from '@pp/shared'

// A browser reload opens the new socket and REJOINs before the server has processed the old socket's
// close. That late close must not drop (lobby) or mark offline (mid-session) the reclaimed seat.
process.env.ALLOWED_ORIGINS = 'http://test.local'

const { CreateRoomUseCase } = await import('../src/application/use-cases/CreateRoomUseCase')
const { JoinRoomUseCase } = await import('../src/application/use-cases/JoinRoomUseCase')
const { CryptoIdGenerator } = await import('../src/infrastructure/driven/id/CryptoIdGenerator')
const { SeededRandom } = await import('../src/infrastructure/driven/random/SeededRandom')
const { SystemClock } = await import('../src/infrastructure/driven/time/SystemClock')
const { startGameServer } = await import('../src/infrastructure/driving/ws/GameSocket')
const { LiveRooms } = await import('../src/infrastructure/live/LiveRooms')
const { createLogger } = await import('../src/infrastructure/observability/logger')
const { createMetrics } = await import('../src/infrastructure/observability/metrics')

type Server = ReturnType<typeof startGameServer>
let server: Server

beforeAll(() => {
  const clock = new SystemClock()
  const ids = new CryptoIdGenerator()
  const rooms = new LiveRooms(ids, 4, 10, clock, false)
  server = startGameServer({
    rooms,
    createRoom: new CreateRoomUseCase(rooms),
    joinRoom: new JoinRoomUseCase(rooms, ids),
    clock,
    random: new SeededRandom(1),
    sessionConfig: {
      introMs: 50,
      roundResultMs: 50,
      scoreboardMs: 50,
      tickHz: 20,
      snapshotEveryNTicks: 3,
      defaultDurationMs: 1000,
      baseSeed: 1,
      handicap: { enabled: false, maxBonusPct: 0.2 },
    },
    logger: { ...createLogger(), info: () => {} },
    metrics: createMetrics(),
    roomIdleTimeoutSec: 900,
    port: 0,
  })
})

afterAll(() => {
  server.stopLoop()
  server.stop(true)
})

interface Client {
  ws: WebSocket
  msgs: ServerMsg[]
  next: (type: ServerMsg['type']) => Promise<ServerMsg>
  closed: Promise<void>
}

function connect(code: string): Promise<Client> {
  const ws = new WebSocket(`ws://localhost:${server.port}/ws?room=${code}`, {
    // @ts-expect-error Bun's WebSocket accepts request headers (the typings only know protocols)
    headers: { Origin: 'http://test.local' },
  })
  const msgs: ServerMsg[] = []
  const waiters: { type: ServerMsg['type']; resolve: (m: ServerMsg) => void }[] = []
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as ServerMsg
    msgs.push(m)
    for (const w of [...waiters]) {
      if (w.type === m.type) {
        waiters.splice(waiters.indexOf(w), 1)
        w.resolve(m)
      }
    }
  }
  const closed = new Promise<void>((resolve) => {
    ws.onclose = () => resolve()
  })
  const next = (type: ServerMsg['type']) =>
    new Promise<ServerMsg>((resolve) => waiters.push({ type, resolve }))
  return new Promise((resolve) => {
    ws.onopen = () => resolve({ ws, msgs, next, closed })
  })
}

async function createRoom(): Promise<string> {
  const res = await fetch(`http://localhost:${server.port}/api/rooms`, { method: 'POST' })
  return ((await res.json()) as { code: string }).code
}

describe('REJOIN while the previous socket is still open (page reload race)', () => {
  test('keeps the reclaimed seat and closes the superseded socket', async () => {
    const code = await createRoom()
    const host = await connect(code)
    host.ws.send(JSON.stringify({ type: 'JOIN', name: 'Host', color: '#ff3e7f', avatar: 'cat' }))
    await host.next('WELCOME')

    const a = await connect(code)
    a.ws.send(JSON.stringify({ type: 'JOIN', name: 'Ada', color: '#29d3f2', avatar: 'owl' }))
    const welcome = await a.next('WELCOME')
    if (welcome.type !== 'WELCOME') throw new Error('no welcome')

    // The "reloaded page" reclaims the seat while socket A is still connected.
    const b = await connect(code)
    b.ws.send(JSON.stringify({ type: 'REJOIN', playerId: welcome.playerId }))
    await b.next('WELCOME')
    await a.closed // the server closes the superseded socket…

    // …and its close must not have removed / disconnected the seat now held by socket B.
    b.ws.send(JSON.stringify({ type: 'SET_READY', ready: true }))
    const lobby = await b.next('LOBBY_STATE')
    if (lobby.type !== 'LOBBY_STATE') throw new Error('no lobby')
    const seat = lobby.players.find((p) => p.id === welcome.playerId)
    expect(seat?.connected).toBe(true)
    expect(seat?.ready).toBe(true)
    expect(lobby.players).toHaveLength(2)

    host.ws.close()
    b.ws.close()
  })
})

describe('START_SESSION with a line-up that does not fit the headcount (D27)', () => {
  test('is refused instead of falling back to a default game', async () => {
    const code = await createRoom()
    const host = await connect(code)
    host.ws.send(JSON.stringify({ type: 'JOIN', name: 'Solo', color: '#ff3e7f', avatar: 'cat' }))
    await host.next('WELCOME')

    // A duel needs a second player, so a solo host has nothing to play.
    host.ws.send(
      JSON.stringify({ type: 'HOST_CONFIG', minigameIds: ['sink-the-fleet'], rounds: 1 }),
    )
    await host.next('LOBBY_STATE')
    host.ws.send(JSON.stringify({ type: 'START_SESSION' }))
    const ack = await host.next('ACK')
    expect(ack).toMatchObject({ intent: 'START_SESSION', ok: false, reason: 'no_games_fit' })

    host.ws.close()
  })
})
