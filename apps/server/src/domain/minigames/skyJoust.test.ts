import { describe, expect, test } from 'bun:test'
import {
  JOUST,
  JOUST_GROUND,
  JOUST_LEDGES,
  type JoustWorld,
  joustGroundW,
  joustNewWorld,
  joustRun,
  joustStep,
} from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { SkyJoust, type SkyJoustState } from './skyJoust'

const game = new SkyJoust()
const init = (players: string[]): SkyJoustState =>
  game.init({
    players,
    seed: 2,
    random: new SeededRandom(2),
    now: 0,
    config: { durationMs: 60_000 },
  })
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const GO = JOUST.startDelayMs
// A world of `n` riders parked in open sky, far apart (no ledge under them).
function sky(n: number): JoustWorld {
  const w = joustNewWorld(n, GO)
  w.riders.forEach((r, i) => {
    r.x = 0.04 + i * 0.5
    r.y = 0.55
    r.ground = false
  })
  return w
}

describe('Sky Joust rules (shared)', () => {
  test('the ground ledges crumble toward the walls on an ease-in (D40)', () => {
    expect(joustGroundW(GO)).toBeCloseTo(JOUST_GROUND.from, 9)
    const early = joustGroundW(GO + 10_000) - joustGroundW(GO + 20_000)
    const late = joustGroundW(GO + 30_000) - joustGroundW(GO + 40_000)
    expect(late).toBeGreaterThan(early * 2)
    expect(joustGroundW(GO + 99_000)).toBeCloseTo(JOUST_GROUND.to, 9)
  })

  test('gravity pulls you down; a flap lifts you, capped', () => {
    const w = sky(1)
    const r = nn(w.riders[0])
    joustRun(w, GO + 200, [[]])
    expect(r.vy).toBeGreaterThan(0)
    joustStep(w, [{ at: w.t, flap: true }])
    expect(r.vy).toBeLessThan(0)
    for (let k = 0; k < 6; k++) joustStep(w, [{ at: w.t, flap: true }])
    expect(r.vy).toBeGreaterThanOrEqual(-JOUST.maxRise)
  })

  test('you land on a ledge from above and fly up through it from below', () => {
    const ledge = nn(JOUST_LEDGES[2])
    const w = sky(1)
    const r = nn(w.riders[0])
    r.x = ledge.x + ledge.w / 2
    r.y = ledge.y - 0.2
    joustRun(w, GO + 1000, [[]])
    expect(r.ground).toBe(true)
    expect(r.y).toBeCloseTo(ledge.y - JOUST.radius, 9)
    const up = sky(1)
    const u = nn(up.riders[0])
    u.x = ledge.x + ledge.w / 2
    u.y = ledge.y + 0.08
    joustRun(up, GO + 400, [
      [
        { at: GO, flap: true },
        { at: GO + 120, flap: true },
      ],
    ])
    expect(u.y).toBeLessThan(ledge.y - JOUST.radius)
  })

  test('steering speeds you up to a cap, and the sky wraps around', () => {
    const w = sky(1)
    const r = nn(w.riders[0])
    r.x = JOUST.w - 0.05
    joustRun(w, GO + 1500, [[{ at: GO, steer: 1 }]])
    expect(r.vx).toBeCloseTo(JOUST.maxVx, 9)
    expect(r.face).toBe(1)
    expect(r.x).toBeLessThan(0.8)
  })

  test('the lava costs a point; you come back on a ledge, safe for a moment', () => {
    const w = sky(1)
    const r = nn(w.riders[0])
    r.score = 4
    r.x = JOUST.w / 2
    r.y = 0.95
    joustRun(w, GO + 400, [[]])
    expect(r.lava).toBe(1)
    expect(r.score).toBe(4 - JOUST.lavaCost)
    expect(r.downUntil).toBeGreaterThan(w.t)
    joustRun(w, r.downUntil + JOUST.dtMs, [[]])
    expect(r.downUntil).toBe(0)
    expect(r.ground).toBe(true)
    expect(r.safeUntil).toBeGreaterThan(w.t)
  })

  test('the higher rider unhorses the lower; a level clash bounces both apart', () => {
    const w = sky(2)
    const [a, b] = [nn(w.riders[0]), nn(w.riders[1])]
    a.x = 0.5
    b.x = 0.52
    a.y = 0.5
    b.y = 0.53
    joustStep(w, [null, null])
    expect(a.wins).toBe(1)
    expect(a.score).toBe(1)
    expect(b.losses).toBe(1)
    expect(b.downUntil).toBeGreaterThan(w.t)
    const lv = sky(2)
    const [c, d] = [nn(lv.riders[0]), nn(lv.riders[1])]
    c.x = 0.5
    d.x = 0.53
    c.y = 0.5
    d.y = 0.5
    joustStep(lv, [null, null])
    expect(c.clashes).toBe(1)
    expect(d.clashes).toBe(1)
    expect(c.vx).toBeLessThan(0)
    expect(d.vx).toBeGreaterThan(0)
    expect(c.score + d.score).toBe(0)
  })

  test('safe riders can’t be hit; without pvp nobody is', () => {
    const w = sky(2)
    const [a, b] = [nn(w.riders[0]), nn(w.riders[1])]
    Object.assign(a, { x: 0.5, y: 0.5 })
    Object.assign(b, { x: 0.52, y: 0.53, safeUntil: 1e9 })
    joustStep(w, [null, null])
    expect(b.losses).toBe(0)
    const q = sky(2)
    Object.assign(nn(q.riders[0]), { x: 0.5, y: 0.5 })
    Object.assign(nn(q.riders[1]), { x: 0.52, y: 0.53 })
    joustStep(q, [null, null], false)
    expect(nn(q.riders[1]).losses).toBe(0)
  })
})

describe('SkyJoust', () => {
  test('commands before GO are ignored; after it they count when pressed, clamped to now', () => {
    const s = init(['a', 'b'])
    game.onInput(s, 'a', { kind: 'fly', flap: true, seq: 3 }, 600)
    expect(s.cmds[0]).toEqual([])
    expect(s.acks[0]).toBe(3)
    game.onInput(s, 'a', { kind: 'fly', steer: 1, at: GO + 20 }, GO + 40)
    game.onInput(s, 'a', { kind: 'fly', flap: true, at: GO + 99_000 }, GO + 300)
    expect(s.cmds[0]).toEqual([
      { at: GO + 20, steer: 1 },
      { at: GO + 300, flap: true },
    ])
  })

  test('mashed flaps and junk are dropped', () => {
    const s = init(['a'])
    game.onInput(s, 'a', { kind: 'fly', flap: true, at: GO + 100 }, GO + 100)
    game.onInput(s, 'a', { kind: 'fly', flap: true, at: GO + 120 }, GO + 120)
    game.onInput(s, 'a', { kind: 'fly', steer: 2 }, GO + 300)
    game.onInput(s, 'a', { kind: 'fly' }, GO + 300)
    expect(s.cmds[0]).toEqual([{ at: GO + 100, flap: true }])
  })

  test('the server flies the world on everyone’s commands, behind real time', () => {
    const s = init(['a', 'b'])
    game.onInput(s, 'a', { kind: 'fly', flap: true, at: GO }, GO + 10)
    game.tick(s, 0, GO + 1000)
    expect(s.world.t).toBe(GO + 1000 - JOUST.judgeMs)
    expect(nn(s.world.riders[0]).flapAt).toBe(GO)
    expect(nn(s.world.riders[1]).flapAt).toBeLessThan(0)
    expect(s.cmds[0]).toEqual([])
  })

  test('the round runs to the bell; score ranks, fewer falls break ties', () => {
    const s = init(['a', 'b', 'c'])
    Object.assign(nn(s.world.riders[0]), { score: 7, losses: 5 })
    Object.assign(nn(s.world.riders[1]), { score: 9, losses: 9 })
    Object.assign(nn(s.world.riders[2]), { score: 7, losses: 2, lava: 1 })
    expect(game.isFinished(s, 59_000)).toBe(false)
    expect(game.isFinished(s, 60_000)).toBe(true)
    const res = game.getResult(s)
    expect(res.placements).toEqual(['b', 'c', 'a'])
    expect(res.stats).toEqual({ a: '7 pts', b: '9 pts', c: '7 pts' })
  })

  test('the snapshot carries a copy of the world, the commands, the acks and the clock', () => {
    const s = init(['a', 'b'])
    game.onInput(s, 'b', { kind: 'fly', steer: -1, at: GO + 40, seq: 5 }, GO + 50)
    const snap = game.snapshot(s, GO + 50)
    expect(snap.ids).toEqual(['a', 'b'])
    expect(snap.cmds).toEqual([[], [{ at: GO + 40, steer: -1 }]])
    expect(snap.acks).toEqual({ a: 0, b: 5 })
    joustRun(snap.world, GO + 2000, snap.cmds)
    expect(s.world.t).toBe(GO)
  })
})
