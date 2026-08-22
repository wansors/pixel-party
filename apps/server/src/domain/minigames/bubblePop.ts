import type { BubblePopInput, BubblePopSnapshot } from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const ROWS = 8
const COLS = 7
const CELLS = ROWS * COLS
const COLORS = 4
const QUEUE_LENGTH = 100
const DEFAULT_DURATION_MS = 60_000

const at = (row: number, col: number) => row * COLS + col

function randomColor(random: Random): number {
  return Math.floor(random.next() * COLORS) + 1
}

// Rows 0..3 (the top half, row 0 = ceiling) start filled with random colors; rows 4..7 stay empty.
function buildStartBoard(random: Random): number[] {
  const board = new Array<number>(CELLS).fill(0)
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < COLS; col++) {
      board[at(row, col)] = randomColor(random)
    }
  }
  return board
}

function buildShotQueue(random: Random): number[] {
  return Array.from({ length: QUEUE_LENGTH }, () => randomColor(random))
}

// 4-directional flood fill from `start` over cells matching `matches`. Returns visited indices.
function floodFill(
  board: number[],
  start: number,
  matches: (index: number) => boolean,
): Set<number> {
  const visited = new Set<number>([start])
  const stack = [start]
  while (stack.length > 0) {
    const index = stack.pop() as number
    const row = Math.floor(index / COLS)
    const col = index % COLS
    const neighbors: number[] = []
    if (row > 0) neighbors.push(at(row - 1, col))
    if (row < ROWS - 1) neighbors.push(at(row + 1, col))
    if (col > 0) neighbors.push(at(row, col - 1))
    if (col < COLS - 1) neighbors.push(at(row, col + 1))
    for (const n of neighbors) {
      if (visited.has(n)) continue
      if (!matches(n)) continue
      visited.add(n)
      stack.push(n)
    }
  }
  return visited
}

// Walks the shared shot queue from `fromIndex` to the next color that's still present on `board` — a
// shot in a color the player has already fully cleared could never be popped, softlocking their board.
// Falls back to the raw slot if the board holds none of the queue's colors (i.e. it's already empty).
function nextValidShot(
  board: number[],
  queue: number[],
  fromIndex: number,
): { index: number; color: number } {
  const present = new Set(board.filter((c) => c !== 0))
  for (let steps = 0; steps < queue.length; steps++) {
    const index = fromIndex + steps
    const color = queue[index % queue.length] as number
    if (present.has(color)) return { index, color }
  }
  return { index: fromIndex, color: queue[fromIndex % queue.length] as number }
}

// Finds the landing row for a shot in `col`: the topmost empty cell whose slot below is either the
// ceiling (row 0) or already backed by a filled cell above it. Returns -1 if the column is full.
function landingRow(board: number[], col: number): number {
  for (let row = ROWS - 1; row >= 0; row--) {
    const index = at(row, col)
    if (board[index] !== 0) continue
    if (row === 0 || board[at(row - 1, col)] !== 0) return row
  }
  return -1
}

// Pops the connected same-color group at `placed` (size >= 3), then removes any bubble left floating
// (not connected via any-color adjacency back up to row 0). Mutates `board` in place; returns the total
// number of cells removed (pop + floating cleanup) for scoring.
function resolvePlacement(board: number[], placed: number): number {
  const color = board[placed]
  if (!color) return 0
  const group = floodFill(board, placed, (i) => board[i] === color)
  let removed = 0
  if (group.size >= 3) {
    for (const i of group) board[i] = 0
    removed += group.size
  }
  const attached = new Set<number>()
  for (let col = 0; col < COLS; col++) {
    const top = at(0, col)
    if (board[top] !== 0 && !attached.has(top)) {
      for (const i of floodFill(board, top, (n) => board[n] !== 0)) attached.add(i)
    }
  }
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== 0 && !attached.has(i)) {
      board[i] = 0
      removed++
    }
  }
  return removed
}

export interface BubblePopState {
  players: PlayerId[]
  shotQueue: number[]
  startedAt: number
  endsAt: number
  boards: Map<PlayerId, number[]>
  shotIndex: Map<PlayerId, number>
  score: Map<PlayerId, number>
  // 0 = not finished; otherwise the server time the player fully cleared their board.
  doneAt: Map<PlayerId, number>
}

// Self-paced FFA puzzle race, structurally like Sudoku Race: one seeded starting cluster and shot queue
// shared by everyone, each player mutates their own copy. A simplified rectangular grid + "choose a
// column" aim stand in for a true hex-grid bubble-shooter, but the pop/clear rules are the real thing.
export class BubblePop implements MiniGame<BubblePopState, BubblePopInput> {
  readonly id = 'bubble-pop'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): BubblePopState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const r = ctx.random
    const startBoard = buildStartBoard(r)
    const shotQueue = buildShotQueue(r)
    return {
      players: [...ctx.players],
      shotQueue,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      boards: new Map(ctx.players.map((pid) => [pid, [...startBoard]])),
      shotIndex: new Map(ctx.players.map((pid) => [pid, 0])),
      score: new Map(ctx.players.map((pid) => [pid, 0])),
      doneAt: new Map(ctx.players.map((pid) => [pid, 0])),
    }
  }

  onInput(
    state: BubblePopState,
    playerId: PlayerId,
    input: BubblePopInput,
    now: number,
  ): BubblePopState {
    if (input.kind !== 'shoot') return state
    const { col } = input
    if (!Number.isInteger(col) || col < 0 || col >= COLS) return state
    const doneAt = state.doneAt.get(playerId)
    if (doneAt === undefined || doneAt > 0) return state
    if (now >= state.endsAt) return state
    const board = state.boards.get(playerId)
    const shotIndex = state.shotIndex.get(playerId)
    if (!board || shotIndex === undefined) return state
    const { index, color } = nextValidShot(board, state.shotQueue, shotIndex)
    state.shotIndex.set(playerId, index + 1)
    const row = landingRow(board, col)
    if (row === -1) return state
    const placed = at(row, col)
    board[placed] = color
    const removed = resolvePlacement(board, placed)
    if (removed > 0) {
      state.score.set(playerId, (state.score.get(playerId) ?? 0) + removed)
    }
    if (board.every((c) => c === 0)) state.doneAt.set(playerId, now)
    return state
  }

  tick(state: BubblePopState, _dt: number, _now: number): BubblePopState {
    return state
  }

  isFinished(state: BubblePopState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((pid) => (state.doneAt.get(pid) ?? 0) > 0)
  }

  private cmp(state: BubblePopState, a: PlayerId, b: PlayerId): number {
    const da = state.doneAt.get(a) ?? 0
    const db = state.doneAt.get(b) ?? 0
    const aDone = da > 0
    const bDone = db > 0
    if (aDone !== bDone) return aDone ? -1 : 1
    if (aDone && bDone) return da - db
    return (state.score.get(b) ?? 0) - (state.score.get(a) ?? 0)
  }

  getResult(state: BubblePopState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => this.cmp(state, a, b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.cmp(state, sorted[idx - 1] as PlayerId, id) !== 0) rank = idx
      ranks[id] = rank
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) {
      const done = (state.doneAt.get(id) ?? 0) > 0
      stats[id] = done ? 'cleared!' : `${state.score.get(id) ?? 0} pts`
    }
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: BubblePopState, now: number): BubblePopSnapshot {
    const boards: Record<string, BubblePopSnapshot['boards'][string]> = {}
    const scores: Record<string, number> = {}
    for (const pid of state.players) {
      const shotIndex = state.shotIndex.get(pid) ?? 0
      const score = state.score.get(pid) ?? 0
      const board = state.boards.get(pid) ?? []
      boards[pid] = {
        grid: [...board],
        score,
        nextColor: nextValidShot(board, state.shotQueue, shotIndex).color,
        done: (state.doneAt.get(pid) ?? 0) > 0,
      }
      scores[pid] = score
    }
    return {
      rows: ROWS,
      cols: COLS,
      boards,
      scores,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
