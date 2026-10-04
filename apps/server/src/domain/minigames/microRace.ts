import {
  MICRO_RACE_CAR_R,
  MICRO_RACE_PHYSICS,
  MICRO_RACE_TRACKS,
  MICRO_RACE_WORLD,
  type MicroRaceInput,
  type MicroRacePoint,
  type MicroRaceSnapshot,
  type MicroRaceTrackDef,
  RACE_DRAFT_TUNING,
  RACE_WALL_BOUNCE,
  sampleMicroRaceTrack,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'
import {
  type GridSlot,
  type RaceCar,
  clamp1,
  collideCars,
  followRoad,
  formatRaceTime,
  gridSlots,
  inSlipstream,
  integrateCar,
  retireCar,
  worldWalls,
} from './raceCore'

export { formatRaceTime }

const DEFAULT_DURATION_MS = 90_000
export const LAPS = 3
// Start lights: three reds, then green.
export const GO_DELAY_MS = 2400
// Once the first car takes the flag, everyone else gets this long to finish.
export const FINISH_WINDOW_MS = 12_000
const SAMPLE_SPACING = 8
const SUB_STEPS = 4

// Arcade car physics (world units, seconds) — the shared integrator, tuned for tiny tabletop cars (the
// numbers live in @pp/shared: the client predicts its own car with them).
export const CAR_R = MICRO_RACE_CAR_R
const PHYSICS = MICRO_RACE_PHYSICS
const RESTITUTION = 1.1 // >1 gives bumps a punchy, Micro Machines feel
// Slipstream: tucked in right behind another car (in range, in its wake, heading the same way) a car
// gets a little more top speed and pull — the way back up from the back of the grid.
const DRAFT_RANGE = 110
const DRAFT_CONE = 0.3
const DRAFT = RACE_DRAFT_TUNING
const HIT_MIN_SPEED = 60 // approach speed that counts as a bump for feedback
const WALL_BOUNCE = RACE_WALL_BOUNCE
// Progress tracking (see raceCore.followRoad): a car that strays lostFactor × halfWidth from its own
// stretch of road for lostMs (a cut across the table, a wild spin) is put back where it left it.
const ROAD = { windowBack: 6, windowAhead: 10, lostFactor: 2.2, lostMs: 1500 }
const GRID_FIRST_BACK = 20
const GRID_ROW_GAP = 36
const GRID_LATERAL = 0.42

interface Car extends RaceCar {
  draft: boolean
}

export interface MicroRaceState {
  players: PlayerId[]
  track: number
  def: MicroRaceTrackDef
  samples: MicroRacePoint[]
  cars: Map<PlayerId, Car>
  startedAt: number
  goAt: number
  endsAt: number
  closing: boolean
}

// Real-time FFA top-down racer (Micro Machines style). Deterministic: the seeded Random only picks the
// track and the grid order; everything after that is pure physics from `dt`/`now`. Cars lap a closed
// spline circuit on a tabletop; progress follows the road sample by sample (no shortcuts), the first
// car to complete LAPS laps opens a short finish window, and the race order ranks everyone.
export class MicroRace implements MiniGame<MicroRaceState, MicroRaceInput> {
  readonly id = 'micro-race'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): MicroRaceState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const track = Math.min(
      MICRO_RACE_TRACKS.length - 1,
      Math.floor(ctx.random.next() * MICRO_RACE_TRACKS.length),
    )
    const def = MICRO_RACE_TRACKS[track] as MicroRaceTrackDef
    const samples = sampleMicroRaceTrack(def, SAMPLE_SPACING)
    // Seeded grid order (Fisher–Yates), two cars per row, staggered behind the start line.
    const order = [...ctx.players]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random.next() * (i + 1))
      const tmp = order[i] as PlayerId
      order[i] = order[j] as PlayerId
      order[j] = tmp
    }
    const grid = gridSlots(samples, order.length, {
      spacing: SAMPLE_SPACING,
      firstBack: GRID_FIRST_BACK,
      rowGap: GRID_ROW_GAP,
      lateral: def.halfWidth * GRID_LATERAL,
      carR: CAR_R,
    })
    const cars = new Map<PlayerId, Car>()
    order.forEach((pid, slot) => {
      const { x, y, a, idx, back } = grid[slot] as GridSlot
      cars.set(pid, {
        x,
        y,
        a,
        vx: 0,
        vy: 0,
        steer: 0,
        throttle: 0,
        idx,
        prog: -back,
        off: false,
        lostSince: null,
        finishMs: null,
        hits: 0,
        resets: 0,
        gone: false,
        draft: false,
      })
    })
    return {
      players: [...ctx.players],
      track,
      def,
      samples,
      cars,
      startedAt: ctx.now,
      goAt: ctx.now + GO_DELAY_MS,
      endsAt: ctx.now + durationMs,
      closing: false,
    }
  }

  onInput(
    state: MicroRaceState,
    playerId: PlayerId,
    input: MicroRaceInput,
    now: number,
  ): MicroRaceState {
    if (input?.kind !== 'drive' || now >= state.endsAt) return state
    const car = state.cars.get(playerId)
    if (!car || car.finishMs !== null) return state
    const { steer, throttle } = input
    if (typeof steer !== 'number' || typeof throttle !== 'number') return state
    if (!Number.isFinite(steer) || !Number.isFinite(throttle)) return state
    car.steer = clamp1(steer)
    car.throttle = clamp1(throttle)
    return state
  }

  tick(state: MicroRaceState, dt: number, now: number): MicroRaceState {
    if (now < state.goAt) return state
    const h = dt / 1000 / SUB_STEPS
    const cars = state.players.map((p) => state.cars.get(p)).filter((c): c is Car => !!c)
    for (const car of cars) {
      car.draft =
        car.finishMs === null &&
        !car.gone &&
        inSlipstream(car, cars, CAR_R, DRAFT_RANGE, DRAFT_CONE)
    }
    for (let s = 0; s < SUB_STEPS; s++) {
      for (const car of cars) integrateCar(car, h, PHYSICS, car.draft ? DRAFT : {})
      for (let i = 0; i < cars.length; i++) {
        for (let j = i + 1; j < cars.length; j++) {
          collideCars(cars[i] as Car, cars[j] as Car, CAR_R, RESTITUTION, HIT_MIN_SPEED)
        }
      }
      for (const car of cars) {
        worldWalls(car, MICRO_RACE_WORLD.w, MICRO_RACE_WORLD.h, CAR_R, WALL_BOUNCE)
      }
    }
    const n = state.samples.length
    for (const car of cars) {
      followRoad(car, state.samples, { closed: true, halfWidth: state.def.halfWidth, ...ROAD }, now)
      if (car.finishMs === null && car.prog >= LAPS * n) {
        car.finishMs = now - state.goAt
        car.steer = 0
        car.throttle = 0
        if (!state.closing) {
          state.closing = true
          state.endsAt = Math.min(state.endsAt, now + FINISH_WINDOW_MS)
        }
      }
    }
    return state
  }

  // A driver who left becomes a ghost (no contact, no slipstream) that no longer holds the race open.
  leave(state: MicroRaceState, playerId: PlayerId): MicroRaceState {
    const car = state.cars.get(playerId)
    if (car) retireCar(car)
    return state
  }

  isFinished(state: MicroRaceState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((p) => {
      const car = state.cars.get(p)
      return !car || car.finishMs !== null || car.gone
    })
  }

  // Race order: finishers by time, then everyone else by distance covered.
  private order(state: MicroRaceState): PlayerId[] {
    const key = (id: PlayerId): [number, number] => {
      const c = state.cars.get(id)
      if (!c) return [1, 0]
      return c.finishMs !== null ? [0, c.finishMs] : [1, -c.prog]
    }
    return [...state.players].sort((x, y) => {
      const [gx, vx] = key(x)
      const [gy, vy] = key(y)
      return gx - gy || vx - vy
    })
  }

  getResult(state: MicroRaceState): NormalizedResult {
    const n = state.samples.length
    const placements = this.order(state)
    const ranks: Record<PlayerId, number> = {}
    const stats: Record<PlayerId, string> = {}
    // Equal finish times (or equal distance for non-finishers) share a rank.
    let rank = 0
    let prevKey = ''
    placements.forEach((id, idx) => {
      const c = state.cars.get(id)
      const done = c !== undefined && c.finishMs !== null
      const k = done ? `f${c.finishMs}` : `p${c?.prog ?? 0}`
      if (idx > 0 && k !== prevKey) rank = idx
      ranks[id] = rank
      prevKey = k
      if (!c) stats[id] = 'DNF'
      else if (c.finishMs !== null) stats[id] = formatRaceTime(c.finishMs)
      else stats[id] = `LAP ${lapOf(c.prog, n)}`
    })
    return { placements, ranks, stats }
  }

  snapshot(state: MicroRaceState, now: number): MicroRaceSnapshot {
    const n = state.samples.length
    const order = this.order(state)
    const cars = order.map((id, i) => {
      const c = state.cars.get(id) as Car
      return {
        id,
        x: Math.round(c.x * 10) / 10,
        y: Math.round(c.y * 10) / 10,
        a: Math.round(c.a * 1000) / 1000,
        lap: lapOf(c.prog, n),
        pos: i + 1,
        finishMs: c.finishMs,
        off: c.off,
        hits: c.hits,
        resets: c.resets,
        draft: c.draft,
        gone: c.gone,
        vx: Math.round(c.vx * 10) / 10,
        vy: Math.round(c.vy * 10) / 10,
      }
    })
    return {
      track: state.track,
      laps: LAPS,
      goInMs: Math.max(0, state.goAt - now),
      raceMs: Math.max(0, now - state.goAt),
      cars,
      remainingMs: Math.max(0, state.endsAt - now),
      closing: state.closing,
    }
  }
}

// Current 1-based lap from signed progress (grid cars behind the line are on lap 1).
function lapOf(prog: number, n: number): number {
  return Math.max(1, Math.min(LAPS, Math.floor(prog / n) + 1))
}
