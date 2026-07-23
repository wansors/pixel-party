import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { PixelRain } from './pixelRain'

// Deterministic RNG: next()=0.5 → every obstacle at x=0.5 with a mid fall speed.
const half: Random = { next: () => 0.5 }
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const init = (players: string[], now = 0) =>
  new PixelRain().init({ players, seed: 1, random: half, now, config: { durationMs: 40_000 } })

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
    const now = obs.spawnAt + obs.fallMs // y = 1 ≥ HIT_Y
    s = game.tick(s, 50, now)
    expect(s.alive.get('a')).toBe(false)
    expect(s.diedAt.get('a')).toBe(now)
    expect(s.alive.get('b')).toBe(true)
    expect(s.diedAt.get('b')).toBe(0)
  })

  test('a dead player ignores further input and is not re-hit', () => {
    const game = new PixelRain()
    let s = init(['a'])
    const obs = nn(s.obstacles[0])
    s = game.onInput(s, 'a', { kind: 'move', x: obs.x }, 0)
    const now = obs.spawnAt + obs.fallMs
    s = game.tick(s, 50, now)
    expect(s.alive.get('a')).toBe(false)
    // Input after death is ignored (avatar unchanged).
    s = game.onInput(s, 'a', { kind: 'move', x: 0.1 }, now)
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
    // Timeline fields (spawnAt/fallMs) never leak onto the wire.
    expect(snap.obstacles.every((o) => !('spawnAt' in o) && !('fallMs' in o))).toBe(true)
    expect(snap.alive.p).toBe(true)
  })
})
