import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { Sumo, type SumoState } from './sumo'

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

  test('snapshot reports every body + the ring radius', () => {
    const game = new Sumo()
    const s = init(['a', 'b'])
    const snap = game.snapshot(s, 0)
    expect(snap.ring).toBeGreaterThan(0)
    expect(snap.bodies.length).toBe(2)
    expect(snap.bodies.every((b) => typeof b.x === 'number')).toBe(true)
  })
})
