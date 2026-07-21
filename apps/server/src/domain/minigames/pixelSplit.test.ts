import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { PixelSplit } from './pixelSplit'

// Deterministic seed; the exact object order doesn't matter — the tests read counts off the puzzle.
const zero: Random = { next: () => 0 }
const init = (players: string[], now = 0) =>
  new PixelSplit().init({ players, seed: 1, random: zero, now, config: { durationMs: 40_000 } })

const leftOf = (cols: number[], cut: number) => cols.slice(0, cut).reduce((a, b) => a + b, 0)

describe('PixelSplit', () => {
  test('the optimal cut scores full points', () => {
    const game = new PixelSplit()
    const s0 = init(['a'])
    const puzzle = s0.puzzles[0]
    if (!puzzle) throw new Error('no puzzle')
    let best = { cut: 1, error: Number.POSITIVE_INFINITY }
    for (let cut = 1; cut < puzzle.object.cols; cut++) {
      const left = leftOf(puzzle.cols, cut)
      const error = Math.abs(left - (puzzle.total - left))
      if (error < best.error) best = { cut, error }
    }
    const s = game.onInput(s0, 'a', { kind: 'cut', index: 0, cut: best.cut }, 100)
    expect(s.score.get('a')).toBe(10)
  })

  test('a lopsided cut scores fewer points than the optimal one', () => {
    const game = new PixelSplit()
    let s = init(['a'])
    const puzzle = s.puzzles[0]
    if (!puzzle) throw new Error('no puzzle')
    s = game.onInput(s, 'a', { kind: 'cut', index: 0, cut: 1 }, 100) // extreme left cut
    const left = leftOf(puzzle.cols, 1)
    const error = Math.abs(left - (puzzle.total - left))
    const expected = Math.max(0, 10 - (error - puzzle.minError))
    expect(s.score.get('a')).toBe(expected)
    expect(s.score.get('a')).toBeLessThanOrEqual(10)
  })

  test('stale index is ignored', () => {
    const game = new PixelSplit()
    let s = init(['a'])
    s = game.onInput(s, 'a', { kind: 'cut', index: 2, cut: 5 }, 100)
    expect(s.pointer.get('a')).toBe(0)
    expect(s.score.get('a')).toBe(0)
  })

  test('ranks by score, faster finish breaks ties', () => {
    const game = new PixelSplit()
    let s = init(['a', 'b'])
    s = game.onInput(s, 'a', { kind: 'cut', index: 0, cut: 6 }, 100)
    s = game.onInput(s, 'b', { kind: 'cut', index: 0, cut: 6 }, 900)
    const r = game.getResult(s)
    expect(r.placements[0]).toBe('a')
    expect(r.ranks?.a).toBe(0)
    expect(r.ranks?.b).toBe(1)
  })
})
