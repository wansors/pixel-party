// Pixel Dash wire shapes. One seeded track of obstacles (each with a fixed arrival time) is shared by
// everyone; players tap JUMP to be in the air when an obstacle reaches them. A jump lasts AIR_MS and the
// runner can't jump again until it has landed (longer after a jump that cleared nothing). The server owns
// the timeline and the scoring (obstacles cleared, timing accuracy as the tiebreak); the client renders
// the obstacles on the server's clock (each approaches linearly, so it extrapolates from the last
// snapshot) and its own runner locally.

export interface PixelDashObstacle {
  // Stable id so the client can track an obstacle across snapshots.
  id: number
  // Normalized time to arrival (ms / LEAD_MS): 1 = entering from the right, 0 = at the runner, negative
  // once past it (kept until it has scrolled off-screen). Falls by 1/LEAD_MS per ms.
  t: number
}

export interface PixelDashSnapshot {
  // Obstacles currently approaching or just past, shared across all players.
  obstacles: PixelDashObstacle[]
  // playerId → obstacles cleared so far.
  scores: Record<string, number>
  // playerId → obstacles that got past them (ran into).
  stumbles: Record<string, number>
  remainingMs: number
}

// Tap JUMP. The server ignores it while the runner is still in the air or landing.
export interface PixelDashInput {
  kind: 'jump'
}
