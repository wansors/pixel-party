// Button Masher wire shapes — shared so client and server agree on the snapshot the scene renders and
// the input it sends. The authoritative logic lives server-side in the domain mini-game module.

// Presses counted per player per rolling second: about the best a human manages, so an autoclicker or
// a three-finger drum roll only ties the fastest masher. Shared so the scene can show the cap (a speed
// gauge that tops out at MAX) instead of silently swallowing the extra presses.
export const BUTTON_MASHER_MAX_PER_SEC = 15

export interface ButtonMasherSnapshot {
  // playerId -> presses counted so far (server-authoritative).
  counts: Record<string, number>
  remainingMs: number
}

// Each input message counts as one press; the server only tallies presses inside the round window.
export interface ButtonMasherInput {
  kind: 'mash'
}
