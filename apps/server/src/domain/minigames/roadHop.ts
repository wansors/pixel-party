import {
  HOP,
  type HopBody,
  type HopKind,
  type HopLane,
  type HopMove,
  type HopperView,
  type HopThing,
  hopHome,
  hopNewBody,
  hopRun,
  hopSnap,
  type RoadHopInput,
  type RoadHopSnapshot,
} from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 60_000
// A lane's loop is at least this long: the field plus a vehicle's length of hiding room each side.
const MIN_LOOP = HOP.cols + 13

interface LaneSpec {
  row: number
  kind: HopKind
  len: number
  speed: number
  // Space between two things (cells): road gaps you slip through, river gaps you hop across.
  gap: readonly [number, number]
}

// Bottom to top: the road (rows 1–5), then the river (rows 7–11). Directions alternate per lane.
const LANES: readonly LaneSpec[] = [
  { row: 1, kind: 'car', len: 1, speed: 1.4, gap: [2.5, 4.5] },
  { row: 2, kind: 'tractor', len: 1, speed: 0.85, gap: [2.5, 4] },
  { row: 3, kind: 'sport', len: 1, speed: 2.5, gap: [3.5, 6] },
  { row: 4, kind: 'van', len: 2, speed: 1.5, gap: [3, 5] },
  { row: 5, kind: 'truck', len: 3, speed: 1.15, gap: [3.5, 6] },
  { row: 7, kind: 'log', len: 3, speed: 1, gap: [1.5, 3] },
  { row: 8, kind: 'raft', len: 2, speed: 1.3, gap: [1.4, 2.4] },
  { row: 9, kind: 'log', len: 5, speed: 1.6, gap: [2, 3.4] },
  { row: 10, kind: 'raft', len: 3, speed: 1.1, gap: [1.4, 2.6] },
  { row: 11, kind: 'log', len: 4, speed: 1.35, gap: [1.5, 3] },
]

// One lane's seeded loop: things with random gaps until the loop is long enough to wrap off screen,
// a random phase, a slightly varied speed; the first lane's direction is a coin flip.
function buildLane(spec: LaneSpec, dir: 1 | -1, random: Random): HopLane {
  const things: HopThing[] = []
  let u = 0
  while (u < MIN_LOOP) {
    things.push({ u, len: spec.len, kind: spec.kind, look: Math.floor(random.next() * 4) })
    u += spec.len + spec.gap[0] + random.next() * (spec.gap[1] - spec.gap[0])
  }
  const loop = Math.round(u * 100) / 100
  const phase = random.next() * loop
  for (const th of things) th.u = Math.round(((th.u + phase) % loop) * 100) / 100
  const speed = Math.round(spec.speed * (0.9 + random.next() * 0.2) * 100) / 100
  return { row: spec.row, river: spec.row > HOP.verge, dir, speed, loop, things }
}

interface Hopper {
  body: HopBody
  // Hops not yet integrated (snapped round ms, ascending, all ≥ body.t).
  moves: HopMove[]
  lastHop: number
  home: number
  ack: number
  gone: boolean
}

export interface RoadHopState {
  players: PlayerId[]
  lanes: HopLane[]
  hoppers: Map<PlayerId, Hopper>
  startedAt: number
  endsAt: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

// Road Hop (D48): a real-time FFA crossing race on one shared field. Everyone hops across the same
// seeded traffic and river at once (no contact between players); a crossing scores and starts you
// over, a squash or a splash sends you back to the pavement after a second. The traffic is a pure
// function of the round clock and speeds up on an ease-in (D40); the run rules live in @pp/shared and
// are integrated on a fixed grid with plain arithmetic, so the client predicts its own hopper bit for
// bit. A hop carries the moment it was pressed; the server accepts it anywhere in the last HOP.judgeMs
// and judges that far behind real time. Most crossings wins; then the furthest row on the run in
// progress at the bell, then fewer deaths.
export class RoadHop implements MiniGame<RoadHopState, RoadHopInput> {
  readonly id = 'road-hop'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): RoadHopState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const first: 1 | -1 = ctx.random.next() < 0.5 ? 1 : -1
    const lanes = LANES.map((spec, i) =>
      buildLane(spec, (i % 2 === 0 ? first : -first) as 1 | -1, ctx.random),
    )
    const hoppers = new Map<PlayerId, Hopper>(
      ctx.players.map((id, i) => {
        const home = hopHome(i, ctx.players.length)
        return [
          id,
          { body: hopNewBody(home), moves: [], lastHop: -Infinity, home, ack: 0, gone: false },
        ]
      }),
    )
    return {
      players: [...ctx.players],
      lanes,
      hoppers,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  // Round ms at server time `now` (capped at the bell).
  private roundTime(state: RoadHopState, now: number): number {
    return Math.min(now, state.endsAt) - state.startedAt
  }

  onInput(state: RoadHopState, playerId: PlayerId, input: RoadHopInput, now: number): RoadHopState {
    if (input?.kind !== 'hop') return state
    const h = state.hoppers.get(playerId)
    if (!h || h.gone) return state
    if (Number.isInteger(input.seq) && (input.seq as number) > h.ack) h.ack = input.seq as number
    if (!Number.isInteger(input.dir) || input.dir < 0 || input.dir > 3) return state
    const live = this.roundTime(state, now)
    if (live < HOP.startDelayMs || now >= state.endsAt) return state
    // When it was pressed: never in the future, never before what's already judged (a hop older than
    // the judging window counts now — as late as possible).
    const asked = typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : live
    const at = hopSnap(clamp(asked, Math.max(h.body.t, HOP.startDelayMs), live))
    if (at - h.lastHop < HOP.minHopGapMs) return state
    h.moves.push({ at, dir: input.dir })
    h.moves.sort((a, b) => a.at - b.at)
    h.lastHop = Math.max(h.lastHop, at)
    return state
  }

  tick(state: RoadHopState, _dt: number, now: number): RoadHopState {
    // Judged HOP.judgeMs behind real time, except at the bell (nothing more can arrive).
    const live = this.roundTime(state, now)
    const lag = now >= state.endsAt ? 0 : HOP.judgeMs
    const until = Math.floor((live - lag) / HOP.dtMs) * HOP.dtMs
    for (const h of state.hoppers.values()) {
      if (h.gone || until <= h.body.t) continue
      hopRun(h.body, until, h.moves, state.lanes, h.home)
      h.moves = h.moves.filter((m) => m.at >= h.body.t)
    }
    return state
  }

  // A player who left freezes where they are and keeps what they scored.
  leave(state: RoadHopState, playerId: PlayerId, _now: number): RoadHopState {
    const h = state.hoppers.get(playerId)
    if (h) {
      h.gone = true
      h.moves = []
    }
    return state
  }

  isFinished(state: RoadHopState, now: number): boolean {
    if (now >= state.endsAt) return true
    for (const h of state.hoppers.values()) if (!h.gone) return false
    return true
  }

  // More crossings; then further along the run in progress; then fewer deaths.
  private cmp(state: RoadHopState, a: PlayerId, b: PlayerId): number {
    const ba = state.hoppers.get(a)?.body
    const bb = state.hoppers.get(b)?.body
    if (!ba || !bb) return 0
    const runA = ba.waitUntil > 0 ? 0 : ba.best
    const runB = bb.waitUntil > 0 ? 0 : bb.best
    return bb.crossings - ba.crossings || runB - runA || ba.deaths - bb.deaths
  }

  getResult(state: RoadHopState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => this.cmp(state, a, b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.cmp(state, sorted[idx - 1] as PlayerId, id) !== 0) rank = idx
      ranks[id] = rank
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players)
      stats[id] = `${state.hoppers.get(id)?.body.crossings ?? 0} crossed`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: RoadHopState, now: number): RoadHopSnapshot {
    const hoppers: Record<PlayerId, HopperView> = {}
    const progress: Record<PlayerId, number> = {}
    for (const id of state.players) {
      const h = state.hoppers.get(id) as Hopper
      hoppers[id] = { body: { ...h.body }, moves: [...h.moves], home: h.home, ack: h.ack }
      progress[id] = h.body.crossings
    }
    return {
      lanes: state.lanes,
      hoppers,
      t: now - state.startedAt,
      progress,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
