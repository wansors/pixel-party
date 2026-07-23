// Pixel Rain wire shapes. Dodge falling blocks: one seeded stream of obstacles is shared by everyone;
// each player drags their own avatar horizontally near the bottom. When a block reaches the avatar band
// and overlaps the avatar's x, that player is eliminated. Survive the longest. The server owns the
// timeline and the eliminations; the client renders the currently-visible obstacles (smoothed by the
// snapshot interpolator) and its own avatar locally.

export interface PixelRainObstacle {
  // Stable id so the client can interpolate an obstacle's fall between snapshots.
  id: number
  // Normalized position: x in [0,1] across the play area, y in [0,1] top→bottom.
  x: number
  y: number
}

export interface PixelRainSnapshot {
  // Obstacles currently on screen (0 ≤ y ≤ 1), shared across all players.
  obstacles: PixelRainObstacle[]
  // playerId → still alive.
  alive: Record<string, boolean>
  remainingMs: number
}

// Drag the avatar: x is the normalized [0,1] avatar centre. The server clamps and uses the latest x
// when checking for a hit.
export interface PixelRainInput {
  kind: 'move'
  x: number
}
