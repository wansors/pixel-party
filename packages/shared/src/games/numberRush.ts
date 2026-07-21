// Number Rush (Schulte grid) wire shapes. A single seeded grid of numbers 1..N is shared by everyone;
// each player taps them in order at their own pace. Server-authoritative progress; the client renders
// its own next-target from the snapshot.

export interface NumberRushSnapshot {
  // Shared seeded layout: grid[cell] = the number printed on that cell. Length = size * size.
  grid: number[]
  size: number
  // playerId -> the next number that player must tap (1-based). size*size + 1 means finished.
  progress: Record<string, number>
  remainingMs: number
}

// Tap a grid cell; the server accepts it only when its number is the player's current target.
export interface NumberRushInput {
  kind: 'tap'
  cell: number
}
