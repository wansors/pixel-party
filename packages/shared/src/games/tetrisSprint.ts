// The Tetris engine and wire shapes shared by the two Tetris-style sprint games (`line-clear-sprint`,
// `quick-tetris`). Each player races their own board against an identical seeded piece sequence. The
// server owns the boards and the scoring; the client runs this SAME engine to predict its own board
// between snapshots (moves, rotations, drops, gravity and locks show on the frame you press a key), then
// rebases on every snapshot and replays the inputs the server hasn't acknowledged yet.
//
// The seven tetrominoes rotate SRS-style inside their n×n box (so a piece turns about its centre), with
// a few wall/floor kicks. Pure and deterministic: no randomness, no clock — time arrives as `dt`.

export const TETRIS = {
  cols: 6,
  rows: 12,
  // Gravity: the falling piece drops one row per this many ms.
  fallMs: 550,
  // Upcoming pieces each board carries on the wire: the NEXT preview, and enough for the client to
  // predict a few locks ahead of the next snapshot.
  preview: 4,
} as const

// 0 = empty, 1..7 = the shape (index + 1) that left it there — its colour.
export type TetrisCell = number

export interface TetrisPiece {
  shape: number
  x: number
  y: number
  rot: number // 0..3, quarter-turns clockwise from the spawn orientation
}

// Spawn orientation of each shape inside its n×n box: I, O, T, S, Z, J, L.
const BASE: readonly { n: number; cells: readonly (readonly [number, number])[] }[] = [
  {
    n: 4,
    cells: [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ],
  },
  {
    n: 2,
    cells: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  },
  {
    n: 3,
    cells: [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  },
  {
    n: 3,
    cells: [
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
    ],
  },
  {
    n: 3,
    cells: [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
  },
  {
    n: 3,
    cells: [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  },
  {
    n: 3,
    cells: [
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  },
]
export const TETRIS_SHAPES = BASE.length

interface XY {
  x: number
  y: number
}

// The four orientations of every shape, precomputed: a clockwise turn maps (x, y) → (n−1−y, x).
const ROTATIONS: readonly (readonly XY[])[][] = BASE.map(({ n, cells }) => {
  const turns: XY[][] = [cells.map(([x, y]) => ({ x, y }))]
  for (let r = 1; r < 4; r++) {
    turns.push((turns[r - 1] as XY[]).map((c) => ({ x: n - 1 - c.y, y: c.x })))
  }
  return turns
})

// Rotation kicks, tried in order: in place, a column either way, one row up (off the floor), two
// columns either way (the I piece against a wall).
const KICKS: readonly (readonly [number, number])[] = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [-2, 0],
  [2, 0],
]

const wrapShape = (shape: number): number =>
  ((shape % TETRIS_SHAPES) + TETRIS_SHAPES) % TETRIS_SHAPES

export function tetrisCells(piece: TetrisPiece): readonly XY[] {
  return ROTATIONS[piece.shape]?.[((piece.rot % 4) + 4) % 4] ?? []
}

// A fresh piece at the top centre, its top row on the board's first row.
export function tetrisSpawn(shape: number): TetrisPiece {
  const s = wrapShape(shape)
  const base = BASE[s] as (typeof BASE)[number]
  const top = Math.min(...base.cells.map(([, y]) => y))
  return { shape: s, x: Math.floor((TETRIS.cols - base.n) / 2), y: -top, rot: 0 }
}

// Would `piece`, offset by (dx, dy), hit a wall, the floor or the stack? Cells above the board never
// collide (a piece may turn while poking out of the top).
export function tetrisCollides(
  board: readonly TetrisCell[],
  piece: TetrisPiece,
  dx = 0,
  dy = 0,
): boolean {
  const cells = tetrisCells(piece)
  if (!cells.length) return true
  return cells.some((c) => {
    const nx = piece.x + c.x + dx
    const ny = piece.y + c.y + dy
    if (nx < 0 || nx >= TETRIS.cols || ny >= TETRIS.rows) return true
    return ny >= 0 && board[ny * TETRIS.cols + nx] !== 0
  })
}

// The row the piece would land on if hard-dropped now (the ghost).
export function tetrisLandingY(board: readonly TetrisCell[], piece: TetrisPiece): number {
  let dy = 0
  while (!tetrisCollides(board, piece, 0, dy + 1)) dy++
  return piece.y + dy
}

// Per-board simulation state, the same on the server and in the client's prediction.
export interface TetrisState {
  board: TetrisCell[] // the locked stack, row-major
  // The falling piece; null while there is none (topped out, or — client side — the next piece isn't
  // known yet).
  current: TetrisPiece | null
  queueIndex: number // the queue slot `current` came from
  fallAccum: number // ms of gravity accumulated toward the next row
  linesCleared: number
  toppedOut: boolean
}

// The shape in queue slot `i`, or undefined when it isn't known (client prediction past its preview).
export type TetrisShapeAt = (i: number) => number | undefined

export interface TetrisLock {
  // Board rows that cleared (indices before the collapse), top to bottom.
  rows: number[]
  toppedOut: boolean
}

export type TetrisSprintInput =
  | { kind: 'move'; dir: 'left' | 'right'; seq?: number }
  | { kind: 'rotate'; dir?: 'cw' | 'ccw'; seq?: number }
  | { kind: 'soft'; seq?: number } // one row down; locks if it can't
  | { kind: 'drop'; seq?: number } // hard drop: straight down and lock

export function tetrisEmptyBoard(): TetrisCell[] {
  return new Array<TetrisCell>(TETRIS.cols * TETRIS.rows).fill(0)
}

// Clears every full row (in place), dropping the rows above; returns the cleared rows.
export function tetrisClearLines(board: TetrisCell[]): number[] {
  const { cols, rows } = TETRIS
  const full: number[] = []
  for (let y = 0; y < rows; y++) {
    let filled = true
    for (let x = 0; x < cols && filled; x++) filled = board[y * cols + x] !== 0
    if (filled) full.push(y)
  }
  if (!full.length) return full
  const kept: TetrisCell[] = []
  for (let y = 0; y < rows; y++) {
    if (!full.includes(y)) for (let x = 0; x < cols; x++) kept.push(board[y * cols + x] ?? 0)
  }
  board.fill(0)
  for (let i = 0; i < kept.length; i++) board[full.length * cols + i] = kept[i] ?? 0
  return full
}

// Bakes the falling piece into the stack, clears lines, and brings the next piece from the queue (a
// piece that can't spawn tops the board out). Shared by gravity, soft drop and hard drop.
export function tetrisLock(s: TetrisState, shapeAt: TetrisShapeAt): TetrisLock {
  const piece = s.current
  if (!piece) return { rows: [], toppedOut: s.toppedOut }
  for (const c of tetrisCells(piece)) {
    const nx = piece.x + c.x
    const ny = piece.y + c.y
    if (nx >= 0 && nx < TETRIS.cols && ny >= 0 && ny < TETRIS.rows) {
      s.board[ny * TETRIS.cols + nx] = piece.shape + 1
    }
  }
  const rows = tetrisClearLines(s.board)
  s.linesCleared += rows.length
  s.queueIndex++
  const next = shapeAt(s.queueIndex)
  s.current = next === undefined ? null : tetrisSpawn(next)
  if (s.current && tetrisCollides(s.board, s.current)) {
    s.current = null
    s.toppedOut = true
  }
  return { rows, toppedOut: s.toppedOut }
}

export function tetrisMove(s: TetrisState, dx: -1 | 1): boolean {
  const piece = s.current
  if (s.toppedOut || !piece || tetrisCollides(s.board, piece, dx, 0)) return false
  s.current = { ...piece, x: piece.x + dx }
  return true
}

// A quarter-turn (clockwise for 1), trying the kicks in order; a no-op when none fits.
export function tetrisRotate(s: TetrisState, dir: 1 | -1): boolean {
  const piece = s.current
  if (s.toppedOut || !piece || piece.shape === 1) return false
  const turned: TetrisPiece = { ...piece, rot: (((piece.rot + dir) % 4) + 4) % 4 }
  for (const [dx, dy] of KICKS) {
    if (!tetrisCollides(s.board, turned, dx, dy)) {
      s.current = { ...turned, x: turned.x + dx, y: turned.y + dy }
      return true
    }
  }
  return false
}

// One row down (gravity starts over); on the stack it locks right away.
export function tetrisSoftDrop(s: TetrisState, shapeAt: TetrisShapeAt): TetrisLock | null {
  const piece = s.current
  if (s.toppedOut || !piece) return null
  s.fallAccum = 0
  if (!tetrisCollides(s.board, piece, 0, 1)) {
    s.current = { ...piece, y: piece.y + 1 }
    return null
  }
  return tetrisLock(s, shapeAt)
}

export function tetrisHardDrop(s: TetrisState, shapeAt: TetrisShapeAt): TetrisLock | null {
  const piece = s.current
  if (s.toppedOut || !piece) return null
  s.current = { ...piece, y: tetrisLandingY(s.board, piece) }
  return tetrisLock(s, shapeAt)
}

// Gravity for `dt` ms: a row per TETRIS.fallMs; a piece that can't fall locks. Returns the locks.
export function tetrisFall(s: TetrisState, dt: number, shapeAt: TetrisShapeAt): TetrisLock[] {
  const locks: TetrisLock[] = []
  if (s.toppedOut) return locks
  s.fallAccum += dt
  while (s.fallAccum >= TETRIS.fallMs && s.current && !s.toppedOut) {
    s.fallAccum -= TETRIS.fallMs
    const piece = s.current
    if (!tetrisCollides(s.board, piece, 0, 1)) s.current = { ...piece, y: piece.y + 1 }
    else locks.push(tetrisLock(s, shapeAt))
  }
  return locks
}

// Applies one player input; returns the lock it caused, if any.
export function tetrisApply(
  s: TetrisState,
  input: TetrisSprintInput,
  shapeAt: TetrisShapeAt,
): TetrisLock | null {
  switch (input.kind) {
    case 'move':
      tetrisMove(s, input.dir === 'left' ? -1 : 1)
      return null
    case 'rotate':
      tetrisRotate(s, input.dir === 'ccw' ? -1 : 1)
      return null
    case 'soft':
      return tetrisSoftDrop(s, shapeAt)
    case 'drop':
      return tetrisHardDrop(s, shapeAt)
    default:
      return null
  }
}

// --- Wire ---

export interface TetrisBoard {
  // The locked stack: rows*cols digits (0 = empty, 1..7 = colour).
  cells: string
  // The falling piece as [shape, x, y, rot], or null (topped out / finished).
  piece: [number, number, number, number] | null
  // The next TETRIS.preview shapes, as digits.
  next: string
  // Gravity accumulated toward the next row (ms), so the client keeps the fall in step.
  fall: number
  // The last input `seq` the server has applied (0 = none): the client replays only the later ones.
  ack: number
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

export function tetrisEncodeBoard(
  s: TetrisState,
  shapeAt: TetrisShapeAt,
  ack: number,
): Omit<TetrisBoard, 'doneAt'> {
  let next = ''
  for (let k = 1; k <= TETRIS.preview; k++) next += String(shapeAt(s.queueIndex + k) ?? 0)
  const p = s.current
  return {
    cells: s.board.join(''),
    piece: p && !s.toppedOut ? [p.shape, p.x, p.y, p.rot] : null,
    next,
    fall: s.fallAccum,
    ack,
    linesCleared: s.linesCleared,
    toppedOut: s.toppedOut,
  }
}

// A wire board back into a simulation state, plus the queue lookup its preview allows.
export function tetrisDecodeBoard(b: TetrisBoard): { state: TetrisState; shapeAt: TetrisShapeAt } {
  // Tolerant of a malformed board (a client and server from different builds): it decodes as empty.
  const cells = typeof b.cells === 'string' ? b.cells : ''
  const board = tetrisEmptyBoard()
  for (let i = 0; i < board.length; i++) board[i] = Number(cells[i] ?? 0) || 0
  const p = Array.isArray(b.piece) && b.piece.length === 4 ? b.piece : null
  // The queue slot of the falling piece isn't on the wire; slot 0 + the preview is all that's needed.
  const state: TetrisState = {
    board,
    current: p ? { shape: p[0], x: p[1], y: p[2], rot: p[3] } : null,
    queueIndex: 0,
    fallAccum: Number(b.fall) || 0,
    linesCleared: Number(b.linesCleared) || 0,
    toppedOut: b.toppedOut === true,
  }
  const next = typeof b.next === 'string' ? b.next : ''
  return {
    state,
    shapeAt: (i) => (i >= 1 && i <= next.length ? Number(next[i - 1]) : undefined),
  }
}
