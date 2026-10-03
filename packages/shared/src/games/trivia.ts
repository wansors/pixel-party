// Lightning Quiz (Trivia) wire shapes. Multiple-choice questions with a short answer window each;
// points for a correct answer plus a speed bonus, scored the moment the answer lands. Every question
// ends with a quick reveal: the right answer and who picked what. The question order/selection is
// common to everyone (seeded server side); the correct answer is never sent while a question is live.

// The quiz games' banks are written natively in each language, so a question ships its text in every
// one of them and the client shows the player's.
export type QuizLang = 'en' | 'es'
export const QUIZ_LANGS: readonly QuizLang[] = ['en', 'es']

// One question in one language, with the choices already in display order.
export interface QuizText {
  q: string
  choices: string[]
}

// A quiz round runs question -> reveal -> question … -> done. A question closes early once every
// player still in the round has locked an answer.
export type QuizPhase = 'question' | 'reveal' | 'done'

// The verdict on the question on screen, sent once it closes.
export interface QuizReveal {
  // Display slot of the right answer.
  correct: number
  // playerId -> the slot they locked (players who never answered are absent).
  picks: Record<string, number>
  // playerId -> points this question earned (right answers only).
  gained: Record<string, number>
}

export interface TriviaSnapshot {
  phase: QuizPhase
  // 0-based index of the question on screen; total questions this round.
  index: number
  total: number
  // The question on screen in each language (null once the round is done).
  text: Record<QuizLang, QuizText> | null
  // ms left in the current phase (answer window or reveal).
  phaseRemainingMs: number
  // playerId -> accumulated points.
  scores: Record<string, number>
  // Players who already locked an answer for the question on screen.
  answeredCurrent: string[]
  // Round players still in play (one gone mid-round drops out: nobody waits for their answer).
  players: string[]
  // Present during the reveal phase only.
  reveal: QuizReveal | null
}

// Answer for a specific question index (server ignores stale/duplicate answers). `choice` is the tapped
// option index.
export interface TriviaInput {
  kind: 'answer'
  question: number
  choice: number
}
