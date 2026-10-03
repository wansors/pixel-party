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

  test('snapshot items carry their fall speed, so y can be extrapolated on the server clock', () => {
    const game = new FruitCatch()
    const s = init(['p'])
    const first = nn(s.items[0])
    const at = first.spawnAt + 400
    const item = nn(game.snapshot(s, at).items.find((i) => i.id === first.id))
    expect(item.fallMs).toBe(first.fallMs)
    // 150 ms later the item is exactly where the extrapolation puts it.
    const later = nn(game.snapshot(s, at + 150).items.find((i) => i.id === first.id))
    expect(later.y).toBeCloseTo(item.y + 150 / item.fallMs)
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

  test('equal scores: fewer bombs caught ranks first, then the longer best combo', () => {
    const game = new FruitCatch()
    const s = init(['bomby', 'streaky', 'steady', 'twin'])
    for (const id of s.players) s.scores.set(id, 10)
    s.bombs.set('bomby', 2)
    s.bestCombos.set('streaky', 8)
    s.bestCombos.set('steady', 4)
    s.bestCombos.set('twin', 4)
    const result = game.getResult(s)
    expect(result.placements).toEqual(['streaky', 'steady', 'twin', 'bomby'])
    expect(result.ranks).toEqual({ streaky: 0, steady: 1, twin: 1, bomby: 3 })
  })

  test('catching tracks bombs and the best combo', () => {
    const game = new FruitCatch()
    let s = init(['p'])
    const [a, b] = [nn(s.items[0]), nn(s.items[1])]
    s = game.onInput(s, 'p', { kind: 'move', x: a.x }, 0)
    s = game.tick(s, 50, a.spawnAt + a.fallMs)
    s = game.tick(s, 50, b.spawnAt + b.fallMs)
    expect(s.bestCombos.get('p')).toBe(2)
    expect(s.bombs.get('p')).toBe(0)
    // next()=0 → every item is a bomb: catching one counts it (and breaks the combo).
    let t = new FruitCatch().init({ players: ['p'], seed: 1, random: { next: () => 0 }, now: 0 })
    const bomb = nn(t.items[0])
    t = game.onInput(t, 'p', { kind: 'move', x: bomb.x }, 0)
    t = game.tick(t, 50, bomb.spawnAt + bomb.fallMs)
    expect(t.bombs.get('p')).toBe(1)
    expect(t.combos.get('p')).toBe(0)
  })
})
