import { describe, expect, test } from 'bun:test'
import { ODD_ONE_OUT_WRONG_COOLDOWN_MS } from '@pp/shared'
import type { Random } from '../ports/Random'
import { OddOneOut, type OddOneOutState, oddOneOutDelta, oddOneOutSide } from './oddOneOut'

const zero: Random = { next: () => 0 }
const game = new OddOneOut()
const init = (players: string[]) =>
  game.init({ players, seed: 1, random: zero, now: 0, config: { durationMs: 40_000 } })
const odd = (s: OddOneOutState, id: string) =>
  s.boards[s.level.get(id) as number]?.oddCell as number
const tap = (s: OddOneOutState, id: string, cell: number, now: number) =>
  game.onInput(s, id, { kind: 'tap', level: s.level.get(id) as number, cell }, now)

describe('OddOneOut', () => {
  test('the odd tile clears the level', () => {
    const s = tap(init(['a']), 'a', 0, 100) // zero random -> the odd tile is cell 0
    expect(s.level.get('a')).toBe(1)
    expect(s.lastClearMs.get('a')).toBe(100)
  })

  test('a wrong tile starts a cooldown that ignores every tap until it runs out', () => {
    let s = init(['a', 'b'])
    s = tap(s, 'a', odd(s, 'a') + 1, 1000)
    expect(s.level.get('a')).toBe(0)
    expect(game.snapshot(s, 1000).cooldowns).toEqual({ a: ODD_ONE_OUT_WRONG_COOLDOWN_MS, b: 0 })
    // Even the right tile is ignored meanwhile (and doesn't extend the penalty).
    s = tap(s, 'a', odd(s, 'a'), 1000 + ODD_ONE_OUT_WRONG_COOLDOWN_MS - 1)
    expect(s.level.get('a')).toBe(0)
    expect(game.snapshot(s, 1500).cooldowns.a).toBe(ODD_ONE_OUT_WRONG_COOLDOWN_MS - 500)
    s = tap(s, 'a', odd(s, 'a'), 1000 + ODD_ONE_OUT_WRONG_COOLDOWN_MS)
    expect(s.level.get('a')).toBe(1)
  })

  test('tapping every tile in turn is slower than finding the odd one', () => {
    let s = init(['spammer'])
    // A 7x7 board late in the run: spam cells 48, 47, … every 50 ms until it clears.
    s.level.set('spammer', 20)
    // 48 misses at a second each outlast the round: give the spammer all the time they need.
    s.endsAt = 120_000
    const last = (s.boards[20]?.cols ?? 0) * (s.boards[20]?.rows ?? 0) - 1
    expect(last).toBe(48)
    let t = 0
    for (let cell = last; s.level.get('spammer') === 20; t += 50) {
      const before = s.cooldownUntil.get('spammer') ?? 0
      s = tap(s, 'spammer', cell, t)
      if ((s.cooldownUntil.get('spammer') ?? 0) !== before) cell--
    }
    const misses = last - odd(s, 'spammer')
    expect(t).toBeGreaterThanOrEqual(misses * ODD_ONE_OUT_WRONG_COOLDOWN_MS)
  })

  test('the odd tile gets subtler by a steady percentage, with no plateau', () => {
    // How hard the odd tile is to see ~ 1 / its brightness gap.
    const subtlety = (level: number): number => 1 / oddOneOutDelta(level)
    expect(oddOneOutDelta(0)).toBe(72)
    for (let level = 1; level < 30; level++) {
      // Strictly subtler every level until the gap is down to single digits (where rounding can hold
      // a value for a level), never wider again.
      if (level <= 19) expect(oddOneOutDelta(level)).toBeLessThan(oddOneOutDelta(level - 1))
      else expect(oddOneOutDelta(level)).toBeLessThanOrEqual(oddOneOutDelta(level - 1))
    }
    // Non-linear: level 8 → 9 is a bigger jump in subtlety than 1 → 2 (and 15 → 16 bigger still).
    expect(subtlety(9) - subtlety(8)).toBeGreaterThan(subtlety(2) - subtlety(1))
    expect(subtlety(16) - subtlety(15)).toBeGreaterThan(subtlety(9) - subtlety(8))
    // The old schedule went flat at a gap of 14 from level 14; this one keeps going to 5.
    expect(oddOneOutDelta(16)).toBeLessThan(10)
    expect(oddOneOutDelta(29)).toBe(5)
    // The grid grows to 7x7 and stops there.
    expect([0, 2, 4, 6, 8, 10, 29].map(oddOneOutSide)).toEqual([2, 3, 4, 5, 6, 7, 7])
    // Odd tiles come both lighter and darker than the rest.
    let x = 7
    const lcg: Random = {
      next: () => {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0
        return x / 2 ** 32
      },
    }
    const s = game.init({ players: ['a'], seed: 7, random: lcg, now: 0 })
    const lum = (c: number): number => (c >> 16) + ((c >> 8) & 0xff) + (c & 0xff)
    const lighter = s.boards.filter((b) => lum(b.odd) > lum(b.base)).length
    expect(lighter).toBeGreaterThan(0)
    expect(lighter).toBeLessThan(s.boards.length)
  })

  test('a player gone mid-round no longer holds the early finish', () => {
    let s = init(['a', 'b'])
    s.level.set('a', s.boards.length)
    expect(game.isFinished(s, 1000)).toBe(false)
    s = game.leave(s, 'b')
    expect(game.isFinished(s, 1000)).toBe(true)
  })
})
