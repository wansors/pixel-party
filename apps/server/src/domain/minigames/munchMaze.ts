import {
  MAZE,
  type MazeTurn,
  type MazeWorld,
  type MunchMazeInput,
  type MunchMazeSnapshot,
  mazeClone,
  mazeNewWorld,
  mazeRun,
  mazeSnap,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 60_000
// Turns closer together than this are dropped (mashing).
const MIN_TURN_GAP_MS = 20

export interface MunchMazeState {
  players: PlayerId[]
  world: MazeWorld
  // Per player (same order): turns not yet integrated (snapped round ms, ascending, all ≥ world.t).
  turns: MazeTurn[][]
  lastTurn: number[]
  acks: number[]
  gone: boolean[]
  startedAt: number
  endsAt: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

// Munch Maze (D50): a real-time FFA maze chase. Everyone runs the same park maze at once, eating seeds
// (they grow back), dodging the pigeons (a peck costs 3 and a dazed moment) and grabbing chillies — a
// spicy runner scares the pigeons (+5 a catch) and tackles rivals for up to 5 of their seeds. The world
// rules live in @pp/shared, integrated on a fixed grid with integer arithmetic; turns carry the moment
// they were pressed and the server judges MAZE.judgeMs behind real time, so every client runs the very
// same world forward from the snapshot. Highest score wins; fewer pecks and tackles taken break ties.
export class MunchMaze implements MiniGame<MunchMazeState, MunchMazeInput> {
  readonly id = 'munch-maze'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): MunchMazeState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const n = ctx.players.length
    return {
      players: [...ctx.players],
      world: mazeNewWorld(n),
      turns: ctx.players.map(() => []),
      lastTurn: ctx.players.map(() => -Infinity),
      acks: ctx.players.map(() => 0),
      gone: ctx.players.map(() => false),
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  // Round ms at server time `now` (capped at the bell).
  private roundTime(state: MunchMazeState, now: number): number {
    return Math.min(now, state.endsAt) - state.startedAt
  }

  onInput(
    state: MunchMazeState,
    playerId: PlayerId,
    input: MunchMazeInput,
    now: number,
  ): MunchMazeState {
    if (input?.kind !== 'turn') return state
    const i = state.players.indexOf(playerId)
    if (i < 0 || state.gone[i]) return state
    if (Number.isInteger(input.seq) && (input.seq as number) > (state.acks[i] as number))
      state.acks[i] = input.seq as number
    if (!Number.isInteger(input.dir) || input.dir < 0 || input.dir > 3) return state
    const live = this.roundTime(state, now)
    if (live < MAZE.startDelayMs || now >= state.endsAt) return state
    // When it was pressed: never in the future, never before what's already judged.
    const asked = typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : live
    const at = mazeSnap(clamp(asked, Math.max(state.world.t, MAZE.startDelayMs), live))
    if (at - (state.lastTurn[i] as number) < MIN_TURN_GAP_MS) return state
    const list = state.turns[i] as MazeTurn[]
    list.push({ at, dir: input.dir })
    list.sort((a, b) => a.at - b.at)
    state.lastTurn[i] = Math.max(state.lastTurn[i] as number, at)
    return state
  }

  tick(state: MunchMazeState, _dt: number, now: number): MunchMazeState {
    // Judged MAZE.judgeMs behind real time, except at the bell (nothing more can arrive).
    const live = this.roundTime(state, now)
    const lag = now >= state.endsAt ? 0 : MAZE.judgeMs
    const until = Math.floor((live - lag) / MAZE.dtMs) * MAZE.dtMs
    if (until <= state.world.t) return state
    mazeRun(state.world, until, state.turns)
    state.turns = state.turns.map((list) => list.filter((t) => t.at >= state.world.t))
    return state
  }

  // A player who left stands still from now on (the pigeons may still find them).
  leave(state: MunchMazeState, playerId: PlayerId, _now: number): MunchMazeState {
    const i = state.players.indexOf(playerId)
    if (i >= 0) {
      state.gone[i] = true
      state.turns[i] = []
      const r = state.world.runners[i]
      if (r) {
        r.want = -1
        r.dir = -1
      }
    }
    return state
  }

  isFinished(state: MunchMazeState, now: number): boolean {
    return now >= state.endsAt || state.gone.every(Boolean)
  }

  private cmp(state: MunchMazeState, a: PlayerId, b: PlayerId): number {
    const ra = state.world.runners[state.players.indexOf(a)]
    const rb = state.world.runners[state.players.indexOf(b)]
    if (!ra || !rb) return 0
    return rb.score - ra.score || ra.pecks + ra.tackled - (rb.pecks + rb.tackled)
  }

  getResult(state: MunchMazeState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => this.cmp(state, a, b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.cmp(state, sorted[idx - 1] as PlayerId, id) !== 0) rank = idx
      ranks[id] = rank
    })
    const stats: Record<PlayerId, string> = {}
    state.players.forEach((id, i) => {
      stats[id] = `${state.world.runners[i]?.score ?? 0} pts`
    })
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: MunchMazeState, now: number): MunchMazeSnapshot {
    const acks: Record<PlayerId, number> = {}
    const progress: Record<PlayerId, number> = {}
    state.players.forEach((id, i) => {
      acks[id] = state.acks[i] as number
      progress[id] = state.world.runners[i]?.score ?? 0
    })
    return {
      world: mazeClone(state.world),
      ids: [...state.players],
      turns: state.turns.map((list) => [...list]),
      acks,
      t: now - state.startedAt,
      progress,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
