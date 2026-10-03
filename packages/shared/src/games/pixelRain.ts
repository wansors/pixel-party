// Pixel Rain wire shapes. Dodge falling blocks: one seeded stream of obstacles is shared by everyone;
// each player drags their own avatar horizontally near the bottom. When a block reaches the avatar band
// and overlaps the avatar's x, that player is eliminated. Survive the longest. The server owns the
// timeline, the avatars (each slides toward its player's x at a capped speed) and the eliminations; the
// client renders the currently-visible obstacles on the server's clock (each falls linearly, so it
// extrapolates from the last snapshot) and its own avatar locally, moving at the same cap.

export interface PixelRainObstacle {
  // Stable id so the client can track an obstacle across snapshots.
  id: number
  // Normalized position: x in [0,1] across the play area, y in [0,1] top→bottom.
  x: number
  y: number
  // Time to fall the full height (y 0 → 1): y grows by 1/fallMs per ms. Shrinks as the rain picks up.
  fallMs: number
}

export interface PixelRainSnapshot {
  // Obstacles currently on screen (0 ≤ y ≤ 1), shared across all players.
  obstacles: PixelRainObstacle[]
  // playerId → still alive.
  alive: Record<string, boolean>
  remainingMs: number
}

// Steer the avatar: x is the normalized [0,1] centre to slide to. The server clamps it to the street the
// avatar can reach and moves the avatar there at its capped speed.
export interface PixelRainInput {
  kind: 'move'
  x: number
}
