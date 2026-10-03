// Maze Sprint wire shapes. Everyone races through the same seeded 9x9 maze; each player has their own
// position within it. The maze itself is tiny (81 wall bitmasks) so it's cheap to ship on every
// snapshot alongside per-player progress. While you race, the client shows rivals only by their
// distance to the exit (their spot would give the path away); their positions are revealed once you
// finish. Positions still travel for everyone — devtools-only on a LAN party.

export interface MazeSprintSnapshot {
  size: number
  // size*size wall bitmasks, one per cell: bit 1 = wall blocking North, 2 = East, 4 = South, 8 = West.
  walls: number[]
  exitIndex: number
  // playerId -> current cell index.
  pos: Record<string, number>
  // playerId -> steps still needed to reach the exit (0 once there).
  dist: Record<string, number>
  // Steps from the entrance to the exit (the full length of every rival's progress bar).
  startDist: number
  // playerId -> steps taken so far.
  progress: Record<string, number>
  // playerId -> 0 if not finished, otherwise the server time they reached the exit.
  doneAt: Record<string, number>
  remainingMs: number
}

// Take one step from the player's current cell in the given direction. No-op server-side if a wall
// blocks that direction, the move would leave the maze, the player already finished, or it comes less
// than the minimum step interval after their last step.
export interface MazeSprintInput {
  kind: 'move'
  dir: 'up' | 'down' | 'left' | 'right'
}
