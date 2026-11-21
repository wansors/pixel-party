// Pixel Dash wire shapes. One seeded track of obstacles (each with a fixed arrival time) is shared by
// everyone; players tap JUMP to be in the air when an obstacle reaches them. A jump lasts AIR_MS and the
// runner can't jump again until it has landed (longer after a jump that cleared nothing). The server owns
// the timeline and the scoring (obstacles cleared, timing accuracy as the tiebreak); the client renders
// the obstacles on the server's clock (each approaches linearly, so it extrapolates from the last
// snapshot) and its own runner locally. The run speeds up over the round: `leadMs` (how long an
// obstacle takes to cross the screen) shrinks, so the world scrolls faster. From a fifth of the way in,
// birds fly in at head height: stay on the ground and they pass over you — jump into one and you're
// down (D53). Later on some obstacles come in pairs, a jump and a landing apart.

// Jump timing, shared so the server judges and the client shows the very same jump: a jump is `airMs`
// in the air (it clears a ground obstacle arriving meanwhile, `lateMs` of grace included); the runner
// can jump again `landMs` after landing — `wastedMs` later still after a jump that cleared nothing —
// and a stumble trips them for `tripMs`. The lead window starts at `startLeadMs`.
export const DASH = {
  airMs: 330,
  lateMs: 40,
  landMs: 150,
  wastedMs: 400,
  tripMs: 450,
  startLeadMs: 1200,
} as const

export interface PixelDashObstacle {
  // Stable id so the client can track an obstacle across snapshots.
  id: number
  // A bird at head height (stay on the ground); absent = on the ground (jump it).
  high?: boolean
  // Normalized time to arrival (ms / leadMs): 1 = entering from the right, 0 = at the runner, negative
  // once past it (kept until it has scrolled off-screen). Falls by 1/leadMs per ms.
  t: number
}

export interface PixelDashSnapshot {
  // Obstacles currently approaching or just past, shared across all players.
  obstacles: PixelDashObstacle[]
  // The lead window in force (ms from entering the screen to reaching the runner): obstacles and the
  // ground scroll at (screen span / leadMs). Absent = DASH.startLeadMs (the starting pace).
  leadMs?: number
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
