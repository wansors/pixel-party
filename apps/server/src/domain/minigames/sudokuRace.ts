import type { SudokuInput, SudokuSnapshot } from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const SIZE = 4
const BOX = 2
const CELLS = SIZE * SIZE
const BLANKS = 8
const DEFAULT_DURATION_MS = 75_000
// Entering a wrong digit locks that player's fill inputs for this long. Without it a tap-until-it-locks
// brute force beats actually solving the puzzle (a correct cell freezes, so every guess is free).
export const WRONG_DIGIT_COOLDOWN_MS = 2000

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

// A random validity-preserving sudoku symmetry: digits relabelled, rows shuffled within their bands
// and the bands swapped, the same for columns and stacks, and an optional transpose. `cells[i]` is the
// source cell that lands on cell i, so one symmetry maps a solution and its givens mask alike.
interface Symmetry {
  digits: number[]
  cells: number[]
}

// Row (or column) order: the pair inside each band swapped on a coin flip, then the bands swapped.
function lineOrder(random: Random): number[] {
  const order = [...Array(SIZE).keys()]
  for (let band = 0; band < SIZE; band += BOX) {
    if (random.next() < 0.5) order.splice(band, BOX, ...order.slice(band, band + BOX).reverse())
  }
  return random.next() < 0.5 ? [...order.slice(BOX), ...order.slice(0, BOX)] : order
}

function randomSymmetry(random: Random): Symmetry {
  const digits = shuffle([1, 2, 3, 4], random)
  const rows = lineOrder(random)
  const cols = lineOrder(random)
  const transpose = random.next() < 0.5
  const cells = Array.from({ length: CELLS }, (_, i) => {
    const r = Math.floor(i / SIZE)
    const c = i % SIZE
    const [sr, sc] = transpose ? [c, r] : [r, c]
    return (rows[sr] as number) * SIZE + (cols[sc] as number)
  })
  return { digits, cells }
}

const mapSolution = (sym: Symmetry, grid: readonly number[]): number[] =>
  sym.cells.map((src) => sym.digits[(grid[src] as number) - 1] as number)
const mapMask = (sym: Symmetry, mask: readonly boolean[]): boolean[] =>
  sym.cells.map((src) => mask[src] as boolean)

// How many ways `grid` (0 = blank) can be completed, counting no further than `limit`.
function countSolutions(grid: number[], limit: number): number {
  const i = grid.indexOf(0)
  if (i < 0) return 1
  const r = Math.floor(i / SIZE)
  const c = i % SIZE
  const br = r - (r % BOX)
  const bc = c - (c % BOX)
  let count = 0
  for (let d = 1; d <= SIZE && count < limit; d++) {
    let fits = true
    for (let k = 0; k < SIZE && fits; k++) {
      const box = (br + Math.floor(k / BOX)) * SIZE + bc + (k % BOX)
      fits = grid[r * SIZE + k] !== d && grid[k * SIZE + c] !== d && grid[box] !== d
    }
    if (!fits) continue
    grid[i] = d
    count += countSolutions(grid, limit - count)
    grid[i] = 0
  }
  return count
}

// Blanks up to BLANKS cells of `solution` in a seeded order, skipping any whose removal would let the
// puzzle be completed in more than one way. The solution stays the only completion, so the only digit
// that fits a blank is the solution's and the server never marks a valid digit wrong. Returns the
// givens mask (true = a given).
function uniqueGivens(solution: readonly number[], random: Random): boolean[] {
  const grid = [...solution]
  let blanks = 0
  for (const i of shuffle([...Array(CELLS).keys()], random)) {
    if (blanks === BLANKS) break
    grid[i] = 0
    if (countSolutions(grid, 2) === 1) blanks++
    else grid[i] = solution[i] as number
  }
  return grid.map((v) => v !== 0)
}

interface Puzzle {
  solution: number[]
  // true = a given (pre-filled, locked) cell.
  givenMask: boolean[]
}

export interface SudokuRaceState {
  players: PlayerId[]
  // playerId -> that player's copy of the round's puzzle, under their own seeded symmetry.
  puzzles: Map<PlayerId, Puzzle>
  blanksCount: number
  startedAt: number
  endsAt: number
  grids: Map<PlayerId, number[]>
  correctCount: Map<PlayerId, number>
  // 0 = not finished; otherwise the server time the player filled every cell correctly.
  doneAt: Map<PlayerId, number>
  // playerId -> server time until which that player's fill inputs are ignored (wrong-digit penalty).
  cooldownUntil: Map<PlayerId, number>
  // Players who left mid-round: no longer waited for.
  left: Set<PlayerId>
}

// Self-paced FFA puzzle race. One seeded 4x4 sudoku with a unique solution is raced by everyone, each
// player on their own copy under a seeded symmetry (relabelled digits, shuffled rows/columns): the same
// logic, so equally hard, but a neighbour's screen — or a rival's board on the room-wide snapshot — is
// no use for yours. Pure domain logic: the puzzle is drawn from the injected Random port and time
// arrives as `now`. The solution is never exposed on the wire — only fills + a correctness count.
export class SudokuRace implements MiniGame<SudokuRaceState, SudokuInput> {
  readonly id = 'sudoku-race'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): SudokuRaceState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const r = ctx.random
    const solution = mapSolution(randomSymmetry(r), BASE_SOLUTION)
    const givenMask = uniqueGivens(solution, r)
    const puzzles = new Map<PlayerId, Puzzle>(
      ctx.players.map((pid) => {
        const sym = randomSymmetry(r)
        return [pid, { solution: mapSolution(sym, solution), givenMask: mapMask(sym, givenMask) }]
      }),
    )
    return {
      players: [...ctx.players],
      puzzles,
      blanksCount: givenMask.filter((given) => !given).length,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      grids: new Map(
        [...puzzles].map(([pid, p]) => [pid, p.solution.map((v, i) => (p.givenMask[i] ? v : 0))]),
      ),
      correctCount: new Map(ctx.players.map((pid) => [pid, 0])),
      doneAt: new Map(ctx.players.map((pid) => [pid, 0])),
      cooldownUntil: new Map(ctx.players.map((pid) => [pid, 0])),
      left: new Set(),
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
    const puzzle = state.puzzles.get(playerId)
    const grid = state.grids.get(playerId)
    if (!puzzle || !grid || puzzle.givenMask[index]) return state
    const { solution, givenMask } = puzzle
    const doneAt = state.doneAt.get(playerId)
    if (doneAt === undefined || doneAt > 0 || state.left.has(playerId)) return state
    if (now >= state.endsAt) return state
    // Serving a wrong-digit penalty: every fill (clears included) is ignored until it runs out.
    if (now < (state.cooldownUntil.get(playerId) ?? 0)) return state
    // A cell already filled correctly is locked — editing it further could only make it wrong again.
    if (grid[index] === solution[index]) return state
    grid[index] = value
    // The wrong digit stays on the board (so the player sees what they entered) but costs a cooldown.
    // The puzzle has a single solution, so a digit that isn't the solution's can't be part of any.
    if (value !== 0 && value !== solution[index]) {
      state.cooldownUntil.set(playerId, now + WRONG_DIGIT_COOLDOWN_MS)
    }
    let correct = 0
    for (let i = 0; i < CELLS; i++) {
      if (!givenMask[i] && grid[i] === solution[i]) correct++
    }
    state.correctCount.set(playerId, correct)
    if (correct === state.blanksCount) state.doneAt.set(playerId, now)
    return state
  }

  tick(state: SudokuRaceState, _dt: number, _now: number): SudokuRaceState {
    return state
  }

  // A player who left isn't waited for: the round can end once everyone else has solved theirs.
  leave(state: SudokuRaceState, playerId: PlayerId, _now: number): SudokuRaceState {
    state.left.add(playerId)
    return state
  }

  isFinished(state: SudokuRaceState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((pid) => (state.doneAt.get(pid) ?? 0) > 0 || state.left.has(pid))
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
    const boards: Record<string, SudokuSnapshot['boards'][string]> = {}
    for (const pid of state.players) {
      const grid = state.grids.get(pid) ?? []
      const { solution, givenMask } = state.puzzles.get(pid) as Puzzle
      boards[pid] = {
        given: solution.map((v, i) => (givenMask[i] ? v : 0)),
        grid: [...grid],
        correctCount: state.correctCount.get(pid) ?? 0,
        lockedMask: grid.map((v, i) => !givenMask[i] && v === solution[i]),
        done: (state.doneAt.get(pid) ?? 0) > 0,
        cooldownMs: Math.max(0, (state.cooldownUntil.get(pid) ?? 0) - now),
      }
    }
    return {
      size: SIZE,
      blanksCount: state.blanksCount,
      boards,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
