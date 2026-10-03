import { QUIZ_LANGS, type QuizLang, type QuizText } from '@pp/shared'
import type { Random } from '../ports/Random'
import type { NormalizedResult, PlayerId } from './MiniGame'

// Shared rules of the quiz games (Lightning Quiz, Weird Trivia): the bilingual bank format, seeded
// question picks and deals, the right-answer score (base + speed bonus) and the points ranking.

// A bank entry: one question written natively in each language (its own phrasing, sometimes its own
// jokes). `right` is the true answer, `wrong` holds three decoys.
export interface QuizEntryText {
  q: string
  right: string
  wrong: readonly [string, string, string]
}

export interface QuizEntry<T extends QuizEntryText = QuizEntryText> {
  id: string
  text: Record<QuizLang, T>
}

// A question as played: its text per language with the choices in display order.
export interface DealtQuestion {
  id: string
  text: Record<QuizLang, QuizText>
  // Display slot of the right answer (the same in every language).
  correct: number
}

const BASE_POINTS = 1000
const SPEED_BONUS = 1000

// Fisher–Yates using the seeded Random port, so every player in a room gets the identical quiz.
export function shuffle<T>(items: readonly T[], random: Random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Shuffles the four options once — one slot order for every language, so the right answer sits in the
// same slot for everybody, whatever language they play in.
export function dealQuestion(entry: QuizEntry, random: Random): DealtQuestion {
  const order = shuffle([0, 1, 2, 3], random) // 0 = the right answer, 1..3 = the decoys
  const text = {} as Record<QuizLang, QuizText>
  for (const lang of QUIZ_LANGS) {
    const t = entry.text[lang]
    const options = [t.right, ...t.wrong]
    text[lang] = { q: t.q, choices: order.map((i) => options[i]) }
  }
  return { id: entry.id, text, correct: order.indexOf(0) }
}

// Points for a right answer: the base plus a speed bonus scaled by the time left in the answer window.
export function rightAnswerPoints(remainingMs: number, windowMs: number): number {
  const left = Math.max(0, Math.min(windowMs, remainingMs))
  return BASE_POINTS + Math.round((left / windowMs) * SPEED_BONUS)
}

// Ranks by total points (equal totals share a rank).
export function rankByPoints(
  players: readonly PlayerId[],
  points: ReadonlyMap<PlayerId, number>,
  stat: (id: PlayerId) => string,
): NormalizedResult {
  const total = (id: PlayerId): number => points.get(id) ?? 0
  const placements = [...players].sort((a, b) => total(b) - total(a))
  const ranks: Record<PlayerId, number> = {}
  let rank = 0
  placements.forEach((id, idx) => {
    if (idx > 0 && total(id) !== total(placements[idx - 1])) rank = idx
    ranks[id] = rank
  })
  const stats: Record<PlayerId, string> = {}
  for (const id of players) stats[id] = stat(id)
  return { placements, ranks, stats }
}
