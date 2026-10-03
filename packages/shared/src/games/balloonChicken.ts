// Balloon Chicken ("Nerve") wire shapes. Everybody pumps the same sequence of balloons, one after the
// other: each pump adds points, and each balloon bursts at its own hidden threshold — the same one for
// everybody (seeded server side, never sent). CASH OUT banks the balloon in hand and brings the next
// one; a burst loses it. A balloon still in hand at the buzzer bursts too.

export const BALLOON_CHICKEN = {
  // Balloons each player gets per round.
  balloons: 3,
  pointsPerPump: 10,
} as const

export type BalloonOutcome = 'cashed' | 'burst'

export interface BalloonPlayer {
  // Pumps on the balloon in hand (0 between balloons and once done). Everybody's rides the room-wide
  // snapshot, but scenes show it for the player's own balloon only: rivals show status alone.
  pumps: number
  // Points banked so far (cash-outs only).
  banked: number
  // How each finished balloon ended, in order: its length is the index of the balloon in hand, and it
  // reaches BALLOON_CHICKEN.balloons once the player is done.
  outcomes: BalloonOutcome[]
}

export interface BalloonChickenSnapshot {
  // playerId -> balloon progress (burst thresholds stay server-side).
  players: Record<string, BalloonPlayer>
  remainingMs: number
}

// One pump adds points and risk; cash out banks the balloon in hand. Both ignored once done.
export interface BalloonChickenInput {
  kind: 'pump' | 'cashout'
}
