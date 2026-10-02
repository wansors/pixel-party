import {
  MICRO_RACE_TRACKS,
  MICRO_RACE_WORLD,
  type MicroRaceInput,
  type MicroRacePoint,
  type MicroRaceSnapshot,
  type MicroRaceTrackDef,
  sampleMicroRaceTrack,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 90_000
export const LAPS = 3
// Start lights: three reds, then green.
export const GO_DELAY_MS = 2400
// Once the first car takes the flag, everyone else gets this long to finish.
export const FINISH_WINDOW_MS = 12_000
const SAMPLE_SPACING = 8
const SUB_STEPS = 4

// Arcade car physics (world units, seconds).
export const CAR_R = 11
const MAX_SPEED = 250
const OFF_MAX_SPEED = 105
const ACCEL = 300
const BRAKE = 650
const REVERSE_ACCEL = 240
const MAX_REVERSE = 90
const ROLL_DRAG = 0.35
const OFF_DRAG = 1.6
const OFF_DECEL = 520 // bleeds speed above OFF_MAX_SPEED while on the table surface
const GRIP = 9 // lateral velocity decay rate (1/s): lower = more drift
const OFF_GRIP = 5
const TURN_RATE = 3.6 // rad/s at full lock once rolling
const TURN_FULL_SPEED = 70 // below this speed steering authority scales down linearly
// Above this speed steering loosens (up to HIGH_SPEED_UNDERSTEER at top speed): brake for hairpins.
const UNDERSTEER_FROM = 160
const HIGH_SPEED_UNDERSTEER = 0.3
const RESTITUTION = 1.1 // >1 gives bumps a punchy, Micro Machines feel
const HIT_MIN_SPEED = 60 // approach speed that counts as a bump for feedback
const WALL_BOUNCE = 0.4
// Progress tracking: the nearest sample is searched in a window around the last one, so the race line
// can't jump to another stretch of road. A car that strays this far from its own stretch for LOST_MS
// (a cut across the table, a wild spin) is put back on the road where it left it.
const WINDOW_BACK = 6
const WINDOW_AHEAD = 10
const LOST_FACTOR = 2.2
const LOST_MS = 1500
const GRID_FIRST_BACK = 20
const GRID_ROW_GAP = 36
const GRID_LATERAL = 0.42

interface Car {
  x: number
  y: number
  a: number
  vx: number
  vy: number
  steer: number
  throttle: number
  // Nearest centreline sample (windowed) and signed progress in samples since the start line.
  idx: number
  prog: number
  off: boolean
  lostSince: number | null
  finishMs: number | null
  hits: number
  resets: number
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

const wrapAngle = (a: number): number => {
  let r = a
  while (r > Math.PI) r -= Math.PI * 2
  while (r < -Math.PI) r += Math.PI * 2
  return r
}

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v))

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
    const n = samples.length
    // Seeded grid order (Fisher–Yates), two cars per row, staggered behind the start line.
    const order = [...ctx.players]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random.next() * (i + 1))
      const tmp = order[i] as PlayerId
      order[i] = order[j] as PlayerId
      order[j] = tmp
    }
    const cars = new Map<PlayerId, Car>()
    order.forEach((pid, slot) => {
      const back = GRID_FIRST_BACK + Math.floor(slot / 2) * GRID_ROW_GAP
      const off = Math.round(back / SAMPLE_SPACING)
      const idx = (((n - off) % n) + n) % n
      const { x, y, tx, ty } = pointAt(samples, idx)
      const lat = (slot % 2 === 0 ? -1 : 1) * def.halfWidth * GRID_LATERAL
      cars.set(pid, {
        x: x - ty * lat,
        y: y + tx * lat,
        a: Math.atan2(ty, tx),
        vx: 0,
        vy: 0,
        steer: 0,
        throttle: 0,
        idx,
        prog: -off,
        off: false,
        lostSince: null,
        finishMs: null,
        hits: 0,
        resets: 0,
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
    for (let s = 0; s < SUB_STEPS; s++) {
      for (const car of cars) this.integrate(car, h)
      for (let i = 0; i < cars.length; i++) {
        for (let j = i + 1; j < cars.length; j++) collide(cars[i] as Car, cars[j] as Car)
      }
      for (const car of cars) walls(car)
    }
    const n = state.samples.length
    for (const car of cars) {
      this.track(state, car, now)
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

  private integrate(car: Car, h: number): void {
    const fx = Math.cos(car.a)
    const fy = Math.sin(car.a)
    let vF = car.vx * fx + car.vy * fy
    let vR = -car.vx * fy + car.vy * fx
    // Finished cars brake to a stop on their own.
    const throttle = car.finishMs !== null ? (vF > 1 ? -0.5 : 0) : car.throttle
    const steer = car.finishMs !== null ? 0 : car.steer
    if (throttle > 0) {
      // Partial throttle holds a proportionally lower cruising speed (a gentle touch = a crawl).
      if (vF < 0) vF = Math.min(0, vF + BRAKE * throttle * h)
      else if (vF < MAX_SPEED * throttle) vF = Math.min(MAX_SPEED * throttle, vF + ACCEL * h)
    } else if (throttle < 0) {
      if (vF > 0) vF = Math.max(0, vF + BRAKE * throttle * h)
      else vF = Math.max(-MAX_REVERSE, vF + REVERSE_ACCEL * throttle * h)
    }
    vF -= vF * (car.off ? OFF_DRAG : ROLL_DRAG) * h
    if (car.off && vF > OFF_MAX_SPEED) vF = Math.max(OFF_MAX_SPEED, vF - OFF_DECEL * h)
    vF = Math.min(MAX_SPEED, vF)
    vR *= Math.exp(-(car.off ? OFF_GRIP : GRIP) * h)
    const speed = Math.abs(vF)
    const understeer =
      1 -
      HIGH_SPEED_UNDERSTEER *
        Math.max(0, Math.min(1, (speed - UNDERSTEER_FROM) / (MAX_SPEED - UNDERSTEER_FROM)))
    const authority = Math.min(1, speed / TURN_FULL_SPEED) * understeer * Math.sign(vF)
    car.a = wrapAngle(car.a + steer * TURN_RATE * authority * h)
    // Velocity keeps its old (forward, lateral) split relative to the new heading → a little slide
    // out of every turn that the grip then eats.
    const nfx = Math.cos(car.a)
    const nfy = Math.sin(car.a)
    car.vx = nfx * vF - nfy * vR
    car.vy = nfy * vF + nfx * vR
    car.x += car.vx * h
    car.y += car.vy * h
  }

  // Once per tick: follow the road (windowed nearest sample), surface, and the lost-car rescue.
  private track(state: MicroRaceState, car: Car, now: number): void {
    const { samples, def } = state
    const n = samples.length
    let best = car.idx
    let bestD = Number.POSITIVE_INFINITY
    for (let k = -WINDOW_BACK; k <= WINDOW_AHEAD; k++) {
      const i = (((car.idx + k) % n) + n) % n
      const p = samples[i] as MicroRacePoint
      const d = Math.hypot(p.x - car.x, p.y - car.y)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    car.off = nearestDistance(samples, car.x, car.y) > def.halfWidth
    // Too far from its own stretch of road: progress freezes (the window must not chase the car
    // along the course) until it comes back — or the rescue puts it back.
    if (bestD > def.halfWidth * LOST_FACTOR) {
      car.lostSince ??= now
      if (now - car.lostSince >= LOST_MS) this.respawn(state, car)
      return
    }
    car.lostSince = null
    let delta = best - car.idx
    if (delta > n / 2) delta -= n
    if (delta < -n / 2) delta += n
    car.prog += delta
    car.idx = best
  }

  private respawn(state: MicroRaceState, car: Car): void {
    const { x, y, tx, ty } = pointAt(state.samples, car.idx)
    car.x = x
    car.y = y
    car.a = Math.atan2(ty, tx)
    car.vx = 0
    car.vy = 0
    car.off = false
    car.lostSince = null
    car.resets++
  }

  isFinished(state: MicroRaceState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((p) => state.cars.get(p)?.finishMs !== null)
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
      }
    })
    return {
      track: state.track,
      laps: LAPS,
      goInMs: Math.max(0, state.goAt - now),
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

export function formatRaceTime(ms: number): string {
  const tenths = Math.floor(ms / 100)
  const m = Math.floor(tenths / 600)
  const s = Math.floor((tenths % 600) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`
}

// A centreline sample plus its unit tangent (central difference).
function pointAt(
  samples: MicroRacePoint[],
  idx: number,
): { x: number; y: number; tx: number; ty: number } {
  const n = samples.length
  const p = samples[idx] as MicroRacePoint
  const a = samples[(idx - 1 + n) % n] as MicroRacePoint
  const b = samples[(idx + 1) % n] as MicroRacePoint
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return { x: p.x, y: p.y, tx: (b.x - a.x) / len, ty: (b.y - a.y) / len }
}

function nearestDistance(samples: MicroRacePoint[], x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY
  for (const p of samples) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

function collide(a: Car, b: Car): void {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  const min = CAR_R * 2
  if (d <= 0 || d >= min) return
  const nx = dx / d
  const ny = dy / d
  const overlap = (min - d) / 2
  a.x -= nx * overlap
  a.y -= ny * overlap
  b.x += nx * overlap
  b.y += ny * overlap
  const va = a.vx * nx + a.vy * ny
  const vb = b.vx * nx + b.vy * ny
  const approach = va - vb
  if (approach <= 0) return
  const imp = approach * RESTITUTION
  a.vx -= imp * nx
  a.vy -= imp * ny
  b.vx += imp * nx
  b.vy += imp * ny
  if (approach >= HIT_MIN_SPEED) {
    a.hits++
    b.hits++
  }
}

// The table edge is a hard wall.
function walls(car: Car): void {
  const { w, h } = MICRO_RACE_WORLD
  if (car.x < CAR_R) {
    car.x = CAR_R
    car.vx = Math.abs(car.vx) * WALL_BOUNCE
  } else if (car.x > w - CAR_R) {
    car.x = w - CAR_R
    car.vx = -Math.abs(car.vx) * WALL_BOUNCE
  }
  if (car.y < CAR_R) {
    car.y = CAR_R
    car.vy = Math.abs(car.vy) * WALL_BOUNCE
  } else if (car.y > h - CAR_R) {
    car.y = h - CAR_R
    car.vy = -Math.abs(car.vy) * WALL_BOUNCE
  }
}
