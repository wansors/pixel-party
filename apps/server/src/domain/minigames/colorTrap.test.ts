import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { ColorTrap } from './colorTrap'

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

  test('tapping the ink color scores; the wrong color does not', () => {
    const game = new ColorTrap()
    let s = init(['a', 'b'])
    s = game.onInput(s, 'a', { kind: 'answer', prompt: 0, color: 1 }, 200) // ink -> correct
    s = game.onInput(s, 'b', { kind: 'answer', prompt: 0, color: 0 }, 200) // word -> wrong
    expect(s.correct.get('a')).toBe(1)
    expect(s.correct.get('b')).toBe(0)
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

  test('finishes at the end of the last prompt window', () => {
    const game = new ColorTrap()
    const s = init(['a'])
    expect(game.isFinished(s, 2999)).toBe(false)
    expect(game.isFinished(s, 3000)).toBe(true)
  })
})
