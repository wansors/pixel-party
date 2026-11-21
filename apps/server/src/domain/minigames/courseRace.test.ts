import { describe, expect, test } from 'bun:test'
import {
  COURSE_GRAVEL_TUNING,
  COURSE_PHYSICS,
  type CourseDef,
  inStretch,
  integrateRaceCar,
  RACE_TURBO,
  RALLY_DRIFT,
  RALLY_STAGES,
  type RaceCarBody,
  SPEED_CIRCUITS,
  sampleCourse,
} from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import type { Random } from '../ports/Random'
import { type CourseRaceState, GO_DELAY_MS, RallyStage, SpeedCircuit } from './courseRace'
import { nearestDistance, wrapAngle } from './raceCore'

type Game = RallyStage | SpeedCircuit
const init = (game: Game, players: string[], seed = 3): CourseRaceState =>
  game.init({ players, seed, random: new SeededRandom(seed), now: 0, config: {} })
// The first roll picks course `i` of `count`; the rest shuffle the grid.
const pick = (i: number, count: number): Random => {
  let calls = 0
  return { next: () => (calls++ === 0 ? (i + 0.5) / count : 0.3) }
}
const TWELVE = Array.from({ length: 12 }, (_, i) => `p${i}`)
const car = (s: CourseRaceState, id: string) => {
  const c = s.cars.get(id)
  if (!c) throw new Error(`no car ${id}`)
  return c
}
// A simple autopilot: aim at the centreline a few samples ahead, ease off in sharp bends.
const autopilot = (
  game: Game,
  s: CourseRaceState,
  id: string,
  now: number,
  closed: boolean,
): void => {
  const c = car(s, id)
  const n = s.samples.length
  const ahead = closed ? (c.idx + 7) % n : Math.min(n - 1, c.idx + 7)
  const p = s.samples[ahead] as { x: number; y: number }
  const diff = wrapAngle(Math.atan2(p.y - c.y, p.x - c.x) - c.a)
  game.onInput(
    s,
    id,
    {
      kind: 'drive',
      steer: Math.max(-1, Math.min(1, diff / 0.35)),
      throttle: Math.abs(diff) > 0.6 ? 0.55 : 1,
    },
    now,
  )
}
// Slip angle: the direction of travel against the car's nose (radians, signed).
const slipOf = (c: { a: number; vx: number; vy: number }): number =>
  Math.atan2(
    -c.vx * Math.sin(c.a) + c.vy * Math.cos(c.a),
    c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a),
  )
const rallyCar = (over: Partial<RaceCarBody> = {}): RaceCarBody => ({
  x: 0,
  y: 0,
  a: 0,
  vx: 230,
  vy: 0,
  steer: 0,
  throttle: 1,
  off: false,
  finishMs: null,
  ...over,
})
// `seconds` of the rally car's integration on gravel, calling `each` after every sub-step.
const slide = (
  c: RaceCarBody,
  seconds: number,
  each: (c: RaceCarBody) => void = () => {},
  tune = COURSE_GRAVEL_TUNING,
): void => {
  for (let t = 0; t < seconds - 1e-9; t += 0.0125) {
    integrateRaceCar(c, 0.0125, COURSE_PHYSICS.stage, tune)
    each(c)
  }
}
const race = (
  game: Game,
  s: CourseRaceState,
  ids: string[],
  until: number,
  closed: boolean,
): number => {
  let t = 0
  while (t < until && !game.isFinished(s, t)) {
    t += 50
    for (const id of ids) autopilot(game, s, id, t, closed)
    game.tick(s, 50, t)
  }
  return t
}

describe('course layouts', () => {
  const check = (def: CourseDef): void => {
    const s = sampleCourse(def)
    const n = s.length
    for (const p of s) {
      expect(p.x).toBeGreaterThan(def.halfWidth)
      expect(p.y).toBeGreaterThan(def.halfWidth)
      expect(p.x).toBeLessThan(def.world.w - def.halfWidth)
      expect(p.y).toBeLessThan(def.world.h - def.halfWidth)
    }
    // Non-adjacent stretches never touch (no shortcuts, roads don't merge).
    const skip = Math.ceil((def.halfWidth * 4) / 8)
    for (let i = 0; i < n; i += 3) {
      for (let j = i + skip; j < n; j += 3) {
        if (def.kind === 'circuit' && n - (j - i) < skip) continue
        const d = Math.hypot((s[i]?.x ?? 0) - (s[j]?.x ?? 0), (s[i]?.y ?? 0) - (s[j]?.y ?? 0))
        expect(d).toBeGreaterThan(def.halfWidth * 2 + 40)
      }
    }
  }
  test('rally stages stay on the map, open, with clear stretches', () => {
    for (const def of RALLY_STAGES) {
      check(def)
      const s = sampleCourse(def)
      const [a, b] = [s[0], s.at(-1)]
      expect(Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0))).toBeGreaterThan(500)
    }
  })
  test('circuits stay on the map with clear stretches; boost pads lie on the lap', () => {
    for (const def of SPEED_CIRCUITS) {
      check(def)
      const n = sampleCourse(def).length
      const pads = [...Array(n).keys()].filter((i) => inStretch(def.boosts, i, n))
      expect(pads.length).toBeGreaterThan(20)
    }
  })
})

describe('RallyStage', () => {
  const game = new RallyStage()
  test('ghosts start side by side on the line and wait for the lights', () => {
    const s = init(game, ['a', 'b', 'c'])
    for (const id of ['a', 'b', 'c']) expect(car(s, id).prog).toBe(0)
    // Spread across the road: no two ghosts share a spot, all on the tarmac.
    for (const [i, def] of RALLY_STAGES.entries()) {
      const full = game.init({
        players: TWELVE,
        seed: 1,
        random: pick(i, RALLY_STAGES.length),
        now: 0,
      })
      const cars = [...full.cars.values()]
      for (const [k, a] of cars.entries()) {
        expect(nearestDistance(full.samples, a.x, a.y)).toBeLessThan(def.halfWidth)
        for (const b of cars.slice(k + 1))
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(4)
      }
    }
    game.onInput(s, 'a', { kind: 'drive', steer: 0, throttle: 1 }, 0)
    game.tick(s, 50, GO_DELAY_MS - 50)
    expect(car(s, 'a').vx).toBe(0)
  })

  test('an autopilot drives the stage, ticks off three splits and finishes in time', () => {
    for (let seed = 1; seed <= 2; seed++) {
      const s = init(game, ['a', 'b'], seed)
      const t = race(game, s, ['a', 'b'], 70_000, false)
      const a = car(s, 'a')
      expect(a.checkpoint).toBe(3)
      expect(a.finishMs).not.toBeNull()
      expect(t).toBeLessThan(70_000)
      // Ghosts never bump.
      expect(a.hits).toBe(0)
      const result = game.getResult(s)
      expect(result.stats?.a).toMatch(/^\d:\d\d\.\d$/)
    }
  })

  test('gravel lets the car slide more than tarmac', () => {
    const s = init(game, ['a'])
    const n = s.samples.length
    const gravelIdx = [...Array(n).keys()].find((i) => inStretch(s.def.gravel, i, n)) ?? 0
    const tarmacIdx = [...Array(n).keys()].find((i) => !inStretch(s.def.gravel, i, n)) ?? 0
    const slide = (idx: number): number => {
      const c = car(s, 'a')
      const p = s.samples[idx] as { x: number; y: number }
      Object.assign(c, {
        x: p.x,
        y: p.y,
        a: 0,
        vx: 0,
        vy: 120,
        idx,
        off: false,
        throttle: 0,
        steer: 0,
      })
      game.tick(s, 50, GO_DELAY_MS + 50)
      return Math.abs(c.vy)
    }
    expect(slide(gravelIdx)).toBeGreaterThan(slide(tarmacIdx))
  })
})

describe('RallyStage drift', () => {
  const game = new RallyStage()
  test('the handbrake on gravel swings the tail out; let go, the slide straightens up', () => {
    const c = rallyCar({ steer: 1, handbrake: true })
    let peak = 0
    slide(c, 0.15, (k) => {
      peak = Math.max(peak, Math.abs(slipOf(k)))
    })
    // ~40° of slip from a short pull at speed.
    expect(peak).toBeGreaterThan(0.55)
    c.handbrake = false
    c.steer = 0
    slide(c, 0.6)
    expect(Math.abs(slipOf(c))).toBeLessThan(0.1)
    // Counter-steering catches the same slide faster than letting go of the wheel.
    const settle = (steer: number): number => {
      const k = rallyCar({ steer: 1, handbrake: true })
      slide(k, 0.15)
      Object.assign(k, { handbrake: false, steer })
      let t = 0
      while (Math.abs(slipOf(k)) > 0.1 && t < 2) {
        slide(k, 0.0125)
        t += 0.0125
      }
      return t
    }
    expect(settle(-1)).toBeLessThan(settle(0))
  })

  test('tarmac grips more than gravel: full lock opens a much smaller slip angle', () => {
    const lockSlip = (tune: typeof COURSE_GRAVEL_TUNING): number => {
      const c = rallyCar({ steer: 1 })
      slide(c, 1.5, () => {}, tune)
      return Math.abs(slipOf(c))
    }
    const tarmac = lockSlip({})
    const gravel = lockSlip(COURSE_GRAVEL_TUNING)
    expect(tarmac).toBeLessThan(RALLY_DRIFT.driftSlip)
    expect(gravel).toBeGreaterThan(RALLY_DRIFT.driftSlip)
    expect(gravel).toBeGreaterThan(tarmac * 2)
  })

  test('straightening out of a clean drift banks a boost in proportion, capped', () => {
    const kickAfter = (seconds: number): RaceCarBody => {
      const c = rallyCar({ steer: 1 })
      slide(c, seconds)
      expect(c.driftS ?? 0).toBeGreaterThan(seconds - 0.5)
      c.steer = -1
      let t = 0
      while ((c.driftS ?? 0) > 0 && t < 1) {
        slide(c, 0.0125)
        t += 0.0125
      }
      return c
    }
    const short = kickAfter(0.6).kickS ?? 0
    const long = kickAfter(4).kickS ?? 0
    expect(short).toBeGreaterThan(0)
    expect(long).toBeGreaterThan(short)
    expect(long).toBeCloseTo(RALLY_DRIFT.maxKickS, 5)
    // The boost lifts the top speed past the car's normal one.
    const c = rallyCar({ vx: COURSE_PHYSICS.stage.maxSpeed, kickS: RALLY_DRIFT.maxKickS })
    let top = 0
    slide(
      c,
      0.5,
      (k) => {
        top = Math.max(top, Math.hypot(k.vx, k.vy))
      },
      {},
    )
    expect(top).toBeGreaterThan(COURSE_PHYSICS.stage.maxSpeed * 1.05)
  })

  test('a spin, a slide scrubbed to a crawl or a trip off the road banks nothing', () => {
    // Mid-drift the car swaps ends (sliding tail first): the drift is gone.
    const spun = rallyCar({ steer: 1 })
    slide(spun, 1)
    expect(spun.driftS ?? 0).toBeGreaterThan(0.5)
    Object.assign(spun, { vx: -spun.vx, vy: -spun.vy, steer: 0 })
    expect(Math.abs(slipOf(spun))).toBeGreaterThan(RALLY_DRIFT.spinSlip)
    slide(spun, 0.0125)
    expect(spun.driftS).toBe(0)
    slide(spun, 1)
    expect(spun.kickS ?? 0).toBe(0)
    // The handbrake held through the bend: the car pivots, scrubs off its speed and banks nothing.
    const held = rallyCar({ steer: 1, handbrake: true })
    slide(held, 1.5)
    expect(Math.hypot(held.vx, held.vy)).toBeLessThan(RALLY_DRIFT.driftSpeed / 2)
    expect(held.driftS).toBe(0)
    Object.assign(held, { handbrake: false, steer: 0 })
    slide(held, 0.5)
    expect(held.kickS ?? 0).toBe(0)
    // Off the road mid-drift: the drift is gone.
    const off = rallyCar({ steer: 1 })
    slide(off, 1)
    off.off = true
    slide(off, 0.05)
    expect(off.driftS).toBe(0)
    off.off = false
    off.steer = 0
    slide(off, 1)
    expect(off.kickS ?? 0).toBe(0)
  })

  test('the stage holds the handbrake, ignores the turbo key and reports the drift', () => {
    const s = init(game, ['a'])
    const c = car(s, 'a')
    game.onInput(s, 'a', { kind: 'drive', steer: 1, throttle: 1, handbrake: true, turbo: true }, 0)
    expect(c.handbrake).toBe(true)
    expect(c.turbo).toBe(false)
    for (const handbrake of ['yes', 1, null]) {
      game.onInput(s, 'a', { kind: 'drive', steer: 1, throttle: 1, handbrake } as never, 0)
      expect(c.handbrake).toBe(false)
    }
    Object.assign(c, { turboMeter: 1, driftS: 0.42, kickS: 0.3 })
    game.onInput(s, 'a', { kind: 'drive', steer: 0, throttle: 1, turbo: true }, 0)
    for (let t = GO_DELAY_MS + 50; t <= GO_DELAY_MS + 500; t += 50) game.tick(s, 50, t)
    expect(c.turboS ?? 0).toBe(0)
    Object.assign(c, { driftS: 0.42, kickS: 0.3 })
    const snap = game.snapshot(s, GO_DELAY_MS + 500).cars[0]
    expect(snap?.driftMs).toBe(420)
    expect(snap?.kickMs).toBe(300)
    expect(snap?.turbo).toBeUndefined()
    expect(snap?.turboMs).toBeUndefined()
  })
})

describe('SpeedCircuit', () => {
  const game = new SpeedCircuit()
  test('a staggered grid behind the line; cars race two laps and bump each other', () => {
    const s = init(game, ['a', 'b', 'c', 'd'])
    expect([...s.cars.values()].every((c) => c.prog <= 0)).toBe(true)
    const t = race(game, s, ['a', 'b', 'c', 'd'], 100_000, true)
    expect(t).toBeLessThan(100_000)
    const result = game.getResult(s)
    expect(result.placements).toHaveLength(4)
    expect([...s.cars.values()].some((c) => c.finishMs !== null)).toBe(true)
  })

  test('12 grid slots are clear of each other and on the road on every circuit', () => {
    for (const [i, def] of SPEED_CIRCUITS.entries()) {
      const s = game.init({
        players: TWELVE,
        seed: 1,
        random: pick(i, SPEED_CIRCUITS.length),
        now: 0,
      })
      expect(s.course).toBe(i)
      const cars = [...s.cars.values()]
      for (const [k, a] of cars.entries()) {
        expect(a.prog).toBeLessThan(0)
        expect(nearestDistance(s.samples, a.x, a.y)).toBeLessThan(def.halfWidth - 13)
        for (const b of cars.slice(k + 1)) {
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(13 * 2 + 4)
        }
      }
    }
  })

  test('a driver who leaves becomes a ghost and stops holding the race open', () => {
    const s = init(game, ['a', 'b'])
    const [a, b] = [car(s, 'a'), car(s, 'b')]
    game.onInput(s, 'b', { kind: 'drive', steer: 0.4, throttle: 1 }, 0)
    game.leave(s, 'b')
    expect(b.gone).toBe(true)
    expect(b.throttle).toBe(0)
    // Parked on top of each other: a ghost neither bumps nor tows.
    Object.assign(b, { x: a.x + 10, y: a.y, a: a.a })
    game.tick(s, 50, GO_DELAY_MS + 50)
    expect(a.hits + b.hits).toBe(0)
    expect(a.draft).toBe(false)
    expect(game.snapshot(s, GO_DELAY_MS + 50).cars.find((c) => c.id === 'b')?.gone).toBe(true)
    // Only 'a' still races: its finish ends the round.
    a.finishMs = 30_000
    expect(game.isFinished(s, GO_DELAY_MS + 100)).toBe(true)
  })

  test('boost pads and the slipstream raise the top speed', () => {
    const s = init(game, ['a', 'b'])
    const n = s.samples.length
    const pad = [...Array(n).keys()].find((i) => inStretch(s.def.boosts, i, n)) ?? 0
    const [a, b] = [car(s, 'a'), car(s, 'b')]
    const p = s.samples[pad] as { x: number; y: number }
    Object.assign(a, { x: p.x, y: p.y, idx: pad, prog: pad })
    Object.assign(b, { x: 50, y: 50, idx: 0, prog: 0 })
    game.tick(s, 50, GO_DELAY_MS + 50)
    expect(a.boostUntil).toBeGreaterThan(GO_DELAY_MS)
    // b tucked in right behind a, both heading the same way.
    const q = s.samples[(pad + 8) % n] as { x: number; y: number }
    Object.assign(a, { x: q.x, y: q.y, a: Math.atan2(q.y - p.y, q.x - p.x), boostUntil: 0 })
    Object.assign(b, { x: p.x, y: p.y, a: a.a })
    game.tick(s, 50, GO_DELAY_MS + 100)
    expect(b.draft).toBe(true)
    expect(a.draft).toBe(false)
  })

  test('the turbo charges as you drive, fires once full for a burst of speed, never on empty', () => {
    const s = init(game, ['a'])
    const c = car(s, 'a')
    let t = 0
    let fired = -1
    let top = 0
    while (t < GO_DELAY_MS + 12_000) {
      t += 50
      autopilot(game, s, 'a', t, true)
      game.onInput(
        s,
        'a',
        { kind: 'drive', steer: c.steer, throttle: 1, turbo: true, handbrake: true },
        t,
      )
      game.tick(s, 50, t)
      expect(c.handbrake).toBe(false)
      if (fired < 0 && (c.turboS ?? 0) > 0) fired = t
      if (fired < 0) expect(c.turboMeter ?? 0).toBeLessThan(1)
      else if (t - fired <= RACE_TURBO.burnS * 1000) top = Math.max(top, Math.hypot(c.vx, c.vy))
    }
    expect(fired - GO_DELAY_MS).toBeGreaterThan(RACE_TURBO.chargeS * 1000)
    expect(top).toBeGreaterThan(COURSE_PHYSICS.circuit.maxSpeed * 1.1)
    const snap = game.snapshot(s, t).cars[0]
    expect(snap?.turbo).toBeGreaterThanOrEqual(0)
    expect(snap?.driftMs).toBeUndefined()
  })

  test('a slipstream charges the turbo twice as fast; off the road it does not charge', () => {
    const s = init(game, ['a', 'b'])
    const [a, b] = [car(s, 'a'), car(s, 'b')]
    const n = s.samples.length
    const p = s.samples[10] as { x: number; y: number }
    const q = s.samples[18] as { x: number; y: number }
    const heading = Math.atan2(q.y - p.y, q.x - p.x)
    const v = { vx: Math.cos(heading) * 200, vy: Math.sin(heading) * 200 }
    // b leads, a tucks in behind; both cruising.
    Object.assign(b, { x: q.x, y: q.y, a: heading, idx: 18, prog: 18, ...v })
    Object.assign(a, { x: p.x, y: p.y, a: heading, idx: 10, prog: 10, ...v })
    game.tick(s, 50, GO_DELAY_MS + 50)
    expect(a.draft).toBe(true)
    expect(a.turboMeter ?? 0).toBeCloseTo(2 * (b.turboMeter ?? 0), 2)
    // Out in the fields (far from the course), the meter stays put.
    const far = { x: 30, y: 30, vx: 200, vy: 0, a: 0, idx: n - 1 }
    Object.assign(a, far)
    game.tick(s, 50, GO_DELAY_MS + 100)
    expect(a.off).toBe(true)
    Object.assign(a, far, { turboMeter: 0.5 })
    game.tick(s, 50, GO_DELAY_MS + 150)
    expect(a.turboMeter).toBe(0.5)
  })

  test('snapshots carry every car velocity and the race clock (client prediction)', () => {
    const s = init(game, ['a', 'b'])
    game.onInput(s, 'a', { kind: 'drive', steer: 0, throttle: 1 }, 0)
    for (let t = GO_DELAY_MS + 50; t <= GO_DELAY_MS + 800; t += 50) game.tick(s, 50, t)
    const snap = game.snapshot(s, GO_DELAY_MS + 800)
    expect(snap.raceMs).toBe(800)
    const a = snap.cars.find((c) => c.id === 'a')
    expect(Math.hypot(a?.vx ?? 0, a?.vy ?? 0)).toBeGreaterThan(100)
    expect(a?.vx).toBeCloseTo(car(s, 'a').vx, 0)
    expect(game.snapshot(s, 1000).raceMs).toBe(0)
  })
})
