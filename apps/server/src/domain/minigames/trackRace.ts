import type { TrackRaceInput, TrackRaceSnapshot, TrackRunner } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'
import { DRAG, type Runner, coast, createRunner, isFoot, rankSorted, stride } from './athleticsCore'

const DEFAULT_DURATION_MS = 30_000
// The starting gun fires at a seeded, unannounced moment after "SET": anticipating is a gamble.
const GUN_MIN_MS = 1600
const GUN_SPREAD_MS = 1400
// A stride before the gun is a false start: the runner stays in the blocks this long after it.
export const FALSE_START_PENALTY_MS = 1000
// Hurdle jump: airborne this long (≈4.5 m at a good sprint). Strides don't count in the air, but the
// runner carries their speed through it (no drag), so a clean jump costs little.
export const AIR_MS = 480
const HIT_KEEP = 0.15 // share of speed kept after clattering into a hurdle
const RUN_OUT_DRAG = 2.5 // a finisher eases up past the line (on top of the usual drag)
// Once the first runner is home, the rest get this long to finish before the round closes.
const FINISH_WINDOW_MS = 10_000

interface Lane {
  runner: Runner
  finishAt: number // server time the line was crossed (0 = still racing)
  falseStart: boolean
  heldUntil: number
  airFrom: number
  airUntil: number
  nextHurdle: number
  knocked: number[]
  // The player left the round: their lane no longer holds the race open.
  gone: boolean
}

export interface TrackRaceState {
  players: PlayerId[]
  lanes: Map<PlayerId, Lane>
  distance: number
  hurdles: readonly number[]
  startedAt: number
  gunAt: number
  endsAt: number
}

export interface TrackRaceSpec {
  distance: number
  hurdles: readonly number[]
}

// Side-by-side sprint engine shared by the flat dash and the hurdles (FFA, real-time). Deterministic:
// the only randomness is the seeded gun delay; the run itself is pure physics in tick(). Ranked by race
// time; anyone still out on the track when the round closes is ranked by distance covered.
abstract class TrackRace implements MiniGame<TrackRaceState, TrackRaceInput> {
  abstract readonly id: string
  readonly format = 'ffa' as const
  protected abstract readonly spec: TrackRaceSpec

  init(ctx: MiniGameInitCtx): TrackRaceState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const gunAt = ctx.now + GUN_MIN_MS + Math.floor(ctx.random.next() * GUN_SPREAD_MS)
    const lanes = new Map<PlayerId, Lane>()
    for (const pid of ctx.players) {
      lanes.set(pid, {
        runner: createRunner(),
        finishAt: 0,
        falseStart: false,
        heldUntil: 0,
        airFrom: 0,
        airUntil: 0,
        nextHurdle: 0,
        knocked: [],
        gone: false,
      })
    }
    return {
      players: [...ctx.players],
      lanes,
      distance: this.spec.distance,
      hurdles: [...this.spec.hurdles],
      startedAt: ctx.now,
      gunAt,
      endsAt: ctx.now + durationMs,
    }
  }

  onInput(
    state: TrackRaceState,
    playerId: PlayerId,
    input: TrackRaceInput,
    now: number,
  ): TrackRaceState {
    const lane = state.lanes.get(playerId)
    if (!lane || lane.finishAt || now >= state.endsAt) return state
    if (input.kind === 'step') {
      if (!isFoot(input.foot)) return state
      if (now < state.gunAt) {
        if (!lane.falseStart) {
          lane.falseStart = true
          lane.heldUntil = state.gunAt + FALSE_START_PENALTY_MS
        }
        return state
      }
      if (now < lane.heldUntil || now < lane.airUntil) return state
      stride(lane.runner, input.foot, now)
    } else if (input.kind === 'jump') {
      if (state.hurdles.length === 0 || now < state.gunAt || now < lane.heldUntil) return state
      if (now < lane.airUntil) return state
      lane.airFrom = now
      lane.airUntil = now + AIR_MS
    }
    return state
  }

  tick(state: TrackRaceState, dt: number, now: number): TrackRaceState {
    if (now < state.gunAt) return state
    for (const pid of state.players) {
      const lane = state.lanes.get(pid)
      if (!lane || now < lane.heldUntil) continue
      const r = lane.runner
      coast(r, dt, lane.finishAt ? DRAG + RUN_OUT_DRAG : now < lane.airUntil ? 0 : DRAG)
      if (lane.finishAt) continue
      this.crossHurdles(state, lane, now)
      if (r.x >= state.distance) {
        // Back-date the crossing to when the runner actually reached the line inside this tick.
        const overMs = r.v > 0 ? ((r.x - state.distance) / r.v) * 1000 : 0
        lane.finishAt = Math.max(state.gunAt + 1, Math.round(now - overMs))
        const first = state.players.every((p) => p === pid || !state.lanes.get(p)?.finishAt)
        if (first) state.endsAt = Math.min(state.endsAt, now + FINISH_WINDOW_MS)
      }
    }
    return state
  }

  // Resolves every hurdle the runner passed this tick: cleared if airborne at the moment of crossing
  // (back-dated from the current speed), otherwise knocked flat at the cost of most of the speed.
  private crossHurdles(state: TrackRaceState, lane: Lane, now: number): void {
    const r = lane.runner
    while (lane.nextHurdle < state.hurdles.length) {
      const h = state.hurdles[lane.nextHurdle] as number
      if (h > r.x) return
      const crossedAt = r.v > 0 ? now - ((r.x - h) / r.v) * 1000 : now
      const airborne = crossedAt >= lane.airFrom && crossedAt < lane.airUntil
      if (!airborne) {
        lane.knocked.push(lane.nextHurdle)
        r.v *= HIT_KEEP
      }
      lane.nextHurdle++
    }
  }

  leave(state: TrackRaceState, playerId: PlayerId): TrackRaceState {
    const lane = state.lanes.get(playerId)
    if (lane) lane.gone = true
    return state
  }

  // Over at the clock, or once everyone still in the race is home.
  isFinished(state: TrackRaceState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((p) => {
      const lane = state.lanes.get(p)
      return !lane || lane.finishAt > 0 || lane.gone
    })
  }

  private raceMs(state: TrackRaceState, pid: PlayerId): number | null {
    const at = state.lanes.get(pid)?.finishAt ?? 0
    return at > 0 ? at - state.gunAt : null
  }

  // Ordering key: finishers by time, then everyone else by distance covered (lower = better).
  private orderKey(state: TrackRaceState, pid: PlayerId): number {
    const t = this.raceMs(state, pid)
    if (t !== null) return t
    const x = Math.min(state.distance, state.lanes.get(pid)?.runner.x ?? 0)
    return 1e9 - Math.round(x * 100)
  }

  getResult(state: TrackRaceState): NormalizedResult {
    const sorted = [...state.players].sort(
      (a, b) => this.orderKey(state, a) - this.orderKey(state, b),
    )
    const ranks = rankSorted(sorted, (id) => this.orderKey(state, id))
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) {
      const t = this.raceMs(state, id)
      const x = Math.min(state.distance, state.lanes.get(id)?.runner.x ?? 0)
      stats[id] = t !== null ? `${(t / 1000).toFixed(2)}s` : `${Math.floor(x)}m`
    }
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: TrackRaceState, now: number): TrackRaceSnapshot {
    const finishers = state.players
      .filter((p) => (state.lanes.get(p)?.finishAt ?? 0) > 0)
      .sort((a, b) => this.orderKey(state, a) - this.orderKey(state, b))
    const runners: TrackRunner[] = state.players.map((id) => {
      const lane = state.lanes.get(id) as Lane
      const air = now >= lane.airFrom && now < lane.airUntil
      const place = finishers.indexOf(id)
      return {
        id,
        x: Math.round(lane.runner.x * 100) / 100,
        v: Math.round(lane.runner.v * 100) / 100,
        finishMs: this.raceMs(state, id),
        place: place >= 0 ? place + 1 : null,
        falseStart: lane.falseStart,
        held: now >= state.gunAt && now < lane.heldUntil,
        air,
        airT: air ? Math.round(((now - lane.airFrom) / AIR_MS) * 100) / 100 : 0,
        knocked: [...lane.knocked],
      }
    })
    return {
      distance: state.distance,
      hurdles: [...state.hurdles],
      phase: now < state.gunAt ? 'set' : 'go',
      raceMs: now < state.gunAt ? 0 : now - state.gunAt,
      runners,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}

// 100 m dash: flat out from the gun to the line.
export class Dash100m extends TrackRace {
  readonly id = 'dash-100m'
  protected readonly spec: TrackRaceSpec = { distance: 100, hurdles: [] }
}

// 110 m hurdles: the regulation layout — first barrier at 13.72 m, then every 9.14 m (ten in all).
export const HURDLES_110M: readonly number[] = Array.from(
  { length: 10 },
  (_, i) => Math.round((13.72 + i * 9.14) * 100) / 100,
)

export class Hurdles110m extends TrackRace {
  readonly id = 'hurdles-110m'
  protected readonly spec: TrackRaceSpec = { distance: 110, hurdles: HURDLES_110M }
}
