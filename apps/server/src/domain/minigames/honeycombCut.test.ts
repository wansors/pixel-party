import { describe, expect, test } from 'bun:test'
import { HONEYCOMB, HONEYCOMB_SHAPES, honeycombOutline } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { HoneycombCut, type HoneycombState } from './honeycombCut'

const game = new HoneycombCut()
const init = (players: string[], seed = 2): HoneycombState =>
  game.init({
    players,
    seed,
    random: new SeededRandom(seed),
    now: 0,
    config: { durationMs: 45_000 },
  })
const carver = (s: HoneycombState, id: string) => {
  const c = s.carvers.get(id)
  if (!c) throw new Error(`no carver ${id}`)
  return c
}
// Traces the outline from point `from` over `count` points (every `stride`-th one), one sample every
// `stepMs`; returns the time reached. The defaults are a calm pace.
const trace = (
  s: HoneycombState,
  id: string,
  from: number,
  count: number,
  t0: number,
  stepMs = 40,
  stride = 1,
): number => {
  let t = t0
  const n = s.outline.length
  for (let k = 0; k <= count; k += stride) {
    const p = s.outline[(from + k) % n] as { x: number; y: number }
    t += stepMs
    game.onInput(s, id, { kind: 'needle', x: p.x, y: p.y, down: true }, t)
  }
  return t
}

describe('honeycomb outlines', () => {
  test('every shape is a closed outline well inside the candy', () => {
    for (const shape of HONEYCOMB_SHAPES) {
      const o = honeycombOutline(shape)
      expect(o).toHaveLength(HONEYCOMB.segments)
      for (const p of o)
        expect(Math.hypot(p.x - 0.5, p.y - 0.5)).toBeLessThan(HONEYCOMB.candyR - 0.05)
    }
  })
})

describe('HoneycombCut', () => {
  test('tracing the whole outline calmly cuts the shape out', () => {
    const s = init(['a', 'b'])
    const t = trace(s, 'a', 0, s.outline.length, 0)
    const a = carver(s, 'a')
    expect(a.cracks).toBe(0)
    expect(a.doneAt).not.toBeNull()
    expect(game.snapshot(s, t).players[0]?.progress).toBe(1)
  })

  test('lifting the needle or jumping across cuts nothing in between', () => {
    const s = init(['a'])
    trace(s, 'a', 0, 10, 0)
    game.onInput(s, 'a', { kind: 'needle', x: 0.5, y: 0.5, down: false }, 500)
    const far = s.outline[80] as { x: number; y: number }
    game.onInput(s, 'a', { kind: 'needle', x: far.x, y: far.y, down: true }, 540)
    const cut = carver(s, 'a').cut
    expect(cut.slice(0, 10).every(Boolean)).toBe(true)
    expect(cut.slice(12, 78).some(Boolean)).toBe(false)
    // Point 80 sits between segments 79 and 80: one of them is cut.
    expect(cut[79] || cut[80]).toBe(true)
  })

  test('straying off the line cracks the candy; the third crack breaks it', () => {
    const s = init(['a', 'b'])
    const off = (t: number): void => {
      game.onInput(s, 'a', { kind: 'needle', x: 0.5, y: 0.5, down: true }, t)
    }
    off(100)
    off(200) // within the crack's grace
    expect(carver(s, 'a').cracks).toBe(1)
    off(900)
    off(1600)
    expect(carver(s, 'a').broken).toBe(true)
    expect(game.isFinished(s, 1600)).toBe(false) // b still carving
    // A broken candy takes no more input.
    const p = s.outline[0] as { x: number; y: number }
    game.onInput(s, 'a', { kind: 'needle', x: p.x, y: p.y, down: true }, 1700)
    expect(carver(s, 'a').cut.some(Boolean)).toBe(false)
  })

  test('rushing the needle along the line cracks it', () => {
    const s = init(['a'])
    trace(s, 'a', 0, 150, 0, 40, 6) // big jumps along the line every 40 ms: a rushed needle
    expect(carver(s, 'a').cracks).toBeGreaterThan(0)
  })

  test('ranks finishers by time, then everyone else by cut, a broken candy counting half', () => {
    const s = init(['a', 'b', 'c', 'd'])
    trace(s, 'a', 0, s.outline.length, 0)
    trace(s, 'b', 0, 30, 0)
    trace(s, 'c', 0, 120, 0)
    Object.assign(carver(s, 'c'), { broken: true, cracks: 3 })
    const result = game.getResult(s)
    // c broke three quarters of the way round, which still counts for more than b's intact fifth.
    expect(result.placements).toEqual(['a', 'c', 'b', 'd'])
    const cut = (id: string): number => carver(s, id).cut.filter(Boolean).length / 160
    expect(result.stats?.c).toBe(`${Math.floor(cut('c') * 50)}%`)
    expect(result.stats?.b).toBe(`${Math.floor(cut('b') * 100)}%`)
    game.onInput(s, 'd', { kind: 'needle', x: 2, y: 0.5, down: true }, 10)
    expect(carver(s, 'd').cracks).toBe(0)
  })

  test('equal credit goes to fewer cracks; equal everything is a tie', () => {
    const s = init(['intact', 'broken', 'idle1', 'idle2'])
    carver(s, 'intact').cut.fill(true, 0, 40)
    Object.assign(carver(s, 'broken'), { broken: true, cracks: 3 })
    carver(s, 'broken').cut.fill(true, 0, 80)
    const { placements, ranks } = game.getResult(s)
    expect(placements.slice(0, 2)).toEqual(['intact', 'broken'])
    expect(ranks?.broken).toBe(1)
    expect(ranks?.idle1).toBe(2)
    expect(ranks?.idle2).toBe(2)
  })

  test('a player who leaves carves no more and no longer holds the round open', () => {
    const s = init(['a', 'b'])
    trace(s, 'a', 0, s.outline.length, 0)
    expect(game.isFinished(s, 10_000)).toBe(false)
    game.leave(s, 'b')
    expect(game.isFinished(s, 10_000)).toBe(true)
    const p = s.outline[0] as { x: number; y: number }
    game.onInput(s, 'b', { kind: 'needle', x: p.x, y: p.y, down: true }, 10_100)
    expect(carver(s, 'b').cut.some(Boolean)).toBe(false)
    expect(game.snapshot(s, 10_100).players.find((q) => q.id === 'b')?.left).toBe(true)
  })
})
