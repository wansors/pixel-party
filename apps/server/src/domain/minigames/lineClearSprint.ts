import type { TetrisSprintInput, TetrisSprintSnapshot } from '@pp/shared'
import { tetrisFall } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'
import {
  applyInput,
  boardView,
  COLS,
  createPlayerBoard,
  createQueue,
  gravityMs,
  isTetrisInput,
  type PlayerBoardState,
  ROWS,
  shapeAtOf,
} from './tetrisCore'

const DEFAULT_DURATION_MS = 60_000
const QUEUE_LENGTH = 300
// Gravity eases in from the opening 550 ms a row to this at the buzzer (see gravityMs).
export const FASTEST_FALL_MS = 170

export interface LineClearSprintState {
  players: PlayerId[]
  queue: number[]
  boards: Map<PlayerId, PlayerBoardState>
  // playerId → when their board topped out (absent while they're still playing).
  toppedAt: Map<PlayerId, number>
  // Players gone mid-round; once nobody is left the round ends.
  left: Set<PlayerId>
  startedAt: number
  endsAt: number
}

// FFA real-time: maximize lines cleared in a fixed time window, under gravity that speeds up for
// everyone as the clock runs down (gently, then steeply). Topping out is the end of your run (D54): the
// board freezes with the lines you made, and the round ends early once every board is out. Most lines
// wins; on equal lines a board still standing beats a topped-out one, and a later top-out an earlier.
export class LineClearSprint implements MiniGame<LineClearSprintState, TetrisSprintInput> {
  readonly id = 'line-clear-sprint'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): LineClearSprintState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const queue = createQueue(ctx.random, QUEUE_LENGTH)
    return {
      players: [...ctx.players],
      queue,
      boards: new Map(ctx.players.map((id) => [id, createPlayerBoard(queue)])),
      toppedAt: new Map(),
      left: new Set(),
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  onInput(
    state: LineClearSprintState,
    playerId: PlayerId,
    input: TetrisSprintInput,
    now: number,
  ): LineClearSprintState {
    const p = state.boards.get(playerId)
    if (!p || !isTetrisInput(input)) return state
    if (now < state.startedAt || now >= state.endsAt) return state
    applyInput(p, input, state.queue)
    this.onTopOut(state, playerId, p, now)
    return state
  }

  tick(state: LineClearSprintState, dt: number, now: number): LineClearSprintState {
    const fallMs = gravityMs(state.startedAt, state.endsAt, now, FASTEST_FALL_MS)
    for (const pid of state.players) {
      const p = state.boards.get(pid)
      if (!p) continue
      p.fallMs = fallMs
      if (p.toppedOut) continue
      tetrisFall(p, dt, shapeAtOf(state.queue))
      this.onTopOut(state, pid, p, now)
    }
    return state
  }

  // A board that just topped out is out: remember when (the tiebreak).
  private onTopOut(
    state: LineClearSprintState,
    pid: PlayerId,
    p: PlayerBoardState,
    now: number,
  ): void {
    if (p.toppedOut && !state.toppedAt.has(pid)) state.toppedAt.set(pid, now)
  }

  leave(state: LineClearSprintState, playerId: PlayerId, _now: number): LineClearSprintState {
    state.left.add(playerId)
    return state
  }

  // The clock, or no board left in play (every one topped out or gone).
  isFinished(state: LineClearSprintState, now: number): boolean {
    return (
      now >= state.endsAt ||
      state.players.every((pid) => state.left.has(pid) || state.toppedAt.has(pid))
    )
  }

  // Most lines; then still standing beats topped out; then the later top-out.
  private cmp(state: LineClearSprintState, a: PlayerId, b: PlayerId): number {
    const lines = (id: PlayerId): number => state.boards.get(id)?.linesCleared ?? 0
    const lasted = (id: PlayerId): number => state.toppedAt.get(id) ?? Number.POSITIVE_INFINITY
    const la = lasted(a)
    const lb = lasted(b)
    return lines(b) - lines(a) || (la === lb ? 0 : lb > la ? 1 : -1)
  }

  getResult(state: LineClearSprintState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => this.cmp(state, a, b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.cmp(state, sorted[idx - 1] as PlayerId, id) !== 0) rank = idx
      ranks[id] = rank
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `${state.boards.get(id)?.linesCleared ?? 0} lines`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: LineClearSprintState, now: number): TetrisSprintSnapshot {
    const boards: Record<string, TetrisSprintSnapshot['boards'][string]> = {}
    const progress: Record<string, number> = {}
    for (const pid of state.players) {
      const p = state.boards.get(pid)
      if (!p) continue
      boards[pid] = boardView(p, state.queue)
      progress[pid] = p.linesCleared
    }
    return {
      cols: COLS,
      rows: ROWS,
      boards,
      progress,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
