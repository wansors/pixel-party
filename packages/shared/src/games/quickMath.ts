// Quick Math wire shapes. A seeded pool of arithmetic questions is shared by everyone; each player
// answers as many as possible before the timer, advancing at their own pace. The correct answer is
// never sent while a question is live — only the choices.

export interface QuickMathPrompt {
  // Index into the shared seeded pool; echoed back on answer so the server drops stale taps.
  index: number
  text: string
  choices: number[]
}

export interface QuickMathSnapshot {
  // playerId -> the question that player is currently on (null once they exhaust the pool).
  prompts: Record<string, QuickMathPrompt | null>
  // playerId -> correct answers so far.
  scores: Record<string, number>
  remainingMs: number
}

// Answer the question at `index` with option `choice`; the server ignores stale/duplicate answers.
export interface QuickMathInput {
  kind: 'answer'
  index: number
  choice: number
}
