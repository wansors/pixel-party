import { describe, expect, test } from 'bun:test'
import {
  BAR,
  BAR_DRINK,
  BAR_SLIDE,
  BAR_WALK,
  type BarArrival,
  barNewBody,
  barRun,
  barStep,
} from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { BarRush, type BarRushState, buildArrivals } from './barRush'

const game = new BarRush()
const init = (players: string[], seed = 6): BarRushState =>
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
const GO = BAR.startDelayMs
const guest = (at: number, lane: number, wants = 1, speed = 0.1): BarArrival => ({
  at,
  lane,
  wants,
  speed,
  look: 0,
})

describe('Bar Rush rules (shared)', () => {
  test('customers walk in on time at the door and walk toward your end', () => {
    const crowd = [guest(GO + 100, 2, 1, 0.2)]
    const b = barNewBody(GO)
    barRun(b, GO + 100, [], crowd)
    expect(b.customers).toHaveLength(0)
    barRun(b, GO + 1110, [], crowd)
    const c = nn(b.customers[0])
    expect(c.lane).toBe(2)
    expect(c.x).toBeCloseTo(0.2, 2)
  })

  test('you serve down the bar you’re on, no faster than the cooldown', () => {
    const b = barNewBody(GO)
    barStep(b, { at: GO, lane: 1, serve: true }, [])
    expect(b.lane).toBe(1)
    expect(b.glasses).toEqual([{ lane: 1, x: BAR.tapX - BAR.drinkSpeed * 0.01, full: true }])
    barStep(b, { at: b.t, serve: true }, [])
    expect(b.glasses).toHaveLength(1)
    barRun(b, GO + BAR.serveCooldownMs + 20, [{ at: GO + BAR.serveCooldownMs, serve: true }], [])
    expect(b.glasses).toHaveLength(2)
  })

  test('a drink is caught by the front customer: pushed back, drinks, sends the empty back', () => {
    const crowd = [guest(GO, 0, 2, 0.05), guest(GO, 0, 1, 0.02)]
    const b = barNewBody(GO)
    barRun(b, GO + 3000, [], crowd)
    const [front, back] = [nn(b.customers[0]), nn(b.customers[1])]
    expect(front.x).toBeGreaterThan(back.x)
    const xBefore = front.x
    barRun(b, GO + 3800, [{ at: GO + 3000, serve: true }], crowd)
    expect(b.served).toBe(1)
    expect(b.score).toBe(BAR.points.serve)
    expect(front.state).toBe(BAR_SLIDE)
    expect(back.state).toBe(BAR_WALK)
    barRun(b, b.t + BAR.slideMs, [], crowd)
    expect(front.state).toBe(BAR_DRINK)
    expect(front.x).toBeLessThan(xBefore)
    expect(front.x).toBeGreaterThanOrEqual(0)
    barRun(b, b.t + BAR.drinkMs, [], crowd)
    expect(b.glasses.some((g) => !g.full && g.lane === 0)).toBe(true)
    // Wanted two: walks on.
    expect(front.state).toBe(BAR_WALK)
  })

  test('an empty glass is caught at your end only if you’re on that bar', () => {
    const b = barNewBody(GO)
    b.glasses = [{ lane: 0, x: BAR.tapX - 0.01, full: false }]
    barRun(b, GO + 100, [], [])
    expect(b.caught).toBe(1)
    expect(b.score).toBe(BAR.points.catch)
    const m = barNewBody(GO)
    m.score = 5
    m.glasses = [{ lane: 3, x: BAR.tapX - 0.01, full: false }]
    barRun(m, GO + 100, [], [])
    expect(m.smashed).toBe(1)
    expect(m.score).toBe(5 + BAR.points.smash)
  })

  test('a drink nobody catches smashes at the door; a customer at your end leaves angry', () => {
    const b = barNewBody(GO)
    b.score = 10
    barRun(b, GO + 1200, [{ at: GO, serve: true }], [])
    expect(b.smashed).toBe(1)
    expect(b.score).toBe(10 + BAR.points.smash)
    const a = barNewBody(GO)
    barRun(a, GO + 4000, [], [guest(GO, 1, 1, 0.5)])
    expect(a.angry).toBe(1)
    expect(a.customers).toHaveLength(0)
    // The score never goes below zero.
    expect(a.score).toBe(0)
  })
})

describe('BarRush', () => {
  test('the seeded crowd: the same per seed, never the same bar twice running, ramping up (D40)', () => {
    const a = buildArrivals(60_000, new SeededRandom(9))
    expect(buildArrivals(60_000, new SeededRandom(9))).toEqual(a)
    for (let i = 1; i < a.length; i++) expect(nn(a[i]).lane).not.toBe(nn(a[i - 1]).lane)
    const gaps = a.slice(1).map((x, i) => x.at - nn(a[i]).at)
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
    expect(avg(gaps.slice(-6))).toBeLessThan(avg(gaps.slice(0, 6)) * 0.6)
    expect(nn(a.at(-1)).speed).toBeGreaterThan(nn(a[0]).speed * 1.4)
    for (const x of a) expect([1, 2]).toContain(x.wants)
  })

  test('commands before GO are ignored; after it they count when pressed, clamped to now', () => {
    const s = init(['a'])
    const board = nn(s.boards.get('a'))
    game.onInput(s, 'a', { kind: 'bar', serve: true, seq: 2 }, 900)
    expect(board.cmds).toEqual([])
    expect(board.ack).toBe(2)
    game.onInput(s, 'a', { kind: 'bar', lane: 2, at: GO + 30 }, GO + 50)
    game.onInput(s, 'a', { kind: 'bar', serve: true, at: GO + 99_000 }, GO + 200)
    expect(board.cmds).toEqual([
      { at: GO + 30, lane: 2 },
      { at: GO + 200, serve: true },
    ])
  })

  test('junk commands are ignored', () => {
    const s = init(['a'])
    const board = nn(s.boards.get('a'))
    game.onInput(s, 'a', { kind: 'bar', lane: 4 }, GO + 100)
    game.onInput(s, 'a', { kind: 'bar', lane: 1.5 }, GO + 100)
    game.onInput(s, 'a', { kind: 'bar' }, GO + 100)
    expect(board.cmds).toEqual([])
  })

  test('the server runs every bar on its commands, behind real time', () => {
    const s = init(['a', 'b'])
    game.onInput(s, 'a', { kind: 'bar', lane: 3, at: GO + 10 }, GO + 20)
    game.tick(s, 0, GO + 1000)
    const a = nn(s.boards.get('a'))
    expect(a.body.t).toBe(GO + 1000 - BAR.judgeMs)
    expect(a.body.lane).toBe(3)
    expect(nn(s.boards.get('b')).body.lane).toBe(0)
    expect(a.cmds).toEqual([])
  })

  test('the round runs to the bell; score ranks, fewer smashes and angry customers break ties', () => {
    const s = init(['a', 'b', 'c'])
    Object.assign(nn(s.boards.get('a')).body, { score: 30, smashed: 4 })
    Object.assign(nn(s.boards.get('b')).body, { score: 41, smashed: 9 })
    Object.assign(nn(s.boards.get('c')).body, { score: 30, smashed: 1, angry: 1 })
    expect(game.isFinished(s, 59_000)).toBe(false)
    expect(game.isFinished(s, 60_000)).toBe(true)
    const res = game.getResult(s)
    expect(res.placements).toEqual(['b', 'c', 'a'])
    expect(res.stats).toEqual({ a: '30 pts', b: '41 pts', c: '30 pts' })
  })

  test('the snapshot carries the crowd, every bar with its pending commands, and the clock', () => {
    const s = init(['a'])
    game.onInput(s, 'a', { kind: 'bar', lane: 1, at: GO + 40, seq: 4 }, GO + 50)
    const snap = game.snapshot(s, GO + 50)
    expect(snap.arrivals.length).toBeGreaterThan(15)
    expect(snap.boards.a).toMatchObject({ ack: 4, cmds: [{ at: GO + 40, lane: 1 }] })
    const view = nn(snap.boards.a)
    barRun(view.body, GO + 5000, view.cmds, snap.arrivals)
    expect(nn(s.boards.get('a')).body.t).toBe(GO)
  })
})
