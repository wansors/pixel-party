import { describe, expect, test } from 'bun:test'
import { SUMO_ICE } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { SumoIce, type SumoIceState } from './sumoIce'

const game = new SumoIce()
const N = SUMO_ICE.grid
const init = (players: string[], seed = 4): SumoIceState =>
  game.init({
    players,
    seed,
    random: new SeededRandom(seed),
    now: 0,
    config: { durationMs: 45_000 },
  })
const body = (s: SumoIceState, id: string) => {
  const b = s.bodies.get(id)
  if (!b) throw new Error(`no body ${id}`)
  return b
}
const centreOf = (i: number): [number, number] => [
  ((i % N) + 0.5) / N,
  (Math.floor(i / N) + 0.5) / N,
]
const dist = (i: number): number => {
  const [x, y] = centreOf(i)
  return Math.hypot(x - 0.5, y - 0.5)
}

describe('SumoIce', () => {
  test('everyone starts on solid ice; the floe is a disc of tiles with a core that never melts', () => {
    const s = init(['a', 'b', 'c', 'd'])
    const snap = game.snapshot(s, 0)
    expect(snap.tiles).toHaveLength(N * N)
    const ice = [...snap.tiles].filter((c) => c === '#').length
    expect(ice).toBeGreaterThan(100)
    for (const b of snap.bodies) expect(b.alive).toBe(true)
    const core = s.meltAt.filter((t) => t === Number.POSITIVE_INFINITY).length
    expect(core).toBe(9)
    expect(game.snapshot(s, 44_999).tiles.match(/#/g)?.length).toBe(9)
  })

  test('the melt is seeded, waits a few seconds and eats the floe roughly edge first', () => {
    const a = init(['a', 'b'], 8)
    expect(init(['a', 'b'], 8).meltAt).toEqual(a.meltAt)
    const timed = a.meltAt
      .map((t, i) => ({ t, i }))
      .filter((x) => x.t > 0 && Number.isFinite(x.t))
      .sort((x, y) => x.t - y.t)
    expect(timed[0]?.t ?? 0).toBeGreaterThanOrEqual(6000 + SUMO_ICE.crackMs)
    const avg = (xs: { i: number }[]): number => xs.reduce((s, x) => s + dist(x.i), 0) / xs.length
    const fifth = Math.floor(timed.length / 5)
    expect(avg(timed.slice(0, fifth))).toBeGreaterThan(avg(timed.slice(-fifth)) + 0.1)
    // Everything but the core is gone with seconds to spare for the final fight.
    expect(timed.at(-1)?.t ?? 0).toBeLessThanOrEqual(45_000 - 7000)
  })

  test('a tile cracks before it sinks', () => {
    const s = init(['a'])
    const i = s.meltAt.findIndex((t) => t > 0 && Number.isFinite(t))
    const melt = s.meltAt[i] ?? 0
    expect(game.snapshot(s, melt - SUMO_ICE.crackMs - 1).tiles[i]).toBe('#')
    expect(game.snapshot(s, melt - 1).tiles[i]).toBe('%')
    expect(game.snapshot(s, melt).tiles[i]).toBe('.')
  })

  test('the first fall is a lifebuoy back onto the core; the second one is out', () => {
    const s = init(['a', 'b'])
    const i = s.meltAt.findIndex((t) => t > 0 && Number.isFinite(t))
    const melt = s.meltAt[i] ?? 0
    const [x, y] = centreOf(i)
    const a = body(s, 'a')
    Object.assign(a, { x, y, vx: 0, vy: 0 })
    game.tick(s, 50, melt - 100)
    expect(a.alive).toBe(true) // still cracking: it holds
    game.tick(s, 50, melt)
    expect(a.alive).toBe(true)
    expect(a.lives).toBe(1)
    expect(Math.hypot(a.x - 0.5, a.y - 0.5)).toBeLessThan(0.05) // fished out onto the core
    expect(game.snapshot(s, melt + 100).bodies.find((b) => b.id === 'a')?.ghost).toBe(true)
    expect(game.snapshot(s, melt + SUMO_ICE.ghostMs).bodies.find((b) => b.id === 'a')?.ghost).toBe(
      false,
    )
    // A ghost passes through others instead of shoving them.
    const b = body(s, 'b')
    Object.assign(b, { x: a.x + 0.03, y: a.y, vx: -0.3, vy: 0 })
    game.tick(s, 50, melt + 50)
    expect(a.vx).toBe(0)
    // Second time in: out.
    Object.assign(a, { x, y, vx: 0, vy: 0 })
    game.tick(s, 50, melt + 2000)
    expect(a.alive).toBe(false)
    expect(game.isFinished(s, melt + 2000)).toBe(true) // one left
  })

  test('ice is slippery: a released body keeps sliding much longer than on the dohyo', () => {
    const s = init(['a'])
    const a = body(s, 'a')
    Object.assign(a, { x: 0.5, y: 0.5, vx: 0.4, vy: 0 })
    for (let t = 50; t <= 1000; t += 50) game.tick(s, 50, t)
    // Sumo's friction (2.0/s) would leave ~14 % of the speed after a second; ice keeps over half.
    expect(a.vx).toBeGreaterThan(0.2)
  })

  test('shoves transfer momentum', () => {
    const s = init(['a', 'b'])
    Object.assign(body(s, 'a'), { x: 0.5, y: 0.5, vx: 0.4, vy: 0 })
    Object.assign(body(s, 'b'), { x: 0.57, y: 0.5, vx: 0, vy: 0 })
    game.tick(s, 50, 50)
    expect(body(s, 'b').vx).toBeGreaterThan(0.2)
    expect(body(s, 'a').vx).toBeLessThan(0.2)
  })

  test('ranks by survival time; ignores junk steering', () => {
    const s = init(['a', 'b', 'c'])
    Object.assign(body(s, 'a'), { alive: false, outAt: 9000 })
    Object.assign(body(s, 'b'), { alive: false, outAt: 20_000 })
    const result = game.getResult(s)
    expect(result.placements).toEqual(['c', 'b', 'a'])
    expect(result.stats?.b).toBe('20s')
    game.onInput(s, 'c', { kind: 'move', dx: Number.NaN, dy: 1 }, 100)
    expect(body(s, 'c').ay).toBe(0)
    game.onInput(s, 'c', { kind: 'move', dx: 3, dy: 4 }, 100)
    expect(body(s, 'c').ax).toBeCloseTo(0.6)
  })
})
