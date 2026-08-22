// Maze Sprint wire shapes. Everyone races through the same seeded 9x9 maze; each player has their own
// position within it. The maze itself is tiny (81 wall bitmasks) so it's cheap to ship on every
// snapshot alongside per-player progress.

export interface MazeSprintSnapshot {
  size: number
  // size*size wall bitmasks, one per cell: bit 1 = wall blocking North, 2 = East, 4 = South, 8 = West.
  walls: number[]
  exitIndex: number
  // playerId -> current cell index.
  pos: Record<string, number>
  // playerId -> steps taken so far.
  progress: Record<string, number>
  // playerId -> 0 if not finished, otherwise the server time they reached the exit.
  doneAt: Record<string, number>
  remainingMs: number
}

// Take one step from the player's current cell in the given direction. No-op server-side if a wall
// blocks that direction, the move would leave the maze, or the player already finished.
export interface MazeSprintInput {
  kind: 'move'
  dir: 'up' | 'down' | 'left' | 'right'
}
