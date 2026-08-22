// Pixel Hoops (basketball) wire shapes. A seeded sequence of free-throws is shared by everyone; each
// player shoots at their own pace. Charge the power meter and release to match the shot's target power
// (further hoop = more power); consecutive baskets build a combo. The server owns the targets/scoring.

export interface PixelHoopsShot {
  // Index into the shared shot sequence; echoed back on shoot so the server drops stale taps.
  index: number
  // Required power for this shot, 0..1 (also how far to draw the hoop).
  distance: number
}

export interface PixelHoopsSnapshot {
  // playerId -> the shot that player is currently lining up (null once the sequence is exhausted).
  shots: Record<string, PixelHoopsShot | null>
  // playerId -> points so far.
  scores: Record<string, number>
  // playerId -> current consecutive-basket streak.
  combos: Record<string, number>
  remainingMs: number
}

// Release the shot for `index` at charged power `power` (0..1). The server scores it against the shot's
// target and clamps out-of-range values.
export interface PixelHoopsInput {
  kind: 'shoot'
  index: number
  power: number
}

// How close the released power must be to a shot's target to sink it, as a function of shot index —
// shared by the server (scoring) and the client (drawing the green target band the same size the server
// actually accepts). Starts generous and tightens with every shot, holding at a floor past SHOTS_TO_MIN
// so the round doesn't become unwinnable, not just harder.
const MAX_TOLERANCE = 0.16
const MIN_TOLERANCE = 0.07
const SHOTS_TO_MIN = 24

export function toleranceForShot(index: number): number {
  const t = Math.min(1, Math.max(0, index) / SHOTS_TO_MIN)
  return MAX_TOLERANCE - (MAX_TOLERANCE - MIN_TOLERANCE) * t
}
