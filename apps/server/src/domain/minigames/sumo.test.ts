import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { DASH_COOLDOWN_MS, Sumo, type SumoState } from './sumo'

const zero: Random = { next: () => 0 }
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const init = (players: string[], now = 0): SumoState =>
  new Sumo().init({ players, seed: 1, random: zero, now, config: { durationMs: 30_000 } })

describe('Sumo', () => {
  test('places every player inside the ring at start', () => {
    const s = init(['a', 'b', 'c'])
    for (const pid of s.players) {
      const b = nn(s.bodies.get(pid))
      expect(Math.hypot(b.x - 0.5, b.y - 0.5)).toBeLessThan(0.42)
      expect(b.alive).toBe(true)
    }
  })

  test('a body pushed past the ring edge is eliminated', () => {
    const game = new Sumo()
    const s = init(['a', 'b'])
    const a = nn(s.bodies.get('a'))
    // Fling it hard toward the edge.
    a.x = 0.9
    a.y = 0.5
    a.vx = 0.5
    game.tick(s, 100, 100)
    expect(a.alive).toBe(false)
    expect(a.outAt).toBe(100)
  })

  test('two approaching bodies transfer momentum on contact', () => {
    const game = new Sumo()
    const s = init(['a', 'b'])
    const a = nn(s.bodies.get('a'))
    const b = nn(s.bodies.get('b'))
    // Overlapping, a moving right into b (both near centre so neither leaves the ring this step).
    a.x = 0.5
    a.y = 0.5
    a.vx = 0.4
    a.vy = 0
    a.ax = 0
    a.ay = 0
    b.x = 0.55
    b.y = 0.5
    b.vx = 0
    b.vy = 0
    b.ax = 0
    b.ay = 0
    game.tick(s, 16, 16)
    // b was shoved to the right; a slowed.
    expect(b.vx).toBeGreaterThan(0)
    expect(a.vx).toBeLessThan(0.4)
  })

  test('ends early once one or fewer players remain', () => {
    const game = new Sumo()
    const s = init(['a', 'b'])
    nn(s.bodies.get('a')).alive = false
    expect(game.isFinished(s, 1000)).toBe(true)
  })

  test('ranks by survival time, last-out above earlier-out', () => {
    const game = new Sumo()
    const s = init(['a', 'b', 'c'])
    // c survives to the end, b out at 5s, a out at 2s.
    nn(s.bodies.get('a')).alive = false
    nn(s.bodies.get('a')).outAt = 2000
    nn(s.bodies.get('b')).alive = false
    nn(s.bodies.get('b')).outAt = 5000
    const result = game.getResult(s)
    expect(result.placements[0]).toBe('c')
    expect(result.ranks?.c).toBe(0)
    expect(result.ranks?.b).toBe(1)
    expect(result.ranks?.a).toBe(2)
  })

  test('the ring holds its size, then closes in to narrower than a wrestler', () => {
    const game = new Sumo()
    const s = init(['a', 'b', 'c'])
    expect(game.ringAt(s, 0)).toBeCloseTo(0.42)
    expect(game.ringAt(s, 12_000)).toBeCloseTo(0.42)
    expect(game.ringAt(s, 21_000)).toBeLessThan(0.42)
    expect(game.ringAt(s, 30_000)).toBeLessThan(0.05)
    expect(game.snapshot(s, 21_000).ring).toBeCloseTo(game.ringAt(s, 21_000))
  })

  test('a dash knocks a bracing centre-holder out once the ring has closed in', () => {
    const game = new Sumo()
    let s = init(['holder', 'rammer', 'c'])
    const now = 19_500
    const holder = nn(s.bodies.get('holder'))
    const rammer = nn(s.bodies.get('rammer'))
    Object.assign(holder, { x: 0.5, y: 0.5, vx: 0, vy: 0 })
    Object.assign(rammer, { x: 0.38, y: 0.5, vx: 0, vy: 0 })
    nn(s.bodies.get('c')).alive = false
    // The holder leans into the rammer; the rammer dashes at it.
    s = game.onInput(s, 'holder', { kind: 'move', dx: -1, dy: 0 }, now)
    s = game.onInput(s, 'rammer', { kind: 'move', dx: 1, dy: 0 }, now)
    s = game.onInput(s, 'rammer', { kind: 'dash' }, now)
    for (let t = now; t < now + 1500 && holder.alive; t += 50) s = game.tick(s, 50, t)
    expect(holder.alive).toBe(false)
    expect(rammer.alive).toBe(true)
  })

  test('the dash recharges, and needs a direction', () => {
    const game = new Sumo()
    let s = init(['a', 'b', 'c'])
    const a = nn(s.bodies.get('a'))
    // Not steering: nowhere to dash.
    s = game.onInput(s, 'a', { kind: 'dash' }, 100)
    expect(a.dashAt).toBe(0)
    s = game.onInput(s, 'a', { kind: 'move', dx: 0, dy: 1 }, 100)
    s = game.onInput(s, 'a', { kind: 'dash' }, 100)
    expect(a.dashAt).toBe(100)
    expect(a.vy).toBeGreaterThan(1)
    expect(game.snapshot(s, 150).bodies.find((b) => b.id === 'a')?.dashing).toBe(true)
    s = game.onInput(s, 'a', { kind: 'dash' }, 100 + DASH_COOLDOWN_MS - 1)
    expect(a.dashAt).toBe(100)
    s = game.onInput(s, 'a', { kind: 'dash' }, 100 + DASH_COOLDOWN_MS)
    expect(a.dashAt).toBe(100 + DASH_COOLDOWN_MS)
  })

  test('three centre-huggers cannot all sit it out to the bell', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const game = new Sumo()
      let s = new Sumo().init({
        players: ['a', 'b', 'c'],
        seed,
        random: { next: () => seed / 7 },
        now: 0,
        config: { durationMs: 30_000 },
      })
      let now = 0
      for (; now <= 30_000 && !game.isFinished(s, now); now += 50) {
        for (const pid of s.players) {
          const b = nn(s.bodies.get(pid))
          s = game.onInput(s, pid, { kind: 'move', dx: 0.5 - b.x, dy: 0.5 - b.y }, now)
        }
        s = game.tick(s, 50, now)
      }
      expect(s.players.filter((p) => s.bodies.get(p)?.alive).length).toBeLessThanOrEqual(1)
    }
  })

  test('a player who leaves steps out of the ring', () => {
    const game = new Sumo()
    let s = init(['a', 'b', 'c'])
    s = game.leave(s, 'a', 4000)
    expect(nn(s.bodies.get('a')).alive).toBe(false)
    expect(nn(s.bodies.get('a')).outAt).toBe(4000)
    expect(game.isFinished(s, 4000)).toBe(false)
    s = game.leave(s, 'b', 5000)
    expect(game.isFinished(s, 5000)).toBe(true)
    expect(game.getResult(s).placements[0]).toBe('c')
  })

  test('snapshot reports every body + the ring radius', () => {
    const game = new Sumo()
    const s = init(['a', 'b'])
    const snap = game.snapshot(s, 0)
    expect(snap.ring).toBeGreaterThan(0)
    expect(snap.bodies.length).toBe(2)
    expect(snap.bodies.every((b) => typeof b.x === 'number')).toBe(true)
  })
})

describe('Sumo wire (the client predicts from it)', () => {
  test('a dash is acknowledged by seq even when the cooldown refuses it', () => {
    const game = new Sumo()
    let s = new Sumo().init({ players: ['a', 'b'], seed: 1, random: { next: () => 0 }, now: 0 })
    s = game.onInput(s, 'a', { kind: 'move', dx: 1, dy: 0 }, 50)
    s = game.onInput(s, 'a', { kind: 'dash', seq: 1 }, 100)
    s = game.onInput(s, 'a', { kind: 'dash', seq: 2 }, 200)
    const body = game.snapshot(s, 200).bodies.find((b) => b.id === 'a')
    expect(body?.dash).toBe(2)
    expect(s.bodies.get('a')?.dashAt).toBe(100)
  })

  test('the snapshot carries velocity and push so the client can step the same physics', () => {
    const game = new Sumo()
    let s = game.init({ players: ['a', 'b'], seed: 1, random: { next: () => 0 }, now: 0 })
    s = game.onInput(s, 'a', { kind: 'move', dx: 0, dy: -3 }, 10)
    s = game.tick(s, 50, 50)
    const a = game.snapshot(s, 50).bodies.find((b) => b.id === 'a')
    expect(a?.ax).toBe(0)
    expect(a?.ay).toBe(-1)
    expect(a?.vy).toBeLessThan(0)
    // Rounded for the wire: no long float tails.
    expect(String(a?.x).length).toBeLessThanOrEqual(6)
  })
})
