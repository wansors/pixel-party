// Bubble Pop wire shapes. Everyone starts from the same seeded top-half cluster and shot queue; each
// player has their own copy of the board and their own pointer into the shared shot queue. The queue
// itself never goes on the wire — only each player's own board plus their next shot color.

export interface BubblePopBoard {
  // rows*cols values; 0 = empty, 1..4 = a color id.
  grid: number[]
  score: number
  // The color id this player's next shot will place.
  nextColor: number
  done: boolean
}

export interface BubblePopSnapshot {
  rows: number
  cols: number
  // playerId -> that player's board.
  boards: Record<string, BubblePopBoard>
  // playerId -> score, mirrored from `boards` for generic live-scoreboard consumers.
  scores: Record<string, number>
  remainingMs: number
}

// Shoot the next queued color up column `col` on this player's own board.
export interface BubblePopInput {
  kind: 'shoot'
  col: number
}
