// Button Masher wire shapes — shared so client and server agree on the snapshot the scene renders and
// the input it sends. The authoritative logic lives server-side in the domain mini-game module.

export interface ButtonMasherSnapshot {
  // playerId -> presses counted so far (server-authoritative).
  counts: Record<string, number>
  remainingMs: number
}

// Each input message counts as one press; the server only tallies presses inside the round window.
export interface ButtonMasherInput {
  kind: 'mash'
}
