import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// BASE_PATH: the game mounted below a path by a reverse proxy. The proxy may pass the prefix through
// or strip it, so both kinds of request must work. `config` reads the env at import, hence the
// dynamic imports after setting it.
process.env.BASE_PATH = '/pixel-party/'
process.env.ALLOWED_ORIGINS = ''

const { config, parseBasePath } = await import('../src/config')
const { CreateRoomUseCase } = await import('../src/application/use-cases/CreateRoomUseCase')
const { JoinRoomUseCase } = await import('../src/application/use-cases/JoinRoomUseCase')
const { CryptoIdGenerator } = await import('../src/infrastructure/driven/id/CryptoIdGenerator')
const { SeededRandom } = await import('../src/infrastructure/driven/random/SeededRandom')
const { SystemClock } = await import('../src/infrastructure/driven/time/SystemClock')
const { loadStaticSite } = await import('../src/infrastructure/driving/http/staticSite')
const { startGameServer } = await import('../src/infrastructure/driving/ws/GameSocket')
const { LiveRooms } = await import('../src/infrastructure/live/LiveRooms')
const { createLogger } = await import('../src/infrastructure/observability/logger')
const { createMetrics } = await import('../src/infrastructure/observability/metrics')

const site = mkdtempSync(join(tmpdir(), 'pp-site-'))
mkdirSync(join(site, 'media'))
writeFileSync(join(site, 'index.html'), '<html><head><base href="/"></head><body></body></html>')
writeFileSync(join(site, 'main-ABCD1234.js'), 'console.log(1)')

let server: ReturnType<typeof startGameServer>
let base: string
beforeAll(() => {
  const clock = new SystemClock()
  const ids = new CryptoIdGenerator()
  const rooms = new LiveRooms(ids, 4, 12, clock, false)
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
    site: loadStaticSite(site, config.basePath) ?? undefined,
  })
  base = `http://localhost:${server.port}`
})

afterAll(() => {
  server.stopLoop()
  server.stop(true)
  rmSync(site, { recursive: true, force: true })
})

describe('BASE_PATH', () => {
  test('is normalised, and rejects anything but path segments', () => {
    expect(config.basePath).toBe('/pixel-party')
    expect(parseBasePath('')).toBe('')
    expect(parseBasePath('/')).toBe('')
    expect(parseBasePath('games/pixel-party')).toBe('/games/pixel-party')
    expect(() => parseBasePath('/a b')).toThrow()
    expect(() => parseBasePath('/x?y')).toThrow()
  })

  test('the page names the mount point in its <base href>', async () => {
    for (const path of ['/pixel-party/', '/pixel-party/room/ABCD', '/']) {
      const html = await (await fetch(`${base}${path}`)).text()
      expect(html).toContain('<base href="/pixel-party/">')
    }
  })

  test('the bare prefix redirects to its trailing slash', async () => {
    const res = await fetch(`${base}/pixel-party?code=ABCD`, { redirect: 'manual' })
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('/pixel-party/?code=ABCD')
  })

  test('assets and the API answer with or without the prefix (both proxy styles)', async () => {
    for (const prefix of ['/pixel-party', '']) {
      expect((await fetch(`${base}${prefix}/main-ABCD1234.js`)).status).toBe(200)
      expect((await fetch(`${base}${prefix}/api/health`)).status).toBe(200)
      const created = await fetch(`${base}${prefix}/api/rooms`, { method: 'POST' })
      expect(created.status).toBe(201)
    }
    // A path that merely starts like the prefix isn't below it (it's just a client route).
    const lookalike = await fetch(`${base}/pixel-partyX/api/health`)
    expect(await lookalike.text()).not.toContain('"ok":true')
  })

  test('the game socket lives below the prefix', async () => {
    const { code } = (await (
      await fetch(`${base}/pixel-party/api/rooms`, { method: 'POST' })
    ).json()) as { code: string }
    const ws = new WebSocket(`ws://localhost:${server.port}/pixel-party/ws?room=${code}`, {
      // @ts-expect-error Bun's WebSocket accepts request headers (the typings only know protocols)
      headers: { Origin: base },
    })
    const welcome = await new Promise<{ type: string }>((resolve, reject) => {
      ws.onopen = () =>
        ws.send(JSON.stringify({ type: 'JOIN', name: 'Ana', color: '#29d3f2', avatar: 'owl' }))
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data))
        if (m.type === 'WELCOME') resolve(m)
      }
      ws.onerror = () => reject(new Error('socket failed'))
    })
    expect(welcome.type).toBe('WELCOME')
    ws.close()
  })
})
