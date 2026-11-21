import {
  COURSE_CAR_R,
  COURSE_GRAVEL_TUNING,
  COURSE_PHYSICS,
  integrateRaceCar,
  MICRO_RACE_CAR_R,
  MICRO_RACE_PHYSICS,
  MICRO_RACE_WORLD,
  RACE_STEP_S,
  RACE_TURBO,
  type RaceCarBody,
  raceTuning,
} from '@pp/shared'
import { OwnCar, RivalCars, RoadIndex, raceClock } from './raceNet'

const ENV = {
  physics: MICRO_RACE_PHYSICS,
  tuning: {},
  world: MICRO_RACE_WORLD,
  carR: MICRO_RACE_CAR_R,
}
const TURBO_ENV = {
  ...ENV,
  tuning: raceTuning(false, false),
  turbo: { draft: false, boosted: raceTuning(false, true) },
}

const parked = (x: number, y: number) => ({ id: 'me', x, y, a: 0, vx: 0, vy: 0 })

describe('OwnCar', () => {
  it('moves the frame the throttle goes down (no snapshot needed)', () => {
    const car = new OwnCar()
    car.snapTo(parked(400, 400))
    car.hold(1000)
    car.body.throttle = 1
    car.step(1016, ENV)
    car.step(1033, ENV)
    expect(car.pose().x).toBeGreaterThan(400)
    expect(car.speed).toBeGreaterThan(5)
  })

  it('folds a server correction in without a jump on screen, then catches up', () => {
    const car = new OwnCar()
    car.snapTo(parked(400, 400))
    car.hold(0)
    car.body.throttle = 1
    for (let t = 16; t <= 480; t += 16) car.step(t, ENV)
    const before = car.pose().x
    // The server had the car 10 units further along at t = 400.
    const s = { ...car.body }
    car.reconcile({ id: 'me', x: s.x + 10, y: s.y, a: s.a, vx: s.vx, vy: s.vy }, 400)
    expect(Math.abs(car.pose().x - before)).toBeLessThan(0.5)
    for (let t = 496; t <= 1200; t += 16) car.step(t, ENV)
    const free = new OwnCar()
    free.snapTo(parked(400, 400))
    free.hold(0)
    free.body.throttle = 1
    for (let t = 16; t <= 1200; t += 16) free.step(t, ENV)
    expect(car.pose().x - free.pose().x).toBeGreaterThan(9)
  })

  it('counts a correction once, even after the history ring wrapped and was reset', () => {
    const car = new OwnCar()
    car.snapTo(parked(400, 400))
    car.hold(0)
    car.body.throttle = 1
    for (let t = 16; t <= 16 * 300; t += 16) car.step(t, ENV)
    car.snapTo(parked(400, 400))
    for (let t = 16 * 301; t <= 16 * 310; t += 16) car.step(t, ENV)
    const at = 16 * 305
    const body = { ...car.body }
    // The same server report twice: the second one finds the history already corrected.
    car.reconcile({ id: 'me', x: body.x + 5, y: body.y, a: body.a, vx: body.vx, vy: body.vy }, at)
    const once = car.body.x
    car.reconcile({ id: 'me', x: body.x + 5, y: body.y, a: body.a, vx: body.vx, vy: body.vy }, at)
    expect(car.body.x).toBeCloseTo(once, 3)
  })

  it('snaps on a big miss (a rescue)', () => {
    const car = new OwnCar()
    car.snapTo(parked(400, 400))
    car.hold(0)
    car.step(16, ENV)
    car.reconcile(parked(100, 100), 16)
    expect(car.pose().x).toBeCloseTo(100, 1)
    expect(car.pose().y).toBeCloseTo(100, 1)
  })

  it('bounces off a car it runs into', () => {
    const car = new OwnCar()
    car.snapTo({ id: 'me', x: 400, y: 400, a: 0, vx: 200, vy: 0 })
    const hit = car.contact({ x: 415, y: 400, vx: 0, vy: 0 }, MICRO_RACE_CAR_R, 1.1)
    expect(hit).toBeGreaterThan(150)
    expect(car.body.vx).toBeLessThan(0)
    expect(car.body.x).toBeLessThan(400)
  })
})

describe('OwnCar turbo and drift', () => {
  const cruising = { id: 'me', x: 400, y: 400, a: 0, vx: 200, vy: 0, turbo: 1, turboMs: 0 }

  it('lights the turbo the frame the key goes down with a full meter, and goes faster', () => {
    const car = new OwnCar()
    car.snapTo(cruising)
    car.hold(1000)
    car.body.throttle = 1
    car.body.turbo = true
    car.step(1016, TURBO_ENV)
    expect(car.body.turboS ?? 0).toBeGreaterThan(RACE_TURBO.burnS - 0.05)
    expect(car.body.turboMeter).toBe(0)
    expect(car.firedAt).toBe(1016)
    for (let t = 1032; t <= 2000; t += 16) car.step(t, TURBO_ENV)
    expect(car.speed).toBeGreaterThan(MICRO_RACE_PHYSICS.maxSpeed * 1.15)
  })

  it('cannot light an empty meter', () => {
    const car = new OwnCar()
    car.snapTo({ ...cruising, turbo: 0.4 })
    car.hold(0)
    car.body.turbo = true
    car.step(16, TURBO_ENV)
    expect(car.body.turboS).toBe(0)
    expect(car.body.turboMeter ?? 0).toBeGreaterThan(0.4)
  })

  it("follows the server's meter and burn, but not right after lighting it yourself", () => {
    const car = new OwnCar()
    car.snapTo(cruising)
    car.hold(0)
    car.body.turbo = true
    car.step(16, TURBO_ENV)
    // A snapshot from before the server saw the key: still full, not lit — ignored for now.
    car.syncTurbo({ ...cruising, turbo: 1, turboMs: 0 }, 30, 100, false)
    expect(car.body.turboS ?? 0).toBeGreaterThan(0)
    // Later, the server never lit it: the prediction gives way.
    car.syncTurbo({ ...cruising, turbo: 0.6, turboMs: 0 }, 0, 800, false)
    expect(car.body.turboS).toBe(0)
    expect(car.body.turboMeter).toBeCloseTo(0.6, 5)
    // The server lit one (a snapshot 50 ms old with 900 ms left).
    car.syncTurbo({ ...cruising, turbo: 0, turboMs: 900 }, 50, 1600, false)
    expect(car.body.turboS).toBeCloseTo(0.85, 5)
  })

  it('predicts the rally drift with the very integration the server runs', () => {
    const car = new OwnCar()
    const env = {
      physics: COURSE_PHYSICS.stage,
      tuning: COURSE_GRAVEL_TUNING,
      world: { w: 2400, h: 1600 },
      carR: COURSE_CAR_R.stage,
    }
    car.snapTo({ id: 'me', x: 1200, y: 800, a: 0, vx: 230, vy: 0 })
    car.hold(0)
    Object.assign(car.body, { steer: 1, throttle: 1, handbrake: true })
    const server: RaceCarBody = { ...car.body }
    // 25 ms frames are exactly two of the server's sub-steps each.
    for (let t = 25; t <= 150; t += 25) car.step(t, env)
    for (let i = 0; i < 12; i++) integrateRaceCar(server, RACE_STEP_S, env.physics, env.tuning)
    expect(car.body.x).toBeCloseTo(server.x, 6)
    expect(car.body.a).toBeCloseTo(server.a, 6)
    expect(car.body.driftS).toBeCloseTo(server.driftS ?? 0, 6)
    // The tail is out: the body points well away from the direction of travel.
    const slip = Math.atan2(car.body.vy, car.body.vx) - car.body.a
    expect(Math.abs(slip)).toBeGreaterThan(0.4)
  })
})

describe('RivalCars', () => {
  it('extrapolates a car to the present from its velocity', () => {
    const rivals = new RivalCars()
    rivals.push([{ id: 'r', x: 0, y: 0, a: 0, vx: 100, vy: 0 }], 1000, 1000)
    const p = rivals.pose('r', 1100, 16)
    expect(p?.x).toBeCloseTo(10, 1)
    expect(rivals.pose('r', 1100, 16, true)?.x).toBeCloseTo(0, 1)
  })

  it('hides the jump to a new snapshot behind a fading offset', () => {
    const rivals = new RivalCars()
    rivals.push([{ id: 'r', x: 0, y: 0, a: 0, vx: 100, vy: 0 }], 1000, 1000)
    const shown = rivals.pose('r', 1150, 16)?.x ?? 0
    rivals.push([{ id: 'r', x: 20, y: 0, a: 0, vx: 100, vy: 0 }], 1150, 1150)
    expect(rivals.pose('r', 1150, 0)?.x).toBeCloseTo(shown, 1)
    expect(rivals.pose('r', 1650, 500)?.x ?? 0).toBeCloseTo(20 + 25, 0)
  })
})

describe('RoadIndex', () => {
  const line = Array.from({ length: 50 }, (_, i) => ({ x: i * 8, y: 0 }))
  it('finds the nearest sample and the direction of travel', () => {
    const road = new RoadIndex(line, false)
    road.update(83, 5)
    expect(road.idx).toBe(10)
    expect(road.dist).toBeCloseTo(Math.hypot(3, 5), 3)
    expect(road.along(0)).toBeCloseTo(1, 3)
    expect(road.along(Math.PI)).toBeCloseTo(-1, 3)
  })
})

describe('raceClock', () => {
  it('formats m:ss.t', () => {
    expect(raceClock(62_345)).toBe('1:02.3')
    expect(raceClock(0)).toBe('0:00.0')
  })
})
