import { describe, expect, test } from 'bun:test'
import { ASTEROIDS } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { Asteroids, type AsteroidsState } from './asteroids'

const game = new Asteroids()
const init = (players: string[], seed = 9): AsteroidsState =>
  game.init({
    players,
    seed,
    random: new SeededRandom(seed),
    now: 0,
    config: { durationMs: 60_000 },
  })
const ship = (s: AsteroidsState, id: string) => {
  const x = s.ships.find((q) => q.id === id)
  if (!x) throw new Error(`no ship ${id}`)
  return x
}
const run = (s: AsteroidsState, from: number, to: number): number => {
  let t = from
  while (t + 50 <= to) {
    t += 50
    game.tick(s, 50, t)
  }
  return t
}
// An empty sky (no rocks, no refills) for controlled checks.
const clear = (s: AsteroidsState): void => {
  s.rocks = []
  s.lastRefillAt = Number.POSITIVE_INFINITY
}

describe('Asteroids', () => {
  test('ships start around the centre, shielded; the first rocks keep their distance', () => {
    const s = init(['a', 'b', 'c'])
    expect(s.rocks).toHaveLength(6)
    expect(s.rocks.every((r) => r.size === 3)).toBe(true)
    for (const sh of s.ships) {
      expect(sh.alive).toBe(true)
      expect(sh.shieldUntil).toBe(ASTEROIDS.shieldMs)
    }
    expect(init(['a', 'b', 'c']).rocks).toEqual(s.rocks)
  })

  test('rotate and thrust; the arena wraps around', () => {
    const s = init(['a'])
    clear(s)
    const a = ship(s, 'a')
    Object.assign(a, { x: 1.55, y: 0.5, a: 0, vx: 0.5, vy: 0 })
    game.onInput(s, 'a', { kind: 'controls', rot: 1, thrust: true, fire: false }, 0)
    run(s, 0, 500)
    expect(a.a).toBeGreaterThan(1.5) // ~3.8 rad/s
    expect(a.x).toBeLessThan(0.5) // went off the right edge, came back on the left
    expect(Math.hypot(a.vx, a.vy)).toBeGreaterThan(0.4)
  })

  test('the gun fires at its cadence, at most four bullets in flight, which fade out', () => {
    const s = init(['a'])
    clear(s)
    game.onInput(s, 'a', { kind: 'controls', rot: 0, thrust: false, fire: true }, 0)
    run(s, 0, 450)
    expect(s.bullets.length).toBe(2) // fired at t=50 and t=300 (220 ms apart, on 50 ms ticks)
    run(s, 450, 800)
    expect(s.bullets.length).toBeLessThanOrEqual(4)
    game.onInput(s, 'a', { kind: 'controls', rot: 0, thrust: false, fire: false }, 800)
    run(s, 800, 2000)
    expect(s.bullets).toHaveLength(0)
  })

  test('a shot splits a big rock into two medium ones and scores; the smallest just break', () => {
    const s = init(['a'])
    clear(s)
    const a = ship(s, 'a')
    Object.assign(a, { x: 0.3, y: 0.5, a: 0, vx: 0, vy: 0 })
    s.rocks = [{ id: 99, x: 0.6, y: 0.5, vx: 0, vy: 0.01, size: 3 }]
    game.onInput(s, 'a', { kind: 'controls', rot: 0, thrust: false, fire: true }, 0)
    run(s, 0, 350)
    expect(a.score).toBe(ASTEROIDS.rockPts[3])
    expect(s.rocks.map((r) => r.size)).toEqual([2, 2])
    s.rocks = [{ id: 7, x: 0.45, y: 0.5, vx: 0, vy: 0, size: 1 }]
    run(s, 350, 900)
    expect(s.rocks).toHaveLength(0)
    expect(a.score).toBe((ASTEROIDS.rockPts[3] ?? 0) + (ASTEROIDS.rockPts[1] ?? 0))
  })

  test('shooting an unshielded rival pays most; they respawn later, shielded', () => {
    const s = init(['a', 'b'])
    clear(s)
    const [a, b] = [ship(s, 'a'), ship(s, 'b')]
    Object.assign(a, { x: 0.3, y: 0.5, a: 0, vx: 0, vy: 0, shieldUntil: 0 })
    Object.assign(b, { x: 0.6, y: 0.5, vx: 0, vy: 0, shieldUntil: 1_000_000, piloted: true })
    game.onInput(s, 'a', { kind: 'controls', rot: 0, thrust: false, fire: true }, 0)
    run(s, 0, 400)
    expect(b.alive).toBe(true) // shield up
    b.shieldUntil = 0
    run(s, 400, 900)
    expect(b.alive).toBe(false)
    expect(a.score).toBe(ASTEROIDS.rivalPts)
    expect(a.kills).toBe(1)
    game.onInput(s, 'a', { kind: 'controls', rot: 0, thrust: false, fire: false }, 900)
    run(s, 900, 900 + ASTEROIDS.respawnMs + 100)
    expect(b.alive).toBe(true)
    expect(b.shieldUntil).toBeGreaterThan(900 + ASTEROIDS.respawnMs)
  })

  test('flying into a rock blows the ship up and breaks the rock, for no points', () => {
    const s = init(['a'])
    clear(s)
    const a = ship(s, 'a')
    Object.assign(a, { x: 0.5, y: 0.5, vx: 0, vy: 0, shieldUntil: 0, piloted: true })
    s.rocks = [{ id: 1, x: 0.52, y: 0.5, vx: 0, vy: 0, size: 2 }]
    run(s, 0, 50)
    expect(a.alive).toBe(false)
    expect(a.score).toBe(0)
    expect(s.rocks.map((r) => r.size)).toEqual([1, 1])
  })

  test('the field is topped up; the round runs on the clock; ranked by score then kills', () => {
    const s = init(['a', 'b', 'c'])
    s.rocks = []
    s.lastRefillAt = 0
    run(s, 0, 2000)
    expect(s.rocks.length).toBe(1)
    expect(game.isFinished(s, 59_999)).toBe(false)
    expect(game.isFinished(s, 60_000)).toBe(true)
    Object.assign(ship(s, 'a'), { score: 300, kills: 0 })
    Object.assign(ship(s, 'b'), { score: 300, kills: 1 })
    Object.assign(ship(s, 'c'), { score: 500, kills: 0 })
    expect(game.getResult(s).placements).toEqual(['c', 'b', 'a'])
    game.onInput(s, 'a', { kind: 'controls', rot: 7 as 1, thrust: true, fire: false }, 0)
    expect(ship(s, 'a').rot).toBe(0)
  })

  test('a bigger field gets a bigger rock supply; up to four pilots keep the tuned one', () => {
    const four = init(['a', 'b', 'c', 'd'])
    expect(four.rocks).toHaveLength(6)
    expect([four.minMass, four.refillMs]).toEqual([16, 1800])
    const twelve = init(Array.from({ length: 12 }, (_, i) => `p${i}`))
    expect(twelve.rocks).toHaveLength(10)
    expect([twelve.minMass, twelve.refillMs]).toEqual([28, 600])
  })

  test('a ship nobody has piloted yet is a ghost: no kill to farm, no rock to ram', () => {
    const s = init(['a', 'b'])
    clear(s)
    const [a, b] = [ship(s, 'a'), ship(s, 'b')]
    Object.assign(a, { x: 0.3, y: 0.5, a: 0, vx: 0, vy: 0, shieldUntil: 0 })
    Object.assign(b, { x: 0.6, y: 0.5, vx: 0, vy: 0, shieldUntil: 0 })
    s.rocks = [{ id: 1, x: 0.6, y: 0.62, vx: 0, vy: -0.2, size: 1 }] // drifts through b
    game.onInput(s, 'a', { kind: 'controls', rot: 0, thrust: false, fire: true }, 0)
    run(s, 0, 900)
    expect(b.alive).toBe(true)
    expect(a.kills).toBe(0)
    expect(game.snapshot(s, 900).ships.map((x) => x.idle)).toEqual([false, true])
    // A neutral keep-alive doesn't unpark it; the first real control does, behind a fresh shield.
    game.onInput(s, 'b', { kind: 'controls', rot: 0, thrust: false, fire: false }, 900)
    expect(b.piloted).toBe(false)
    game.onInput(s, 'b', { kind: 'controls', rot: 1, thrust: false, fire: false }, 900)
    expect(b.piloted).toBe(true)
    expect(b.shieldUntil).toBe(900 + ASTEROIDS.shieldMs)
  })

  test('a pilot who leaves takes their ship and bullets out of the sky; the others keep theirs', () => {
    const s = init(['a', 'b', 'c'])
    clear(s)
    for (const id of ['a', 'b', 'c'])
      game.onInput(s, id, { kind: 'controls', rot: 0, thrust: false, fire: true }, 0)
    run(s, 0, 100)
    expect(s.bullets.map((b) => b.owner)).toEqual([0, 1, 2])
    game.leave(s, 'b', 100)
    run(s, 100, 10_000)
    expect(ship(s, 'b').alive).toBe(false)
    const snap = game.snapshot(s, 10_000)
    expect(snap.ships.map((x) => x.id)).toEqual(['a', 'c'])
    // Bullets name their shooter by index into the ships on the wire.
    expect(new Set(snap.bullets.map((b) => b[4]))).toEqual(new Set([0, 1]))
    expect(game.getResult(s).placements).toContain('b')
  })
})
