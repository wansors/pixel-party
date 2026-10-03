import type { MazeSprintInput, MazeSprintSnapshot } from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const SIZE = 9
const CELLS = SIZE * SIZE
const EXIT_INDEX = CELLS - 1
const DEFAULT_DURATION_MS = 45_000
// Steps faster than this apart are dropped: a held key walks at the same pace on every machine, whatever
// its OS key-repeat rate (the client paces itself a little slower, so it never loses a step).
export const MIN_STEP_MS = 90

// Wall bit per side; a cell's mask records which of its 4 sides are still walled.
const NORTH = 1
const EAST = 2
const SOUTH = 4
const WEST = 8

const DIR_BIT: Record<MazeSprintInput['dir'], number> = {
  up: NORTH,
  right: EAST,
  down: SOUTH,
  left: WEST,
}

// Iterative randomized depth-first "carve a perfect maze": every cell starts fully walled, then we walk
// an explicit stack (no recursion) knocking down the wall into a random unvisited neighbor, backtracking
// by popping once a cell has none left. Terminates because the stack only grows on a fresh visit (at
// most CELLS pushes) and every push is eventually popped — no rejection sampling, so no random draw can
// spin forever. Guarantees full connectivity: exactly one path between any two cells.
function buildMaze(random: Random): number[] {
  const walls = new Array<number>(CELLS).fill(NORTH | EAST | SOUTH | WEST)
  const visited = new Array<boolean>(CELLS).fill(false)
  const stack: number[] = [0]
  visited[0] = true
  while (stack.length > 0) {
    const current = stack[stack.length - 1] as number
    const row = Math.floor(current / SIZE)
    const col = current % SIZE
    const neighbors: { dir: number; opposite: number; cell: number }[] = []
    if (row > 0 && !visited[current - SIZE]) {
      neighbors.push({ dir: NORTH, opposite: SOUTH, cell: current - SIZE })
    }
    if (col < SIZE - 1 && !visited[current + 1]) {
      neighbors.push({ dir: EAST, opposite: WEST, cell: current + 1 })
    }
    if (row < SIZE - 1 && !visited[current + SIZE]) {
      neighbors.push({ dir: SOUTH, opposite: NORTH, cell: current + SIZE })
    }
    if (col > 0 && !visited[current - 1]) {
      neighbors.push({ dir: WEST, opposite: EAST, cell: current - 1 })
    }
    if (neighbors.length === 0) {
      stack.pop()
      continue
    }
    const pick = neighbors[
      Math.floor(random.next() * neighbors.length)
    ] as (typeof neighbors)[number]
    walls[current] = (walls[current] as number) & ~pick.dir
    walls[pick.cell] = (walls[pick.cell] as number) & ~pick.opposite
    visited[pick.cell] = true
    stack.push(pick.cell)
  }
  return walls
}

// Shortest number of steps from every cell to `to` over the shared maze, respecting the same wall-bit
// adjacency the movement logic uses. Every cell is reachable — the maze is a perfect maze.
function distancesTo(walls: number[], to: number): number[] {
  const dist = new Array<number>(CELLS).fill(-1)
  dist[to] = 0
  const queue: number[] = [to]
  let head = 0
  while (head < queue.length) {
    const cur = queue[head++] as number
    const row = Math.floor(cur / SIZE)
    const col = cur % SIZE
    const mask = walls[cur] as number
    const next: number[] = []
    if (!(mask & NORTH) && row > 0) next.push(cur - SIZE)
    if (!(mask & EAST) && col < SIZE - 1) next.push(cur + 1)
    if (!(mask & SOUTH) && row < SIZE - 1) next.push(cur + SIZE)
    if (!(mask & WEST) && col > 0) next.push(cur - 1)
    for (const n of next) {
      if (dist[n] === -1) {
        dist[n] = (dist[cur] as number) + 1
        queue.push(n)
      }
    }
  }
  return dist
}

export interface MazeSprintState {
  players: PlayerId[]
  size: number
  walls: number[]
  exitIndex: number
  // Steps from each cell to the exit.
  exitDist: number[]
  startedAt: number
  endsAt: number
  pos: Map<PlayerId, number>
  steps: Map<PlayerId, number>
  lastStepAt: Map<PlayerId, number>
  // 0 = not finished; otherwise the server time the player reached the exit.
  doneAt: Map<PlayerId, number>
  // Players gone mid-round: the race doesn't wait for them to finish.
  left: Set<PlayerId>
}

// Self-paced FFA race. One seeded 9x9 maze is shared by everyone; each player moves their own position
// through it independently, from the entrance (cell 0) to the exit (last cell), at most one step per
// MIN_STEP_MS. Rivals are shown as their distance to the exit, not their spot (that would give the path
// away). Pure domain logic: the maze is drawn from the injected Random port and time arrives as `now`.
export class MazeSprint implements MiniGame<MazeSprintState, MazeSprintInput> {
  readonly id = 'maze-sprint'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): MazeSprintState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const walls = buildMaze(ctx.random)
    return {
      players: [...ctx.players],
      size: SIZE,
      walls,
      exitIndex: EXIT_INDEX,
      exitDist: distancesTo(walls, EXIT_INDEX),
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      pos: new Map(ctx.players.map((pid) => [pid, 0])),
      steps: new Map(ctx.players.map((pid) => [pid, 0])),
      lastStepAt: new Map(),
      doneAt: new Map(ctx.players.map((pid) => [pid, 0])),
      left: new Set(),
    }
  }

  onInput(
    state: MazeSprintState,
    playerId: PlayerId,
    input: MazeSprintInput,
    now: number,
  ): MazeSprintState {
    if (input.kind !== 'move') return state
    const bit = DIR_BIT[input.dir]
    if (bit === undefined) return state
    if (now < state.startedAt || now >= state.endsAt) return state
    const doneAt = state.doneAt.get(playerId)
    if (doneAt === undefined || doneAt > 0) return state
    const pos = state.pos.get(playerId)
    if (pos === undefined) return state
    if (now - (state.lastStepAt.get(playerId) ?? Number.NEGATIVE_INFINITY) < MIN_STEP_MS)
      return state
    const mask = state.walls[pos] as number
    if (mask & bit) return state // wall blocks this move
    const row = Math.floor(pos / state.size)
    const col = pos % state.size
    let nextRow = row
    let nextCol = col
    if (input.dir === 'up') nextRow -= 1
    else if (input.dir === 'down') nextRow += 1
    else if (input.dir === 'left') nextCol -= 1
    else nextCol += 1
    if (nextRow < 0 || nextRow >= state.size || nextCol < 0 || nextCol >= state.size) return state
    const next = nextRow * state.size + nextCol
    state.pos.set(playerId, next)
    state.steps.set(playerId, (state.steps.get(playerId) ?? 0) + 1)
    state.lastStepAt.set(playerId, now)
    if (next === state.exitIndex) state.doneAt.set(playerId, now)
    return state
  }

  tick(state: MazeSprintState, _dt: number, _now: number): MazeSprintState {
    return state
  }

  leave(state: MazeSprintState, playerId: PlayerId, _now: number): MazeSprintState {
    state.left.add(playerId)
    return state
  }

  isFinished(state: MazeSprintState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((pid) => (state.doneAt.get(pid) ?? 0) > 0 || state.left.has(pid))
  }

  private distOf(state: MazeSprintState, pid: PlayerId): number {
    return state.exitDist[state.pos.get(pid) ?? 0] ?? 0
  }

  private cmp(state: MazeSprintState, a: PlayerId, b: PlayerId): number {
    const da = state.doneAt.get(a) ?? 0
    const db = state.doneAt.get(b) ?? 0
    const aDone = da > 0
    const bDone = db > 0
    if (aDone !== bDone) return aDone ? -1 : 1
    if (aDone && bDone) return da - db
    return this.distOf(state, a) - this.distOf(state, b)
  }

  getResult(state: MazeSprintState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => this.cmp(state, a, b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.cmp(state, sorted[idx - 1] as PlayerId, id) !== 0) rank = idx
      ranks[id] = rank
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) {
      const steps = state.steps.get(id) ?? 0
      const doneAt = state.doneAt.get(id) ?? 0
      stats[id] =
        doneAt > 0
          ? `${steps} steps · ${((doneAt - state.startedAt) / 1000).toFixed(1)}s`
          : `${steps} steps`
    }
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: MazeSprintState, now: number): MazeSprintSnapshot {
    return {
      size: state.size,
      walls: [...state.walls],
      exitIndex: state.exitIndex,
      pos: Object.fromEntries(state.pos),
      dist: Object.fromEntries(state.players.map((pid) => [pid, this.distOf(state, pid)])),
      startDist: state.exitDist[0] ?? 0,
      progress: Object.fromEntries(state.steps),
      doneAt: Object.fromEntries(state.doneAt),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
