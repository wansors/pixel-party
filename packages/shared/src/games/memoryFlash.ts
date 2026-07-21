// Memory Flash wire shapes. A burst of colored pixels flashes briefly; count how many of the target
// color appeared, then pick the number. A seeded board sequence is shared by everyone; each player
// advances at their own pace. The server owns the true counts and scoring.

export interface MemoryFlashPixel {
  // Grid coordinates.
  x: number
  y: number
  // 0xRRGGBB for the Phaser canvas.
  color: number
}

export interface MemoryFlashBoard {
  // Index into the shared board sequence; echoed back on answer so the server drops stale taps.
  level: number
  cols: number
  rows: number
  pixels: MemoryFlashPixel[]
  // The colour to count, as hex + a human label.
  targetColor: number
  targetName: string
  // How long the client shows the pixels before hiding them and asking.
  flashMs: number
  // Answer options (numbers); the correct count stays server-side.
  choices: number[]
}

export interface MemoryFlashSnapshot {
  // playerId -> the board that player is currently on (null once the sequence is exhausted).
  boards: Record<string, MemoryFlashBoard | null>
  // playerId -> correct answers so far.
  scores: Record<string, number>
  remainingMs: number
}

export interface MemoryFlashInput {
  kind: 'answer'
  level: number
  value: number
}
