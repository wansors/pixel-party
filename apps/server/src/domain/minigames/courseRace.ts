import {
  COURSE_SPACING,
  type CourseDef,
  type CourseKind,
  type CourseRaceInput,
  type CourseRaceSnapshot,
  type MicroRacePoint,
  RALLY_STAGES,
  SPEED_CIRCUITS,
  inStretch,
  sampleCourse,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'
import {
  type CarPhysics,
  type CarTuning,
  type GridSlot,
  type RaceCar,
  clamp1,
  collideCars,
  followRoad,
  formatRaceTime,
  gridSlots,
  inSlipstream,
  integrateCar,
  pointAt,
  retireCar,
  worldWalls,
} from './raceCore'

export const GO_DELAY_MS = 2400
const SUB_STEPS = 4
const WALL_BOUNCE = 0.4
const ROAD = { windowBack: 6, windowAhead: 12, lostFactor: 2.4, lostMs: 1500 }

interface CourseConfig {
  kind: CourseKind
  courses: readonly CourseDef[]
  defaultDurationMs: number
  physics: CarPhysics
  carR: number
  // Wheel-to-wheel contact (the stage is driven by ghosts).
  contact: boolean
  laps: number
  checkpoints: number
  finishWindowMs: number
}

// Rally: a lively tarmac car that slides on gravel.
const STAGE: CourseConfig = {
  kind: 'stage',
  courses: RALLY_STAGES,
  defaultDurationMs: 70_000,
  physics: {
    maxSpeed: 270,
    offMaxSpeed: 110,
    accel: 300,
    brake: 650,
    reverseAccel: 240,
    maxReverse: 90,
    rollDrag: 0.35,
    offDrag: 1.6,
    offDecel: 520,
    grip: 9,
    offGrip: 4.5,
    turnRate: 3.7,
    turnFullSpeed: 70,
    understeerFrom: 170,
    highSpeedUndersteer: 0.3,
  },
  carR: 12,
  contact: false,
  laps: 1,
  checkpoints: 3,
  finishWindowMs: 15_000,
}
const GRAVEL_GRIP = 4.2
const GRAVEL_SPEED = 0.93

// Circuit: faster, grippier, and racing each other for real.
const CIRCUIT: CourseConfig = {
  kind: 'circuit',
  courses: SPEED_CIRCUITS,
  defaultDurationMs: 100_000,
  physics: {
    maxSpeed: 320,
    offMaxSpeed: 130,
    accel: 320,
    brake: 700,
    reverseAccel: 240,
    maxReverse: 90,
    rollDrag: 0.35,
    offDrag: 1.6,
    offDecel: 560,
    grip: 10,
    offGrip: 5,
    turnRate: 3.4,
    turnFullSpeed: 80,
    understeerFrom: 220,
    highSpeedUndersteer: 0.35,
  },
  carR: 13,
  contact: true,
  laps: 2,
  checkpoints: 0,
  finishWindowMs: 12_000,
}
const RESTITUTION = 1
const HIT_MIN_SPEED = 70
// Slipstream: right behind another car (within range, in its wake, heading the same way).
const DRAFT_RANGE = 140
const DRAFT_CONE = 0.3
const DRAFT = { maxSpeedScale: 1.1, accelScale: 1.15 }
// Boost pads.
const BOOST_MS = 1200
const BOOST = { maxSpeedScale: 1.25, accelScale: 1.6 }
const GRID_FIRST_BACK = 24
const GRID_ROW_GAP = 40
const GRID_LATERAL = 0.42
// Stage ghosts line up side by side across this share of the road's half-width.
const STAGE_SPREAD = 0.75

interface Car extends RaceCar {
  checkpoint: number
  splitMs: number | null
  draft: boolean
  boostUntil: number
}

export interface CourseRaceState {
  players: PlayerId[]
  course: number
  def: CourseDef
  samples: MicroRacePoint[]
  cars: Map<PlayerId, Car>
  startedAt: number
  goAt: number
  endsAt: number
  closing: boolean
}

// Shared engine for the course racers: the seeded Random only picks the course and the grid order;
// everything after that is pure physics on `dt`/`now` (raceCore). Rally Stage and Speed Circuit are
// two configurations of it.
class CourseRace implements MiniGame<CourseRaceState, CourseRaceInput> {
  readonly format = 'ffa' as const

  constructor(
    readonly id: string,
    private readonly cfg: CourseConfig,
  ) {}

  private get closed(): boolean {
    return this.cfg.kind === 'circuit'
  }

  init(ctx: MiniGameInitCtx): CourseRaceState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number'
        ? ctx.config.durationMs
        : this.cfg.defaultDurationMs
    const courses = this.cfg.courses
    const course = Math.min(courses.length - 1, Math.floor(ctx.random.next() * courses.length))
    const def = courses[course] as CourseDef
    const samples = sampleCourse(def)
    const order = [...ctx.players]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random.next() * (i + 1))
      ;[order[i], order[j]] = [order[j] as PlayerId, order[i] as PlayerId]
    }
    // Circuit: a staggered two-wide grid behind the line. Stage: ghosts side by side on the line,
    // spread evenly across the road.
    const grid = this.closed
      ? gridSlots(samples, order.length, {
          spacing: COURSE_SPACING,
          firstBack: GRID_FIRST_BACK,
          rowGap: GRID_ROW_GAP,
          lateral: def.halfWidth * GRID_LATERAL,
          carR: this.cfg.carR,
        })
      : order.map((_, slot) => this.stageSlot(samples, def, slot, order.length))
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
        prog: back > 0 ? -back : 0,
        off: false,
        lostSince: null,
        finishMs: null,
        hits: 0,
        resets: 0,
        gone: false,
        checkpoint: 0,
        splitMs: null,
        draft: false,
        boostUntil: 0,
      })
    })
    return {
      players: [...ctx.players],
      course,
      def,
      samples,
      cars,
      startedAt: ctx.now,
      goAt: ctx.now + GO_DELAY_MS,
      endsAt: ctx.now + durationMs,
      closing: false,
    }
  }

  // Start slot `slot` of `count` on the stage's start line.
  private stageSlot(
    samples: MicroRacePoint[],
    def: CourseDef,
    slot: number,
    count: number,
  ): GridSlot {
    const { x, y, tx, ty } = pointAt(samples, 0, false)
    const lat = count > 1 ? (slot / (count - 1) - 0.5) * 2 * def.halfWidth * STAGE_SPREAD : 0
    return { x: x - ty * lat, y: y + tx * lat, a: Math.atan2(ty, tx), idx: 0, back: 0 }
  }

  onInput(
    state: CourseRaceState,
    playerId: PlayerId,
    input: CourseRaceInput,
    now: number,
  ): CourseRaceState {
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

  // The full race distance in samples.
  private distance(state: CourseRaceState): number {
    const n = state.samples.length
    return this.closed ? n * this.cfg.laps : n - 1
  }

  tick(state: CourseRaceState, dt: number, now: number): CourseRaceState {
    if (now < state.goAt) return state
    const { def, samples } = state
    const n = samples.length
    const h = dt / 1000 / SUB_STEPS
    const cars = state.players.map((p) => state.cars.get(p)).filter((c): c is Car => !!c)
    for (const car of cars) {
      car.draft =
        this.closed &&
        car.finishMs === null &&
        !car.gone &&
        inSlipstream(car, cars, this.cfg.carR, DRAFT_RANGE, DRAFT_CONE)
      if (this.closed && inStretch(def.boosts, car.idx, n) && !car.off)
        car.boostUntil = now + BOOST_MS
    }
    for (let s = 0; s < SUB_STEPS; s++) {
      for (const car of cars) integrateCar(car, h, this.cfg.physics, this.tuning(state, car, now))
      if (this.cfg.contact) {
        for (let i = 0; i < cars.length; i++) {
          for (let j = i + 1; j < cars.length; j++) {
            collideCars(cars[i] as Car, cars[j] as Car, this.cfg.carR, RESTITUTION, HIT_MIN_SPEED)
          }
        }
      }
      for (const car of cars) worldWalls(car, def.world.w, def.world.h, this.cfg.carR, WALL_BOUNCE)
    }
    const total = this.distance(state)
    for (const car of cars) {
      followRoad(car, samples, { closed: this.closed, halfWidth: def.halfWidth, ...ROAD }, now)
      if (car.finishMs !== null) continue
      // Stage splits: checkpoints evenly spaced along the road.
      const cps = this.cfg.checkpoints
      while (car.checkpoint < cps && car.prog >= ((car.checkpoint + 1) * total) / (cps + 1)) {
        car.checkpoint += 1
        car.splitMs = now - state.goAt
      }
      if (car.prog >= total) {
        car.finishMs = now - state.goAt
        car.steer = 0
        car.throttle = 0
        if (!state.closing) {
          state.closing = true
          state.endsAt = Math.min(state.endsAt, now + this.cfg.finishWindowMs)
        }
      }
    }
    return state
  }

  private tuning(state: CourseRaceState, car: Car, now: number): CarTuning {
    if (!this.closed) {
      const gravel = inStretch(state.def.gravel, car.idx, state.samples.length)
      return gravel ? { grip: GRAVEL_GRIP, maxSpeedScale: GRAVEL_SPEED } : {}
    }
    let maxSpeedScale = car.draft ? DRAFT.maxSpeedScale : 1
    let accelScale = car.draft ? DRAFT.accelScale : 1
    if (now < car.boostUntil) {
      maxSpeedScale *= BOOST.maxSpeedScale
      accelScale *= BOOST.accelScale
    }
    return { maxSpeedScale, accelScale }
  }

  // A driver who left becomes a ghost (no contact, no slipstream) that no longer holds the race open.
  leave(state: CourseRaceState, playerId: PlayerId): CourseRaceState {
    const car = state.cars.get(playerId)
    if (car) retireCar(car)
    return state
  }

  isFinished(state: CourseRaceState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((p) => {
      const car = state.cars.get(p)
      return !car || car.finishMs !== null || car.gone
    })
  }

  // Race order: finishers by time, then everyone else by distance covered.
  private order(state: CourseRaceState): PlayerId[] {
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

  private lap(state: CourseRaceState, car: Car): number {
    const n = state.samples.length
    return this.closed ? Math.max(1, Math.min(this.cfg.laps, Math.floor(car.prog / n) + 1)) : 1
  }

  getResult(state: CourseRaceState): NormalizedResult {
    const total = this.distance(state)
    const placements = this.order(state)
    const ranks: Record<PlayerId, number> = {}
    const stats: Record<PlayerId, string> = {}
    let rank = 0
    let prevKey = ''
    placements.forEach((id, idx) => {
      const c = state.cars.get(id)
      const k = c?.finishMs != null ? `f${c.finishMs}` : `p${c?.prog ?? 0}`
      if (idx > 0 && k !== prevKey) rank = idx
      ranks[id] = rank
      prevKey = k
      if (!c) stats[id] = 'DNF'
      else if (c.finishMs !== null) stats[id] = formatRaceTime(c.finishMs)
      else if (this.closed) stats[id] = `LAP ${this.lap(state, c)}`
      else stats[id] = `${Math.max(0, Math.min(99, Math.floor((c.prog / total) * 100)))}%`
    })
    return { placements, ranks, stats }
  }

  snapshot(state: CourseRaceState, now: number): CourseRaceSnapshot {
    const total = this.distance(state)
    const order = this.order(state)
    return {
      kind: this.cfg.kind,
      course: state.course,
      laps: this.cfg.laps,
      checkpoints: this.cfg.checkpoints,
      goInMs: Math.max(0, state.goAt - now),
      cars: order.map((id, i) => {
        const c = state.cars.get(id) as Car
        return {
          id,
          x: Math.round(c.x * 10) / 10,
          y: Math.round(c.y * 10) / 10,
          a: Math.round(c.a * 1000) / 1000,
          progress: Math.max(0, Math.min(1, c.prog / total)),
          lap: this.lap(state, c),
          pos: i + 1,
          finishMs: c.finishMs,
          off: c.off,
          hits: c.hits,
          resets: c.resets,
          checkpoint: c.checkpoint,
          splitMs: c.splitMs,
          draft: c.draft,
          boost: now < c.boostUntil,
          gone: c.gone,
        }
      }),
      remainingMs: Math.max(0, state.endsAt - now),
      closing: state.closing,
    }
  }
}

export class RallyStage extends CourseRace {
  constructor() {
    super('rally-stage', STAGE)
  }
}

export class SpeedCircuit extends CourseRace {
  constructor() {
    super('speed-circuit', CIRCUIT)
  }
}
