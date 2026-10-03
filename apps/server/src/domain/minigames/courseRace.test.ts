import { describe, expect, test } from 'bun:test'
import { type CourseDef, RALLY_STAGES, SPEED_CIRCUITS, inStretch, sampleCourse } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { type CourseRaceState, GO_DELAY_MS, RallyStage, SpeedCircuit } from './courseRace'
import { wrapAngle } from './raceCore'

type Game = RallyStage | SpeedCircuit
const init = (game: Game, players: string[], seed = 3): CourseRaceState =>
  game.init({ players, seed, random: new SeededRandom(seed), now: 0, config: {} })
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
})
