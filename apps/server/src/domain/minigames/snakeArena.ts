import {
  SNAKE,
  type SnakeDir,
  type SnakeInput,
  type SnakeSim,
  type SnakeSnapshot,
  type SnakeView,
  snakeCanTurn,
  snakeStep,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const GRID = SNAKE.grid
const DEFAULT_DURATION_MS = 45_000
const DIRS: readonly SnakeDir[] = ['up', 'down', 'left', 'right']
// How far ahead a turn may be booked (steps past the server's next one).
const MAX_AHEAD = SNAKE.turnQueue

interface SnakeState extends SnakeSim {
  foodIdx: number
  len: number
  // The step on which the snake reached its current length (ties go to whoever got there first).
  lenAt: number
  ack: number
}

export interface SnakeArenaState {
  players: PlayerId[]
  snakes: Map<PlayerId, SnakeState>
  foods: number[]
  startedAt: number
  endsAt: number
  stepsTaken: number
  stepMs: number
}

// Real-time FFA grid snake. Every player has their own independent board (same size) and the same seeded
// food sequence; a wrong turn or a crash only affects that player. Movement is time-driven: a shared
// step counter advances each snake once per stepMs elapsed since start, so the simulation is
// deterministic and reconnect-safe (the food stream comes from the injected Random port; time is `now`).
// A snake holds still until its player picks a first direction (at most SNAKE.autoStartMs), so nobody
// hits a wall before touching a key. The step rule itself is shared with the client (@pp/shared), which
// predicts its own snake; a turn names the step it was meant for, so the two agree on where it turned.
export class SnakeArena implements MiniGame<SnakeArenaState, SnakeInput> {
  readonly id = 'snake-arena'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): SnakeArenaState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const r = ctx.random
    const foods = Array.from({ length: GRID * GRID }, () => {
      const x = Math.floor(r.next() * GRID)
      const y = Math.floor(r.next() * GRID)
      return y * GRID + x
    })
    const mid = Math.floor(GRID / 2)
    const snakes = new Map<PlayerId, SnakeState>(
      ctx.players.map((id) => {
        const body = Array.from({ length: SNAKE.startLen }, (_, i) => mid * GRID + mid - i)
        return [
          id,
          {
            body,
            dir: 'right',
            turns: [],
            alive: true,
            waiting: true,
            foodIdx: 0,
            len: body.length,
            lenAt: 0,
            ack: 0,
          },
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
      stepMs: SNAKE.stepMs,
    }
  }

  // The snake's current food: the first candidate from foodIdx onward not covered by its body.
  // Advances foodIdx past leading occupied candidates lazily (candidates wrap so it never runs out).
  private currentFood(state: SnakeArenaState, snake: SnakeState): number {
    const n = state.foods.length
    for (let scanned = 0; scanned < n; scanned++) {
      const cell = state.foods[snake.foodIdx % n] as number
      if (!snake.body.includes(cell)) return cell
      snake.foodIdx++
    }
    return state.foods[snake.foodIdx % n] as number
  }

  private step(state: SnakeArenaState, snake: SnakeState, k: number): void {
    if (!snake.alive) return
    const result = snakeStep(snake, k, this.currentFood(state, snake), GRID, state.stepMs)
    if (result === 'ate') {
      snake.foodIdx++
      snake.lenAt = k
    }
    snake.len = snake.body.length
  }

  onInput(
    state: SnakeArenaState,
    playerId: PlayerId,
    input: SnakeInput,
    _now: number,
  ): SnakeArenaState {
    if (input?.kind !== 'turn' || !DIRS.includes(input.dir)) return state
    const snake = state.snakes.get(playerId)
    if (!snake) return state
    if (Number.isInteger(input.seq) && (input.seq as number) > snake.ack)
      snake.ack = input.seq as number
    // Judged against the heading the snake will have by then: no reversal into its own neck, and a
    // repeat of that heading is a no-op rather than a wasted slot.
    if (!snakeCanTurn(snake, input.dir)) return state
    // The step it's meant for: never one already taken, never behind a turn already queued, and not
    // booked further ahead than the queue reaches.
    const next = Math.max(state.stepsTaken + 1, (snake.turns.at(-1)?.at ?? 0) + 1)
    const asked = Number.isInteger(input.at) ? (input.at as number) : next
    const at = Math.min(Math.max(asked, next), state.stepsTaken + 1 + MAX_AHEAD)
    snake.turns.push({ dir: input.dir, at: Math.max(at, next) })
    return state
  }

  tick(state: SnakeArenaState, _dt: number, now: number): SnakeArenaState {
    const due = Math.floor((now - state.startedAt) / state.stepMs)
    while (state.stepsTaken < due) {
      const k = state.stepsTaken + 1
      for (const snake of state.snakes.values()) this.step(state, snake, k)
      state.stepsTaken = k
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
    const food: Record<PlayerId, number> = {}
    const progress: Record<PlayerId, number> = {}
    for (const id of state.players) {
      const snake = state.snakes.get(id) as SnakeState
      snakes[id] = {
        body: [...snake.body],
        alive: snake.alive,
        len: snake.len,
        dir: snake.dir,
        turns: snake.turns.map((t) => [t.dir, t.at]),
        waiting: snake.waiting,
        ack: snake.ack,
      }
      food[id] = this.currentFood(state, snake)
      progress[id] = snake.len
    }
    return {
      snakes,
      food,
      grid: GRID,
      step: state.stepsTaken,
      stepMs: state.stepMs,
      t: now - state.startedAt,
      progress,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
