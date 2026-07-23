// Pixel Dash wire shapes. One seeded track of obstacles (each with a fixed arrival time) is shared by
// everyone; players tap JUMP to clear the obstacle arriving at the player. The server owns the timeline
// and the scoring (obstacles cleared, with stumbles as the tiebreak); the client renders the obstacles
// approaching from the right (smoothed by the snapshot interpolator) and its own runner locally.

export interface PixelDashObstacle {
  // Stable id so the client can interpolate an obstacle's approach between snapshots.
  id: number
  // Normalized approach: 1 = far to the right, 0 = at the player. Slightly negative just past the player.
  t: number
}

export interface PixelDashSnapshot {
  // Obstacles currently approaching (within the lead window), shared across all players.
  obstacles: PixelDashObstacle[]
  // playerId → obstacles cleared so far.
  scores: Record<string, number>
  remainingMs: number
}

// Tap JUMP to clear the obstacle arriving at the player. The server resolves the tap against the track's
// timing window.
export interface PixelDashInput {
  kind: 'jump'
}
