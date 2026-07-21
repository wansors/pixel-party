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
