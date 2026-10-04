import type { TetrisSprintInput, TetrisSprintSnapshot } from '@pp/shared'
import { tetrisFall } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'
import {
  applyInput,
  boardView,
  COLS,
  createPlayerBoard,
  createQueue,
  isTetrisInput,
  type PlayerBoardState,
  ROWS,
  restartBoard,
  shapeAtOf,
} from './tetrisCore'

const DEFAULT_DURATION_MS = 60_000
const QUEUE_LENGTH = 300
// Topping out costs TOPOUT_PENALTY lines (never below 0) and RESTART_MS frozen while the stack crumbles;
// then the board starts over empty.
const TOPOUT_PENALTY = 2
const RESTART_MS = 1500

export interface LineClearSprintState {
  players: PlayerId[]
  queue: number[]
  boards: Map<PlayerId, PlayerBoardState>
  // playerId → when their topped-out board restarts (absent while they're playing).
  restartAt: Map<PlayerId, number>
  topOuts: Map<PlayerId, number>
  // Players gone mid-round; once nobody is left the round ends.
  left: Set<PlayerId>
  startedAt: number
  endsAt: number
}

// FFA real-time: maximize lines cleared in a fixed time window. Topping out isn't the end: it costs a
// couple of lines and a short freeze, then the board starts over — nobody sits out the rest of the
// round. Most lines wins; fewer top-outs breaks ties.
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
      restartAt: new Map(),
      topOuts: new Map(ctx.players.map((id) => [id, 0])),
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
    for (const pid of state.players) {
      const p = state.boards.get(pid)
      if (!p) continue
      const restartAt = state.restartAt.get(pid)
      if (restartAt !== undefined && now >= restartAt) {
        restartBoard(p, state.queue)
        state.restartAt.delete(pid)
      }
      tetrisFall(p, dt, shapeAtOf(state.queue))
      this.onTopOut(state, pid, p, now)
    }
    return state
  }

  // A board that just topped out pays the penalty and is scheduled to restart.
  private onTopOut(
    state: LineClearSprintState,
    pid: PlayerId,
    p: PlayerBoardState,
    now: number,
  ): void {
    if (!p.toppedOut || state.restartAt.has(pid)) return
    p.linesCleared = Math.max(0, p.linesCleared - TOPOUT_PENALTY)
    state.topOuts.set(pid, (state.topOuts.get(pid) ?? 0) + 1)
    state.restartAt.set(pid, now + RESTART_MS)
  }

  leave(state: LineClearSprintState, playerId: PlayerId, _now: number): LineClearSprintState {
    state.left.add(playerId)
    return state
  }

  // Every board can always go on (a top-out restarts), so only the clock — or an empty room — ends it.
  isFinished(state: LineClearSprintState, now: number): boolean {
    return now >= state.endsAt || state.players.every((pid) => state.left.has(pid))
  }

  // Most lines; equal lines go to whoever topped out less.
  private cmp(state: LineClearSprintState, a: PlayerId, b: PlayerId): number {
    const lines = (id: PlayerId): number => state.boards.get(id)?.linesCleared ?? 0
    const topOuts = (id: PlayerId): number => state.topOuts.get(id) ?? 0
    return lines(b) - lines(a) || topOuts(a) - topOuts(b)
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
      topOutPenalty: TOPOUT_PENALTY,
    }
  }
}
