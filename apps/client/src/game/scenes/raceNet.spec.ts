import { MICRO_RACE_CAR_R, MICRO_RACE_PHYSICS, MICRO_RACE_WORLD } from '@pp/shared'
import { OwnCar, RivalCars, RoadIndex, raceClock } from './raceNet'

const ENV = {
  physics: MICRO_RACE_PHYSICS,
  tuning: {},
  world: MICRO_RACE_WORLD,
  carR: MICRO_RACE_CAR_R,
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
