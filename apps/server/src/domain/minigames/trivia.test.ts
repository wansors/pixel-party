import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import type { QuizState } from './quizCore'
import { Trivia } from './trivia'

const zero: Random = { next: () => 0 }
const Q = 8000
const R = 2000
const game = new Trivia()
const init = (players: string[], config: Record<string, unknown> = {}) =>
  game.init({
    players,
    seed: 1,
    random: zero,
    now: 0,
    config: { questions: 3, questionMs: Q, revealMs: R, ...config },
  })
const answer = (s: QuizState, id: string, choice: number, now: number, question = s.index) =>
  game.onInput(s, id, { kind: 'answer', question, choice }, now)
const right = (s: QuizState) => s.questions[s.index]?.correct as number
const wrong = (s: QuizState) => (right(s) + 1) % 4

describe('Trivia', () => {
  test('selects a seeded question subset sized by the round duration', () => {
    const s = game.init({ players: ['a'], seed: 1, random: zero, now: 0, config: {} })
    // 36 s default / (7 s window + 2 s reveal) = 4 questions.
    expect(s.questions).toHaveLength(4)
    expect(s.questions[0]?.text.en.choices).toHaveLength(4)
    expect(s.questions[0]?.text.es.choices).toHaveLength(4)
    expect(init(['a']).questions).toHaveLength(3)
  })

  test('a right answer scores base + speed bonus the moment it lands; a wrong one nothing', () => {
    let s = init(['a', 'b', 'c'])
    s = answer(s, 'a', right(s), 0) // full window left -> +1000 bonus
    s = answer(s, 'b', wrong(s), 0)
    expect(game.snapshot(s, 0).scores).toEqual({ a: 2000, b: 0, c: 0 })
    expect(s.phase).toBe('question')
  })

  test('the speed bonus shrinks as the window elapses', () => {
    let s = init(['a', 'b'])
    s = answer(s, 'a', right(s), Q / 2)
    expect(s.points.get('a')).toBe(1500)
  })

  test('answers for another question index, out-of-range choices and duplicates are ignored', () => {
    let s = init(['a', 'b'])
    s = answer(s, 'a', right(s), 0, 1)
    s = answer(s, 'a', 4, 0)
    s = answer(s, 'a', 0.5, 0)
    s = answer(s, 'ghost', right(s), 0)
    expect(s.picks.size).toBe(0)
    s = answer(s, 'a', wrong(s), 10)
    s = answer(s, 'a', right(s), 20)
    expect(s.points.get('a')).toBe(0)
  })

  test('the live snapshot ships the question in every language, never the answer', () => {
    let s = init(['a', 'b'])
    s = answer(s, 'a', right(s), 100)
    const snap = game.snapshot(s, 100)
    expect(snap.text?.en.q).toBe(s.questions[0]?.text.en.q)
    expect(snap.text?.es.choices).toEqual(s.questions[0]?.text.es.choices as string[])
    expect(snap.answeredCurrent).toEqual(['a'])
    expect(snap.reveal).toBeNull()
    expect(JSON.stringify(snap)).not.toContain('correct')
  })

  test('a question closes early once everybody answered, then reveals the right answer', () => {
    let s = init(['a', 'b'])
    s = answer(s, 'a', right(s), 1000)
    s = answer(s, 'b', wrong(s), 3000)
    expect(s.phase).toBe('reveal')
    const snap = game.snapshot(s, 3000)
    expect(snap.phaseRemainingMs).toBe(R)
    expect(snap.reveal).toEqual({
      correct: right(s),
      picks: { a: right(s), b: wrong(s) },
      gained: { a: 1875 },
    })
    game.tick(s, 50, 3000 + R)
    expect(s.phase).toBe('question')
    expect(s.index).toBe(1)
    expect(s.phaseEndsAt).toBe(3000 + R + Q)
  })

  test('an answer landing just before the window closes still gets its verdict', () => {
    let s = init(['a', 'b'])
    s = answer(s, 'a', right(s), Q - 10)
    // The next snapshot is already past the deadline: it is the reveal of that same question.
    game.tick(s, 50, Q + 140)
    const after = game.snapshot(s, Q + 140)
    expect(after.phase).toBe('reveal')
    expect(after.index).toBe(0)
    expect(after.reveal?.picks).toEqual({ a: right(s) })
    expect(after.scores.a).toBeGreaterThan(1000)
  })

  test('a player gone mid-round is not waited for', () => {
    let s = init(['a', 'b', 'c'])
    s = answer(s, 'a', right(s), 100)
    s = answer(s, 'b', right(s), 200)
    expect(s.phase).toBe('question')
    s = game.leave(s, 'c', 300)
    expect(s.phase).toBe('reveal')
    expect(game.snapshot(s, 300).players).toEqual(['a', 'b'])
    // The next question closes as soon as the two left have answered.
    game.tick(s, 50, 300 + R)
    s = answer(s, 'a', wrong(s), 400 + R)
    s = answer(s, 'b', wrong(s), 500 + R)
    expect(s.phase).toBe('reveal')
  })

  test('ranks by total points', () => {
    let s = init(['a', 'b'])
    s = answer(s, 'b', right(s), 0)
    const r = game.getResult(s)
    expect(r.placements[0]).toBe('b')
    expect(r.ranks).toEqual({ b: 0, a: 1 })
    expect(r.stats?.b).toBe('1/3 · 2000 pts')
  })

  test('finishes after the last reveal', () => {
    const s = init(['a'])
    expect(game.isFinished(s, 3 * (Q + R) - 1)).toBe(false)
    expect(game.isFinished(s, 3 * (Q + R))).toBe(true)
    expect(game.snapshot(s, 3 * (Q + R)).text).toBeNull()
  })
})
