// Micro Race wire shapes + the shared track set. A real-time FFA top-down racer in the Micro Machines
// mould: tiny cars lapping a circuit laid out on a tabletop (kitchen table, desk mat, pool table). The
// server owns the car physics, lap counting and race order; the client renders the circuit from the same
// track definition (so only the track index goes on the wire) and draws every car from the snapshot.
//
// World units: the tabletop is MICRO_RACE_WORLD.w × .h; the course is a closed Catmull-Rom spline through
// each track's control points, driven in increasing-sample order, with the start/finish line at sample 0.

export const MICRO_RACE_WORLD = { w: 1200, h: 800 } as const

export type MicroRaceTheme = 'kitchen' | 'desk' | 'pool'

export interface MicroRaceTrackDef {
  readonly theme: MicroRaceTheme
  // Road half-width (world units).
  readonly halfWidth: number
  // Closed loop of control points (the spline returns to the first one).
  readonly points: readonly (readonly [number, number])[]
}

// Every layout keeps non-adjacent stretches of road well apart (no crossings, no shortcuts through a
// shared verge) — microRace.test.ts checks the clearance, turn radii and table bounds.
export const MICRO_RACE_TRACKS: readonly MicroRaceTrackDef[] = [
  {
    theme: 'kitchen',
    halfWidth: 46,
    points: [
      [620, 130],
      [930, 150],
      [1070, 260],
      [1040, 420],
      [890, 470],
      [890, 590],
      [950, 660],
      [880, 700],
      [720, 690],
      [520, 560],
      [330, 680],
      [140, 600],
      [130, 330],
      [300, 150],
    ],
  },
  {
    theme: 'desk',
    halfWidth: 46,
    points: [
      [430, 124],
      [560, 120],
      [700, 250],
      [850, 130],
      [1060, 170],
      [1080, 420],
      [940, 530],
      [1040, 640],
      [990, 700],
      [720, 700],
      [520, 580],
      [300, 690],
      [120, 560],
      [260, 400],
      [120, 250],
      [260, 130],
    ],
  },
  {
    theme: 'pool',
    halfWidth: 46,
    points: [
      [660, 140],
      [1000, 140],
      [1080, 250],
      [960, 320],
      [720, 330],
      [680, 450],
      [960, 480],
      [1080, 580],
      [980, 690],
      [320, 690],
      [130, 560],
      [130, 270],
      [320, 140],
    ],
  },
]

export interface MicroRacePoint {
  x: number
  y: number
}

// Uniform closed Catmull-Rom through the control points, resampled every `spacing` world units by arc
// length. Pure and deterministic — the server and the client derive the exact same polyline from a def.
export function sampleMicroRaceTrack(def: MicroRaceTrackDef, spacing = 8): MicroRacePoint[] {
  return sampleSpline(def.points, spacing, true)
}

// Catmull-Rom through `pts` (closed loop, or an open road whose ends are held), resampled every
// `spacing` world units by arc length. Shared by every top-down racer's course.
export function sampleSpline(
  pts: readonly (readonly [number, number])[],
  spacing: number,
  closed: boolean,
): MicroRacePoint[] {
  const n = pts.length
  const at = (i: number): readonly [number, number] =>
    (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]) as readonly [
      number,
      number,
    ]
  const dense: MicroRacePoint[] = []
  const STEPS = 48
  const segments = closed ? n : n - 1
  for (let i = 0; i < segments; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    for (let s = 0; s < STEPS; s++) {
      const t = s / STEPS
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number): number =>
        0.5 *
        (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3)
      dense.push({ x: f(p0[0], p1[0], p2[0], p3[0]), y: f(p0[1], p1[1], p2[1], p3[1]) })
    }
  }
  if (!closed) {
    const last = pts[n - 1] as readonly [number, number]
    dense.push({ x: last[0], y: last[1] })
  }
  // Arc-length resample (a closed loop runs back onto dense[0]).
  const out: MicroRacePoint[] = [{ ...(dense[0] as MicroRacePoint) }]
  let carry = 0
  const spans = closed ? dense.length : dense.length - 1
  for (let i = 0; i < spans; i++) {
    const a = dense[i] as MicroRacePoint
    const b = dense[(i + 1) % dense.length] as MicroRacePoint
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    let d = spacing - carry
    while (d <= len) {
      const t = d / len
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      d += spacing
    }
    carry = len - (d - spacing)
  }
  if (closed) {
    // Drop a tail sample that would sit (almost) on top of the start sample.
    const first = out[0] as MicroRacePoint
    const last = out[out.length - 1] as MicroRacePoint
    if (Math.hypot(last.x - first.x, last.y - first.y) < spacing * 0.5) out.pop()
  }
  return out
}

export interface MicroRaceCar {
  id: string
  x: number
  y: number
  // Heading in radians (0 = +x, clockwise-positive on screen since y grows downward).
  a: number
  // Current lap, 1-based, clamped to [1, laps] (the grid sits just behind the line on lap 1).
  lap: number
  // Live race position, 1-based.
  pos: number
  // Race time when this car crossed the line on its final lap; null while still racing.
  finishMs: number | null
  // True while the car is off the road (slowed down) — for dust/skid cues.
  off: boolean
  // Monotonic counters so the client can fire one-shot feedback from snapshot deltas.
  hits: number
  resets: number
  // In another car's slipstream right now (a little more top speed).
  draft: boolean
  // The driver left the round: the car is a ghost that blocks no one.
  gone: boolean
  // Velocity (world units/s): clients dead-reckon every car to the present with it, and reconcile
  // their own predicted car against it.
  vx: number
  vy: number
}

export interface MicroRaceSnapshot {
  // Index into MICRO_RACE_TRACKS.
  track: number
  laps: number
  // Time until the start lights go green (0 once racing), and the race clock since then.
  goInMs: number
  raceMs: number
  cars: MicroRaceCar[]
  // Hard round clock (shrinks to the finish window once the first car finishes).
  remainingMs: number
  // True once someone has finished — the rest are racing the finish window.
  closing: boolean
}

// Drive: steer in [-1, 1] (right positive), throttle in [-1, 1] (negative = brake, then reverse). The
// server holds the last drive until the next one.
export interface MicroRaceInput {
  kind: 'drive'
  steer: number
  throttle: number
}

// --- Car physics, shared by the server and the client's own-car prediction ---------------------------
//
// The arcade car model behind every top-down racer (Micro Race, Rally Stage, Speed Circuit). It lives
// here, not in the server, so the client can run the very same integration for the car its player
// drives (it reacts on the frame a key goes down instead of a snapshot later) and only reconcile with
// the server's authoritative state. Both sides step it in RACE_STEP_S sub-steps.

// The server's sub-step: its 50 ms tick split in four. The client predicts on the same fixed step.
export const RACE_STEP_S = 0.0125

export interface RaceCarPhysics {
  maxSpeed: number
  offMaxSpeed: number
  accel: number
  brake: number
  reverseAccel: number
  maxReverse: number
  rollDrag: number
  offDrag: number
  // Bleeds speed above offMaxSpeed while off the road.
  offDecel: number
  // Lateral velocity decay rate (1/s): lower = more drift.
  grip: number
  offGrip: number
  // rad/s at full lock once rolling; below turnFullSpeed steering authority scales down linearly.
  turnRate: number
  turnFullSpeed: number
  // Above understeerFrom the steering loosens, up to highSpeedUndersteer at top speed.
  understeerFrom: number
  highSpeedUndersteer: number
}

// What the integrator reads and writes on a car.
export interface RaceCarBody {
  x: number
  y: number
  a: number
  vx: number
  vy: number
  steer: number
  throttle: number
  off: boolean
  // Set once the car took the flag: it then brakes to a stop on its own.
  finishMs: number | null
}

// Per-step tweaks a game layers on top of the base physics (a surface's grip, a slipstream, a boost).
export interface RaceCarTuning {
  grip?: number
  maxSpeedScale?: number
  accelScale?: number
}

// Micro Race's tabletop cars.
export const MICRO_RACE_CAR_R = 11
export const MICRO_RACE_PHYSICS: RaceCarPhysics = {
  maxSpeed: 250,
  offMaxSpeed: 105,
  accel: 300,
  brake: 650,
  reverseAccel: 240,
  maxReverse: 90,
  rollDrag: 0.35,
  offDrag: 1.6,
  offDecel: 520, // bleeds speed above offMaxSpeed while on the table surface
  grip: 9,
  offGrip: 5,
  turnRate: 3.6,
  turnFullSpeed: 70,
  // Above this speed steering loosens (brake for hairpins).
  understeerFrom: 160,
  highSpeedUndersteer: 0.3,
}
// Slipstream (Micro Race and Speed Circuit): a little more top speed and pull.
export const RACE_DRAFT_TUNING = { maxSpeedScale: 1.1, accelScale: 1.15 } as const
export const RACE_WALL_BOUNCE = 0.4

export const raceWrapAngle = (a: number): number => {
  let r = a
  while (r > Math.PI) r -= Math.PI * 2
  while (r < -Math.PI) r += Math.PI * 2
  return r
}

export const raceClamp1 = (v: number): number => Math.max(-1, Math.min(1, v))

// One physics sub-step of `h` seconds.
export function integrateRaceCar(
  car: RaceCarBody,
  h: number,
  p: RaceCarPhysics,
  tune: RaceCarTuning = {},
): void {
  const maxSpeed = p.maxSpeed * (tune.maxSpeedScale ?? 1)
  const accel = p.accel * (tune.accelScale ?? 1)
  const fx = Math.cos(car.a)
  const fy = Math.sin(car.a)
  let vF = car.vx * fx + car.vy * fy
  let vR = -car.vx * fy + car.vy * fx
  // Finished cars brake to a stop on their own.
  const throttle = car.finishMs !== null ? (vF > 1 ? -0.5 : 0) : car.throttle
  const steer = car.finishMs !== null ? 0 : car.steer
  if (throttle > 0) {
    // Partial throttle holds a proportionally lower cruising speed (a gentle touch = a crawl).
    if (vF < 0) vF = Math.min(0, vF + p.brake * throttle * h)
    else if (vF < maxSpeed * throttle) vF = Math.min(maxSpeed * throttle, vF + accel * h)
  } else if (throttle < 0) {
    if (vF > 0) vF = Math.max(0, vF + p.brake * throttle * h)
    else vF = Math.max(-p.maxReverse, vF + p.reverseAccel * throttle * h)
  }
  vF -= vF * (car.off ? p.offDrag : p.rollDrag) * h
  if (car.off && vF > p.offMaxSpeed) vF = Math.max(p.offMaxSpeed, vF - p.offDecel * h)
  vF = Math.min(maxSpeed, vF)
  vR *= Math.exp(-(car.off ? p.offGrip : (tune.grip ?? p.grip)) * h)
  const speed = Math.abs(vF)
  const understeer =
    1 -
    p.highSpeedUndersteer *
      Math.max(0, Math.min(1, (speed - p.understeerFrom) / (maxSpeed - p.understeerFrom)))
  const authority = Math.min(1, speed / p.turnFullSpeed) * understeer * Math.sign(vF)
  car.a = raceWrapAngle(car.a + steer * p.turnRate * authority * h)
  // Velocity keeps its old (forward, lateral) split relative to the new heading → a little slide out
  // of every turn that the grip then eats.
  const nfx = Math.cos(car.a)
  const nfy = Math.sin(car.a)
  car.vx = nfx * vF - nfy * vR
  car.vy = nfy * vF + nfx * vR
  car.x += car.vx * h
  car.y += car.vy * h
}

// The world edge is a hard wall.
export function raceWorldWalls(
  car: RaceCarBody,
  w: number,
  h: number,
  carR: number,
  bounce: number,
): void {
  if (car.x < carR) {
    car.x = carR
    car.vx = Math.abs(car.vx) * bounce
  } else if (car.x > w - carR) {
    car.x = w - carR
    car.vx = -Math.abs(car.vx) * bounce
  }
  if (car.y < carR) {
    car.y = carR
    car.vy = Math.abs(car.vy) * bounce
  } else if (car.y > h - carR) {
    car.y = h - carR
    car.vy = -Math.abs(car.vy) * bounce
  }
}
