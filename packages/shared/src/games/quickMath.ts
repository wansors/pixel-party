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
  // playerId -> remaining ms of that player's wrong-answer penalty (0 when none). A wrong answer still
  // advances to the next sum but starts a short cooldown during which the server ignores every answer
  // from that player, so mashing one button is slower than actually doing the arithmetic.
  cooldowns: Record<string, number>
  remainingMs: number
}

// Answer the question at `index` with option `choice`; the server ignores stale/duplicate answers and
// every answer sent while the player's `cooldowns` entry is running.
export interface QuickMathInput {
  kind: 'answer'
  index: number
  choice: number
}
