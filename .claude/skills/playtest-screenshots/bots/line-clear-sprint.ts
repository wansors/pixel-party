// Tetris sprint bot (Line Clear Sprint; Quick Tetris re-exports it): for every piece it tries each turn
// and column with the shared engine (needs PP_REPO), keeps the placement that clears most and leaves
// the flattest stack with the fewest holes, then sends the turns, the moves and a hard drop at once.
// Ten percent of its pieces it just drops where they spawn, so it tops out now and then.
type Board = { cells: string; piece: [number, number, number, number] | null; next: string }
type Snap = { boards: Record<string, Board> }
type State = {
  board: number[]
  current: { shape: number; x: number; y: number; rot: number } | null
}
type Shared = {
  TETRIS: { cols: number; rows: number }
  tetrisDecodeBoard: (b: Board) => { state: State; shapeAt: (i: number) => number | undefined }
  tetrisRotate: (s: State, dir: 1 | -1) => boolean
  tetrisMove: (s: State, dx: -1 | 1) => boolean
  tetrisHardDrop: (s: State, shapeAt: (i: number) => number | undefined) => unknown
}

const repo = process.env.PP_REPO
const shared: Shared | null = repo ? await import(`${repo}/packages/shared/src/index.ts`) : null
// The piece each bot last placed (its cells + position), so it plays each piece once, and how many
// calls (150 ms each) it still waits before the next one — a piece every ~0.9 s, a human pace.
const placed = new Map<string, string>()
const wait = new Map<string, number>()

function score(board: number[], cols: number, rows: number): number {
  let holes = 0
  let bumps = 0
  let height = 0
  let prev = -1
  for (let x = 0; x < cols; x++) {
    let top = rows
    for (let y = 0; y < rows; y++) {
      if (board[y * cols + x]) {
        top = y
        break
      }
    }
    for (let y = top + 1; y < rows; y++) if (!board[y * cols + x]) holes++
    const h = rows - top
    height = Math.max(height, h)
    if (prev >= 0) bumps += Math.abs(h - prev)
    prev = h
  }
  return -holes * 8 - bumps * 2 - height * 3
}

export default function play(s: Snap, me: string): unknown {
  const b = s.boards[me]
  if (!shared || !b?.piece) return null
  const key = `${b.cells}|${b.piece.join(',')}`
  if (placed.get(me) === key) return null
  const left = wait.get(me) ?? 5
  if (left > 0) {
    wait.set(me, left - 1)
    return null
  }
  wait.set(me, 5)
  placed.set(me, key)
  if ((b.cells.length + me.charCodeAt(me.length - 1)) % 10 === 0) return { kind: 'drop' }
  const { cols, rows } = shared.TETRIS
  let best: { turns: number; dx: number; value: number } | null = null
  for (let turns = 0; turns < 4; turns++) {
    for (let dx = -cols; dx <= cols; dx++) {
      const { state, shapeAt } = shared.tetrisDecodeBoard(b)
      for (let t = 0; t < turns; t++) shared.tetrisRotate(state, 1)
      let moved = 0
      const dir = dx < 0 ? -1 : 1
      while (moved < Math.abs(dx) && shared.tetrisMove(state, dir)) moved++
      if (moved !== Math.abs(dx)) continue
      const before = state.board.filter((c) => c).length
      shared.tetrisHardDrop(state, shapeAt)
      const cleared = (before + 4 - state.board.filter((c) => c).length) / cols
      const value = cleared * 30 + score(state.board, cols, rows)
      if (!best || value > best.value) best = { turns, dx, value }
    }
  }
  if (!best) return { kind: 'drop' }
  const inputs: unknown[] = []
  for (let t = 0; t < best.turns; t++) inputs.push({ kind: 'rotate' })
  for (let m = 0; m < Math.abs(best.dx); m++) {
    inputs.push({ kind: 'move', dir: best.dx < 0 ? 'left' : 'right' })
  }
  inputs.push({ kind: 'drop' })
  return inputs
}
