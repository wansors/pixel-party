// Number Rush (Schulte grid) wire shapes. A single seeded grid of numbers 1..N is shared by everyone;
// each player taps them in order at their own pace. Server-authoritative progress; the client renders
// its own next-target from the snapshot.

// A wrong number locks that player's taps for this long: hunting by sweeping every cell in reading order
// (≈ 150 wrong taps a grid) is then hopeless, while an honest misclick costs half a second.
export const NUMBER_RUSH_WRONG_COOLDOWN_MS = 500

export interface NumberRushSnapshot {
  // Shared seeded layout: grid[cell] = the number printed on that cell. Length = size * size.
  grid: number[]
  size: number
  // playerId -> the next number that player must tap (1-based). size*size + 1 means finished.
  progress: Record<string, number>
  // playerId -> remaining ms of that player's wrong-number penalty (0 when none).
  cooldowns: Record<string, number>
  remainingMs: number
}

// Tap a grid cell; the server accepts it only when its number is the player's current target. A
// higher number starts the wrong-number penalty (taps during it are ignored); an already cleared one is
// simply ignored (a double click).
export interface NumberRushInput {
  kind: 'tap'
  cell: number
}
