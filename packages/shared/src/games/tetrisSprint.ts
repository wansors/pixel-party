// Shared wire shapes for the two Tetris-style sprint games (`line-clear-sprint`, `quick-tetris`). Each
// player races their own board against an identical seeded piece sequence; the server owns the board and
// scoring, the client only renders.

export interface TetrisBoard {
  // ROWS*COLS values, 0 = empty, else a color id. The currently-falling piece is baked in already, so
  // the scene just draws this flat array — it never needs the separate falling-piece object.
  grid: number[]
  linesCleared: number
  toppedOut: boolean
  // Present only for quick-tetris. 0 = hasn't reached the target yet.
  doneAt?: number
}

export interface TetrisSprintSnapshot {
  cols: number
  rows: number
  boards: Record<string, TetrisBoard>
  // playerId -> linesCleared, top-level for the live-scoreboard feature.
  progress: Record<string, number>
  remainingMs: number
  // Present only for quick-tetris.
  targetLines?: number
  // Present only for line-clear-sprint: a topped-out board costs this many lines and restarts empty a
  // moment later (in quick-tetris a top-out is final).
  topOutPenalty?: number
}

export type TetrisSprintInput =
  | { kind: 'move'; dir: 'left' | 'right' }
  | { kind: 'drop' }
  | { kind: 'rotate' }
