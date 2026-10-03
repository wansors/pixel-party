import type { Cell, SnakeInput, SnakeSnapshot, SnakeView } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const GRID = 15
const DEFAULT_DURATION_MS = 45_000
const STEP_MS = 160
const START_LEN = 3
// Turns buffered ahead of the next step: two quick taps inside one step (a U-turn) both apply.
const TURN_QUEUE = 2

type Dir = 'up' | 'down' | 'left' | 'right'

const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }
const DELTA: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

interface SnakeState {
  body: Cell[]
  dir: Dir
  // Turns waiting for the next steps, oldest first.
  turns: Dir[]
  alive: boolean
  foodIdx: number
  len: number
  // The step on which the snake reached its current length (ties go to whoever got there first).
  lenAt: number
}

export interface SnakeArenaState {
  players: PlayerId[]
  snakes: Map<PlayerId, SnakeState>
  foods: Cell[]
  startedAt: number
  endsAt: number
  stepsTaken: number
  stepMs: number
}

// Real-time FFA grid snake. Every player has their own independent board (same size) and the same seeded
// food sequence; a wrong turn or a crash only affects that player. Movement is time-driven: a shared
// step counter advances each alive snake once per STEP_MS elapsed since start, so the simulation is
// deterministic and reconnect-safe (the food stream comes from the injected Random port; time is `now`).
export class SnakeArena implements MiniGame<SnakeArenaState, SnakeInput> {
  readonly id = 'snake-arena'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): SnakeArenaState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const r = ctx.random
    const foods: Cell[] = Array.from({ length: GRID * GRID }, () => ({
      x: Math.floor(r.next() * GRID),
      y: Math.floor(r.next() * GRID),
    }))
    const mid = Math.floor(GRID / 2)
    const snakes = new Map<PlayerId, SnakeState>(
      ctx.players.map((id) => {
        const body: Cell[] = Array.from({ length: START_LEN }, (_, i) => ({ x: mid - i, y: mid }))
        return [
          id,
          { body, dir: 'right', turns: [], alive: true, foodIdx: 0, len: body.length, lenAt: 0 },
        ]
      }),
    )
    return {
      players: [...ctx.players],
      snakes,
      foods,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      stepsTaken: 0,
      stepMs: STEP_MS,
    }
  }

  private onBody(body: Cell[], c: Cell): boolean {
    return body.some((b) => b.x === c.x && b.y === c.y)
  }

  // The snake's current food: the first candidate from foodIdx onward not covered by its body.
  // Advances foodIdx past leading occupied candidates lazily (candidates wrap so it never runs out).
  private currentFood(state: SnakeArenaState, snake: SnakeState): Cell {
    const n = state.foods.length
    for (let scanned = 0; scanned < n; scanned++) {
      const cell = state.foods[snake.foodIdx % n] as Cell
      if (!this.onBody(snake.body, cell)) return cell
      snake.foodIdx++
    }
    return state.foods[snake.foodIdx % n] as Cell
  }

  private step(state: SnakeArenaState, snake: SnakeState): void {
    if (!snake.alive) return
    snake.dir = snake.turns.shift() ?? snake.dir
    const head = snake.body[0] as Cell
    const d = DELTA[snake.dir]
    const next: Cell = { x: head.x + d.x, y: head.y + d.y }
    if (next.x < 0 || next.x >= GRID || next.y < 0 || next.y >= GRID) {
      snake.alive = false
      return
    }
    if (this.onBody(snake.body, next)) {
      snake.alive = false
      return
    }
    const food = this.currentFood(state, snake)
    snake.body.unshift(next)
    if (next.x === food.x && next.y === food.y) {
      snake.foodIdx++
      snake.lenAt = state.stepsTaken + 1
    } else {
      snake.body.pop()
    }
    snake.len = snake.body.length
  }

  onInput(
    state: SnakeArenaState,
    playerId: PlayerId,
    input: SnakeInput,
    _now: number,
  ): SnakeArenaState {
    if (input.kind !== 'turn') return state
    const snake = state.snakes.get(playerId)
    if (!snake || !snake.alive || !Object.hasOwn(DELTA, input.dir)) return state
    // Judged against the heading the snake will have by then: no reversal into its own neck, and a
    // repeat of that heading is a no-op rather than a wasted slot.
    const heading = snake.turns.at(-1) ?? snake.dir
    if (input.dir === heading || input.dir === OPPOSITE[heading]) return state
    if (snake.turns.length < TURN_QUEUE) snake.turns.push(input.dir)
    return state
  }

  tick(state: SnakeArenaState, _dt: number, now: number): SnakeArenaState {
    const due = Math.floor((now - state.startedAt) / state.stepMs)
    while (state.stepsTaken < due) {
      for (const snake of state.snakes.values()) this.step(state, snake)
      state.stepsTaken++
    }
    return state
  }

  // A player who left is out right away: the all-crashed early end doesn't wait for their snake.
  leave(state: SnakeArenaState, playerId: PlayerId, _now: number): SnakeArenaState {
    const snake = state.snakes.get(playerId)
    if (snake) snake.alive = false
    return state
  }

  isFinished(state: SnakeArenaState, now: number): boolean {
    if (now >= state.endsAt) return true
    for (const snake of state.snakes.values()) if (snake.alive) return false
    return true
  }

  // Longest snake; equal lengths go to whoever reached it first, then to a snake still alive.
  private cmp(state: SnakeArenaState, a: PlayerId, b: PlayerId): number {
    const sa = state.snakes.get(a)
    const sb = state.snakes.get(b)
    return (
      (sb?.len ?? 0) - (sa?.len ?? 0) ||
      (sa?.lenAt ?? 0) - (sb?.lenAt ?? 0) ||
      Number(sb?.alive ?? false) - Number(sa?.alive ?? false)
    )
  }

  getResult(state: SnakeArenaState): NormalizedResult {
    const lenOf = (id: PlayerId): number => state.snakes.get(id)?.len ?? 0
    const sorted = [...state.players].sort((a, b) => this.cmp(state, a, b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.cmp(state, sorted[idx - 1] as PlayerId, id) !== 0) rank = idx
      ranks[id] = rank
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `${lenOf(id)} long`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: SnakeArenaState, now: number): SnakeSnapshot {
    const snakes: Record<PlayerId, SnakeView> = {}
    const food: Record<PlayerId, Cell> = {}
    for (const id of state.players) {
      const snake = state.snakes.get(id) as SnakeState
      snakes[id] = {
        body: snake.body.map((c) => ({ x: c.x, y: c.y })),
        alive: snake.alive,
        len: snake.len,
      }
      const f = this.currentFood(state, snake)
      food[id] = { x: f.x, y: f.y }
    }
    return { snakes, food, grid: GRID, remainingMs: Math.max(0, state.endsAt - now) }
  }
}
