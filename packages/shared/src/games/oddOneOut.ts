// Odd One Out wire shapes. A seeded sequence of boards (grids of near-identical tiles with one odd
// tile) is shared by everyone; each player advances through it at their own pace, the grid growing and
// the difference shrinking each level. The odd tile differs in brightness (not hue alone) so it stays
// solvable without color discrimination.

export interface OddOneOutBoard {
  // Level index (0-based); echoed back on tap so the server drops stale taps.
  level: number
  cols: number
  rows: number
  // 0xRRGGBB for the Phaser canvas.
  base: number
  odd: number
  // Cell index (0..cols*rows-1) of the odd tile.
  oddCell: number
}

export interface OddOneOutSnapshot {
  // playerId -> the board that player is currently on (null once the sequence is exhausted).
  boards: Record<string, OddOneOutBoard | null>
  // playerId -> levels cleared so far.
  scores: Record<string, number>
  remainingMs: number
}

// Tap a tile on the board at `level`; a correct tap (the odd tile) advances the player.
export interface OddOneOutInput {
  kind: 'tap'
  level: number
  cell: number
}
