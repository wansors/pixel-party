import type { Random } from '../ports/Random'

// Shared simplified Tetris engine reused by both `line-clear-sprint` and `quick-tetris`. Deliberately
// minimal for a party game: a small board and gravity-only movement plus left/right/drop/rotate input.
// Everyone races the same seeded piece queue (see `createQueue`).

export const COLS = 6
export const ROWS = 12

// Gravity: the falling piece advances one row per this many accumulated ms.
export const FALL_INTERVAL_MS = 550

export type Cell = number // 0 = empty, 1..N = a color id

export interface PieceShape {
  color: number
  cells: { x: number; y: number }[]
}

// Four simple tetromino-like shapes, colors 1..4 (rotations are precomputed below; see tryRotate).
export const SHAPES: readonly PieceShape[] = [
  {
    color: 1,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
  }, // I
  {
    color: 2,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  }, // O
  {
    color: 3,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
    ],
  }, // T
  {
    color: 4,
    cells: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  }, // S
]

export interface FallingPiece {
  shapeIndex: number
  x: number
  y: number
  rotation: number // 0..3, quarter-turns clockwise from the shape's base orientation
}

type Cells = { x: number; y: number }[]

function normalizeCells(cells: Cells): Cells {
  const minX = Math.min(...cells.map((c) => c.x))
  const minY = Math.min(...cells.map((c) => c.y))
  return cells.map((c) => ({ x: c.x - minX, y: c.y - minY }))
}

// Rotates a cell set 90° clockwise within its own bounding box.
function rotateCellsCW(cells: Cells): Cells {
  const maxY = Math.max(...cells.map((c) => c.y))
  return normalizeCells(cells.map((c) => ({ x: maxY - c.y, y: c.x })))
}

// Precomputed 4 rotation states per shape, so rotating at runtime is a lookup, not recomputation.
const SHAPE_ROTATIONS: readonly Cells[][] = SHAPES.map((shape) => {
  const rotations: Cells[] = [normalizeCells(shape.cells)]
  for (let i = 1; i < 4; i++) rotations.push(rotateCellsCW(rotations[i - 1] as Cells))
  return rotations
})

function pieceCells(piece: FallingPiece): Cells {
  return SHAPE_ROTATIONS[piece.shapeIndex]?.[piece.rotation] ?? []
}

export function spawnPiece(shapeIndex: number, cols: number): FallingPiece {
  const idx = ((shapeIndex % SHAPES.length) + SHAPES.length) % SHAPES.length
  const shape = SHAPES[idx] as PieceShape
  const width = Math.max(...shape.cells.map((c) => c.x)) + 1
  return { shapeIndex: idx, x: Math.floor((cols - width) / 2), y: 0, rotation: 0 }
}

// A seeded sequence of shape indices shared by every player in the round, long enough to outlast any
// realistic round (300 entries — generous headroom for both games' durations).
export function createQueue(random: Random, length: number): number[] {
  const queue: number[] = []
  for (let i = 0; i < length; i++) {
    queue.push(Math.min(SHAPES.length - 1, Math.floor(random.next() * SHAPES.length)))
  }
  return queue
}

// Would `piece`, offset by (dx, dy), overlap a wall, the floor, or an occupied board cell? Cells above
// the board (y < 0, during spawn) never collide — only sideways/downward/board checks matter.
export function collides(
  board: Cell[],
  cols: number,
  rows: number,
  piece: FallingPiece,
  dx: number,
  dy: number,
): boolean {
  const cells = pieceCells(piece)
  if (!cells.length) return true
  return cells.some((c) => {
    const nx = piece.x + c.x + dx
    const ny = piece.y + c.y + dy
    if (nx < 0 || nx >= cols || ny >= rows) return true
    if (ny < 0) return false
    return board[ny * cols + nx] !== 0
  })
}

// Bakes the piece's cells into the board. Per-player boards are exclusively owned by that player's
// state, so mutating in place is fine — callers that need to preserve the input array copy it first.
export function lockPiece(board: Cell[], cols: number, piece: FallingPiece): Cell[] {
  const shape = SHAPES[piece.shapeIndex]
  const cells = pieceCells(piece)
  if (!shape || !cells.length) return board
  for (const c of cells) {
    const nx = piece.x + c.x
    const ny = piece.y + c.y
    if (nx >= 0 && nx < cols && ny >= 0 && ny * cols + nx < board.length) {
      board[ny * cols + nx] = shape.color
    }
  }
  return board
}

// Clears every full row, shifts everything above down, and refills the top with empty rows.
export function clearFullLines(
  board: Cell[],
  cols: number,
  rows: number,
): { board: Cell[]; cleared: number } {
  const remaining: Cell[][] = []
  for (let y = 0; y < rows; y++) {
    const row = board.slice(y * cols, y * cols + cols)
    if (!row.every((c) => c !== 0)) remaining.push(row)
  }
  const cleared = rows - remaining.length
  const blankRows = Array.from({ length: cleared }, () => new Array<Cell>(cols).fill(0))
  return { board: [...blankRows, ...remaining].flat(), cleared }
}

// Per-player simulation state, shared verbatim by both games (each keeps its own extra bookkeeping —
// e.g. quick-tetris' `doneAt` — alongside a Map of these, not inside them).
export interface PlayerBoardState {
  board: Cell[]
  queueIndex: number
  current: FallingPiece
  fallAccum: number
  linesCleared: number
  toppedOut: boolean
}

export function createPlayerBoard(queue: number[]): PlayerBoardState {
  return {
    board: new Array<Cell>(COLS * ROWS).fill(0),
    queueIndex: 0,
    current: spawnPiece(queue[0] ?? 0, COLS),
    fallAccum: 0,
    linesCleared: 0,
    toppedOut: false,
  }
}

// Locks the current piece, clears full lines, and spawns the next piece from the queue — shared by the
// gravity-triggered lock (tick) and the hard-drop input, so this sequence is never duplicated.
export function lockAndAdvance(p: PlayerBoardState, queue: number[]): void {
  p.board = lockPiece(p.board, COLS, p.current)
  const { board, cleared } = clearFullLines(p.board, COLS, ROWS)
  p.board = board
  p.linesCleared += cleared
  p.queueIndex++
  p.current = spawnPiece(queue[p.queueIndex % queue.length] ?? 0, COLS)
  if (collides(p.board, COLS, ROWS, p.current, 0, 0)) p.toppedOut = true
}

// A topped-out board starts over: emptied, with the piece that couldn't spawn back at the top (the
// queue carries on where it was). Line Clear Sprint uses it so one top-out doesn't bench you for the
// rest of the round.
export function restartBoard(p: PlayerBoardState, queue: number[]): void {
  p.board = new Array<Cell>(COLS * ROWS).fill(0)
  p.current = spawnPiece(queue[p.queueIndex % queue.length] ?? 0, COLS)
  p.fallAccum = 0
  p.toppedOut = false
}

export function stepFall(p: PlayerBoardState, dt: number, queue: number[]): void {
  if (p.toppedOut) return
  p.fallAccum += dt
  while (p.fallAccum >= FALL_INTERVAL_MS && !p.toppedOut) {
    p.fallAccum -= FALL_INTERVAL_MS
    if (!collides(p.board, COLS, ROWS, p.current, 0, 1)) {
      p.current = { ...p.current, y: p.current.y + 1 }
    } else {
      lockAndAdvance(p, queue)
    }
  }
}

export function tryMove(p: PlayerBoardState, dir: -1 | 1): void {
  if (p.toppedOut) return
  if (!collides(p.board, COLS, ROWS, p.current, dir, 0)) {
    p.current = { ...p.current, x: p.current.x + dir }
  }
}

// Rotates the falling piece a quarter-turn clockwise, trying a small set of horizontal wall-kick
// offsets (own column, then one/two columns either side) before giving up as a no-op.
export function tryRotate(p: PlayerBoardState): void {
  if (p.toppedOut) return
  const rotated: FallingPiece = { ...p.current, rotation: (p.current.rotation + 1) % 4 }
  for (const dx of [0, -1, 1, -2, 2]) {
    if (!collides(p.board, COLS, ROWS, rotated, dx, 0)) {
      p.current = { ...rotated, x: rotated.x + dx }
      return
    }
  }
}

export function hardDrop(p: PlayerBoardState, queue: number[]): void {
  if (p.toppedOut) return
  while (!collides(p.board, COLS, ROWS, p.current, 0, 1)) {
    p.current = { ...p.current, y: p.current.y + 1 }
  }
  lockAndAdvance(p, queue)
}

// The board plus the currently-falling piece baked into a COPY, for wire snapshots — the client only
// ever renders a flat grid and never needs to know about the separate falling-piece object.
export function renderBoard(p: PlayerBoardState): Cell[] {
  const grid = [...p.board]
  if (p.toppedOut) return grid
  const shape = SHAPES[p.current.shapeIndex]
  const cells = pieceCells(p.current)
  if (!shape || !cells.length) return grid
  for (const c of cells) {
    const nx = p.current.x + c.x
    const ny = p.current.y + c.y
    if (nx >= 0 && nx < COLS && ny >= 0 && ny * COLS + nx < grid.length) {
      grid[ny * COLS + nx] = shape.color
    }
  }
  return grid
}
