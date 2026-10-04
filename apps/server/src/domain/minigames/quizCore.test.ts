import { describe, expect, test } from 'bun:test'
import { QUIZ_LANGS } from '@pp/shared'
import type { Random } from '../ports/Random'
import { dealQuestion, type QuizEntry, rankByPoints, rightAnswerPoints } from './quizCore'
import { TRIVIA_BANK } from './triviaBank'
import { WEIRD_TRIVIA_BANK } from './weirdTriviaBank'

// A Random that cycles through fixed values (deterministic, but not always 0).
const cycle = (values: number[]): Random => {
  let i = 0
  return { next: () => values[i++ % values.length] ?? 0 }
}

describe('quizCore', () => {
  test('a deal puts the right answer in the same slot in every language', () => {
    const entry: QuizEntry = {
      id: 'x',
      text: {
        en: { q: 'Q?', right: 'yes', wrong: ['a', 'b', 'c'] },
        es: { q: '¿P?', right: 'sí', wrong: ['d', 'e', 'f'] },
      },
    }
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const dealt = dealQuestion(entry, cycle([r, 0.5, 0.1]))
      expect(dealt.text.en.choices[dealt.correct]).toBe('yes')
      expect(dealt.text.es.choices[dealt.correct]).toBe('sí')
      expect([...dealt.text.en.choices].sort()).toEqual(['a', 'b', 'c', 'yes'])
    }
  })

  test('a right answer is worth 1000 plus up to 1000 for speed', () => {
    expect(rightAnswerPoints(8000, 8000)).toBe(2000)
    expect(rightAnswerPoints(4000, 8000)).toBe(1500)
    expect(rightAnswerPoints(-50, 8000)).toBe(1000)
  })

  test('equal totals share a rank', () => {
    const r = rankByPoints(
      ['a', 'b', 'c'],
      new Map([
        ['a', 5],
        ['b', 9],
        ['c', 5],
      ]),
      () => '',
    )
    expect(r.placements[0]).toBe('b')
    expect(r.ranks).toEqual({ b: 0, a: 1, c: 1 })
  })
})

// Both quiz banks: complete in every language, four distinct choices, and within the screen budgets
// (a choice fits a tile, a question fits the board, a fun fact fits the reveal).
describe.each([
  ['Lightning Quiz', TRIVIA_BANK as readonly QuizEntry[], 40],
  ['Weird Trivia', WEIRD_TRIVIA_BANK as readonly QuizEntry[], 40],
])('%s bank', (_name, bank, minSize) => {
  test('has unique ids and enough questions for many rounds', () => {
    const ids = bank.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(minSize)
  })

  test('every entry is complete in every language and fits the screen', () => {
    for (const entry of bank) {
      for (const lang of QUIZ_LANGS) {
        const t = entry.text[lang]
        const where = `${entry.id}/${lang}`
        const choices = [t.right, ...t.wrong]
        expect(new Set(choices.map((c) => c.toLowerCase())).size, where).toBe(4)
        for (const c of choices) {
          expect(c.trim().length, `${where}: ${c}`).toBeGreaterThan(0)
          expect(c.length, `${where}: ${c}`).toBeLessThanOrEqual(24)
        }
        expect(t.q.trim().length, where).toBeGreaterThan(0)
        expect(t.q.length, where).toBeLessThanOrEqual(90)
      }
    }
  })
})

test('every Weird Trivia fact fits the reveal', () => {
  for (const fact of WEIRD_TRIVIA_BANK) {
    for (const lang of QUIZ_LANGS) {
      const t = fact.text[lang]
      expect(t.fact.length, `${fact.id}/${lang}`).toBeLessThanOrEqual(120)
      expect(t.fact.length, `${fact.id}/${lang}`).toBeGreaterThan(20)
    }
  }
})
