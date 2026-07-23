// Match (memory pairs) wire shapes. One seeded board of face-down cards (pairs) is shared by everyone;
// each player flips on their own board. A matching pair stays revealed, a mismatch flips back on the
// next flip. The server owns each board and only ever reveals the pairId of cards this player has
// face-up or already matched — face-down values are never leaked.

export interface MatchBoard {
  // Card indices currently face-up (length 0/1/2; a length-2 board is a mismatch shown until next flip).
  up: number[]
  // Card indices already matched (locked, stay revealed).
  matched: number[]
  attempts: number
  done: boolean
}

export interface MatchSnapshot {
  cols: number
  rows: number
  // playerId -> that player's board.
  boards: Record<string, MatchBoard>
  // playerId -> { cardIndex -> pairId } for ONLY that player's up + matched cards (never face-down).
  reveal: Record<string, Record<number, number>>
  remainingMs: number
}

// Flip the card at `index` on this player's board.
export interface MatchInput {
  kind: 'flip'
  index: number
}
