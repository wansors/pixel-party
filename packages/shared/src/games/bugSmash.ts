// Bug Smash (whack-a-mole) wire shapes. One seeded spawn timeline is shared by everyone: bugs (and the
// odd bomb) pop from a grid of holes for a short window. Tap a bug to score, avoid the bombs. The
// server owns the timeline and scoring; the client renders whatever is currently live.

export type BugKind = 'bug' | 'bomb'

export interface BugSmashLiveBug {
  // Stable spawn index (lets the client optimistically hide one it just smashed).
  index: number
  hole: number
  kind: BugKind
}

export interface BugSmashSnapshot {
  // Total holes; the client lays them out as a square grid.
  holes: number
  // Spawns visible right now (shared across all players).
  live: BugSmashLiveBug[]
  // playerId -> score so far.
  scores: Record<string, number>
  remainingMs: number
}

// Tap a hole; the server credits it only if a live bug occupies that hole and this player has not
// already smashed that spawn.
export interface BugSmashInput {
  kind: 'smash'
  hole: number
}
