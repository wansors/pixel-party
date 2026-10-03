import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { NumberRush, type NumberRushState } from './numberRush'

const zero: Random = { next: () => 0 }
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
    game.onInput(s, 'a', { kind: 'tap', cell: s.grid.indexOf(1) }, 100)
    expect(s.progress.get('a')).toBe(2)
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
