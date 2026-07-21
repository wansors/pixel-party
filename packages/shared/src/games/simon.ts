// Simon (sequence memory) wire shapes. One seeded pad sequence is shared by everyone; each player
// watches the growing prefix and repeats it. A wrong pad ends that player's run. The server only ever
// sends the prefix up to a player's current level, so nobody can read ahead.

export interface SimonPlayerView {
  // The pads to reproduce at this player's current level (0-based pad indices). Never longer than the
  // level reached, so future pads stay hidden.
  seq: number[]
  // How many pads of the current replay the player has entered correctly so far.
  pos: number
  alive: boolean
}

export interface SimonSnapshot {
  players: Record<string, SimonPlayerView>
  // playerId -> levels completed (also the score).
  scores: Record<string, number>
  // Number of pads on the board.
  pads: number
  remainingMs: number
}

export interface SimonInput {
  kind: 'pad'
  pad: number
}
