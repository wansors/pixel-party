import type { TetrisSprintInput, TetrisSprintSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'
import {
  COLS,
  type PlayerBoardState,
  ROWS,
  createPlayerBoard,
  createQueue,
  hardDrop,
  renderBoard,
  stepFall,
  tryMove,
} from './tetrisCore'

const DEFAULT_DURATION_MS = 60_000
const QUEUE_LENGTH = 300

export interface LineClearSprintState {
  players: PlayerId[]
  queue: number[]
  boards: Map<PlayerId, PlayerBoardState>
  startedAt: number
  endsAt: number
}

// FFA real-time: maximize lines cleared in a fixed time window. A topped-out player's board just stops
// advancing — they stay in the round and are still ranked by the linesCleared they reached.
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
    if (now < state.startedAt || now >= state.endsAt) return state
    const p = state.boards.get(playerId)
    if (!p || p.toppedOut) return state
    if (input.kind === 'move') tryMove(p, input.dir === 'left' ? -1 : 1)
    else if (input.kind === 'drop') hardDrop(p, state.queue)
    return state
  }

  tick(state: LineClearSprintState, dt: number, _now: number): LineClearSprintState {
    for (const pid of state.players) {
      const p = state.boards.get(pid)
      if (p) stepFall(p, dt, state.queue)
    }
    return state
  }

  isFinished(state: LineClearSprintState, now: number): boolean {
    return now >= state.endsAt
  }

  getResult(state: LineClearSprintState): NormalizedResult {
    // Higher linesCleared wins; among equal scores, a survivor outranks one who topped out.
    const key = (pid: PlayerId): number => {
      const p = state.boards.get(pid)
      return (p?.linesCleared ?? 0) * 2 + (p?.toppedOut ? 0 : 1)
    }
    const sorted = [...state.players].sort((a, b) => key(b) - key(a))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prevKey: number | undefined
    sorted.forEach((id, idx) => {
      const k = key(id)
      if (idx > 0 && k !== prevKey) rank = idx
      ranks[id] = rank
      prevKey = k
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
      boards[pid] = { grid: renderBoard(p), linesCleared: p.linesCleared, toppedOut: p.toppedOut }
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
