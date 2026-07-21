import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { PixelWeight } from './pixelWeight'

// Deterministic seed; the exact object order doesn't matter — the tests read the answer off the puzzle.
const zero: Random = { next: () => 0 }
const init = (players: string[], now = 0) =>
  new PixelWeight().init({ players, seed: 1, random: zero, now, config: { durationMs: 40_000 } })

describe('PixelWeight', () => {
  test('puzzles are seeded pixel-art objects whose answer is the filled-pixel count', () => {
    const s = init(['a'])
    expect(s.puzzles).toHaveLength(8)
    expect(s.puzzles[0]?.answer).toBe(s.puzzles[0]?.object.pixels.length)
    expect(s.puzzles[0]?.answer).toBeGreaterThan(0)
  })

  test('exact guess scores full points; error reduces points and floors at zero', () => {
    const game = new PixelWeight()
    let s = init(['a', 'b'])
    const answer = s.puzzles[0]?.answer ?? 0
    s = game.onInput(s, 'a', { kind: 'guess', index: 0, value: answer }, 100) // exact -> 10
    s = game.onInput(s, 'b', { kind: 'guess', index: 0, value: answer + 3 }, 100) // off by 3 -> 7
    expect(s.score.get('a')).toBe(10)
    expect(s.score.get('b')).toBe(7)
  })

  test('stale index is ignored and does not advance the pointer', () => {
    const game = new PixelWeight()
    let s = init(['a'])
    s = game.onInput(s, 'a', { kind: 'guess', index: 3, value: 0 }, 100)
    expect(s.pointer.get('a')).toBe(0)
    expect(s.score.get('a')).toBe(0)
  })

  test('ranks by score, faster finish breaks ties', () => {
    const game = new PixelWeight()
    let s = init(['a', 'b'])
    const answer = s.puzzles[0]?.answer ?? 0
    s = game.onInput(s, 'a', { kind: 'guess', index: 0, value: answer }, 100)
    s = game.onInput(s, 'b', { kind: 'guess', index: 0, value: answer }, 900)
    const r = game.getResult(s)
    expect(r.placements[0]).toBe('a')
    expect(r.ranks?.a).toBe(0)
    expect(r.ranks?.b).toBe(1)
  })
})
