import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { AVATARS, MAX_ROUNDS, PLAYER_COLORS, type ServerMsg } from '@pp/shared'

// The game socket end to end: seat reclaiming (REJOIN), start refusals, and what a hostile or broken
// client may send without taking the server down.
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

async function join(code: string, name: string): Promise<{ client: Client; welcome: ServerMsg }> {
  const client = await connect(code)
  client.ws.send(JSON.stringify({ type: 'JOIN', name, color: '#29d3f2', avatar: 'owl' }))
  return { client, welcome: await client.next('WELCOME') }
}

const healthy = async (): Promise<boolean> =>
  (await fetch(`http://localhost:${server.port}/api/health`)).ok

// A browser reload opens the new socket and REJOINs before the server has processed the old socket's
// close. That late close must not drop (lobby) or mark offline (mid-session) the reclaimed seat.
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
    b.ws.send(
      JSON.stringify({ type: 'REJOIN', playerId: welcome.playerId, token: welcome.rejoinToken }),
    )
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

describe('REJOIN needs the seat token', () => {
  test("another player can't take a seat with its public id", async () => {
    const code = await createRoom()
    const { client: host, welcome } = await join(code, 'Host')
    if (welcome.type !== 'WELCOME') throw new Error('no welcome')
    const { client: rival } = await join(code, 'Rival')
    // The rival sees the host's id in every LOBBY_STATE, but not its token.
    const thief = await connect(code)
    thief.ws.send(JSON.stringify({ type: 'REJOIN', playerId: welcome.playerId, token: 'guess' }))
    const ack = await thief.next('ACK')
    expect(ack).toMatchObject({ intent: 'REJOIN', ok: false })
    expect(host.ws.readyState).toBe(WebSocket.OPEN)
    for (const c of [host, rival, thief]) c.ws.close()
  })
})

describe('hostile messages never take the server down', () => {
  test('a null game input is refused as malformed', async () => {
    const code = await createRoom()
    const { client: host } = await join(code, 'Host')
    host.ws.send(JSON.stringify({ type: 'HOST_CONFIG', minigameIds: ['pang'], rounds: 1 }))
    await host.next('LOBBY_STATE')
    host.ws.send(JSON.stringify({ type: 'START_SESSION' }))
    await host.next('ROUND_STATE')
    host.ws.send(JSON.stringify({ type: 'MINIGAME_INPUT', input: null }))
    expect(await host.next('ERROR')).toMatchObject({ reason: 'malformed message' })
    expect(await healthy()).toBe(true)
    host.ws.close()
  })

  test('a blank or invisible name is rejected; a long one is cut', async () => {
    const code = await createRoom()
    const blank = await connect(code)
    blank.ws.send(JSON.stringify({ type: 'JOIN', name: ' \u200b ', color: '#fff', avatar: 'cat' }))
    expect(await blank.next('JOIN_REJECTED')).toMatchObject({ reason: 'invalid_name' })
    expect(await healthy()).toBe(true)

    const long = await connect(code)
    long.ws.send(
      JSON.stringify({ type: 'JOIN', name: 'Z'.repeat(5000), color: 'url(x)', avatar: 'dragon' }),
    )
    const lobby = await long.next('LOBBY_STATE')
    if (lobby.type !== 'LOBBY_STATE') throw new Error('no lobby')
    const [seat] = lobby.players
    expect(seat?.name).toBe('Z'.repeat(16))
    expect(seat?.color).toBe(PLAYER_COLORS[0])
    expect(seat?.avatar).toBe(AVATARS[0])
    long.ws.close()
  })
})

// SET_PROFILE (D40): rename / re-skin yourself from the lobby, with JOIN's cleaning and uniqueness.
describe('SET_PROFILE', () => {
  type Lobby = Extract<ServerMsg, { type: 'LOBBY_STATE' }>
  const lobbyAfter = async (c: Client): Promise<Lobby> => {
    const m = await c.next('LOBBY_STATE')
    if (m.type !== 'LOBBY_STATE') throw new Error('no lobby')
    return m
  }
  // The first LOBBY_STATE (already received or still to come) that satisfies `ok`: broadcasts from
  // earlier joins may still be in flight when the test acts.
  const lobbyWhere = async (c: Client, ok: (m: Lobby) => boolean): Promise<Lobby> => {
    for (;;) {
      const hit = c.msgs.find((m): m is Lobby => m.type === 'LOBBY_STATE' && ok(m))
      if (hit) return hit
      await c.next('LOBBY_STATE')
    }
  }
  const ack = async (c: Client): Promise<Extract<ServerMsg, { type: 'ACK' }>> => {
    const m = await c.next('ACK')
    if (m.type !== 'ACK') throw new Error('no ack')
    return m
  }

  test('renames in the lobby and broadcasts it to everyone', async () => {
    const code = await createRoom()
    const host = await join(code, 'Host')
    const ada = await join(code, 'Ada')
    if (ada.welcome.type !== 'WELCOME') throw new Error('no welcome')
    ada.client.ws.send(
      JSON.stringify({
        type: 'SET_PROFILE',
        name: '  Grace​ ',
        avatar: 'frog',
        color: PLAYER_COLORS[3],
      }),
    )
    expect(await ack(ada.client)).toMatchObject({ intent: 'SET_PROFILE', ok: true })
    const seen = await lobbyWhere(host.client, (m) => m.players.some((p) => p.name === 'Grace'))
    const me = seen.players.find((p) => p.id === (ada.welcome as { playerId: string }).playerId)
    expect(me).toMatchObject({ name: 'Grace', avatar: 'frog', color: PLAYER_COLORS[3] })
    host.client.ws.close()
    ada.client.ws.close()
  })

  test("refuses another member's name and a blank one; keeps unknown avatar/color", async () => {
    const code = await createRoom()
    const host = await join(code, 'Host')
    const ada = await join(code, 'Ada')
    ada.client.ws.send(JSON.stringify({ type: 'SET_PROFILE', name: 'host' }))
    expect(await ack(ada.client)).toMatchObject({ ok: false, reason: 'name_taken' })
    ada.client.ws.send(JSON.stringify({ type: 'SET_PROFILE', name: ' ​ ' }))
    expect(await ack(ada.client)).toMatchObject({ ok: false, reason: 'invalid_name' })
    // Re-spelling your own name is fine; an unknown avatar/color keeps the current one.
    ada.client.ws.send(
      JSON.stringify({ type: 'SET_PROFILE', name: 'ADA', avatar: 'nope', color: 'url(x)' }),
    )
    expect(await ack(ada.client)).toMatchObject({ ok: true })
    const seen = await lobbyWhere(host.client, (m) => m.players.some((p) => p.name === 'ADA'))
    const me = seen.players.find((p) => p.name === 'ADA')
    expect(me).toMatchObject({ avatar: 'owl', color: '#29d3f2' })
    // A malformed shape is refused at the boundary without hurting the server.
    ada.client.ws.send(JSON.stringify({ type: 'SET_PROFILE', name: 42 }))
    expect(await ada.client.next('ERROR')).toMatchObject({ reason: 'malformed message' })
    expect(await healthy()).toBe(true)
    host.client.ws.close()
    ada.client.ws.close()
  })

  test('HOST_CONFIG keeps 0 as auto and caps rounds at MAX_ROUNDS', async () => {
    const code = await createRoom()
    const host = await join(code, 'Host')
    await host.client.next('LOBBY_STATE')
    const config = (rounds: number) =>
      host.client.ws.send(
        JSON.stringify({ type: 'HOST_CONFIG', minigameIds: ['button-masher', 'pang'], rounds }),
      )
    config(40)
    expect((await lobbyAfter(host.client)).rounds).toBe(40)
    config(5000)
    expect((await lobbyAfter(host.client)).rounds).toBe(MAX_ROUNDS)
    config(0)
    expect((await lobbyAfter(host.client)).rounds).toBe(0)
    config(-3)
    expect((await lobbyAfter(host.client)).rounds).toBe(0)
    host.client.ws.close()
  })
})
