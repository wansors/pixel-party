import { describe, expect, test } from 'bun:test'
import { PIXEL_OBJECTS, pixelVariant } from '@pp/shared'
import type { Random } from '../ports/Random'
import { PixelWeight } from './pixelWeight'

// Deterministic seed; the exact object order doesn't matter — the tests read the answer off the puzzle.
const zero: Random = { next: () => 0 }
const init = (players: string[], now = 0, random: Random = zero) =>
  new PixelWeight().init({ players, seed: 1, random, now, config: { durationMs: 40_000 } })

// Small seeded generator (mulberry32) so the variety tests walk many real, reproducible seeds.
function seeded(seed: number): Random {
  let a = seed >>> 0
  return {
    next: () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), a | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

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

  test('the count of the same object changes from seed to seed (no memorising)', () => {
    for (const base of PIXEL_OBJECTS) {
      const counts = new Set<number>()
      for (let seed = 1; seed <= 40; seed++) {
        const v = pixelVariant(base, seeded(seed))
        // A well-formed object: the count is its cells, all distinct and inside the frame.
        expect(v.count).toBe(v.cells.length)
        expect(new Set(v.cells.map((c) => `${c.x},${c.y}`)).size).toBe(v.count)
        for (const c of v.cells) {
          expect(c.x >= 0 && c.x < v.cols && c.y >= 0 && c.y < v.rows).toBe(true)
        }
        counts.add(v.count)
      }
      expect({ name: base.name, varied: counts.size >= 8 }).toEqual({
        name: base.name,
        varied: true,
      })
    }
    // Two seeds, one object, two different answers.
    const heart = PIXEL_OBJECTS.find((o) => o.name === 'HEART')
    if (!heart) throw new Error('no HEART')
    const seeds = [1, 2, 3, 4, 5].map((seed) => pixelVariant(heart, seeded(seed)).count)
    expect(new Set(seeds).size).toBeGreaterThan(1)
  })

  test('the same object weighs differently in two rounds; the server keeps owning the count', () => {
    const answers = new Map<string, Set<number>>()
    for (let seed = 1; seed <= 30; seed++) {
      for (const p of init(['a'], 0, seeded(seed)).puzzles) {
        expect(p.answer).toBe(p.object.pixels.length)
        expect(p.object.maxGuess).toBe(p.object.cols * p.object.rows)
        answers.set(p.object.name, (answers.get(p.object.name) ?? new Set()).add(p.answer))
      }
    }
    for (const [name, seen] of answers)
      expect({ name, n: seen.size > 3 }).toEqual({ name, n: true })
  })

  test('a leaver is skipped to the end so the round finishes once the rest are done', () => {
    const game = new PixelWeight()
    let s = init(['a', 'gone'])
    s.puzzles.forEach((p, index) => {
      s = game.onInput(s, 'a', { kind: 'guess', index, value: p.answer }, 100 + index)
    })
    expect(game.isFinished(s, 500)).toBe(false)
    s = game.leave(s, 'gone', 500)
    expect(game.isFinished(s, 500)).toBe(true)
    expect(game.snapshot(s, 500).objects.gone).toBeNull()
  })
})
