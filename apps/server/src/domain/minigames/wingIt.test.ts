import { describe, expect, test } from 'bun:test'
import {
  WING,
  WING_PACE,
  type WingBody,
  type WingColumn,
  wingDistance,
  wingFly,
  wingSpeed,
} from '@pp/shared'
import type { Random } from '../ports/Random'
import { WingIt, type WingItState } from './wingIt'

const seeded = (): Random => {
  let s = 7
  return {
    next: () => {
      s = (s * 16807) % 2147483647
      return (s - 1) / 2147483646
    },
  }
}
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const init = (players: string[], durationMs = 60_000) =>
  new WingIt().init({ players, seed: 1, random: seeded(), now: 0, config: { durationMs } })
// Server time of `t` ms after GO.
const at = (t: number) => WING.startDelayMs + t
const fresh = (): WingBody => ({ t: 0, y: WING.startY, vy: 0 })

// A bird that steers for the next gap's center, deciding every 10 ms on the server's own rules.
function autopilot(game: WingIt, s: WingItState, id: string, untilT: number): void {
  for (let t = 0; t <= untilT; t += 10) {
    const f = nn(s.fliers.get(id))
    if (!f.alive) return
    const body = { ...f.body }
    wingFly(body, t, f.flaps)
    const ahead = wingDistance(t) + WING.birdX - WING.columnW / 2 - WING.radius
    const next = s.columns.find((c) => c.x >= ahead)
    const target = next ? next.gapY + next.gapH * 0.12 : 0.5
    if (body.y > target && body.vy >= 0) game.onInput(s, id, { kind: 'flap', at: t }, at(t))
    game.tick(s, 10, at(t) + WING.judgeMs)
  }
}

describe('Wing It flight (shared)', () => {
  test('a flap kicks you up, gravity pulls you down, the fall is capped', () => {
    const b = fresh()
    wingFly(b, 100, [0])
    expect(b.y).toBeLessThan(WING.startY)
    const c = fresh()
    wingFly(c, 3000, [])
    expect(c.vy).toBe(WING.maxFallVy)
  })

  test('the ceiling stops you without a crash', () => {
    const b = fresh()
    const flaps = Array.from({ length: 30 }, (_, i) => i * 70)
    let top = 1
    for (let t = 5; t <= 2100; t += 5) {
      expect(wingFly(b, t, flaps, [])).toBeNull()
      top = Math.min(top, b.y)
    }
    expect(top).toBe(WING.radius)
  })

  test('the same flaps give the very same flight', () => {
    const flaps = [0, 300, 650, 1000, 1240]
    const a = fresh()
    const b = fresh()
    wingFly(a, 1500, flaps)
    wingFly(b, 700, flaps)
    wingFly(b, 1500, flaps)
    expect(b).toEqual(a)
  })

  test('the scroll speeds up on an ease-in and the distance is its integral', () => {
    expect(wingDistance(0)).toBe(0)
    const T = WING_PACE.rampMs
    const firstQuarter = wingSpeed(T / 4) - wingSpeed(0)
    const lastQuarter = wingSpeed(T) - wingSpeed((3 * T) / 4)
    expect(lastQuarter).toBeGreaterThan(firstQuarter * 3)
    for (const t of [1000, 20_000, 44_000, 50_000]) {
      const slope = (wingDistance(t + 1) - wingDistance(t - 1)) / 2
      expect(slope * 1000).toBeCloseTo(wingSpeed(t), 3)
    }
  })
})

describe('WingIt', () => {
  test('the seeded course: sorted, every gap reachable, tighter further on', () => {
    const s = init(['a'])
    const cols = s.columns
    expect(cols.length).toBeGreaterThan(20)
    for (let i = 1; i < cols.length; i++) {
      const prev = nn(cols[i - 1])
      const cur = nn(cols[i])
      expect(cur.x).toBeGreaterThan(prev.x)
      expect(Math.abs(cur.gapY - prev.gapY)).toBeLessThanOrEqual(0.3 + 1e-9)
      expect(cur.gapY - cur.gapH / 2).toBeGreaterThan(0)
      expect(cur.gapY + cur.gapH / 2).toBeLessThan(1)
    }
    const first = nn(cols[0])
    const late = nn(cols[cols.length - 1])
    expect(late.gapH).toBeLessThan(first.gapH)
    expect(nn(cols[cols.length - 1]).x - nn(cols[cols.length - 2]).x).toBeLessThan(
      nn(cols[1]).x - first.x,
    )
  })

  test('without a flap you drop to the floor and are out', () => {
    const game = new WingIt()
    const s = init(['a', 'b'])
    game.tick(s, 0, at(3000) + WING.judgeMs)
    const a = nn(s.fliers.get('a'))
    expect(a.alive).toBe(false)
    const ref = fresh()
    const crash = wingFly(ref, 3000, [], [])
    expect(crash).not.toBeNull()
    expect(a.outAt).toBe(crash as number)
  })

  test('a flap counts when it was pressed, not when it arrived', () => {
    const run = (arrivalLag: number) => {
      const game = new WingIt()
      const s = init(['a'])
      game.onInput(s, 'a', { kind: 'flap', at: 200 }, at(200 + arrivalLag))
      game.tick(s, 0, at(600) + WING.judgeMs)
      return nn(s.fliers.get('a')).body
    }
    expect(run(120)).toEqual(run(0))
  })

  test('a flap older than the judging window counts at the judged edge; mashing is dropped', () => {
    const game = new WingIt()
    const s = init(['a'])
    game.tick(s, 0, at(400) + WING.judgeMs)
    game.onInput(s, 'a', { kind: 'flap', at: 100 }, at(560))
    expect(nn(s.fliers.get('a')).flaps).toEqual([400])
    game.onInput(s, 'a', { kind: 'flap', at: 430 }, at(560))
    expect(nn(s.fliers.get('a')).flaps).toEqual([400])
    game.onInput(s, 'a', { kind: 'flap', at: 9999, seq: 4 }, at(560))
    expect(nn(s.fliers.get('a')).flaps).toEqual([400, 560])
    expect(nn(s.fliers.get('a')).ack).toBe(4)
  })

  test('flaps before GO are ignored', () => {
    const game = new WingIt()
    const s = init(['a'])
    game.onInput(s, 'a', { kind: 'flap' }, 500)
    expect(nn(s.fliers.get('a')).flaps).toEqual([])
  })

  test('touching a column is out', () => {
    const game = new WingIt()
    const s = init(['a', 'b'])
    // A gap high up, right in front: falling birds hit its lower half.
    const wall: WingColumn = { id: 0, x: WING.birdX + 0.25, gapY: 0.15, gapH: 0.2 }
    s.columns = [wall]
    game.tick(s, 0, at(1500) + WING.judgeMs)
    const a = nn(s.fliers.get('a'))
    expect(a.alive).toBe(false)
    expect(wingDistance(a.outAt) + WING.birdX).toBeGreaterThan(wall.x - WING.columnW)
    const floor = wingFly(fresh(), 5000, [], [])
    expect(a.outAt).toBeLessThan(floor as number)
  })

  test('a careful bird can fly the course well into the fast part', () => {
    const game = new WingIt()
    const s = init(['a'])
    autopilot(game, s, 'a', 40_000)
    const a = nn(s.fliers.get('a'))
    expect(a.alive).toBe(true)
    expect(a.passed).toBeGreaterThan(15)
  })

  test('last bird flying wins; the rest by how long they flew; ties share', () => {
    const game = new WingIt()
    const s = init(['a', 'b', 'c'])
    autopilot(game, s, 'a', 2000)
    // b and c never flap: they hit the floor at the same moment.
    expect(nn(s.fliers.get('b')).alive).toBe(false)
    expect(game.isFinished(s, at(2000) + WING.judgeMs)).toBe(true)
    const res = game.getResult(s)
    expect(res.placements[0]).toBe('a')
    expect(res.ranks).toEqual({ a: 0, b: 1, c: 1 })
    expect(nn(res.stats).a).toBe('survivor')
    expect(nn(res.stats).b).toBe('0 cleared')
  })

  test('alone you fly until you crash or time runs out', () => {
    const game = new WingIt()
    const s = init(['solo'], 20_000)
    expect(game.isFinished(s, at(500))).toBe(false)
    game.tick(s, 0, at(4000))
    expect(game.isFinished(s, at(4000))).toBe(true)
  })

  test('a player who leaves drops out', () => {
    const game = new WingIt()
    const s = init(['a', 'b'])
    game.leave(s, 'b', at(100))
    expect(nn(s.fliers.get('b')).alive).toBe(false)
    expect(game.isFinished(s, at(100))).toBe(true)
  })

  test('the snapshot lists the columns in view and stays small', () => {
    const game = new WingIt()
    const s = init(Array.from({ length: 12 }, (_, i) => `p${i}`))
    for (const id of s.players) autopilot(game, s, id, 5000)
    const snap = game.snapshot(s, at(5000))
    expect(snap.columns.length).toBeGreaterThan(0)
    expect(snap.columns.length).toBeLessThan(8)
    expect(Object.keys(snap.fliers).length).toBe(12)
    expect(JSON.stringify(snap).length).toBeLessThan(4000)
  })
})
