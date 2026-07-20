// Lightning Quiz (Trivia) wire shapes. Multiple-choice questions with a per-question time limit;
// points for a correct answer plus a speed bonus. The question order/selection is common to everyone
// (seeded server side); the correct answer is never sent while a question is live.

export interface TriviaSnapshot {
  // 0-based index of the active question; total questions this round.
  index: number
  total: number
  // Active question text + options (null after the last question closes).
  question: string | null
  choices: string[]
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
