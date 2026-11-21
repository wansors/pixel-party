import {
  AVATARS,
  BAR,
  type BarArrival,
  type BarBoardView,
  type BarBody,
  type BarCmd,
  type BarRushInput,
  type BarRushSnapshot,
  barClone,
  barNewBody,
  barRun,
  barSnap,
} from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 60_000
// The first customer walks in this long after GO.
const FIRST_MS = 600
// The crowd's pace over the round (D40): the gap between arrivals and the walking speed ease in.
const GAP_MS: readonly [number, number] = [2500, 850]
const SPEED: readonly [number, number] = [0.075, 0.15]

// The seeded crowd for a round of `durationMs`: the same customers, at the same moments, for everyone.
export function buildArrivals(durationMs: number, random: Random): BarArrival[] {
  const out: BarArrival[] = []
  let at = BAR.startDelayMs + FIRST_MS
  let lastLane = -1
  while (at < durationMs) {
    const p = Math.min(1, (at - BAR.startDelayMs) / (durationMs - BAR.startDelayMs))
    const ease = p * p
    // Never the same bar twice running (keeps you moving).
    let lane = Math.floor(random.next() * BAR.lanes)
    if (lane === lastLane)
      lane = (lane + 1 + Math.floor(random.next() * (BAR.lanes - 1))) % BAR.lanes
    lastLane = lane
    out.push({
      at: Math.round(at),
      lane,
      wants: random.next() < 0.2 + 0.35 * ease ? 2 : 1,
      speed:
        Math.round((SPEED[0] + (SPEED[1] - SPEED[0]) * ease) * (0.9 + random.next() * 0.2) * 1e4) /
        1e4,
      look: Math.floor(random.next() * AVATARS.length * 4),
    })
    at += (GAP_MS[0] + (GAP_MS[1] - GAP_MS[0]) * ease) * (0.75 + random.next() * 0.5)
  }
  return out
}

interface Board {
  body: BarBody
  // Commands not yet integrated (snapped round ms, ascending, all ≥ body.t).
  cmds: BarCmd[]
  ack: number
  gone: boolean
}

export interface BarRushState {
  players: PlayerId[]
  arrivals: BarArrival[]
  boards: Map<PlayerId, Board>
  startedAt: number
  endsAt: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

// Bar Rush (D52): a real-time FFA bar-serving rush. Everyone tends their own four bars against the same
// seeded crowd: serve a drink down the right bar (+1), catch the empties (+1), never
// smash a glass (−2) or let a customer reach your end (−3). The crowd comes faster and walks faster as
// the round goes on (D40). The bar rules live in @pp/shared and are integrated on a fixed grid with
// plain arithmetic; commands carry the moment they were pressed and the server judges BAR.judgeMs
// behind real time, so the client predicts its own bar bit for bit. Highest score wins; fewer smashed
// glasses and angry customers break ties.
export class BarRush implements MiniGame<BarRushState, BarRushInput> {
  readonly id = 'bar-rush'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): BarRushState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    return {
      players: [...ctx.players],
      arrivals: buildArrivals(durationMs, ctx.random),
      boards: new Map(
        ctx.players.map((id) => [id, { body: barNewBody(), cmds: [], ack: 0, gone: false }]),
      ),
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  // Round ms at server time `now` (capped at the bell).
  private roundTime(state: BarRushState, now: number): number {
    return Math.min(now, state.endsAt) - state.startedAt
  }

  onInput(state: BarRushState, playerId: PlayerId, input: BarRushInput, now: number): BarRushState {
    if (input?.kind !== 'bar') return state
    const board = state.boards.get(playerId)
    if (!board || board.gone) return state
    if (Number.isInteger(input.seq) && (input.seq as number) > board.ack)
      board.ack = input.seq as number
    const lane =
      Number.isInteger(input.lane) &&
      (input.lane as number) >= 0 &&
      (input.lane as number) < BAR.lanes
        ? (input.lane as number)
        : undefined
    const serve = input.serve === true
    if (lane === undefined && !serve) return state
    const live = this.roundTime(state, now)
    if (live < BAR.startDelayMs || now >= state.endsAt) return state
    // When it was pressed: never in the future, never before what's already judged.
    const asked = typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : live
    const at = barSnap(clamp(asked, Math.max(board.body.t, BAR.startDelayMs), live))
    board.cmds.push({ at, ...(lane !== undefined ? { lane } : {}), ...(serve ? { serve } : {}) })
    board.cmds.sort((a, b) => a.at - b.at)
    return state
  }

  tick(state: BarRushState, _dt: number, now: number): BarRushState {
    // Judged BAR.judgeMs behind real time, except at the bell (nothing more can arrive).
    const live = this.roundTime(state, now)
    const lag = now >= state.endsAt ? 0 : BAR.judgeMs
    const until = Math.floor((live - lag) / BAR.dtMs) * BAR.dtMs
    for (const board of state.boards.values()) {
      if (board.gone || until <= board.body.t) continue
      barRun(board.body, until, board.cmds, state.arrivals)
      board.cmds = board.cmds.filter((c) => c.at >= board.body.t)
    }
    return state
  }

  // A player who left shuts their bar: it stops where it is and keeps its score.
  leave(state: BarRushState, playerId: PlayerId, _now: number): BarRushState {
    const board = state.boards.get(playerId)
    if (board) {
      board.gone = true
      board.cmds = []
    }
    return state
  }

  isFinished(state: BarRushState, now: number): boolean {
    if (now >= state.endsAt) return true
    for (const board of state.boards.values()) if (!board.gone) return false
    return true
  }

  private cmp(state: BarRushState, a: PlayerId, b: PlayerId): number {
    const ba = state.boards.get(a)?.body
    const bb = state.boards.get(b)?.body
    if (!ba || !bb) return 0
    return bb.score - ba.score || ba.smashed + ba.angry - (bb.smashed + bb.angry)
  }

  getResult(state: BarRushState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => this.cmp(state, a, b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.cmp(state, sorted[idx - 1] as PlayerId, id) !== 0) rank = idx
      ranks[id] = rank
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `${state.boards.get(id)?.body.score ?? 0} pts`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: BarRushState, now: number): BarRushSnapshot {
    const boards: Record<PlayerId, BarBoardView> = {}
    const progress: Record<PlayerId, number> = {}
    for (const id of state.players) {
      const board = state.boards.get(id) as Board
      boards[id] = {
        body: barClone(board.body),
        cmds: board.cmds.map((c) => ({ ...c })),
        ack: board.ack,
      }
      progress[id] = board.body.score
    }
    return {
      arrivals: state.arrivals,
      boards,
      t: now - state.startedAt,
      progress,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
