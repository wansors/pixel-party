import type { QuizLang, QuizText } from './trivia'

// Weird Trivia wire shapes. A fast quiz of strange-but-true facts: every question gets a short answer
// window, then a reveal that shows the right answer, who picked what and a one-line fun fact. Points =
// a correct answer plus a speed bonus (the Lightning Quiz rules). The bank lives server side and is
// written natively in both languages, so a question ships its own text in each one and the client shows
// the player's language (`QuizLang`, shared with Lightning Quiz). The right answer and the fact never go
// on the wire before the reveal.

export const WEIRD_TRIVIA = {
  questionMs: 6000,
  revealMs: 4000,
  choices: 4,
} as const

export type WeirdTriviaPhase = 'question' | 'reveal' | 'done'

export interface WeirdTriviaReveal {
  // Display slot of the right answer.
  correct: number
  fact: Record<QuizLang, string>
  // playerId -> the slot they locked (players who never answered are absent).
  picks: Record<string, number>
  // playerId -> points this question earned (right answers only).
  gained: Record<string, number>
}

export interface WeirdTriviaSnapshot {
  phase: WeirdTriviaPhase
  // 0-based index of the question on screen; total questions this round.
  index: number
  total: number
  // The question on screen (null once the round is done).
  text: Record<QuizLang, QuizText> | null
  // ms left in the current phase (answer window or reveal).
  phaseRemainingMs: number
  // playerId -> points, counting revealed questions only (a lock-in never leaks the verdict early).
  scores: Record<string, number>
  // Players who already locked an answer for the question on screen.
  answeredCurrent: string[]
  // Present during the reveal phase only.
  reveal: WeirdTriviaReveal | null
}

// Same shape as the Lightning Quiz answer: the question index guards against stale taps.
export interface WeirdTriviaInput {
  kind: 'answer'
  question: number
  choice: number
}
