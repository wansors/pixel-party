// Lightning Quiz (Trivia) wire shapes. Multiple-choice questions with a per-question time limit;
// points for a correct answer plus a speed bonus. The question order/selection is common to everyone
// (seeded server side); the correct answer is never sent while a question is live.

// The quiz games' banks are written natively in each language, so a question ships its text in every
// one of them and the client shows the player's.
export type QuizLang = 'en' | 'es'
export const QUIZ_LANGS: readonly QuizLang[] = ['en', 'es']

// One question in one language, with the choices already in display order.
export interface QuizText {
  q: string
  choices: string[]
}

export interface TriviaSnapshot {
  // 0-based index of the active question; total questions this round.
  index: number
  total: number
  // The active question in each language (null after the last question closes).
  text: Record<QuizLang, QuizText> | null
  // ms left in the current question window.
  questionRemainingMs: number
  // playerId -> accumulated points.
  scores: Record<string, number>
  // players who already locked an answer for the current question.
  answeredCurrent: string[]
}

// Answer for a specific question index (server ignores stale/duplicate answers). `choice` is the tapped
// option index.
export interface TriviaInput {
  kind: 'answer'
  question: number
  choice: number
}
