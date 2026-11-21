import {
  rampEase,
  WING,
  WING_PACE,
  type WingBody,
  type WingColumn,
  type WingFlierView,
  type WingInput,
  type WingSnapshot,
  wingDistance,
  wingFly,
  wingSnap,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 60_000
// The first column's distance ahead of the birds at GO (~2.8 s of flight).
const FIRST_COLUMN_X = WING.birdX + 1.2
// The most a gap's center moves from one column to the next (keeps every gap reachable).
const MAX_SHIFT = 0.3
const GAP_MARGIN = 0.1

interface Flier {
  body: WingBody
  // Flaps not yet integrated (snapped ms after GO, ascending, all ≥ body.t).
  flaps: number[]
  lastFlap: number
  alive: boolean
  outAt: number
  passed: number
  ack: number
}

export interface WingItState {
  players: PlayerId[]
  fliers: Map<PlayerId, Flier>
  // The whole seeded course, sorted by x.
  columns: WingColumn[]
  startedAt: number
  endsAt: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

// Wing It (D42): a real-time FFA tap-to-flap course. Everyone flies the same seeded columns at once
// (no contact between birds); a tap kicks you up, gravity pulls you down, a column or the floor ends
// the flight. The flight rules live in @pp/shared and are integrated on a fixed grid with plain
// arithmetic, so the client predicts its own bird bit for bit. A flap carries the moment it was pressed
// (ms after GO on the client's estimate of the server clock); the server accepts it anywhere in the
// last WING.judgeMs and judges crashes that far behind real time, so the flap counts when it was
// pressed. The course speeds up and its gaps narrow on an ease-in (D40). Last bird flying wins; the
// rest rank by how long they flew.
export class WingIt implements MiniGame<WingItState, WingInput> {
  readonly id = 'wing-it'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): WingItState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const flightMs = Math.max(0, durationMs - WING.startDelayMs)
    const end = wingDistance(flightMs) + WING.viewAhead + 1
    const full = wingDistance(WING_PACE.rampMs)
    const columns: WingColumn[] = []
    let x = FIRST_COLUMN_X
    let gapY = 0.5
    for (let id = 0; x < end; id++) {
      const p = clamp(x / full, 0, 1)
      const gapH = rampEase(WING_PACE.gap[0], WING_PACE.gap[1], p, 2)
      const lo = GAP_MARGIN + gapH / 2
      const hi = 1 - GAP_MARGIN - gapH / 2
      if (id > 0) gapY = clamp(gapY + (ctx.random.next() * 2 - 1) * MAX_SHIFT, lo, hi)
      columns.push({ id, x, gapY, gapH })
      x += rampEase(WING_PACE.spacing[0], WING_PACE.spacing[1], p, 2)
    }
    const fliers = new Map<PlayerId, Flier>(
      ctx.players.map((id) => [
        id,
        {
          body: { t: 0, y: WING.startY, vy: 0 },
          flaps: [],
          lastFlap: -Infinity,
          alive: true,
          outAt: 0,
          passed: 0,
          ack: 0,
        },
      ]),
    )
    return {
      players: [...ctx.players],
      fliers,
      columns,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  // Ms after GO at server time `now`.
  private flightTime(state: WingItState, now: number): number {
    return Math.min(now, state.endsAt) - state.startedAt - WING.startDelayMs
  }

  onInput(state: WingItState, playerId: PlayerId, input: WingInput, now: number): WingItState {
    if (input?.kind !== 'flap') return state
    const f = state.fliers.get(playerId)
    if (!f) return state
    if (Number.isInteger(input.seq) && (input.seq as number) > f.ack) f.ack = input.seq as number
    const live = this.flightTime(state, now)
    if (!f.alive || live < 0) return state
    // When it was pressed: never in the future, never before what's already judged (a flap older than
    // the judging window counts now — as late as possible).
    const asked = typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : live
    const at = wingSnap(clamp(asked, f.body.t, live))
    if (at - f.lastFlap < WING.minFlapGapMs) return state
    f.flaps.push(at)
    f.flaps.sort((a, b) => a - b)
    f.lastFlap = Math.max(f.lastFlap, at)
    return state
  }

  // The columns a body can touch while flying from distance `from` to `to`.
  private near(state: WingItState, from: number, to: number): WingColumn[] {
    const lo = from + WING.birdX - WING.columnW
    const hi = to + WING.birdX + WING.columnW
    return state.columns.filter((c) => c.x >= lo && c.x <= hi)
  }

  private judge(state: WingItState, f: Flier, until: number): void {
    if (!f.alive || until <= f.body.t) return
    const cols = this.near(state, wingDistance(f.body.t), wingDistance(until))
    const crash = wingFly(f.body, until, f.flaps, cols)
    f.flaps = f.flaps.filter((t) => t >= f.body.t)
    const tail = wingDistance(f.body.t) + WING.birdX - WING.radius
    f.passed = state.columns.filter((c) => c.x + WING.columnW / 2 < tail).length
    if (crash !== null) {
      f.alive = false
      f.outAt = Math.max(WING.dtMs, crash)
      f.flaps = []
    }
  }

  tick(state: WingItState, _dt: number, now: number): WingItState {
    // Judged WING.judgeMs behind real time, except at the bell (nothing more can arrive).
    const live = this.flightTime(state, now)
    const lag = now >= state.endsAt ? 0 : WING.judgeMs
    const until = Math.floor((live - lag) / WING.dtMs) * WING.dtMs
    if (until <= 0) return state
    for (const f of state.fliers.values()) this.judge(state, f, until)
    return state
  }

  // A player who left drops out of the sky on the spot.
  leave(state: WingItState, playerId: PlayerId, _now: number): WingItState {
    const f = state.fliers.get(playerId)
    if (f?.alive) {
      f.alive = false
      f.outAt = Math.max(WING.dtMs, f.body.t)
    }
    return state
  }

  private aliveCount(state: WingItState): number {
    let n = 0
    for (const f of state.fliers.values()) if (f.alive) n++
    return n
  }

  isFinished(state: WingItState, now: number): boolean {
    if (now >= state.endsAt) return true
    const alive = this.aliveCount(state)
    return state.players.length > 1 ? alive <= 1 : alive === 0
  }

  // Still flying beats down; a longer flight beats a shorter one; same-moment crashes tie.
  private flown(state: WingItState, id: PlayerId): number {
    const f = state.fliers.get(id)
    if (!f) return 0
    return f.alive ? Number.MAX_SAFE_INTEGER : f.outAt
  }

  getResult(state: WingItState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => this.flown(state, b) - this.flown(state, a))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.flown(state, sorted[idx - 1] as PlayerId) !== this.flown(state, id))
        rank = idx
      ranks[id] = rank
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) {
      const f = state.fliers.get(id)
      stats[id] = f?.alive ? 'survivor' : `${f?.passed ?? 0} cleared`
    }
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: WingItState, now: number): WingSnapshot {
    const fliers: Record<PlayerId, WingFlierView> = {}
    const progress: Record<PlayerId, number> = {}
    let oldest = Number.POSITIVE_INFINITY
    for (const id of state.players) {
      const f = state.fliers.get(id) as Flier
      oldest = Math.min(oldest, f.body.t)
      fliers[id] = {
        t: f.body.t,
        y: f.body.y,
        vy: f.body.vy,
        flaps: [...f.flaps],
        alive: f.alive,
        outAt: f.outAt,
        passed: f.passed,
        ack: f.ack,
      }
      progress[id] = f.passed
    }
    // From just behind the slowest judged bird to a screen ahead of the present.
    const live = Math.max(0, this.flightTime(state, now))
    const from = wingDistance(Math.min(oldest, live)) - 0.6
    const to = wingDistance(live) + WING.birdX + WING.viewAhead
    return {
      fliers,
      columns: state.columns.filter((c) => c.x >= from && c.x <= to),
      t: now - state.startedAt,
      progress,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
