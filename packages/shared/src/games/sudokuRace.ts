// Sudoku Race wire shapes. Everyone races the same seeded 4x4 sudoku (2x2 boxes, a unique solution);
// each player fills their own copy of the blanks, dealt under their own seeded symmetry (relabelled
// digits, shuffled rows/columns — the same puzzle logically). The snapshot goes to the whole room, so a
// rival's board is on the wire too, but it's a differently dressed puzzle: no help with yours. The
// solution never goes on the wire — only per-player fill state and a correctness count, which the
// server alone computes.

export interface SudokuBoard {
  // size*size values for this player's copy: 0 = blank (to fill), 1..size = a given (pre-filled, locked).
  given: number[]
  // size*size values; 0 = still blank, 1..size = this player's current entry (givens included).
  grid: number[]
  // How many of this player's non-given cells currently hold the correct value.
  correctCount: number
  // size*size flags; true for a non-given cell this player has already filled correctly — the server
  // rejects further edits to it, so the client should render it as locked too.
  lockedMask: boolean[]
  done: boolean
  // Remaining ms of this player's wrong-digit penalty (0 when none). Entering a wrong non-zero digit
  // keeps it on the board but starts a short cooldown during which the server ignores every fill
  // input from this player, so guessing digit after digit is slower than solving.
  cooldownMs: number
}

export interface SudokuSnapshot {
  size: number
  // Blanks to fill (the same count on every copy).
  blanksCount: number
  // playerId -> that player's board.
  boards: Record<string, SudokuBoard>
  remainingMs: number
}

// Set the cell at `index` to `value` (0 clears it) on this player's own board. No-op on a given cell,
// on a cell already filled correctly, and while the player's `cooldownMs` is running.
export interface SudokuInput {
  kind: 'fill'
  index: number
  value: number
}
