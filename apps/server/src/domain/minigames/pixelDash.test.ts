import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { PixelDash } from './pixelDash'

// Deterministic RNG: next()=0.5 → every obstacle gap is FIRST/700+300 spacing, reproducible.
const half: Random = { next: () => 0.5 }
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const init = (players: string[], now = 0) =>
  new PixelDash().init({ players, seed: 1, random: half, now, config: { durationMs: 40_000 } })

describe('PixelDash', () => {
  test('builds a seeded obstacle track (deterministic from the Random port)', () => {
    const a = init(['p'])
    const b = init(['p'])
    expect(a.obstacles.length).toBeGreaterThan(0)
    expect(a.obstacles.map((o) => o.arriveAt)).toEqual(b.obstacles.map((o) => o.arriveAt))
    // First obstacle arrives ~1500ms in; gaps are positive and increasing.
    expect(nn(a.obstacles[0]).arriveAt).toBe(1500)
    expect(nn(a.obstacles[1]).arriveAt).toBeGreaterThan(nn(a.obstacles[0]).arriveAt)
  })

  test('a jump within TOL of an obstacle arrival clears it (score 1)', () => {
    const game = new PixelDash()
    let s = init(['p'])
    const o = nn(s.obstacles[0])
    s = game.onInput(s, 'p', { kind: 'jump' }, s.startedAt + o.arriveAt)
    expect(s.cleared.get('p')?.size).toBe(1)
    expect(s.stumbles.get('p')).toBe(0)
  })

  test('a jump with nothing in the window is a stumble (wasted jump)', () => {
    const game = new PixelDash()
    let s = init(['p'])
    const o = nn(s.obstacles[0])
    // Way earlier than the first obstacle → no obstacle within TOL.
    s = game.onInput(s, 'p', { kind: 'jump' }, s.startedAt + o.arriveAt - 5000)
    expect(s.cleared.get('p')?.size).toBe(0)
    expect(s.stumbles.get('p')).toBe(1)
  })

  test('an obstacle passing without a jump becomes a stumble via tick (once)', () => {
    const game = new PixelDash()
    let s = init(['p'])
    const o = nn(s.obstacles[0])
    const now = s.startedAt + o.arriveAt + 500 // well past arrival + TOL
    s = game.tick(s, 50, now)
    expect(s.stumbles.get('p')).toBe(1)
    expect(s.resolvedMiss.get('p')?.has(o.id)).toBe(true)
    // Ticking again does not double-count.
    s = game.tick(s, 50, now + 50)
    expect(s.stumbles.get('p')).toBe(1)
  })

  test('ranks more clears first, fewer stumbles breaks ties', () => {
    const game = new PixelDash()
    let s = init(['a', 'b'])
    const o = nn(s.obstacles[0])
    s = game.onInput(s, 'a', { kind: 'jump' }, s.startedAt + o.arriveAt)
    const result = game.getResult(s)
    expect(result.placements[0]).toBe('a')
    expect(result.ranks?.a).toBe(0)
    expect(result.ranks?.b).toBe(1)
    expect(result.stats?.a).toBe('1 cleared')
  })

  test('snapshot only shows approaching obstacles', () => {
    const game = new PixelDash()
    const s = init(['p'])
    const first = nn(s.obstacles[0])
    // Sample when the first obstacle is ~half a lead-window away.
    const snap = game.snapshot(s, s.startedAt + first.arriveAt - 600)
    expect(snap.obstacles.some((o) => o.id === first.id)).toBe(true)
    expect(snap.obstacles.every((o) => o.t >= -0.2 && o.t <= 1)).toBe(true)
    expect(snap.scores.p).toBe(0)
  })
})
