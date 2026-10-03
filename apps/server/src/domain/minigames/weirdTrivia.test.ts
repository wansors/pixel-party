import { describe, expect, test } from 'bun:test'
import { WEIRD_TRIVIA } from '@pp/shared'
import type { Random } from '../ports/Random'
import { WeirdTrivia, type WeirdTriviaState } from './weirdTrivia'
import { WEIRD_TRIVIA_BANK } from './weirdTriviaBank'

const zero: Random = { next: () => 0 }
const Q = 6000
const R = 4000
const game = new WeirdTrivia()
const init = (players: string[], extra: Record<string, unknown> = {}) =>
  game.init({
    players,
    seed: 1,
    random: zero,
    now: 0,
    config: { questions: 3, questionMs: Q, revealMs: R, ...extra },
  })
const answer = (s: WeirdTriviaState, id: string, choice: number, now: number, question = s.index) =>
  game.onInput(s, id, { kind: 'answer', question, choice }, now)
const right = (s: WeirdTriviaState) => s.questions[s.index].correct
const wrong = (s: WeirdTriviaState) => (right(s) + 1) % WEIRD_TRIVIA.choices

describe('WeirdTrivia', () => {
  test('picks a seeded subset sized by the round duration', () => {
    const s = game.init({
      players: ['a'],
      seed: 1,
      random: zero,
      now: 0,
      config: { durationMs: 50_000 },
    })
    expect(s.questions).toHaveLength(5)
    expect(new Set(s.questions.map((q) => q.id)).size).toBe(5)
  })

  test('every language puts the right answer in the same slot', () => {
    const s = init(['a'])
    for (const q of s.questions) {
      const fact = WEIRD_TRIVIA_BANK.find((f) => f.id === q.id)
      expect(q.text.en.choices[q.correct]).toBe(fact?.text.en.right ?? '')
      expect(q.text.es.choices[q.correct]).toBe(fact?.text.es.right ?? '')
    }
  })

  test('a right answer scores base + speed bonus, banked only at the reveal', () => {
    let s = init(['a', 'b'])
    s = answer(s, 'a', right(s), 0) // full window left -> +1000 bonus
    expect(game.snapshot(s, 0).scores.a).toBe(0)
    expect(game.snapshot(s, 0).reveal).toBeNull()
    s = answer(s, 'b', wrong(s), Q / 2)
    // Both locked in: the reveal starts at once.
    expect(s.phase).toBe('reveal')
    const snap = game.snapshot(s, Q / 2)
    expect(snap.scores).toEqual({ a: 2000, b: 0 })
    expect(snap.reveal?.gained).toEqual({ a: 2000 })
    expect(snap.reveal?.picks).toEqual({ a: right(s), b: wrong(s) })
    expect(snap.reveal?.correct).toBe(right(s))
    expect(snap.reveal?.fact.es.length).toBeGreaterThan(0)
  })

  test('the speed bonus shrinks as the window elapses', () => {
    let s = init(['a', 'b'])
    s = answer(s, 'a', right(s), Q / 2)
    game.tick(s, 50, Q)
    expect(s.points.get('a')).toBe(1500)
  })

  test('the live snapshot never carries the right answer or the picks', () => {
    let s = init(['a', 'b'])
    s = answer(s, 'a', right(s), 100)
    const snap = game.snapshot(s, 100)
    expect(snap.phase).toBe('question')
    expect(snap.reveal).toBeNull()
    expect(snap.answeredCurrent).toEqual(['a'])
    expect(JSON.stringify(snap)).not.toContain('correct')
  })

  test('ignores stale, duplicate, out-of-range and reveal-time answers', () => {
    let s = init(['a', 'b'])
    s = answer(s, 'a', right(s), 0, 1) // wrong question index
    s = answer(s, 'a', 7, 0)
    s = answer(s, 'a', 1.5, 0)
    s = answer(s, 'x', right(s), 0) // not in the round
    expect(s.picks.size).toBe(0)
    s = answer(s, 'a', wrong(s), 0)
    s = answer(s, 'a', right(s), 10) // second try
    expect(s.picks.get('a')).toBe(wrong(s))
    game.tick(s, 50, Q) // window closes -> reveal
    s = answer(s, 'b', right(s), Q + 10)
    expect(s.picks.has('b')).toBe(false)
  })

  test('phases run question -> reveal -> next question on their deadlines, then finish', () => {
    const s = init(['a'])
    expect(game.snapshot(s, 1000).phaseRemainingMs).toBe(Q - 1000)
    game.tick(s, 50, Q)
    expect(s.phase).toBe('reveal')
    game.tick(s, 50, Q + R)
    expect(s.phase).toBe('question')
    expect(s.index).toBe(1)
    // A big time jump catches up through several phases at once.
    expect(game.isFinished(s, 10 * (Q + R))).toBe(true)
    const done = game.snapshot(s, 10 * (Q + R))
    expect(done.text).toBeNull()
    expect(done.index).toBe(3)
  })

  test('an early reveal restarts the clock from the last lock-in', () => {
    let s = init(['a'])
    s = answer(s, 'a', right(s), 1000)
    expect(s.phase).toBe('reveal')
    expect(game.isFinished(s, 1000 + R - 1)).toBe(false)
    game.tick(s, 50, 1000 + R)
    expect(s.index).toBe(1)
    expect(s.phaseEndsAt).toBe(1000 + R + Q)
  })

  test('ranks by points with ties and a right-answers stat', () => {
    let s = init(['a', 'b', 'c'])
    s = answer(s, 'b', right(s), 0)
    s = answer(s, 'c', right(s), 0)
    s = answer(s, 'a', wrong(s), 0)
    const r = game.getResult(s)
    expect(r.placements[2]).toBe('a')
    expect(r.ranks).toEqual({ b: 0, c: 0, a: 2 })
    expect(r.stats?.b).toBe('1/3 · 2000 pts')
  })

  test('a player gone mid-round neither blocks the early reveal nor counts as a contestant', () => {
    let s = init(['a', 'b', 'c'])
    s = answer(s, 'a', right(s), 100)
    s = answer(s, 'b', right(s), 200)
    expect(s.phase).toBe('question')
    s = game.leave(s, 'c', 300)
    expect(s.phase).toBe('reveal')
    const snap = game.snapshot(s, 300)
    // Everybody still here got it right: the scene's "too easy" quip counts `players`, not `scores`.
    expect(snap.players).toEqual(['a', 'b'])
    expect(Object.keys(snap.reveal?.gained ?? {})).toEqual(['a', 'b'])
    expect(Object.keys(snap.scores)).toEqual(['a', 'b', 'c'])
  })

  test('a leave during the reveal carries over to the next questions', () => {
    let s = init(['a', 'b'])
    s = answer(s, 'a', right(s), 100)
    game.tick(s, 50, Q)
    s = game.leave(s, 'b', Q + 10)
    game.tick(s, 50, Q + R)
    expect(s.phase).toBe('question')
    s = answer(s, 'a', wrong(s), Q + R + 10)
    expect(s.phase).toBe('reveal')
  })
})
