// Bubble Pop wire shapes and the shot rules shared by the server and the client's prediction. Everyone
// starts from the same seeded top-half cluster and shot queue; each player has their own copy of the
// board and their own pointer into the shared queue. A shot sticks under the lowest bubble in its
// column; 3+ touching bubbles of its colour pop, and anything left hanging drops. A column filled to the
// bottom row takes no more shots, and a board with every column filled to the bottom is jammed (out for
// the round). The client runs the same `bubbleShoot` on its own board, so a shot lands, pops and loads
// the next colour on the frame it hits — the snapshot confirms it.

export const BUBBLE = { rows: 8, cols: 7, colors: 4 } as const

// Walks the shared shot queue from `from` to the next colour still on `board`: a shot in a colour the
// player has already cleared could never pop, softlocking their board. Falls back to the raw slot if
// the board holds none of the queue's colours (i.e. it's already empty).
export function bubbleNextShot(
  board: readonly number[],
  colorAt: (i: number) => number,
  from: number,
  queueLength: number,
): { index: number; color: number } {
  const present = new Set(board.filter((c) => c !== 0))
  for (let steps = 0; steps < queueLength; steps++) {
    const color = colorAt(from + steps)
    if (present.has(color)) return { index: from + steps, color }
  }
  return { index: from, color: colorAt(from) }
}

// The landing row for a shot in `col`: under the lowest filled cell, or the ceiling in an empty column.
// -1 when the column's bottom cell is filled: nothing gets in.
export function bubbleLandingRow(board: readonly number[], col: number): number {
  const { rows, cols } = BUBBLE
  for (let row = rows - 1; row >= 0; row--) {
    if (board[row * cols + col] !== 0) return row === rows - 1 ? -1 : row + 1
  }
  return 0
}

// Every column blocked at the bottom: no shot can land anywhere.
export function bubbleJammed(board: readonly number[]): boolean {
  for (let col = 0; col < BUBBLE.cols; col++) if (bubbleLandingRow(board, col) !== -1) return false
  return true
}

// 4-directional flood fill from `start` over cells matching `matches`.
function floodFill(start: number, matches: (index: number) => boolean): Set<number> {
  const { rows, cols } = BUBBLE
  const visited = new Set<number>([start])
  const stack = [start]
  while (stack.length > 0) {
    const index = stack.pop() as number
    const row = Math.floor(index / cols)
    const col = index % cols
    const neighbors: number[] = []
    if (row > 0) neighbors.push(index - cols)
    if (row < rows - 1) neighbors.push(index + cols)
    if (col > 0) neighbors.push(index - 1)
    if (col < cols - 1) neighbors.push(index + 1)
    for (const n of neighbors) {
      if (visited.has(n) || !matches(n)) continue
      visited.add(n)
      stack.push(n)
    }
  }
  return visited
}

export interface BubbleShot {
  // Where the shot stuck (-1: the column was blocked, the shot is wasted).
  row: number
  placed: number
  // Cells that popped (the matched group) and that dropped (left hanging), before removal.
  popped: number[]
  dropped: number[]
}

// Fires `color` up column `col` on `board` (in place): it sticks, pops a 3+ group of its colour, then
// drops whatever no longer hangs from the ceiling.
export function bubbleShoot(board: number[], col: number, color: number): BubbleShot {
  const { cols } = BUBBLE
  const row = bubbleLandingRow(board, col)
  if (row === -1) return { row, placed: -1, popped: [], dropped: [] }
  const placed = row * cols + col
  board[placed] = color
  const group = floodFill(placed, (i) => board[i] === color)
  const popped = group.size >= 3 ? [...group] : []
  for (const i of popped) board[i] = 0
  const attached = new Set<number>()
  for (let c = 0; c < cols; c++) {
    if (board[c] !== 0 && !attached.has(c)) {
      for (const i of floodFill(c, (n) => board[n] !== 0)) attached.add(i)
    }
  }
  const dropped: number[] = []
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== 0 && !attached.has(i)) dropped.push(i)
  }
  for (const i of dropped) board[i] = 0
  return { row, placed, popped, dropped }
}

export interface BubblePopBoard {
  // rows*cols digits; 0 = empty, 1..4 = a color id.
  grid: string
  score: number
  // This player's pointer into the shared shot queue (the next shot is the first colour from here on
  // that is still on the board).
  shot: number
  // Shots the server has taken from this player (the client replays only later ones).
  shots: number
  // Cleared the whole board.
  done: boolean
  // Every column blocked at the bottom: no more shots this round.
  jammed: boolean
}

export interface BubblePopSnapshot {
  rows: number
  cols: number
  // The shared shot queue, one digit per colour id.
  queue: string
  // playerId -> that player's board.
  boards: Record<string, BubblePopBoard>
  // playerId -> score, mirrored from `boards` for generic live-scoreboard consumers.
  scores: Record<string, number>
  remainingMs: number
}

// Shoot the next queued color up column `col` on this player's own board.
export interface BubblePopInput {
  kind: 'shoot'
  col: number
}
