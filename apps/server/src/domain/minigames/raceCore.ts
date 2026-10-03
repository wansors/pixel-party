import type { MicroRacePoint } from '@pp/shared'

// Shared top-down car racing engine behind Micro Race, Rally Stage and Speed Circuit: arcade car physics
// (throttle/brake/reverse, drift that grip eats, understeer at speed, a slowed-down surface off the road),
// car-to-car bumps, the slipstream and the road follower that turns a position into progress along a
// sampled centreline (windowed, so the race line can't jump to another stretch of road), with the
// stray-car rescue.

export interface CarPhysics {
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

export interface RaceCar {
  x: number
  y: number
  a: number
  vx: number
  vy: number
  steer: number
  throttle: number
  // Nearest centreline sample (windowed) and signed progress in samples since the start.
  idx: number
  prog: number
  off: boolean
  lostSince: number | null
  finishMs: number | null
  hits: number
  resets: number
  // The driver left the round: a ghost that rolls to a stop, races no one and blocks no one.
  gone: boolean
}

// Per-step tweaks a game layers on top of the base physics (a surface's grip, a slipstream, a boost).
export interface CarTuning {
  grip?: number
  maxSpeedScale?: number
  accelScale?: number
}

export const wrapAngle = (a: number): number => {
  let r = a
  while (r > Math.PI) r -= Math.PI * 2
  while (r < -Math.PI) r += Math.PI * 2
  return r
}

export const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v))

// One physics sub-step of `h` seconds.
export function integrateCar(car: RaceCar, h: number, p: CarPhysics, tune: CarTuning = {}): void {
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
  car.a = wrapAngle(car.a + steer * p.turnRate * authority * h)
  // Velocity keeps its old (forward, lateral) split relative to the new heading → a little slide out
  // of every turn that the grip then eats.
  const nfx = Math.cos(car.a)
  const nfy = Math.sin(car.a)
  car.vx = nfx * vF - nfy * vR
  car.vy = nfy * vF + nfx * vR
  car.x += car.vx * h
  car.y += car.vy * h
}

// Bouncy car-to-car contact (ghosts of gone drivers pass through); counts a bump on both cars above
// `hitMinSpeed`.
export function collideCars(
  a: RaceCar,
  b: RaceCar,
  carR: number,
  restitution: number,
  hitMinSpeed: number,
): void {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  const min = carR * 2
  if (a.gone || b.gone || d <= 0 || d >= min) return
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
  const imp = approach * restitution
  a.vx -= imp * nx
  a.vy -= imp * ny
  b.vx += imp * nx
  b.vy += imp * ny
  if (approach >= hitMinSpeed) {
    a.hits++
    b.hits++
  }
}

// Slipstream: right behind another (racing) car — between touching and `range` away, inside a narrow
// `cone` (radians) dead ahead, both heading the same way.
export function inSlipstream(
  car: RaceCar,
  others: readonly RaceCar[],
  carR: number,
  range: number,
  cone: number,
): boolean {
  return others.some((o) => {
    if (o === car || o.gone) return false
    const dx = o.x - car.x
    const dy = o.y - car.y
    const d = Math.hypot(dx, dy)
    if (d < carR * 2 || d > range) return false
    return (
      Math.abs(wrapAngle(Math.atan2(dy, dx) - car.a)) < cone &&
      Math.abs(wrapAngle(o.a - car.a)) < cone
    )
  })
}

// The world edge is a hard wall.
export function worldWalls(car: RaceCar, w: number, h: number, carR: number, bounce: number): void {
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

// A centreline sample plus its unit tangent (central difference; one-sided at an open road's ends).
export function pointAt(
  samples: readonly MicroRacePoint[],
  idx: number,
  closed = true,
): { x: number; y: number; tx: number; ty: number } {
  const n = samples.length
  const p = samples[idx] as MicroRacePoint
  const a = samples[closed ? (idx - 1 + n) % n : Math.max(0, idx - 1)] as MicroRacePoint
  const b = samples[closed ? (idx + 1) % n : Math.min(n - 1, idx + 1)] as MicroRacePoint
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return { x: p.x, y: p.y, tx: (b.x - a.x) / len, ty: (b.y - a.y) / len }
}

export function nearestDistance(samples: readonly MicroRacePoint[], x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY
  for (const p of samples) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

const GRID_AIR = 4 // world units of air between grid neighbours

export interface GridSpec {
  // World units between centreline samples, and from the line back to the first row.
  spacing: number
  firstBack: number
  rowGap: number
  // Each car's offset from the centreline (world units), alternately left and right.
  lateral: number
  carR: number
}

export interface GridSlot {
  x: number
  y: number
  a: number
  idx: number
  // Samples behind the start line.
  back: number
}

// A staggered two-wide grid behind the start line (sample 0 of a closed course), pointing down the road.
// Rows on a bend squeeze together on the inside, so a slot that would touch a car already placed slides
// back a sample at a time until it's clear.
export function gridSlots(
  samples: readonly MicroRacePoint[],
  count: number,
  g: GridSpec,
): GridSlot[] {
  const n = samples.length
  const slots: GridSlot[] = []
  for (let slot = 0; slot < count; slot++) {
    const lat = (slot % 2 === 0 ? -1 : 1) * g.lateral
    let back = Math.round((g.firstBack + Math.floor(slot / 2) * g.rowGap) / g.spacing)
    for (;;) {
      const idx = (((n - back) % n) + n) % n
      const { x, y, tx, ty } = pointAt(samples, idx)
      const at = { x: x - ty * lat, y: y + tx * lat, a: Math.atan2(ty, tx), idx, back }
      const clear = slots.every((o) => Math.hypot(o.x - at.x, o.y - at.y) >= g.carR * 2 + GRID_AIR)
      if (clear || back >= n / 2) {
        slots.push(at)
        break
      }
      back++
    }
  }
  return slots
}

export interface RoadFollow {
  closed: boolean
  halfWidth: number
  windowBack: number
  windowAhead: number
  // Too far from its own stretch (× halfWidth) for lostMs → put back on the road.
  lostFactor: number
  lostMs: number
}

// Once per tick: follow the road (windowed nearest sample), the surface, and the lost-car rescue.
// Progress only moves while the car is near its own stretch, so cutting across never pays.
export function followRoad(
  car: RaceCar,
  samples: readonly MicroRacePoint[],
  f: RoadFollow,
  now: number,
): void {
  const n = samples.length
  let best = car.idx
  let bestD = Number.POSITIVE_INFINITY
  for (let k = -f.windowBack; k <= f.windowAhead; k++) {
    const raw = car.idx + k
    if (!f.closed && (raw < 0 || raw >= n)) continue
    const i = ((raw % n) + n) % n
    const p = samples[i] as MicroRacePoint
    const d = Math.hypot(p.x - car.x, p.y - car.y)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  car.off = nearestDistance(samples, car.x, car.y) > f.halfWidth
  if (bestD > f.halfWidth * f.lostFactor) {
    car.lostSince ??= now
    if (now - car.lostSince >= f.lostMs) rescueCar(car, samples, f.closed)
    return
  }
  car.lostSince = null
  let delta = best - car.idx
  if (f.closed) {
    if (delta > n / 2) delta -= n
    if (delta < -n / 2) delta += n
  }
  car.prog += delta
  car.idx = best
}

// Back on the road where it left it, pointing down the road, at rest.
export function rescueCar(car: RaceCar, samples: readonly MicroRacePoint[], closed: boolean): void {
  const { x, y, tx, ty } = pointAt(samples, car.idx, closed)
  car.x = x
  car.y = y
  car.a = Math.atan2(ty, tx)
  car.vx = 0
  car.vy = 0
  car.off = false
  car.lostSince = null
  car.resets++
}

// The driver left mid-race: lift off and let go of the wheel; from now on the car is a ghost.
export function retireCar(car: RaceCar): void {
  car.gone = true
  car.steer = 0
  car.throttle = 0
}

export function formatRaceTime(ms: number): string {
  const tenths = Math.floor(ms / 100)
  const m = Math.floor(tenths / 600)
  const s = Math.floor((tenths % 600) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`
}
