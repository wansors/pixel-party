import { describe, expect, test } from 'bun:test'
import { FRUIT } from '@pp/shared'
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

  test('the shower picks up non-linearly: the last quarter tightens far more than the first', () => {
    // A constant RNG isolates the curve (every gap and fall time is the ramp multiplier at work).
    const s = init(['p'])
    const at = (ms: number) => {
      const i = s.items.findIndex((o) => o.spawnAt >= ms)
      const o = nn(s.items[i])
      return { gap: o.spawnAt - nn(s.items[i - 1]).spawnAt, fall: o.fallMs }
    }
    const [q0, q1, q3, q4] = [at(1000), at(7500), at(22_500), at(29_000)]
    expect(q3.gap - q4.gap).toBeGreaterThan(2 * (q0.gap - q1.gap))
    expect(q3.fall - q4.fall).toBeGreaterThan(2 * (q0.fall - q1.fall))
    expect(q4.fall).toBeLessThan(q0.fall * 0.6)
    // More bombs late: a roll that is fruit at the start is a bomb at the end.
    const late = new FruitCatch().init({
      players: ['p'],
      seed: 1,
      random: { next: () => 0.25 },
      now: 0,
      config: { durationMs: 30_000 },
    })
    expect(late.items[0]?.kind).toBe('fruit')
    expect(late.items.at(-1)?.kind).toBe('bomb')
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
    s = game.tick(s, 1000, 0) // the basket slides there
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
    s = game.tick(s, 1000, 0) // the basket slides there
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
    s = game.tick(s, 1000, 0) // the basket slides there
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
    s = game.tick(s, 1000, 0) // the basket slides there
    s = game.tick(s, 50, a.spawnAt + a.fallMs)
    s = game.tick(s, 50, b.spawnAt + b.fallMs)
    expect(s.bestCombos.get('p')).toBe(2)
    expect(s.bombs.get('p')).toBe(0)
    // next()=0 → every item is a bomb: catching one counts it (and breaks the combo).
    let t = new FruitCatch().init({ players: ['p'], seed: 1, random: { next: () => 0 }, now: 0 })
    const bomb = nn(t.items[0])
    t = game.onInput(t, 'p', { kind: 'move', x: bomb.x }, 0)
    t = game.tick(t, 1000, 0) // the basket slides there
    t = game.tick(t, 50, bomb.spawnAt + bomb.fallMs)
    expect(t.bombs.get('p')).toBe(1)
    expect(t.combos.get('p')).toBe(0)
  })
})

describe('FruitCatch basket speed', () => {
  test('the basket slides toward its target at BASKET_SPEED instead of teleporting', () => {
    const game = new FruitCatch()
    let s = game.init({ players: ['p'], seed: 1, random: { next: () => 0.5 }, now: 0 })
    s = game.onInput(s, 'p', { kind: 'move', x: 1 }, 0)
    s = game.tick(s, 50, 50)
    expect(s.baskets.get('p')).toBeCloseTo(0.5 + (FRUIT.basketSpeed * 50) / 1000, 6)
    s = game.tick(s, 1000, 1050)
    expect(s.baskets.get('p')).toBe(1)
  })
})

describe('FruitCatch basket width', () => {
  test('a fruit just inside the basket’s reach is caught; just outside it is missed', () => {
    const game = new FruitCatch()
    for (const [offset, caught] of [
      [FRUIT.basketHalf - 0.005, 1],
      [FRUIT.basketHalf + 0.005, 0],
    ] as const) {
      let s = game.init({ players: ['p'], seed: 1, random: { next: () => 0.5 }, now: 0 })
      const item = s.items[0] as NonNullable<(typeof s.items)[0]>
      s = game.onInput(s, 'p', { kind: 'move', x: item.x + offset }, 0)
      s = game.tick(s, 1000, 0)
      s = game.tick(s, 0, item.spawnAt + item.fallMs)
      expect(s.scores.get('p')).toBe(caught)
    }
  })
})
