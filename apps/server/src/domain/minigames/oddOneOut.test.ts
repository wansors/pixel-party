import { describe, expect, test } from 'bun:test'
import { ODD_ONE_OUT_WRONG_COOLDOWN_MS } from '@pp/shared'
import type { Random } from '../ports/Random'
import { OddOneOut, type OddOneOutState } from './oddOneOut'

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
    // A 6x6 board late in the run: spam cells 35, 34, … every 50 ms until it clears.
    s.level.set('spammer', 20)
    let t = 0
    for (let cell = 35; s.level.get('spammer') === 20; t += 50) {
      const before = s.cooldownUntil.get('spammer') ?? 0
      s = tap(s, 'spammer', cell, t)
      if ((s.cooldownUntil.get('spammer') ?? 0) !== before) cell--
    }
    const misses = 35 - odd(s, 'spammer')
    expect(t).toBeGreaterThanOrEqual(misses * ODD_ONE_OUT_WRONG_COOLDOWN_MS)
  })

  test('a player gone mid-round no longer holds the early finish', () => {
    let s = init(['a', 'b'])
    s.level.set('a', s.boards.length)
    expect(game.isFinished(s, 1000)).toBe(false)
    s = game.leave(s, 'b')
    expect(game.isFinished(s, 1000)).toBe(true)
  })
})
