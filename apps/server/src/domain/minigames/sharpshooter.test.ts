import { describe, expect, test } from 'bun:test'
import {
  SHOOT,
  SHOOT_PACE,
  SHOOT_SPOTS,
  type ShootTarget,
  shootHit,
  shootNerves,
  shootSway,
  shootTargetAt,
} from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { Sharpshooter, type SharpshooterState } from './sharpshooter'

const game = new Sharpshooter()
const init = (players: string[], seed = 9): SharpshooterState =>
  game.init({
    players,
    seed,
    random: new SeededRandom(seed),
    now: 0,
    config: { durationMs: 45_000 },
  })
// Server time of `t` ms after GO.
const at = (t: number) => SHOOT.startDelayMs + t
const nn = <T>(x: T | undefined | null): T => {
  if (x === undefined || x === null) throw new Error('unexpected nullish')
  return x
}
// A moment when `tg` is fully up, and where it is then.
const aim = (tg: ShootTarget) => {
  const t = tg.at + Math.round(tg.stay / 2)
  return { t, ...nn(shootTargetAt(tg, t)) }
}
const firstOf = (s: SharpshooterState, kind: ShootTarget['kind']) =>
  nn(s.targets.find((tg) => tg.kind === kind))

describe('Sharpshooter rules (shared)', () => {
  test('a pop-up target is only hittable once fully up', () => {
    const tg: ShootTarget = { id: 1, kind: 'bandit', spot: 0, at: 1000, stay: 1000 }
    const spot = nn(SHOOT_SPOTS[0])
    expect(shootHit([tg], 1050, spot.x, spot.y)).toBeNull()
    expect(shootHit([tg], 1500, spot.x, spot.y)?.id).toBe(1)
    expect(shootHit([tg], 1500, spot.x + 0.2, spot.y)).toBeNull()
    expect(shootHit([tg], 2100, spot.x, spot.y)).toBeNull()
  })

  test('a tossed can flies an arc; the smaller target wins an overlap', () => {
    const can: ShootTarget = {
      id: 2,
      kind: 'can',
      spot: -1,
      at: 0,
      stay: 2000,
      x0: 0,
      x1: 1,
      peak: 0.5,
    }
    const mid = nn(shootTargetAt(can, 1000))
    expect(mid.x).toBeCloseTo(0.5)
    expect(mid.y).toBeLessThan(nn(shootTargetAt(can, 100)).y)
    const spot = nn(SHOOT_SPOTS[5])
    const bandit: ShootTarget = { id: 3, kind: 'bandit', spot: 5, at: 0, stay: 3000 }
    const bottle: ShootTarget = { id: 4, kind: 'bottle', spot: 5, at: 0, stay: 3000 }
    expect(shootHit([bandit, bottle], 1000, spot.x, spot.y - 0.05)?.id).toBe(4)
  })

  test('the crosshair breathes: a slow figure-eight that holding your breath shrinks', () => {
    const at0 = shootSway(0, 0, 0, 0, 1)
    const quarter = shootSway(SHOOT.breathMs / 4, 0, 0, 0, 1)
    expect(Math.abs(quarter.dx - at0.dx)).toBeGreaterThan(0.02)
    const free = Math.hypot(quarter.dx, quarter.dy)
    const held = shootSway(SHOOT.breathMs / 4, 0, 1, 0, 1)
    expect(Math.hypot(held.dx, held.dy)).toBeCloseTo(free * SHOOT.holdShare, 5)
    const gasp = shootSway(SHOOT.breathMs / 4, 0, 0, 1, 1)
    expect(Math.hypot(gasp.dx, gasp.dy)).toBeGreaterThan(free * 1.5)
    expect(shootNerves(SHOOT_PACE.rampMs)).toBeCloseTo(SHOOT_PACE.nerves[1])
    expect(shootNerves(SHOOT_PACE.rampMs / 2) - 1).toBeLessThan((SHOOT_PACE.nerves[1] - 1) / 2)
  })
})

describe('Sharpshooter', () => {
  test('one seeded schedule: every kind shows up, and it tightens as the round goes on', () => {
    const s = init(['a'])
    const t = s.targets
    expect(t.length).toBeGreaterThan(40)
    for (const kind of ['bandit', 'civilian', 'bottle', 'can'] as const)
      expect(t.some((tg) => tg.kind === kind)).toBe(true)
    expect(t.filter((tg) => tg.kind === 'can').every((tg) => tg.at >= 12_000)).toBe(true)
    const pops = t.filter((tg) => tg.kind === 'bandit')
    expect(nn(pops.at(-1)).stay).toBeLessThan(nn(pops[0]).stay)
    const early = t.filter((tg) => tg.at < 10_000).length
    const late = t.filter((tg) => tg.at >= 30_000 && tg.at < 40_000).length
    expect(late).toBeGreaterThan(early)
    // Never two targets in the same spot at once.
    for (const a of t) {
      for (const b of t) {
        if (a.id >= b.id || a.spot < 0 || a.spot !== b.spot) continue
        expect(b.at >= a.at + a.stay || a.at >= b.at + b.stay).toBe(true)
      }
    }
    expect(init(['x']).targets).toEqual(t)
  })

  test('a hit scores the target once per player; everyone can hit it', () => {
    const s = init(['a', 'b'])
    const tg = firstOf(s, 'bandit')
    const p = aim(tg)
    game.onInput(s, 'a', { kind: 'shot', x: p.x, y: p.y, at: p.t }, at(p.t))
    game.onInput(s, 'a', { kind: 'shot', x: p.x, y: p.y, at: p.t + 300 }, at(p.t + 300))
    game.onInput(s, 'b', { kind: 'shot', x: p.x, y: p.y, at: p.t }, at(p.t))
    const snap = game.snapshot(s, at(p.t + 300))
    expect(snap.players.a?.score).toBe(SHOOT.points.bandit)
    expect(snap.players.a?.shots).toBe(2)
    expect(snap.players.b?.score).toBe(SHOOT.points.bandit)
    expect(snap.holes.map((h) => h.player).sort()).toEqual(['a', 'b'])
  })

  test('shooting a civilian costs points', () => {
    const s = init(['a'])
    const p = aim(firstOf(s, 'civilian'))
    game.onInput(s, 'a', { kind: 'shot', x: p.x, y: p.y, at: p.t }, at(p.t))
    expect(game.snapshot(s, at(p.t)).players.a?.score).toBe(SHOOT.points.civilian)
  })

  test('a shot counts when it was fired, up to SHOOT.lateMs late', () => {
    const s = init(['a'])
    const tg = firstOf(s, 'bandit')
    // Fired in the target's last moment, arrives 200 ms after it dropped.
    const t = tg.at + tg.stay - SHOOT.popMs - 10
    const p = nn(shootTargetAt(tg, t))
    game.onInput(s, 'a', { kind: 'shot', x: p.x, y: p.y, at: t }, at(t + 200))
    expect(game.snapshot(s, at(t + 200)).players.a?.score).toBe(SHOOT.points.bandit)
    // A claim from long ago is clamped to the late window, when the target is gone.
    const s2 = init(['a'])
    game.onInput(s2, 'a', { kind: 'shot', x: p.x, y: p.y, at: t }, at(t + 2000))
    expect(game.snapshot(s2, at(t + 2000)).players.a?.score).toBe(0)
  })

  test('six shots, then a reload; the hammer has a cadence', () => {
    const s = init(['a'])
    let t = 2000
    for (let i = 0; i < 8; i++) {
      game.onInput(s, 'a', { kind: 'shot', x: 0.01, y: 0.01, at: t }, at(t))
      t += SHOOT.shotGapMs
    }
    const v = nn(game.snapshot(s, at(t)).players.a)
    expect(v.shots).toBe(SHOOT.ammo)
    expect(v.ammo).toBe(0)
    expect(v.reloadMs).toBeGreaterThan(0)
    // Too soon after the last shot: ignored.
    const s2 = init(['a'])
    game.onInput(s2, 'a', { kind: 'shot', x: 0.01, y: 0.01, at: 2000 }, at(2000))
    game.onInput(s2, 'a', { kind: 'shot', x: 0.01, y: 0.01, at: 2100 }, at(2100))
    expect(game.snapshot(s2, at(2100)).players.a?.shots).toBe(1)
    // After the reload the cylinder is full again.
    const after = nn(game.snapshot(s, at(t + SHOOT.reloadMs)).players.a)
    expect(after.ammo).toBe(SHOOT.ammo)
  })

  test('reloading early refills the cylinder after the reload time', () => {
    const s = init(['a'])
    game.onInput(s, 'a', { kind: 'shot', x: 0.01, y: 0.01, at: 2000 }, at(2000))
    game.onInput(s, 'a', { kind: 'reload' }, at(2100))
    expect(game.snapshot(s, at(2200)).players.a?.reloadMs).toBeGreaterThan(0)
    game.onInput(s, 'a', { kind: 'shot', x: 0.01, y: 0.01, at: 2600 }, at(2600))
    expect(game.snapshot(s, at(2600)).players.a?.shots).toBe(1)
    expect(game.snapshot(s, at(2100 + SHOOT.reloadMs)).players.a?.ammo).toBe(SHOOT.ammo)
  })

  test('shots before GO, off the scene or malformed are ignored', () => {
    const s = init(['a'])
    game.onInput(s, 'a', { kind: 'shot', x: 0.5, y: 0.5 }, 500)
    game.onInput(s, 'a', { kind: 'shot', x: 9, y: 0.5 }, at(3000))
    game.onInput(s, 'a', { kind: 'shot', x: Number.NaN, y: 0.5 }, at(3000))
    expect(game.snapshot(s, at(3000)).players.a?.shots).toBe(0)
  })

  test('most points wins; accuracy breaks a tie', () => {
    const s = init(['a', 'b', 'c'])
    const tg = firstOf(s, 'bandit')
    const p = aim(tg)
    game.onInput(s, 'a', { kind: 'shot', x: p.x, y: p.y, at: p.t }, at(p.t))
    game.onInput(s, 'b', { kind: 'shot', x: 0.01, y: 0.01, at: p.t - 300 }, at(p.t - 300))
    game.onInput(s, 'b', { kind: 'shot', x: p.x, y: p.y, at: p.t }, at(p.t))
    expect(game.isFinished(s, 45_000)).toBe(true)
    const res = game.getResult(s)
    expect(res.placements).toEqual(['a', 'b', 'c'])
    expect(res.ranks).toEqual({ a: 0, b: 1, c: 2 })
    expect(res.stats?.a).toBe('100 pts')
  })

  test('the snapshot lists only the targets around now', () => {
    const s = init(Array.from({ length: 12 }, (_, i) => `p${i}`))
    const snap = game.snapshot(s, at(20_000))
    expect(snap.targets.length).toBeGreaterThan(0)
    expect(snap.targets.length).toBeLessThan(12)
    expect(JSON.stringify(snap).length).toBeLessThan(3000)
  })
})
