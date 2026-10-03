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
  tryRotate,
} from './tetrisCore'

const DEFAULT_DURATION_MS = 45_000
export const TARGET_LINES = 8
const QUEUE_LENGTH = 300

export interface QuickTetrisState {
  players: PlayerId[]
  queue: number[]
  boards: Map<PlayerId, PlayerBoardState>
  // playerId -> the `now` at which they reached TARGET_LINES (0 = not yet).
  doneAt: Map<PlayerId, number>
  // Players gone mid-round: the race doesn't wait for them.
  left: Set<PlayerId>
  startedAt: number
  endsAt: number
}

// FFA real-time sprint variant of the same mechanic: be the fastest to clear TARGET_LINES lines. A
// player who reaches the target stops advancing (their board is done), and so does one who tops out
// (they're out of the race); everyone else keeps racing until the timer or until no board is left
// racing.
export class QuickTetris implements MiniGame<QuickTetrisState, TetrisSprintInput> {
  readonly id = 'quick-tetris'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): QuickTetrisState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const queue = createQueue(ctx.random, QUEUE_LENGTH)
    return {
      players: [...ctx.players],
      queue,
      boards: new Map(ctx.players.map((id) => [id, createPlayerBoard(queue)])),
      doneAt: new Map(ctx.players.map((id) => [id, 0])),
      left: new Set(),
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  private markDoneIfReached(state: QuickTetrisState, playerId: PlayerId, now: number): void {
    const p = state.boards.get(playerId)
    if (!p) return
    if (p.linesCleared >= TARGET_LINES && (state.doneAt.get(playerId) ?? 0) === 0) {
      state.doneAt.set(playerId, now)
    }
  }

  onInput(
    state: QuickTetrisState,
    playerId: PlayerId,
    input: TetrisSprintInput,
    now: number,
  ): QuickTetrisState {
    if (now < state.startedAt || now >= state.endsAt) return state
    const p = state.boards.get(playerId)
    if (!p || p.toppedOut) return state
    if ((state.doneAt.get(playerId) ?? 0) > 0) return state
    if (input.kind === 'move') tryMove(p, input.dir === 'left' ? -1 : 1)
    else if (input.kind === 'drop') hardDrop(p, state.queue)
    else if (input.kind === 'rotate') tryRotate(p)
    this.markDoneIfReached(state, playerId, now)
    return state
  }

  tick(state: QuickTetrisState, dt: number, now: number): QuickTetrisState {
    for (const pid of state.players) {
      if ((state.doneAt.get(pid) ?? 0) > 0) continue
      const p = state.boards.get(pid)
      if (!p) continue
      stepFall(p, dt, state.queue)
      this.markDoneIfReached(state, pid, now)
    }
    return state
  }

  leave(state: QuickTetrisState, playerId: PlayerId, _now: number): QuickTetrisState {
    state.left.add(playerId)
    return state
  }

  // Over at the timer, or once no board is still racing: every player finished, topped out or gone.
  isFinished(state: QuickTetrisState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every(
      (pid) =>
        (state.doneAt.get(pid) ?? 0) > 0 ||
        state.boards.get(pid)?.toppedOut === true ||
        state.left.has(pid),
    )
  }

  getResult(state: QuickTetrisState): NormalizedResult {
    // Finishers rank above non-finishers, sorted by finish time ascending; non-finishers by
    // linesCleared descending (a survivor tiebreaks above one who topped out, as in Line Clear Sprint).
    const notFinishedKey = (pid: PlayerId): number => {
      const p = state.boards.get(pid)
      return (p?.linesCleared ?? 0) * 2 + (p?.toppedOut ? 0 : 1)
    }
    const rankValue = (pid: PlayerId): [number, number] => {
      const doneAt = state.doneAt.get(pid) ?? 0
      return doneAt > 0 ? [0, doneAt] : [1, -notFinishedKey(pid)]
    }
    const sorted = [...state.players].sort((a, b) => {
      const [ga, va] = rankValue(a)
      const [gb, vb] = rankValue(b)
      return ga !== gb ? ga - gb : va - vb
    })
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prevKey: string | undefined
    sorted.forEach((id, idx) => {
      const [g, v] = rankValue(id)
      const k = `${g}:${v}`
      if (idx > 0 && k !== prevKey) rank = idx
      ranks[id] = rank
      prevKey = k
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) {
      const doneAt = state.doneAt.get(id) ?? 0
      stats[id] =
        doneAt > 0
          ? `finished in ${((doneAt - state.startedAt) / 1000).toFixed(1)}s`
          : `${state.boards.get(id)?.linesCleared ?? 0}/${TARGET_LINES}`
    }
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: QuickTetrisState, now: number): TetrisSprintSnapshot {
    const boards: Record<string, TetrisSprintSnapshot['boards'][string]> = {}
    const progress: Record<string, number> = {}
    for (const pid of state.players) {
      const p = state.boards.get(pid)
      if (!p) continue
      boards[pid] = {
        grid: renderBoard(p),
        linesCleared: p.linesCleared,
        toppedOut: p.toppedOut,
        doneAt: state.doneAt.get(pid) ?? 0,
      }
      progress[pid] = p.linesCleared
    }
    return {
      cols: COLS,
      rows: ROWS,
      boards,
      progress,
      remainingMs: Math.max(0, state.endsAt - now),
      targetLines: TARGET_LINES,
    }
  }
}
