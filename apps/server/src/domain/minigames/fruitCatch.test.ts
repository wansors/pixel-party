import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { FruitCatch } from './fruitCatch'

// Deterministic RNG: next()=0.5 → every item is a fruit (0.5 ≥ BOMB_CHANCE) at x=0.5, mid fall speed.
const half: Random = { next: () => 0.5 }
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const init = (players: string[], now = 0) =>
  new FruitCatch().init({ players, seed: 1, random: half, now, config: { durationMs: 30_000 } })

describe('FruitCatch', () => {
  test('builds a seeded item stream (deterministic from the Random port)', () => {
    const a = init(['p'])
    const b = init(['p'])
    expect(a.items.length).toBeGreaterThan(0)
    expect(a.items.map((i) => i.spawnAt)).toEqual(b.items.map((i) => i.spawnAt))
    // next()=0.5 → all fruit at mid x.
    expect(a.items.every((i) => i.kind === 'fruit')).toBe(true)
    expect(a.items[0]?.x).toBeCloseTo(0.5)
  })

  test('a bomb roll happens for a low RNG value', () => {
    const bombRng: Random = { next: () => 0 } // 0 < BOMB_CHANCE → bomb
    const s = new FruitCatch().init({ players: ['p'], seed: 1, random: bombRng, now: 0 })
    expect(s.items.every((i) => i.kind === 'bomb')).toBe(true)
  })

  test('catches a fruit when the basket overlaps at the catch line', () => {
    const game = new FruitCatch()
    let s = init(['p'])
    const item = nn(s.items[0])
    s = game.onInput(s, 'p', { kind: 'move', x: item.x }, 0)
    const now = item.spawnAt + item.fallMs // y = 1 ≥ CATCH_Y
    s = game.tick(s, 50, now)
    expect(s.scores.get('p')).toBe(1)
    expect(s.combos.get('p')).toBe(1)
    // The item is resolved: ticking again does not double-count.
    s = game.tick(s, 50, now + 50)
    expect(s.scores.get('p')).toBe(1)
  })

  test('missing a fruit (basket elsewhere) resets the combo, no score', () => {
    const game = new FruitCatch()
    let s = init(['p'])
    const item = nn(s.items[0])
    s.combos.set('p', 3)
    s = game.onInput(s, 'p', { kind: 'move', x: 0 }, 0) // far from x=0.5
    s = game.tick(s, 50, item.spawnAt + item.fallMs)
    expect(s.scores.get('p')).toBe(0)
    expect(s.combos.get('p')).toBe(0)
  })

  test('snapshot exposes only on-screen items and hides the timeline', () => {
    const game = new FruitCatch()
    const s = init(['p'])
    const first = nn(s.items[0])
    const snap = game.snapshot(s, first.spawnAt + 10)
    expect(snap.items.some((i) => i.id === first.id)).toBe(true)
    expect(snap.items.every((i) => i.y >= 0 && i.y <= 1)).toBe(true)
    expect(snap.scores.p).toBe(0)
  })

  test('ranks by score descending', () => {
    const game = new FruitCatch()
    let s = init(['a', 'b'])
    const item = nn(s.items[0])
    s = game.onInput(s, 'a', { kind: 'move', x: item.x }, 0)
    s = game.onInput(s, 'b', { kind: 'move', x: 0 }, 0)
    s = game.tick(s, 50, item.spawnAt + item.fallMs)
    const result = game.getResult(s)
    expect(result.placements[0]).toBe('a')
    expect(result.ranks?.a).toBe(0)
    expect(result.ranks?.b).toBe(1)
  })
})
