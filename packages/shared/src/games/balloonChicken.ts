// Balloon Chicken ("Nerve") wire shapes. Pump a pixel balloon for points; a hidden server-side
// threshold bursts it → 0. Cash out before it pops to bank what you have. The threshold is never sent.

export type BalloonStatus = 'pumping' | 'cashed' | 'burst'

export interface BalloonPlayer {
  pumps: number
  banked: number
  status: BalloonStatus
}

export interface BalloonChickenSnapshot {
  // playerId -> live balloon state (burst thresholds stay server-side).
  players: Record<string, BalloonPlayer>
  remainingMs: number
  pointsPerPump: number
}

// One pump adds points and risk; cash out locks the current points in. Both ignored once cashed/burst.
export interface BalloonChickenInput {
  kind: 'pump' | 'cashout'
}
