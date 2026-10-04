import { describe, expect, test } from 'bun:test'
import { NUMBER_RUSH_WRONG_COOLDOWN_MS } from '@pp/shared'
import type { Random } from '../ports/Random'
import { NumberRush, type NumberRushState } from './numberRush'

const zero: Random = { next: () => 0 }
const lcg = (seed: number): Random => {
  let x = seed >>> 0
  return {
    next: () => {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0
      return x / 2 ** 32
    },
  }
}
const game = new NumberRush()
const init = (players: string[]) =>
  game.init({ players, seed: 1, random: zero, now: 0, config: { durationMs: 40_000 } })
// Taps every number in order for `id`, finishing at `now`.
const clear = (s: NumberRushState, id: string, now: number) => {
  for (let n = 1; n <= s.grid.length; n++)
    game.onInput(s, id, { kind: 'tap', cell: s.grid.indexOf(n) }, now)
  return s
}

describe('NumberRush', () => {
  test('only the next number in order counts', () => {
    const s = init(['a'])
    game.onInput(s, 'a', { kind: 'tap', cell: s.grid.indexOf(2) }, 100)
    expect(s.progress.get('a')).toBe(1)
    game.onInput(
      s,
      'a',
      { kind: 'tap', cell: s.grid.indexOf(1) },
      100 + NUMBER_RUSH_WRONG_COOLDOWN_MS,
    )
    expect(s.progress.get('a')).toBe(2)
  })

  test('a wrong number starts a cooldown that ignores every tap until it runs out', () => {
    const s = init(['a', 'b'])
    game.onInput(s, 'a', { kind: 'tap', cell: s.grid.indexOf(7) }, 1000)
    expect(game.snapshot(s, 1000).cooldowns).toEqual({ a: NUMBER_RUSH_WRONG_COOLDOWN_MS, b: 0 })
    expect(game.snapshot(s, 1200).cooldowns.a).toBe(NUMBER_RUSH_WRONG_COOLDOWN_MS - 200)
    // Even the right number waits for the penalty to end…
    game.onInput(s, 'a', { kind: 'tap', cell: s.grid.indexOf(1) }, 1200)
    expect(s.progress.get('a')).toBe(1)
    // …and doesn't extend it.
    game.onInput(
      s,
      'a',
      { kind: 'tap', cell: s.grid.indexOf(1) },
      1000 + NUMBER_RUSH_WRONG_COOLDOWN_MS,
    )
    expect(s.progress.get('a')).toBe(2)
    // Only the offender is penalized.
    game.onInput(s, 'b', { kind: 'tap', cell: s.grid.indexOf(1) }, 1001)
    expect(s.progress.get('b')).toBe(2)
  })

  test('tapping an already cleared number (a double click) costs nothing', () => {
    const s = init(['a'])
    game.onInput(s, 'a', { kind: 'tap', cell: s.grid.indexOf(1) }, 100)
    game.onInput(s, 'a', { kind: 'tap', cell: s.grid.indexOf(1) }, 150)
    expect(game.snapshot(s, 150).cooldowns.a).toBe(0)
    game.onInput(s, 'a', { kind: 'tap', cell: 99 }, 160)
    expect(game.snapshot(s, 160).cooldowns.a).toBe(0)
    game.onInput(s, 'a', { kind: 'tap', cell: s.grid.indexOf(2) }, 170)
    expect(s.progress.get('a')).toBe(3)
  })

  test('sweeping every open cell in reading order is far slower than the round', () => {
    // A sweeper clicking ten cells a second, skipping the cleared ones, on the seeded grid.
    const s = game.init({
      players: ['a'],
      seed: 1,
      random: lcg(5),
      now: 0,
      config: { durationMs: 40_000 },
    })
    let now = 0
    while (now < 40_000 && (s.progress.get('a') ?? 1) <= s.grid.length) {
      for (let cell = 0; cell < s.grid.length && now < 40_000; cell++) {
        if ((s.grid[cell] as number) < (s.progress.get('a') ?? 1)) continue
        game.onInput(s, 'a', { kind: 'tap', cell }, now)
        now += 100
      }
    }
    expect(s.progress.get('a') as number).toBeLessThan(s.grid.length / 2)
  })

  test('the round ends early once everybody cleared the grid', () => {
    let s = clear(init(['a', 'b']), 'a', 5000)
    expect(game.isFinished(s, 5000)).toBe(false)
    s = clear(s, 'b', 6000)
    expect(game.isFinished(s, 6000)).toBe(true)
    expect(game.getResult(s).placements).toEqual(['a', 'b'])
  })

  test('a player gone mid-round no longer holds the early finish', () => {
    let s = clear(init(['a', 'b']), 'a', 5000)
    s = game.leave(s, 'b')
    expect(game.isFinished(s, 5000)).toBe(true)
  })
})
