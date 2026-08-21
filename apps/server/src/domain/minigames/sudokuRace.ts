import type { SudokuInput, SudokuSnapshot } from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const SIZE = 4
const BOX = 2
const CELLS = SIZE * SIZE
const BLANKS = 8
const DEFAULT_DURATION_MS = 75_000

// A validated 4x4 sudoku solution (rows, cols, and 2x2 boxes each hold 1..4 exactly once).
const BASE_SOLUTION: readonly number[] = [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1]

// Fisher–Yates using the seeded Random port so the order is reproducible per round.
function shuffle<T>(items: readonly T[], random: Random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Builds a fresh valid solved grid by relabeling digits and permuting rows/cols within their
// bands/stacks (standard validity-preserving sudoku transforms) — no backtracking solver needed.
function buildSolution(random: Random): number[] {
  const digitMap = shuffle([1, 2, 3, 4], random)
  const grid: number[][] = []
  for (let r = 0; r < SIZE; r++) {
    const row: number[] = []
    for (let c = 0; c < SIZE; c++) {
      row.push(digitMap[(BASE_SOLUTION[r * SIZE + c] as number) - 1] as number)
    }
    grid.push(row)
  }
  const swapRows = (a: number, b: number) => {
    const tmp = grid[a] as number[]
    grid[a] = grid[b] as number[]
    grid[b] = tmp
  }
  const swapCols = (a: number, b: number) => {
    for (const row of grid) {
      const tmp = row[a] as number
      row[a] = row[b] as number
      row[b] = tmp
    }
  }
  for (let band = 0; band < SIZE; band += BOX) {
    if (random.next() < 0.5) swapRows(band, band + 1)
  }
  if (random.next() < 0.5) {
    swapRows(0, 2)
    swapRows(1, 3)
  }
  for (let stack = 0; stack < SIZE; stack += BOX) {
    if (random.next() < 0.5) swapCols(stack, stack + 1)
  }
  if (random.next() < 0.5) {
    swapCols(0, 2)
    swapCols(1, 3)
  }
  if (random.next() < 0.5) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = r + 1; c < SIZE; c++) {
        const rowR = grid[r] as number[]
        const rowC = grid[c] as number[]
        const tmp = rowR[c] as number
        rowR[c] = rowC[r] as number
        rowC[r] = tmp
      }
    }
  }
  return grid.flat()
}

export interface SudokuRaceState {
  players: PlayerId[]
  solution: number[]
  // true = a given (pre-filled, locked) cell.
  givenMask: boolean[]
  blanksCount: number
  startedAt: number
  endsAt: number
  grids: Map<PlayerId, number[]>
  correctCount: Map<PlayerId, number>
  // 0 = not finished; otherwise the server time the player filled every cell correctly.
  doneAt: Map<PlayerId, number>
}

// Self-paced FFA puzzle race. One seeded 4x4 sudoku is shared by everyone; each player fills their own
// copy of the blanks. Pure domain logic: the puzzle is drawn from the injected Random port and time
// arrives as `now`. The solution is never exposed on the wire — only fills + a correctness count.
export class SudokuRace implements MiniGame<SudokuRaceState, SudokuInput> {
  readonly id = 'sudoku-race'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): SudokuRaceState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const r = ctx.random
    const solution = buildSolution(r)
    const blankIndices = new Set(shuffle([...Array(CELLS).keys()], r).slice(0, BLANKS))
    const givenMask = Array.from({ length: CELLS }, (_, i) => !blankIndices.has(i))
    const startGrid = solution.map((v, i) => (givenMask[i] ? v : 0))
    return {
      players: [...ctx.players],
      solution,
      givenMask,
      blanksCount: blankIndices.size,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      grids: new Map(ctx.players.map((pid) => [pid, [...startGrid]])),
      correctCount: new Map(ctx.players.map((pid) => [pid, 0])),
      doneAt: new Map(ctx.players.map((pid) => [pid, 0])),
    }
  }

  onInput(
    state: SudokuRaceState,
    playerId: PlayerId,
    input: SudokuInput,
    now: number,
  ): SudokuRaceState {
    if (input.kind !== 'fill') return state
    const { index, value } = input
    if (!Number.isInteger(index) || index < 0 || index >= CELLS) return state
    if (!Number.isInteger(value) || value < 0 || value > SIZE) return state
    if (state.givenMask[index]) return state
    const doneAt = state.doneAt.get(playerId)
    if (doneAt === undefined || doneAt > 0) return state
    if (now >= state.endsAt) return state
    const grid = state.grids.get(playerId)
    if (!grid) return state
    grid[index] = value
    let correct = 0
    for (let i = 0; i < CELLS; i++) {
      if (!state.givenMask[i] && grid[i] === state.solution[i]) correct++
    }
    state.correctCount.set(playerId, correct)
    if (correct === state.blanksCount) state.doneAt.set(playerId, now)
    return state
  }

  tick(state: SudokuRaceState, _dt: number, _now: number): SudokuRaceState {
    return state
  }

  isFinished(state: SudokuRaceState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((pid) => (state.doneAt.get(pid) ?? 0) > 0)
  }

  private cmp(state: SudokuRaceState, a: PlayerId, b: PlayerId): number {
    const da = state.doneAt.get(a) ?? 0
    const db = state.doneAt.get(b) ?? 0
    const aDone = da > 0
    const bDone = db > 0
    if (aDone !== bDone) return aDone ? -1 : 1
    if (aDone && bDone) return da - db
    return (state.correctCount.get(b) ?? 0) - (state.correctCount.get(a) ?? 0)
  }

  getResult(state: SudokuRaceState): NormalizedResult {
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
      stats[id] = done ? 'solved' : `${state.correctCount.get(id) ?? 0}/${state.blanksCount}`
    }
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: SudokuRaceState, now: number): SudokuSnapshot {
    const given = state.solution.map((v, i) => (state.givenMask[i] ? v : 0))
    const boards: Record<string, SudokuSnapshot['boards'][string]> = {}
    for (const pid of state.players) {
      boards[pid] = {
        grid: [...(state.grids.get(pid) ?? [])],
        correctCount: state.correctCount.get(pid) ?? 0,
        done: (state.doneAt.get(pid) ?? 0) > 0,
      }
    }
    return {
      size: SIZE,
      given,
      blanksCount: state.blanksCount,
      boards,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
