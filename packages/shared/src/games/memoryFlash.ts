// Memory Flash wire shapes. A burst of colored pixels flashes briefly; count how many of the target
// color appeared, then pick the number. A seeded board sequence is shared by everyone; each player
// advances at their own pace. The server owns the true counts and scoring.

// The burst's colours; a board's `cells` index into this list.
export const MEMORY_FLASH_COLORS: readonly { name: string; hex: number }[] = [
  { name: 'RED', hex: 0xe63946 },
  { name: 'GREEN', hex: 0x2a9d3f },
  { name: 'BLUE', hex: 0x3a7bd5 },
  { name: 'YELLOW', hex: 0xf4c20d },
]

export interface MemoryFlashBoard {
  // Index into the shared board sequence; echoed back on answer so the server drops stale taps.
  level: number
  cols: number
  rows: number
  // The burst, row-major: one character per cell, '.' = empty, else a digit indexing
  // MEMORY_FLASH_COLORS (64 characters at most, instead of a list of {x, y, color} objects).
  cells: string
  // The colour to count, as hex + a human label.
  targetColor: number
  targetName: string
  // How long the client shows the pixels before hiding them and asking.
  flashMs: number
  // Answer options (numbers); the correct count stays server-side.
  choices: number[]
}

export interface MemoryFlashSnapshot {
  // The boards players are on right now, each sent once (everyone on the same level shares one).
  boards: MemoryFlashBoard[]
  // playerId -> the level that player is on (null once the sequence is exhausted).
  at: Record<string, number | null>
  // playerId -> correct answers so far.
  scores: Record<string, number>
  remainingMs: number
}

export interface MemoryFlashInput {
  kind: 'answer'
  level: number
  value: number
}
