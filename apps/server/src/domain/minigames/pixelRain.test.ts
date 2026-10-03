import { describe, expect, test } from 'bun:test'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import type { Random } from '../ports/Random'
import { AVATAR_MAX_X, AVATAR_MIN_X, MAX_SPEED, PixelRain, type PixelRainState } from './pixelRain'

// Deterministic RNG: next()=0.5 → every obstacle at x=0.5 with a mid fall speed.
const half: Random = { next: () => 0.5 }
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const init = (players: string[], now = 0) =>
  new PixelRain().init({ players, seed: 1, random: half, now, config: { durationMs: 40_000 } })
// Ticks the first 400 ms (before any block lands) so avatars reach where their players steered them.
const settle = (game: PixelRain, s: PixelRainState): PixelRainState => {
  let out = s
  for (let now = 0; now <= 400; now += 50) out = game.tick(out, 50, now)
  return out
}

describe('PixelRain', () => {
  test('builds a seeded obstacle timeline (deterministic from the Random port)', () => {
    const a = init(['p'])
    const b = init(['p'])
    expect(a.obstacles.length).toBeGreaterThan(0)
    expect(a.obstacles.map((o) => o.spawnAt)).toEqual(b.obstacles.map((o) => o.spawnAt))
    // next()=0.5 → all obstacles at mid x.
    expect(a.obstacles[0]?.x).toBeCloseTo(0.5)
    expect(a.alive.get('p')).toBe(true)
  })

  test('a player under an obstacle dies while one who dodges survives', () => {
    const game = new PixelRain()
    let s = init(['a', 'b'])
    const obs = nn(s.obstacles[0])
    s = game.onInput(s, 'a', { kind: 'move', x: obs.x }, 0) // stands under it
    s = game.onInput(s, 'b', { kind: 'move', x: 0 }, 0) // far to the left
    s = settle(game, s)
    const now = obs.spawnAt + obs.fallMs // y = 1 ≥ HIT_Y
    s = game.tick(s, 50, now)
    expect(s.alive.get('a')).toBe(false)
    expect(s.diedAt.get('a')).toBe(now)
    expect(s.alive.get('b')).toBe(true)
    expect(s.diedAt.get('b')).toBe(0)
  })

  test('ends as soon as only one player is left standing', () => {
    const game = new PixelRain()
    let s = init(['a', 'b'])
    const obs = nn(s.obstacles[0])
    s = game.onInput(s, 'a', { kind: 'move', x: obs.x }, 0)
    s = game.onInput(s, 'b', { kind: 'move', x: 0 }, 0)
    s = settle(game, s)
    expect(game.isFinished(s, 0)).toBe(false)
    s = game.tick(s, 50, obs.spawnAt + obs.fallMs)
    expect(game.isFinished(s, obs.spawnAt + obs.fallMs)).toBe(true)
    expect(game.getResult(s).placements[0]).toBe('b')
  })

  test('a solo round runs until the lone player is out', () => {
    const game = new PixelRain()
    let s = init(['solo'])
    const obs = nn(s.obstacles[0])
    s = game.onInput(s, 'solo', { kind: 'move', x: 0 }, 0)
    s = settle(game, s)
    s = game.tick(s, 50, obs.spawnAt + obs.fallMs)
    expect(game.isFinished(s, obs.spawnAt + obs.fallMs)).toBe(false)
  })

  test('a dead player ignores further input and is not re-hit', () => {
    const game = new PixelRain()
    let s = init(['a'])
    const obs = nn(s.obstacles[0])
    s = game.onInput(s, 'a', { kind: 'move', x: obs.x }, 0)
    const now = obs.spawnAt + obs.fallMs
    s = game.tick(s, 50, now)
    expect(s.alive.get('a')).toBe(false)
    // Input after death is ignored (target and avatar unchanged).
    s = game.onInput(s, 'a', { kind: 'move', x: 0.2 }, now)
    expect(s.targets.get('a')).toBeCloseTo(obs.x)
    expect(s.avatars.get('a')).toBeCloseTo(obs.x)
    // diedAt is not overwritten on later ticks.
    s = game.tick(s, 50, now + 50)
    expect(s.diedAt.get('a')).toBe(now)
  })

  test('getResult ranks the survivor above the dead', () => {
    const game = new PixelRain()
    let s = init(['a', 'b'])
    const obs = nn(s.obstacles[0])
    s = game.onInput(s, 'a', { kind: 'move', x: obs.x }, 0)
    s = game.onInput(s, 'b', { kind: 'move', x: 0 }, 0)
    s = settle(game, s)
    s = game.tick(s, 50, obs.spawnAt + obs.fallMs)
    const result = game.getResult(s)
    expect(result.placements[0]).toBe('b')
    expect(result.ranks?.b).toBe(0)
    expect(result.ranks?.a).toBe(1)
    expect(result.stats?.a.endsWith('s')).toBe(true)
  })

  test('isFinished when every player is dead before the deadline', () => {
    const game = new PixelRain()
    let s = init(['a'])
    const obs = nn(s.obstacles[0])
    s = game.onInput(s, 'a', { kind: 'move', x: obs.x }, 0)
    const now = obs.spawnAt + obs.fallMs
    expect(game.isFinished(s, now - 1)).toBe(false)
    s = game.tick(s, 50, now)
    expect(game.isFinished(s, now)).toBe(true)
  })

  test('snapshot exposes only on-screen obstacles and hides the timeline', () => {
    const game = new PixelRain()
    const s = init(['p'])
    const first = nn(s.obstacles[0])
    const snap = game.snapshot(s, first.spawnAt + 10)
    expect(snap.obstacles.some((o) => o.id === first.id)).toBe(true)
    expect(snap.obstacles.every((o) => o.y >= 0 && o.y <= 1)).toBe(true)
    // The fall speed goes on the wire (the client extrapolates y); the spawn timeline never does.
    expect(snap.obstacles.every((o) => !('spawnAt' in o) && o.fallMs > 0)).toBe(true)
    expect(snap.alive.p).toBe(true)
  })

  test('a player who leaves is out, so the last one standing wins without waiting', () => {
    const game = new PixelRain()
    let s = init(['a', 'b'])
    s = game.leave(s, 'b', 3000)
    expect(s.alive.get('b')).toBe(false)
    expect(s.diedAt.get('b')).toBe(3000)
    expect(game.isFinished(s, 3000)).toBe(true)
    expect(game.getResult(s).placements[0]).toBe('a')
  })

  test('the avatar slides toward the steered x at a capped speed (a drag cannot teleport it)', () => {
    const game = new PixelRain()
    let s = init(['p'])
    s = game.onInput(s, 'p', { kind: 'move', x: 0.85 }, 0)
    s = game.tick(s, 50, 0)
    expect(s.avatars.get('p')).toBeCloseTo(0.5 + MAX_SPEED * 0.05)
    s = settle(game, s)
    expect(s.avatars.get('p')).toBeCloseTo(0.85)
  })

  test('the avatar is held inside the street the blocks rain on', () => {
    const game = new PixelRain()
    let s = init(['p'])
    s = game.onInput(s, 'p', { kind: 'move', x: 0 }, 0)
    expect(s.targets.get('p')).toBeCloseTo(AVATAR_MIN_X)
    s = game.onInput(s, 'p', { kind: 'move', x: 1 }, 0)
    expect(s.targets.get('p')).toBeCloseTo(AVATAR_MAX_X)
  })

  test('hugging a wall gets as much rain as the middle of the street', () => {
    // Over many real seeded streams, count the blocks landing within reach of an avatar parked at each
    // spot: the walls must not be a shelter (they used to get about a third of the centre's rain).
    const hits = { left: 0, mid: 0, right: 0 }
    for (let seed = 1; seed <= 40; seed++) {
      const s = new PixelRain().init({
        players: ['p'],
        seed,
        random: new SeededRandom(seed),
        now: 0,
        config: { durationMs: 30_000 },
      })
      for (const o of s.obstacles) {
        if (Math.abs(o.x - AVATAR_MIN_X) <= 0.09) hits.left++
        if (Math.abs(o.x - 0.5) <= 0.09) hits.mid++
        if (Math.abs(o.x - AVATAR_MAX_X) <= 0.09) hits.right++
      }
    }
    expect(hits.left / hits.mid).toBeGreaterThan(0.85)
    expect(hits.right / hits.mid).toBeGreaterThan(0.85)
  })

  test('a wall camper is squashed about as soon as a player standing still in the middle', () => {
    let camper = 0
    let idle = 0
    for (let seed = 1; seed <= 40; seed++) {
      const game = new PixelRain()
      let s = game.init({
        players: ['camper', 'idle'],
        seed,
        random: new SeededRandom(seed),
        now: 0,
        config: { durationMs: 30_000 },
      })
      s = game.onInput(s, 'camper', { kind: 'move', x: 1 }, 0)
      for (let now = 0; now <= 30_000; now += 50) s = game.tick(s, 50, now)
      const survival = (id: string): number => s.diedAt.get(id) || 30_000
      camper += survival('camper')
      idle += survival('idle')
    }
    expect(camper / idle).toBeLessThan(1.3)
  })

  test('the rain picks up over the round: denser and faster at the end', () => {
    const s = new PixelRain().init({
      players: ['p'],
      seed: 7,
      random: new SeededRandom(7),
      now: 0,
      config: { durationMs: 30_000 },
    })
    const early = s.obstacles.filter((o) => o.spawnAt < 7500)
    const late = s.obstacles.filter((o) => o.spawnAt >= 22_500)
    const meanFall = (os: typeof early): number =>
      os.reduce((sum, o) => sum + o.fallMs, 0) / os.length
    expect(late.length).toBeGreaterThan(early.length * 1.4)
    expect(meanFall(late)).toBeLessThan(meanFall(early) * 0.8)
  })
})
