import { describe, expect, test } from 'bun:test'
import {
  MICRO_RACE_TRACKS,
  MICRO_RACE_WORLD,
  type MicroRaceTrackDef,
  sampleMicroRaceTrack,
} from '@pp/shared'
import type { Random } from '../ports/Random'
import {
  CAR_R,
  FINISH_WINDOW_MS,
  GO_DELAY_MS,
  LAPS,
  MicroRace,
  type MicroRaceState,
  formatRaceTime,
} from './microRace'

const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const done = (x: number | null): number => {
  if (x === null) throw new Error('car did not finish')
  return x
}
// First roll picks the track, the rest drive the grid shuffle.
const rng = (trackRoll: number): Random => {
  let calls = 0
  return { next: () => (calls++ === 0 ? trackRoll : 0.3) }
}
const init = (players: string[], trackRoll = 0.1): MicroRaceState =>
  new MicroRace().init({
    players,
    seed: 1,
    random: rng(trackRoll),
    now: 0,
    config: { durationMs: 90_000 },
  })

// Simple autopilot: aim a few samples ahead on the centreline, lift and brake for sharp bends.
function drive(game: MicroRace, s: MicroRaceState, pid: string, now: number): MicroRaceState {
  const car = nn(s.cars.get(pid))
  const n = s.samples.length
  const angleTo = (i: number): number => {
    const p = nn(s.samples[(car.idx + i) % n])
    let d = Math.atan2(p.y - car.y, p.x - car.x) - car.a
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    return d
  }
  const speed = Math.hypot(car.vx, car.vy)
  const throttle = Math.abs(angleTo(14)) > 0.9 && speed > 150 ? -0.6 : 1
  const steer = Math.max(-1, Math.min(1, angleTo(7) * 2.5))
  return game.onInput(s, pid, { kind: 'drive', steer, throttle }, now)
}

function run(
  game: MicroRace,
  s: MicroRaceState,
  drivers: string[],
  untilMs: number,
): { s: MicroRaceState; now: number } {
  let now = 0
  let state = s
  while (now < untilMs && !game.isFinished(state, now)) {
    for (const pid of drivers) state = drive(game, state, pid, now)
    now += 50
    state = game.tick(state, 50, now)
  }
  return { s: state, now }
}

describe('micro-race tracks', () => {
  test.each(MICRO_RACE_TRACKS.map((def, i) => [i, def] as const))(
    'track %i keeps road stretches apart, on the table and evenly sampled',
    (_i, def: MicroRaceTrackDef) => {
      const s = sampleMicroRaceTrack(def, 8)
      const n = s.length
      expect(n * 8).toBeGreaterThan(2400)
      expect(n * 8).toBeLessThan(3800)
      for (let i = 0; i < n; i++) {
        const a = nn(s[i])
        const b = nn(s[(i + 1) % n])
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(12)
        expect(a.x - def.halfWidth).toBeGreaterThan(CAR_R)
        expect(a.y - def.halfWidth).toBeGreaterThan(CAR_R)
        expect(a.x + def.halfWidth).toBeLessThan(MICRO_RACE_WORLD.w - CAR_R)
        expect(a.y + def.halfWidth).toBeLessThan(MICRO_RACE_WORLD.h - CAR_R)
        // Stretches that are far apart along the course never come within two road widths + a verge.
        for (let j = i + 1; j < n; j++) {
          if (Math.min(j - i, n - (j - i)) * 8 < 300) continue
          const c = nn(s[j])
          expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeGreaterThan(def.halfWidth * 2 + 20)
        }
      }
    },
  )
})

describe('MicroRace', () => {
  test('picks the track from the seeded roll and grids everyone behind the line', () => {
    const s = init(['a', 'b', 'c', 'd', 'e'], 0.9)
    expect(s.track).toBe(MICRO_RACE_TRACKS.length - 1)
    for (const car of s.cars.values()) {
      expect(car.prog).toBeLessThan(0)
      expect(car.off).toBe(false)
    }
    // No two grid slots overlap.
    const cars = [...s.cars.values()]
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = nn(cars[i])
        const b = nn(cars[j])
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(CAR_R * 2)
      }
    }
    const snap = new MicroRace().snapshot(s, 0)
    expect(snap.goInMs).toBe(GO_DELAY_MS)
    expect(snap.cars.every((c) => c.lap === 1)).toBe(true)
  })

  test('cars stay parked until the lights go green', () => {
    const game = new MicroRace()
    let s = init(['a'])
    const start = { ...nn(s.cars.get('a')) }
    s = game.onInput(s, 'a', { kind: 'drive', steer: 0, throttle: 1 }, 0)
    s = game.tick(s, 50, GO_DELAY_MS - 50)
    expect(nn(s.cars.get('a')).x).toBe(start.x)
    s = game.tick(s, 50, GO_DELAY_MS + 50)
    expect(Math.hypot(nn(s.cars.get('a')).vx, nn(s.cars.get('a')).vy)).toBeGreaterThan(0)
  })

  test('partial throttle cruises at a proportionally lower speed', () => {
    const game = new MicroRace()
    let s = init(['a'])
    s = game.onInput(s, 'a', { kind: 'drive', steer: 0, throttle: 0.4 }, 0)
    let now = GO_DELAY_MS
    for (let i = 0; i < 40; i++) {
      now += 50
      s = game.tick(s, 50, now)
    }
    const car = nn(s.cars.get('a'))
    const speed = Math.hypot(car.vx, car.vy)
    expect(speed).toBeGreaterThan(60)
    expect(speed).toBeLessThanOrEqual(250 * 0.4 + 0.01)
  })

  test('ignores junk and non-finite inputs, clamps the rest', () => {
    const game = new MicroRace()
    let s = init(['a'])
    for (const junk of [
      { kind: 'mash' },
      { kind: 'move', x: 0.3 },
      { kind: 'dir', dir: 'up' },
      { kind: 'drive', steer: Number.NaN, throttle: 1 },
      { kind: 'drive', steer: '1', throttle: 1 },
    ]) {
      s = game.onInput(s, 'a', junk as never, 0)
    }
    expect(nn(s.cars.get('a')).throttle).toBe(0)
    s = game.onInput(s, 'a', { kind: 'drive', steer: 5, throttle: -9 }, 0)
    expect(nn(s.cars.get('a')).steer).toBe(1)
    expect(nn(s.cars.get('a')).throttle).toBe(-1)
  })

  test.each([0.1, 0.5, 0.9])(
    'an autopilot finishes all laps well inside the cap (track roll %p)',
    (roll) => {
      const game = new MicroRace()
      const { s } = run(game, init(['a'], roll), ['a'], 90_000)
      const car = nn(s.cars.get('a'))
      expect(car.finishMs).not.toBeNull()
      // A clean race: ~12–16 s laps for a tidy line.
      expect(done(car.finishMs)).toBeGreaterThan(LAPS * 10_000)
      expect(done(car.finishMs)).toBeLessThan(LAPS * 20_000)
      expect(car.resets).toBe(0)
      const result = game.getResult(s)
      expect(result.stats?.a).toBe(formatRaceTime(done(car.finishMs)))
    },
  )

  test('the first finisher opens a finish window, then the race order ranks everyone', () => {
    const game = new MicroRace()
    // Only 'a' drives; 'b' sits on the grid.
    const { s, now } = run(game, init(['a', 'b']), ['a'], 90_000)
    expect(nn(s.cars.get('a')).finishMs).not.toBeNull()
    expect(s.closing).toBe(true)
    const finishAt = done(nn(s.cars.get('a')).finishMs) + GO_DELAY_MS
    expect(s.endsAt).toBe(finishAt + FINISH_WINDOW_MS)
    expect(game.isFinished(s, now)).toBe(true)
    const result = game.getResult(s)
    expect(result.placements).toEqual(['a', 'b'])
    expect(result.ranks).toEqual({ a: 0, b: 1 })
    expect(result.stats?.b).toBe('LAP 1')
  })

  test('cutting across the table does not count: a lost car is put back where it left the road', () => {
    const game = new MicroRace()
    let s = init(['a'])
    s = game.tick(s, 50, GO_DELAY_MS)
    const car = nn(s.cars.get('a'))
    const progBefore = car.prog
    // Teleport-like shortcut: drop the car onto a far stretch of road (half a lap ahead).
    const n = s.samples.length
    const far = nn(s.samples[Math.floor(n / 2)])
    car.x = far.x
    car.y = far.y
    let now = GO_DELAY_MS
    for (let i = 0; i < 40; i++) {
      now += 50
      s = game.tick(s, 50, now)
    }
    const after = nn(s.cars.get('a'))
    expect(after.resets).toBe(1)
    expect(Math.abs(after.prog - progBefore)).toBeLessThan(10)
  })

  test('two cars driven into each other bump apart and both register a hit', () => {
    const game = new MicroRace()
    let s = init(['a', 'b'])
    const a = nn(s.cars.get('a'))
    const b = nn(s.cars.get('b'))
    const p = nn(s.samples[40])
    a.x = p.x - 30
    a.y = p.y
    a.vx = 200
    a.vy = 0
    a.a = 0
    b.x = p.x + 30
    b.y = p.y
    b.vx = -200
    b.vy = 0
    b.a = Math.PI
    a.idx = 40
    b.idx = 40
    let now = GO_DELAY_MS
    for (let i = 0; i < 6; i++) {
      now += 50
      s = game.tick(s, 50, now)
    }
    expect(a.hits).toBeGreaterThan(0)
    expect(b.hits).toBeGreaterThan(0)
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(CAR_R * 2 - 0.01)
    expect(a.vx).toBeLessThan(0)
  })

  test('formats race times as m:ss.t', () => {
    expect(formatRaceTime(62_345)).toBe('1:02.3')
    expect(formatRaceTime(9_999)).toBe('0:09.9')
  })
})
