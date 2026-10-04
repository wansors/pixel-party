import {
  type MicroRacePoint,
  RACE_STEP_S,
  RACE_WALL_BOUNCE,
  type RaceCarBody,
  type RaceCarPhysics,
  type RaceCarTuning,
  integrateRaceCar,
  raceWorldWalls,
  raceWrapAngle,
} from '@pp/shared'

// Netcode for the top-down racers (Micro Race, Rally Stage, Speed Circuit), framework-free like
// netcode/SnapshotInterpolator:
//  - OwnCar: the car you drive runs the server's own integrator (@pp/shared) locally, so it turns the
//    frame a key goes down; each snapshot is compared with what was predicted for that moment and the
//    difference folded in (smoothed on screen; a rescue or a big miss snaps).
//  - RivalCars: everyone else dead-reckoned from position + velocity + turn rate to the server's
//    present (not ~100–250 ms behind as an interpolation buffer draws them), so contact, slipstream and
//    "who's ahead" line up with your own predicted car.
//  - RoadIndex: the nearest centreline sample, searched in a window (off-road, wrong way).

export interface NetCar {
  id: string
  x: number
  y: number
  a: number
  vx: number
  vy: number
}

export interface CarPose {
  x: number
  y: number
  a: number
}

const MAX_EXTRAPOLATE_MS = 250
const RIVAL_TAU_MS = 90
const OWN_TAU_MS = 110
// A correction bigger than this (world units) is a rescue or a respawn: snapped, not smoothed.
const TELEPORT = 80
// Cap on the turn rate a rival is extrapolated with (rad/s).
const MAX_TURN = 4
const HISTORY = 256
const FIELDS = 6

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

// --- Rivals: dead reckoning ---------------------------------------------------------------------------

interface RivalTrack {
  x: number
  y: number
  a: number
  vx: number
  vy: number
  // Turn rate between the last two snapshots (rad/s).
  w: number
  // Client time at which this state was the server's present.
  at: number
  ox: number
  oy: number
  oa: number
  pose: CarPose
}

export class RivalCars {
  private readonly tracks = new Map<string, RivalTrack>()
  private readonly scratch: CarPose = { x: 0, y: 0, a: 0 }

  reset(): void {
    this.tracks.clear()
  }

  // A snapshot's cars, valid at client time `at`. Whatever is on screen keeps its place: the jump to
  // the new extrapolation becomes an offset that fades out.
  push(cars: readonly NetCar[], at: number, now: number): void {
    for (const c of cars) {
      const t = this.tracks.get(c.id)
      if (!t) {
        this.tracks.set(c.id, {
          x: c.x,
          y: c.y,
          a: c.a,
          vx: c.vx,
          vy: c.vy,
          w: 0,
          at,
          ox: 0,
          oy: 0,
          oa: 0,
          pose: { x: c.x, y: c.y, a: c.a },
        })
        continue
      }
      const before = this.predict(t, now)
      const bx = before.x + t.ox
      const by = before.y + t.oy
      const ba = before.a + t.oa
      const span = (at - t.at) / 1000
      const jumped = Math.hypot(c.x - t.x, c.y - t.y) > TELEPORT
      if (jumped) t.w = 0
      else if (span > 0.02) t.w = clamp(raceWrapAngle(c.a - t.a) / span, -MAX_TURN, MAX_TURN)
      t.x = c.x
      t.y = c.y
      t.a = c.a
      t.vx = c.vx
      t.vy = c.vy
      t.at = at
      const after = this.predict(t, now)
      t.ox = bx - after.x
      t.oy = by - after.y
      t.oa = raceWrapAngle(ba - after.a)
      if (jumped || Math.hypot(t.ox, t.oy) > TELEPORT) {
        t.ox = 0
        t.oy = 0
        t.oa = 0
      }
    }
  }

  // Where the server has the car now (no on-screen smoothing) and how fast it's going — for contact.
  state(id: string, now: number): { x: number; y: number; vx: number; vy: number } | null {
    const t = this.tracks.get(id)
    if (!t) return null
    const p = this.predict(t, now)
    const turn = p.a - t.a
    const c = Math.cos(turn)
    const s = Math.sin(turn)
    return { x: p.x, y: p.y, vx: t.vx * c - t.vy * s, vy: t.vx * s + t.vy * c }
  }

  // The car's on-screen pose at `now`; `dt` fades the smoothing; `freeze` (the round's final
  // snapshot) stops extrapolating.
  pose(id: string, now: number, dt: number, freeze = false): CarPose | null {
    const t = this.tracks.get(id)
    if (!t) return null
    const k = Math.exp(-dt / RIVAL_TAU_MS)
    t.ox *= k
    t.oy *= k
    t.oa *= k
    if (freeze) {
      t.pose.x = t.x + t.ox
      t.pose.y = t.y + t.oy
      t.pose.a = t.a + t.oa
    } else {
      const p = this.predict(t, now)
      t.pose.x = p.x + t.ox
      t.pose.y = p.y + t.oy
      t.pose.a = p.a + t.oa
    }
    return t.pose
  }

  // Takes over a car's display from elsewhere (your own predicted car, once it has finished) without a
  // jump: the difference becomes the fading offset.
  adopt(id: string, shown: CarPose, now: number): void {
    const t = this.tracks.get(id)
    if (!t) return
    const p = this.predict(t, now)
    t.ox = shown.x - p.x
    t.oy = shown.y - p.y
    t.oa = raceWrapAngle(shown.a - p.a)
    if (Math.hypot(t.ox, t.oy) > TELEPORT) {
      t.ox = 0
      t.oy = 0
      t.oa = 0
    }
  }

  // Constant speed and turn rate from the snapshot's moment (an arc, capped at MAX_EXTRAPOLATE_MS).
  private predict(t: RivalTrack, now: number): CarPose {
    const age = clamp(now - t.at, 0, MAX_EXTRAPOLATE_MS) / 1000
    const turn = t.w * age
    const c = Math.cos(turn / 2)
    const s = Math.sin(turn / 2)
    const out = this.scratch
    out.x = t.x + (t.vx * c - t.vy * s) * age
    out.y = t.y + (t.vx * s + t.vy * c) * age
    out.a = t.a + turn
    return out
  }
}

// --- Your own car: prediction + reconciliation ----------------------------------------------------------

export interface OwnCarEnv {
  physics: RaceCarPhysics
  tuning: RaceCarTuning
  world: { readonly w: number; readonly h: number }
  carR: number
}

export class OwnCar {
  readonly body: RaceCarBody = {
    x: 0,
    y: 0,
    a: 0,
    vx: 0,
    vy: 0,
    steer: 0,
    throttle: 0,
    off: false,
    finishMs: null,
  }
  private acc = 0
  private lastAt = -1
  // Ring of [clientTime, x, y, a, vx, vy] after every frame's steps.
  private readonly hist = new Float64Array(HISTORY * FIELDS)
  private head = 0
  private count = 0
  private ox = 0
  private oy = 0
  private oa = 0
  private readonly shown: CarPose = { x: 0, y: 0, a: 0 }
  private readonly past: CarPose & { vx: number; vy: number } = { x: 0, y: 0, a: 0, vx: 0, vy: 0 }

  // Pins the car to the server's state (the grid, a rescue, a big miss) and forgets the history.
  snapTo(c: NetCar): void {
    const b = this.body
    b.x = c.x
    b.y = c.y
    b.a = c.a
    b.vx = c.vx
    b.vy = c.vy
    this.acc = 0
    this.head = 0
    this.count = 0
    this.ox = 0
    this.oy = 0
    this.oa = 0
  }

  get speed(): number {
    return Math.hypot(this.body.vx, this.body.vy)
  }

  // Keeps the car where it is this frame (on the grid before the green light): the next step()
  // starts counting from here.
  hold(now: number): void {
    this.lastAt = now
  }

  // Advances the local simulation to client time `now` (real elapsed time, not the frame's smoothed
  // delta, so it keeps pace with the server) on the server's fixed sub-step, with the drive the server
  // holds (body.steer / body.throttle) and the surface the scene measured (body.off).
  step(now: number, env: OwnCarEnv): void {
    const dtMs = this.lastAt < 0 ? 0 : Math.min(100, Math.max(0, now - this.lastAt))
    this.lastAt = now
    this.acc += dtMs / 1000
    while (this.acc >= RACE_STEP_S) {
      integrateRaceCar(this.body, RACE_STEP_S, env.physics, env.tuning)
      raceWorldWalls(this.body, env.world.w, env.world.h, env.carR, RACE_WALL_BOUNCE)
      this.acc -= RACE_STEP_S
    }
    this.record(now - this.acc * 1000)
    const k = Math.exp(-dtMs / OWN_TAU_MS)
    this.ox *= k
    this.oy *= k
    this.oa *= k
  }

  // The server's state for this car, valid at client time `at`: whatever was predicted for that moment
  // is off by the difference — fold it into the simulation (and its history), and let the screen
  // catch up smoothly.
  reconcile(c: NetCar, at: number): void {
    const h = this.historyAt(at)
    if (!h) {
      this.snapTo(c)
      return
    }
    const ex = c.x - h.x
    const ey = c.y - h.y
    if (Math.hypot(ex, ey) > TELEPORT) {
      this.snapTo(c)
      return
    }
    const ea = raceWrapAngle(c.a - h.a)
    const evx = c.vx - h.vx
    const evy = c.vy - h.vy
    const b = this.body
    b.x += ex
    b.y += ey
    b.a = raceWrapAngle(b.a + ea)
    b.vx += evx
    b.vy += evy
    for (let i = 0; i < this.count; i++) {
      const o = i * FIELDS
      this.hist[o + 1] = (this.hist[o + 1] as number) + ex
      this.hist[o + 2] = (this.hist[o + 2] as number) + ey
      this.hist[o + 3] = (this.hist[o + 3] as number) + ea
      this.hist[o + 4] = (this.hist[o + 4] as number) + evx
      this.hist[o + 5] = (this.hist[o + 5] as number) + evy
    }
    this.ox -= ex
    this.oy -= ey
    this.oa -= ea
  }

  // Bouncy contact with another car (its server-present state): your car takes the whole push-out and
  // its half of the impulse, like the server's equal-mass bump. Returns the approach speed (0 = none).
  contact(o: { x: number; y: number; vx: number; vy: number }, carR: number, rest: number): number {
    const b = this.body
    const dx = o.x - b.x
    const dy = o.y - b.y
    const d = Math.hypot(dx, dy)
    const min = carR * 2
    if (d <= 0 || d >= min) return 0
    const nx = dx / d
    const ny = dy / d
    b.x -= nx * (min - d)
    b.y -= ny * (min - d)
    const approach = b.vx * nx + b.vy * ny - (o.vx * nx + o.vy * ny)
    if (approach <= 0) return 0
    b.vx -= approach * rest * nx
    b.vy -= approach * rest * ny
    return approach
  }

  // On-screen pose: the simulation, advanced through the unfinished sub-step, plus the fading
  // correction.
  pose(): CarPose {
    const b = this.body
    this.shown.x = b.x + b.vx * this.acc + this.ox
    this.shown.y = b.y + b.vy * this.acc + this.oy
    this.shown.a = b.a + this.oa
    return this.shown
  }

  private record(t: number): void {
    const o = this.head * FIELDS
    const b = this.body
    this.hist[o] = t
    this.hist[o + 1] = b.x
    this.hist[o + 2] = b.y
    this.hist[o + 3] = b.a
    this.hist[o + 4] = b.vx
    this.hist[o + 5] = b.vy
    this.head = (this.head + 1) % HISTORY
    this.count = Math.min(HISTORY, this.count + 1)
  }

  // The predicted state at client time `t` (interpolated between frames, extrapolated a hair past the
  // newest), or null when it's older than the whole history.
  private historyAt(t: number): (CarPose & { vx: number; vy: number }) | null {
    const H = this.hist
    let newer = -1
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - 1 - i + HISTORY) % HISTORY
      const o = idx * FIELDS
      const ti = H[o] as number
      if (ti <= t) {
        const p = this.past
        if (newer < 0) {
          const dt = Math.min(0.05, (t - ti) / 1000)
          p.x = (H[o + 1] as number) + (H[o + 4] as number) * dt
          p.y = (H[o + 2] as number) + (H[o + 5] as number) * dt
          p.a = H[o + 3] as number
          p.vx = H[o + 4] as number
          p.vy = H[o + 5] as number
          return p
        }
        const n = newer * FIELDS
        const tn = H[n] as number
        const f = tn > ti ? (t - ti) / (tn - ti) : 1
        const mix = (k: number): number => (H[o + k] as number) * (1 - f) + (H[n + k] as number) * f
        p.x = mix(1)
        p.y = mix(2)
        p.a = (H[o + 3] as number) + raceWrapAngle((H[n + 3] as number) - (H[o + 3] as number)) * f
        p.vx = mix(4)
        p.vy = mix(5)
        return p
      }
      newer = idx
    }
    return null
  }
}

// --- Road index -----------------------------------------------------------------------------------------

// The nearest centreline sample to a moving car, searched in a window around the last one (a full
// search on the first call or after a jump) — cheap enough to run every frame.
export class RoadIndex {
  idx = -1
  dist = Number.POSITIVE_INFINITY

  constructor(
    private readonly samples: readonly MicroRacePoint[],
    private readonly closed: boolean,
  ) {}

  update(x: number, y: number): void {
    const n = this.samples.length
    if (n === 0) return
    if (this.idx >= 0) {
      this.search(x, y, -8, 16)
      if (this.dist < 140) return
    }
    this.search(x, y, -n, n)
  }

  // Cosine between a heading and the direction of travel at the current sample (-1 = dead wrong way).
  along(a: number): number {
    const n = this.samples.length
    if (this.idx < 0 || n < 2) return 1
    const i = this.idx
    const p = this.samples[this.closed ? (i - 1 + n) % n : Math.max(0, i - 1)] as MicroRacePoint
    const q = this.samples[this.closed ? (i + 1) % n : Math.min(n - 1, i + 1)] as MicroRacePoint
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
    return (Math.cos(a) * (q.x - p.x) + Math.sin(a) * (q.y - p.y)) / len
  }

  private search(x: number, y: number, back: number, ahead: number): void {
    const n = this.samples.length
    const full = ahead - back >= n
    let best = this.idx
    let bestD = Number.POSITIVE_INFINITY
    const from = full ? 0 : this.idx + back
    const to = full ? n - 1 : this.idx + ahead
    for (let raw = from; raw <= to; raw++) {
      if (!this.closed && (raw < 0 || raw >= n)) continue
      const i = ((raw % n) + n) % n
      const p = this.samples[i] as MicroRacePoint
      const d = (p.x - x) ** 2 + (p.y - y) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    this.idx = best
    this.dist = Math.sqrt(bestD)
  }
}

// m:ss.t race clock (the server's result format).
export function raceClock(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100)
  return `${Math.floor(tenths / 600)}:${String(Math.floor((tenths % 600) / 10)).padStart(2, '0')}.${tenths % 10}`
}
