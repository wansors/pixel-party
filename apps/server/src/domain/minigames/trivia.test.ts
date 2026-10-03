import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { Trivia } from './trivia'

const zero: Random = { next: () => 0 }
const init = (players: string[], now = 0) =>
  new Trivia().init({
    players,
    seed: 1,
    random: zero,
    now,
    config: { questions: 3, questionMs: 8000 },
  })

describe('Trivia', () => {
  test('selects a seeded question subset', () => {
    const s = init(['a'])
    expect(s.questions).toHaveLength(3)
    expect(s.questions[0].text.en.choices).toHaveLength(4)
    expect(s.questions[0].text.es.choices).toHaveLength(4)
  })

  test('correct answer scores base + speed bonus; wrong scores nothing', () => {
    const game = new Trivia()
    let s = init(['a', 'b'])
    const correct = s.questions[0].correct
    const wrong = (correct + 1) % 4
    s = game.onInput(s, 'a', { kind: 'answer', question: 0, choice: correct }, 0) // full time left -> +1000 bonus
    s = game.onInput(s, 'b', { kind: 'answer', question: 0, choice: wrong }, 0)
    expect(s.points.get('a')).toBe(2000)
    expect(s.points.get('b')).toBe(0)
  })

  test('speed bonus shrinks as the window elapses', () => {
    const game = new Trivia()
    let s = init(['a'])
    const correct = s.questions[0].correct
    s = game.onInput(s, 'a', { kind: 'answer', question: 0, choice: correct }, 4000) // half window left
    expect(s.points.get('a')).toBe(1500)
  })

  test('answers for a non-live question index are ignored', () => {
    const game = new Trivia()
    let s = init(['a'])
    const correct = s.questions[0].correct
    s = game.onInput(s, 'a', { kind: 'answer', question: 1, choice: correct }, 0)
    expect(s.points.get('a')).toBe(0)
  })

  test('the snapshot ships the question in every language, never the answer', () => {
    const game = new Trivia()
    const s = init(['a'])
    const snap = game.snapshot(s, 0)
    expect(snap.text?.en.q).toBe(s.questions[0].text.en.q)
    expect(snap.text?.es.choices).toEqual(s.questions[0].text.es.choices)
    expect(JSON.stringify(snap)).not.toContain('correct')
    expect(game.snapshot(s, 24000).text).toBeNull()
  })

  test('out-of-range choices are ignored without locking the question', () => {
    const game = new Trivia()
    let s = init(['a'])
    s = game.onInput(s, 'a', { kind: 'answer', question: 0, choice: 4 }, 0)
    s = game.onInput(s, 'a', { kind: 'answer', question: 0, choice: 0.5 }, 0)
    expect(s.answered.get('a')?.size).toBe(0)
  })

  test('ranks by total points', () => {
    const game = new Trivia()
    let s = init(['a', 'b'])
    s = game.onInput(s, 'b', { kind: 'answer', question: 0, choice: s.questions[0].correct }, 0)
    const r = game.getResult(s)
    expect(r.placements[0]).toBe('b')
    expect(r.ranks?.b).toBe(0)
    expect(r.ranks?.a).toBe(1)
  })

  test('finishes after the last question window', () => {
    const game = new Trivia()
    const s = init(['a'])
    expect(game.isFinished(s, 24000 - 1)).toBe(false)
    expect(game.isFinished(s, 24000)).toBe(true)
  })
})
