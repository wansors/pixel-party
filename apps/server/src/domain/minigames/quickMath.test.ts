import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { QUICK_MATH_WRONG_COOLDOWN_MS, QuickMath, type QuickMathState } from './quickMath'

// Small deterministic LCG: varied draws (a constant Random would never find 4 distinct distractors).
const lcg = (seed: number): Random => {
  let x = seed >>> 0
  return {
    next: () => {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0
      return x / 2 ** 32
    },
  }
}
const init = (players: string[], seed = 7, now = 0) =>
  new QuickMath().init({ players, seed, random: lcg(seed), now, config: { durationMs: 30_000 } })

const correctOf = (s: QuickMathState, index: number): number => s.pool[index]?.correct as number
const wrongOf = (s: QuickMathState, index: number): number => (correctOf(s, index) + 1) % 4
const answer = (s: QuickMathState, id: string, index: number, choice: number, now: number) =>
  new QuickMath().onInput(s, id, { kind: 'answer', index, choice }, now)

describe('QuickMath', () => {
  test('the question pool is seeded: same seed, same pool; four distinct choices incl. the answer', () => {
    const a = init(['p'], 3)
    const b = init(['p'], 3)
    expect(a.pool).toEqual(b.pool)
    for (const q of a.pool) {
      expect(new Set(q.choices).size).toBe(4)
      expect(q.correct).toBeGreaterThanOrEqual(0)
      expect(q.correct).toBeLessThan(4)
    }
  })

  test('a correct answer scores and advances with no cooldown', () => {
    let s = init(['p'])
    s = answer(s, 'p', 0, correctOf(s, 0), 100)
    expect(s.correct.get('p')).toBe(1)
    expect(s.pointer.get('p')).toBe(1)
    expect(new QuickMath().snapshot(s, 100).cooldowns.p).toBe(0)
    // The very next answer lands immediately.
    s = answer(s, 'p', 1, correctOf(s, 1), 101)
    expect(s.correct.get('p')).toBe(2)
  })

  test('a wrong answer advances but starts a cooldown that ignores answers until it expires', () => {
    const game = new QuickMath()
    let s = init(['p', 'q'])
    s = answer(s, 'p', 0, wrongOf(s, 0), 1000)
    expect(s.wrong.get('p')).toBe(1)
    expect(s.pointer.get('p')).toBe(1)
    expect(game.snapshot(s, 1000).cooldowns.p).toBe(QUICK_MATH_WRONG_COOLDOWN_MS)
    expect(game.snapshot(s, 1500).cooldowns.p).toBe(QUICK_MATH_WRONG_COOLDOWN_MS - 500)
    // Only the offender is penalized.
    expect(game.snapshot(s, 1000).cooldowns.q).toBe(0)
    s = answer(s, 'q', 0, correctOf(s, 0), 1001)
    expect(s.correct.get('q')).toBe(1)

    // During the cooldown every answer is ignored — even the right one — and the sum stays put.
    const end = 1000 + QUICK_MATH_WRONG_COOLDOWN_MS
    s = answer(s, 'p', 1, correctOf(s, 1), end - 1)
    expect(s.correct.get('p')).toBe(0)
    expect(s.pointer.get('p')).toBe(1)

    // Accepted again the moment it runs out.
    expect(game.snapshot(s, end).cooldowns.p).toBe(0)
    s = answer(s, 'p', 1, correctOf(s, 1), end)
    expect(s.correct.get('p')).toBe(1)
    expect(s.pointer.get('p')).toBe(2)
  })

  test('mashing one button is slower than solving: at most one answer per cooldown after a miss', () => {
    let s = init(['p'])
    // Tap choice 0 every 50 ms for the whole round.
    for (let t = 0; t < 30_000; t += 50) {
      const ptr = s.pointer.get('p') as number
      s = answer(s, 'p', ptr, 0, t)
    }
    const wrong = s.wrong.get('p') ?? 0
    const answered = (s.correct.get('p') ?? 0) + wrong
    // Every wrong answer blocks the next QUICK_MATH_WRONG_COOLDOWN_MS of input…
    expect(wrong).toBeLessThanOrEqual(Math.ceil(30_000 / QUICK_MATH_WRONG_COOLDOWN_MS))
    // …so the masher no longer burns through the whole pool (without the cooldown it would).
    expect(answered).toBeLessThan(s.pool.length)
  })

  test('stale indices, bad payloads and answers after the timer are ignored', () => {
    let s = init(['p'])
    s = answer(s, 'p', 1, correctOf(s, 1), 10) // not the live question
    s = new QuickMath().onInput(s, 'p', { kind: 'answer', index: 0 } as never, 11)
    s = answer(s, 'p', 0, correctOf(s, 0), 30_000) // time is up
    s = answer(s, 'ghost', 0, correctOf(s, 0), 12) // not in this round
    expect(s.correct.get('p')).toBe(0)
    expect(s.wrong.get('p')).toBe(0)
    expect(s.pointer.get('p')).toBe(0)
    expect(s.correct.has('ghost')).toBe(false)
  })

  test('ranks by correct answers, fewer wrong breaks a tie', () => {
    const game = new QuickMath()
    let s = init(['a', 'b', 'c'])
    s = answer(s, 'a', 0, correctOf(s, 0), 0)
    s = answer(s, 'b', 0, wrongOf(s, 0), 0)
    s = answer(s, 'b', 1, correctOf(s, 1), QUICK_MATH_WRONG_COOLDOWN_MS)
    s = answer(s, 'c', 0, correctOf(s, 0), 0)
    s = answer(s, 'c', 1, correctOf(s, 1), 1)
    const r = game.getResult(s)
    expect(r.placements).toEqual(['c', 'a', 'b'])
    expect(r.ranks).toEqual({ c: 0, a: 1, b: 2 })
  })

  test('snapshot exposes each player their own sum, never the answer', () => {
    const game = new QuickMath()
    let s = init(['p', 'q'])
    s = answer(s, 'p', 0, correctOf(s, 0), 0)
    const snap = game.snapshot(s, 0)
    expect(snap.prompts.p?.index).toBe(1)
    expect(snap.prompts.q?.index).toBe(0)
    expect(JSON.stringify(snap)).not.toContain('correct')
    expect(snap.cooldowns).toEqual({ p: 0, q: 0 })
  })

  test("the answer's rank among the sorted choices is uniform (no 'pick a middle one')", () => {
    const counts = [0, 0, 0, 0]
    let total = 0
    for (let seed = 1; seed <= 100; seed++) {
      for (const q of init(['p'], seed).pool) {
        const answer = q.choices[q.correct] as number
        counts[[...q.choices].sort((a, b) => a - b).indexOf(answer)]++
        total++
        // Near misses, never negative.
        for (const c of q.choices) {
          expect(c).toBeGreaterThanOrEqual(0)
          expect(Math.abs(c - answer)).toBeLessThanOrEqual(5)
        }
      }
    }
    // 6000 sums: every rank within a few points of 25 % (it was the 2nd or 3rd 86 % of the time).
    for (const n of counts) {
      expect(n / total).toBeGreaterThan(0.21)
      expect(n / total).toBeLessThan(0.29)
    }
    // The middle two together, the old blind-guess edge: about half, as for any two slots.
    expect(((counts[1] as number) + (counts[2] as number)) / total).toBeLessThan(0.55)
  })
})
