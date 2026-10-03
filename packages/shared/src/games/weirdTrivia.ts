import type { QuizLang, QuizReveal, TriviaSnapshot } from './trivia'

// Weird Trivia wire shapes. A fast quiz of strange-but-true facts on the Lightning Quiz phases (answer
// window, then a reveal of the right answer and who picked what), plus a one-line fun fact at each
// reveal. Points = a correct answer plus a speed bonus, but banked only at the reveal: locking in gives
// no verdict. The bank lives server side and is written natively in both languages, so a question
// ships its own text in each one and the client shows the player's language (`QuizLang`, shared with
// Lightning Quiz). The right answer and the fact never go on the wire before the reveal.

export const WEIRD_TRIVIA = {
  questionMs: 6000,
  revealMs: 4000,
  choices: 4,
} as const

export interface WeirdTriviaReveal extends QuizReveal {
  fact: Record<QuizLang, string>
}

// `scores` count revealed questions only (a lock-in never leaks the verdict early).
export interface WeirdTriviaSnapshot extends Omit<TriviaSnapshot, 'reveal'> {
  reveal: WeirdTriviaReveal | null
}

// Same shape as the Lightning Quiz answer: the question index guards against stale taps.
export interface WeirdTriviaInput {
  kind: 'answer'
  question: number
  choice: number
}
