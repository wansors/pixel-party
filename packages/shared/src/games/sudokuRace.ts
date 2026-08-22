// Sudoku Race wire shapes. Everyone races the same seeded 4x4 sudoku (2x2 boxes); each player fills
// their own copy of the blanks. The solution never goes on the wire — only per-player fill state and a
// correctness count, which the server alone computes.

export interface SudokuBoard {
  // size*size values; 0 = still blank, 1..size = this player's current entry (givens included).
  grid: number[]
  // How many of this player's non-given cells currently hold the correct value.
  correctCount: number
  // size*size flags; true for a non-given cell this player has already filled correctly — the server
  // rejects further edits to it, so the client should render it as locked too.
  lockedMask: boolean[]
  done: boolean
}

export interface SudokuSnapshot {
  size: number
  // size*size values; 0 = blank (to fill), 1..size = a given (pre-filled, locked) digit.
  given: number[]
  blanksCount: number
  // playerId -> that player's board.
  boards: Record<string, SudokuBoard>
  remainingMs: number
}

// Set the cell at `index` to `value` (0 clears it) on this player's own board. No-op on a given cell.
export interface SudokuInput {
  kind: 'fill'
  index: number
  value: number
}
