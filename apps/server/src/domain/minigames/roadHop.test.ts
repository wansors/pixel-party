import { describe, expect, test } from 'bun:test'
import {
  HOP,
  HOP_CROSSED,
  HOP_DOWN,
  HOP_LEFT,
  HOP_NONE,
  HOP_PACE,
  HOP_RIGHT,
  HOP_SPLASHED,
  HOP_SQUASHED,
  HOP_UP,
  type HopLane,
  hopHazard,
  hopHome,
  hopLaneTime,
  hopLeft,
  hopNewBody,
  hopRun,
  hopStep,
} from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { RoadHop, type RoadHopState } from './roadHop'

const game = new RoadHop()
const init = (players: string[], seed = 5): RoadHopState =>
  game.init({
    players,
    seed,
    random: new SeededRandom(seed),
    now: 0,
    config: { durationMs: 60_000 },
  })
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const GO = HOP.startDelayMs

// A hand-made field: one parked car on row 1 at cells 4..5, one still log on row 7 at cells 2..5 and
// a log drifting right on row 8 — speed 0 makes the stationary ones easy to reason about.
const still = (row: number, u: number, len: number, river: boolean): HopLane => ({
  row,
  river,
  dir: 1,
  speed: 0,
  loop: HOP.cols + 13,
  things: [{ u: u + 6.5, len, kind: river ? 'log' : 'car', look: 0 }],
})
const FIELD: HopLane[] = [
  still(1, 4, 1, false),
  still(7, 2, 3, true),
  {
    row: 8,
    river: true,
    dir: 1,
    speed: 2,
    loop: HOP.cols + 13,
    things: [{ u: 2 + 6.5, len: 3, kind: 'log', look: 0 }],
  },
]

describe('Road Hop rules (shared)', () => {
  test('lane time runs faster as the round goes on (D40) and holds after the ramp', () => {
    expect(hopLaneTime(0)).toBe(0)
    const early = hopLaneTime(11_000) - hopLaneTime(10_000)
    const late = hopLaneTime(45_000) - hopLaneTime(44_000)
    expect(late).toBeGreaterThan(early * 1.4)
    const after = hopLaneTime(HOP_PACE.rampMs + 2000) - hopLaneTime(HOP_PACE.rampMs + 1000)
    expect(after).toBeCloseTo(HOP_PACE.to, 6)
  })

  test('things wrap around their loop', () => {
    const lane = nn(FIELD[2])
    const th = nn(lane.things[0])
    const a = hopLeft(lane, th, 0)
    expect(a).toBeCloseTo(2, 9)
    expect(hopLeft(lane, th, lane.loop / lane.speed)).toBeCloseTo(a, 9)
    expect(hopLeft(lane, th, 1)).toBeCloseTo(4, 9)
  })

  test('a vehicle squashes, a log carries, open water splashes', () => {
    expect(hopHazard(FIELD, 1, 4.5, 0)).toBe(HOP_SQUASHED)
    expect(hopHazard(FIELD, 1, 2.5, 0)).toBe(HOP_NONE)
    expect(hopHazard(FIELD, 7, 3.5, 0)).toBe(HOP_NONE)
    expect(hopHazard(FIELD, 7, 8.5, 0)).toBe(HOP_SPLASHED)
    expect(hopHazard(FIELD, 0, 4.5, 0)).toBe(HOP_NONE)
  })

  test('hopping into a parked car squashes you; you start over after the wait', () => {
    const b = hopNewBody(4.5, GO)
    hopStep(b, FIELD, HOP_UP, 4.5)
    expect(b).toMatchObject({ row: 1, deaths: 1, last: HOP_SQUASHED })
    expect(b.waitUntil).toBe(GO + HOP.dtMs + HOP.respawnMs)
    // Hops while out of play are ignored.
    hopStep(b, FIELD, HOP_LEFT, 4.5)
    expect(b.x).toBe(4.5)
    hopRun(b, b.waitUntil + HOP.dtMs, [], FIELD, 6.5)
    expect(b).toMatchObject({ row: 0, x: 6.5, waitUntil: 0, deaths: 1 })
  })

  test('on a log you ride it; ridden off the edge, you are swept away', () => {
    // At the round's very start, when the drifting log still sits at cells 2..5.
    const b = hopNewBody(3.5, 0)
    b.row = 7
    hopStep(b, FIELD, HOP_UP, 3.5)
    expect(b.row).toBe(8)
    expect(b.deaths).toBe(0)
    const x0 = b.x
    hopRun(b, b.t + 500, [], FIELD, 3.5)
    // Two cells a second at pace ~1: about one cell in half a second, never snapped to the grid.
    expect(b.x - x0).toBeGreaterThan(0.95)
    expect(b.x - x0).toBeLessThan(1.05)
    hopRun(b, b.t + 6000, [], FIELD, 3.5)
    expect(b).toMatchObject({ deaths: 1, last: HOP_SPLASHED })
  })

  test('solid ground snaps you back to a cell; sideways hops stay on the field', () => {
    const b = hopNewBody(0.5, GO)
    hopStep(b, FIELD, HOP_LEFT, 0.5)
    expect(b.x).toBe(0.5)
    b.row = 8
    b.x = 3.3
    hopStep(b, FIELD, HOP_DOWN, 0.5)
    expect(b.row).toBe(7)
    hopStep(b, FIELD, HOP_RIGHT, 0.5)
    expect(b.x).toBeCloseTo(4.3, 9)
    b.row = 7
    b.x = 3.7
    b.row = HOP.verge + 1
    hopStep(b, FIELD, HOP_DOWN, 0.5)
    expect(b.row).toBe(HOP.verge)
    expect(b.x).toBe(3.5)
  })

  test('reaching the far bank scores a crossing, then you start over', () => {
    const b = hopNewBody(5.5, GO)
    b.row = HOP.goal - 1
    b.x = 5.5
    hopStep(b, [], HOP_UP, 5.5)
    expect(b).toMatchObject({ row: HOP.goal, crossings: 1, last: HOP_CROSSED, best: HOP.goal })
    hopRun(b, b.waitUntil + HOP.dtMs, [], [], 5.5)
    expect(b).toMatchObject({ row: 0, best: 0, crossings: 1 })
  })

  test('starting cells spread along the pavement', () => {
    const homes = Array.from({ length: 6 }, (_, i) => hopHome(i, 6))
    expect(new Set(homes).size).toBe(6)
    for (const h of homes) expect(h % 1).toBe(0.5)
    expect(hopHome(0, 1)).toBe(5.5)
  })
})

describe('RoadHop', () => {
  test('the same seed builds the same field: five road lanes, five river lanes', () => {
    const a = init(['a'], 9)
    expect(init(['a'], 9).lanes).toEqual(a.lanes)
    expect(a.lanes.filter((l) => !l.river).map((l) => l.row)).toEqual([1, 2, 3, 4, 5])
    expect(a.lanes.filter((l) => l.river).map((l) => l.row)).toEqual([7, 8, 9, 10, 11])
    for (const lane of a.lanes) {
      // Long enough that every thing wraps fully off screen.
      expect((lane.loop - HOP.cols) / 2).toBeGreaterThanOrEqual(nn(lane.things[0]).len)
      expect(lane.things.length).toBeGreaterThan(1)
    }
    // Neighbouring lanes run opposite ways.
    expect(nn(a.lanes[0]).dir + nn(a.lanes[1]).dir).toBe(0)
  })

  test('hops before GO are ignored; a hop up from the pavement counts after it', () => {
    const s = init(['a'])
    game.onInput(s, 'a', { kind: 'hop', dir: HOP_UP, seq: 1 }, 500)
    expect(nn(s.hoppers.get('a')).moves).toEqual([])
    expect(nn(s.hoppers.get('a')).ack).toBe(1)
    game.onInput(s, 'a', { kind: 'hop', dir: HOP_DOWN, at: GO + 100, seq: 2 }, GO + 120)
    expect(nn(s.hoppers.get('a')).moves).toEqual([{ at: GO + 100, dir: HOP_DOWN }])
  })

  test('a hop counts when it was pressed, clamped to what is already judged and to now', () => {
    const s = init(['a'])
    const h = nn(s.hoppers.get('a'))
    game.tick(s, 0, GO + 1000)
    expect(h.body.t).toBe(GO + 1000 - HOP.judgeMs)
    // Pressed long ago (a slow trip): taken at the judged moment, not rewriting the past.
    game.onInput(s, 'a', { kind: 'hop', dir: HOP_RIGHT, at: GO + 10 }, GO + 1000)
    expect(h.moves[0]?.at).toBe(h.body.t)
    // From the future: taken now.
    game.onInput(s, 'a', { kind: 'hop', dir: HOP_LEFT, at: GO + 99_000 }, GO + 1300)
    expect(h.moves[1]?.at).toBe(GO + 1300)
  })

  test('mashing is dropped, junk is ignored', () => {
    const s = init(['a'])
    const h = nn(s.hoppers.get('a'))
    game.onInput(s, 'a', { kind: 'hop', dir: HOP_UP, at: GO + 100 }, GO + 110)
    game.onInput(s, 'a', { kind: 'hop', dir: HOP_UP, at: GO + 150 }, GO + 160)
    game.onInput(s, 'a', { kind: 'hop', dir: 7 }, GO + 400)
    game.onInput(s, 'a', { kind: 'hop', dir: 1.5 }, GO + 400)
    expect(h.moves).toHaveLength(1)
  })

  test('the server runs every hopper on its hops, behind real time', () => {
    const s = init(['a', 'b'])
    // A left/right shuffle on the safe pavement never dies.
    for (let i = 0; i < 6; i++)
      game.onInput(
        s,
        'a',
        { kind: 'hop', dir: i % 2 ? HOP_LEFT : HOP_RIGHT, at: GO + i * 200 },
        GO + i * 200,
      )
    game.tick(s, 0, GO + 2000)
    const a = nn(s.hoppers.get('a'))
    expect(a.body.deaths).toBe(0)
    expect(a.body.x).toBe(a.home)
    expect(a.moves).toEqual([])
  })

  test('the round runs to the bell; crossings rank first, then the run in progress, then deaths', () => {
    const s = init(['a', 'b', 'c', 'd'])
    const set = (id: string, crossings: number, best: number, deaths: number) => {
      const b = nn(s.hoppers.get(id)).body
      Object.assign(b, { crossings, best, row: best, deaths })
    }
    set('a', 2, 3, 4)
    set('b', 3, 0, 9)
    set('c', 2, 5, 1)
    set('d', 2, 5, 1)
    expect(game.isFinished(s, 30_000)).toBe(false)
    expect(game.isFinished(s, 60_000)).toBe(true)
    const res = game.getResult(s)
    expect(res.placements).toEqual(['b', 'c', 'd', 'a'])
    expect(res.ranks).toEqual({ b: 0, c: 1, d: 1, a: 3 })
    expect(res.stats).toEqual({ a: '2 crossed', b: '3 crossed', c: '2 crossed', d: '2 crossed' })
  })

  test('the snapshot carries the field, each run with its pending hops, and the clock', () => {
    const s = init(['a'])
    game.onInput(s, 'a', { kind: 'hop', dir: HOP_UP, at: GO + 50, seq: 3 }, GO + 60)
    const snap = game.snapshot(s, GO + 60)
    expect(snap.lanes).toHaveLength(10)
    expect(snap.t).toBe(GO + 60)
    expect(snap.hoppers.a).toMatchObject({ ack: 3, moves: [{ at: GO + 50, dir: HOP_UP }] })
    expect(snap.progress).toEqual({ a: 0 })
  })

  test('everyone leaving ends the round early', () => {
    const s = init(['a', 'b'])
    game.leave(s, 'a', 1000)
    expect(game.isFinished(s, 1000)).toBe(false)
    game.leave(s, 'b', 1000)
    expect(game.isFinished(s, 1000)).toBe(true)
  })
})
