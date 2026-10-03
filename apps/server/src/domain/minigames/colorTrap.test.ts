import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { COLOR_TRAP_LATE_GRACE_MS, ColorTrap } from './colorTrap'

// next() = 0 -> word = 0 (RED), ink = (0 + 1 + 0) % 4 = 1 (GREEN) for every prompt.
const zero: Random = { next: () => 0 }
const init = (players: string[], now = 0) =>
  new ColorTrap().init({
    players,
    seed: 1,
    random: zero,
    now,
    config: { prompts: 3, promptMs: 1000 },
  })

describe('ColorTrap', () => {
  test('prompt sequence is seeded and always mismatched (word !== ink)', () => {
    const s = init(['a'])
    expect(s.prompts).toHaveLength(3)
    for (const p of s.prompts) expect(p.word).not.toBe(p.ink)
    expect(s.prompts[0]).toEqual({ word: 0, ink: 1 })
  })

  test('tapping the ink color scores a point; the wrong color costs one', () => {
    const game = new ColorTrap()
    let s = init(['a', 'b'])
    s = game.onInput(s, 'a', { kind: 'answer', prompt: 0, color: 1 }, 200) // ink -> correct
    s = game.onInput(s, 'b', { kind: 'answer', prompt: 0, color: 0 }, 200) // word -> wrong
    expect(s.correct.get('a')).toBe(1)
    expect(s.correct.get('b')).toBe(0)
    expect(game.snapshot(s, 200).scores).toEqual({ a: 1, b: -1 })
  })

  test('an answer to the previous prompt still counts during the grace period, not after', () => {
    const game = new ColorTrap()
    let s = init(['a', 'b'])
    // Prompt 0 closed at 1000; the taps were made before that and land a little late.
    s = game.onInput(s, 'a', { kind: 'answer', prompt: 0, color: 1 }, 1000 + 120)
    s = game.onInput(
      s,
      'b',
      { kind: 'answer', prompt: 0, color: 1 },
      1000 + COLOR_TRAP_LATE_GRACE_MS,
    )
    expect(s.correct.get('a')).toBe(1)
    expect(s.correct.get('b')).toBe(0)
    // The late answer's time is capped at the prompt window (no tiebreak gain from the grace).
    expect(s.totalMs.get('a')).toBe(1000)
    // Prompt 1 is live meanwhile and takes its own answer.
    s = game.onInput(
      s,
      'b',
      { kind: 'answer', prompt: 1, color: 1 },
      1000 + COLOR_TRAP_LATE_GRACE_MS,
    )
    expect(s.correct.get('b')).toBe(1)
  })

  test('the last prompt gets the same grace before the round ends', () => {
    const game = new ColorTrap()
    let s = init(['a'])
    expect(game.isFinished(s, 3000)).toBe(false)
    s = game.onInput(s, 'a', { kind: 'answer', prompt: 2, color: 1 }, 3100)
    expect(s.correct.get('a')).toBe(1)
    expect(game.snapshot(s, 3100).word).toBeNull()
  })

  test('blind guessing loses points on average; care beats spraying on a tie', () => {
    const game = new ColorTrap()
    let s = init(['careful', 'sprayer', 'guesser'])
    // careful: 1 right. sprayer: 2 right and 1 wrong (the same 1 point), all faster. guesser: always
    // the first color.
    s = game.onInput(s, 'careful', { kind: 'answer', prompt: 0, color: 1 }, 600)
    s = game.onInput(s, 'sprayer', { kind: 'answer', prompt: 0, color: 1 }, 100)
    s = game.onInput(s, 'sprayer', { kind: 'answer', prompt: 1, color: 0 }, 1100)
    s = game.onInput(s, 'sprayer', { kind: 'answer', prompt: 2, color: 1 }, 2100)
    for (let i = 0; i < 3; i++) {
      s = game.onInput(s, 'guesser', { kind: 'answer', prompt: i, color: 0 }, i * 1000 + 50)
    }
    const r = game.getResult(s)
    expect(game.snapshot(s, 2100).scores).toEqual({ careful: 1, sprayer: 1, guesser: -3 })
    expect(r.placements).toEqual(['careful', 'sprayer', 'guesser'])
    expect(r.ranks).toEqual({ careful: 0, sprayer: 1, guesser: 2 })
    expect(r.stats?.sprayer).toBe('2 right · 1 wrong')
  })

  test('a player gone mid-round no longer holds the early finish', () => {
    const game = new ColorTrap()
    let s = init(['a', 'b'])
    for (let i = 0; i < 3; i++) {
      s = game.onInput(s, 'a', { kind: 'answer', prompt: i, color: 1 }, i * 1000 + 10)
    }
    expect(game.isFinished(s, 2010)).toBe(false)
    s = game.leave(s, 'b')
    expect(game.isFinished(s, 2010)).toBe(true)
  })

  test('stale or duplicate answers are ignored', () => {
    const game = new ColorTrap()
    let s = init(['a'])
    s = game.onInput(s, 'a', { kind: 'answer', prompt: 1, color: 1 }, 200) // aimed at wrong (future) prompt
    expect(s.correct.get('a')).toBe(0)
    s = game.onInput(s, 'a', { kind: 'answer', prompt: 0, color: 1 }, 200) // valid
    s = game.onInput(s, 'a', { kind: 'answer', prompt: 0, color: 1 }, 300) // duplicate
    expect(s.correct.get('a')).toBe(1)
  })

  test('ranks by correct count, faster total time breaks ties', () => {
    const game = new ColorTrap()
    let s = init(['a', 'b'])
    s = game.onInput(s, 'a', { kind: 'answer', prompt: 0, color: 1 }, 100)
    s = game.onInput(s, 'b', { kind: 'answer', prompt: 0, color: 1 }, 900)
    const r = game.getResult(s)
    expect(r.placements[0]).toBe('a')
    expect(r.ranks?.a).toBe(0)
    expect(r.ranks?.b).toBe(1)
  })

  test('finishes at the end of the last prompt window plus the grace period', () => {
    const game = new ColorTrap()
    const s = init(['a'])
    expect(game.isFinished(s, 3000 + COLOR_TRAP_LATE_GRACE_MS - 1)).toBe(false)
    expect(game.isFinished(s, 3000 + COLOR_TRAP_LATE_GRACE_MS)).toBe(true)
  })
})
