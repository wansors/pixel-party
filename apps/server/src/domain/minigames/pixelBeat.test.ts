import { describe, expect, test } from 'bun:test'
import type { PixelBeatInput } from '@pp/shared'
import type { MiniGameInitCtx } from './MiniGame'
import { PixelBeat } from './pixelBeat'

// next() = 0.5 zeroes the jitter term ((r.next() - 0.5) * 160), so beats land exactly 650ms apart:
// 1200, 1850, 2500, ...
const baseCtx = (overrides: Partial<MiniGameInitCtx> = {}): MiniGameInitCtx => ({
  players: ['a', 'b'],
  seed: 1,
  random: { next: () => 0.5 },
  now: 0,
  config: { durationMs: 3000 },
  ...overrides,
})

describe('PixelBeat', () => {
  test('beats are generated strictly increasing and within [0, durationMs)', () => {
    const game = new PixelBeat()
    const state = game.init(baseCtx({ config: { durationMs: 40_000 } }))
    expect(state.beatTimes.length).toBeGreaterThan(0)
    for (let i = 0; i < state.beatTimes.length; i++) {
      const t = state.beatTimes[i] as number
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThan(40_000)
      if (i > 0) expect(t).toBeGreaterThan(state.beatTimes[i - 1] as number)
    }
  })

  test('a tap exactly at a beat scores the perfect value', () => {
    const game = new PixelBeat()
    let state = game.init(baseCtx())
    state = game.onInput(state, 'a', { kind: 'tap' }, 1200)
    const snap = game.snapshot(state, 1200)
    expect(snap.scores.a).toBe(3)
    expect(snap.streaks.a).toBe(1)
  })

  test('a tap far from any beat scores nothing and resets the streak', () => {
    const game = new PixelBeat()
    let state = game.init(baseCtx())
    // Midway between beats at 1200 and 1850 -> 325ms from either, outside the good window.
    state = game.onInput(state, 'a', { kind: 'tap' }, 1525)
    const snap = game.snapshot(state, 1525)
    expect(snap.scores.a).toBe(0)
    expect(snap.streaks.a).toBe(0)
  })

  test('the same beat cannot be scored twice by the same player', () => {
    const game = new PixelBeat()
    let state = game.init(baseCtx())
    state = game.onInput(state, 'a', { kind: 'tap' }, 1200)
    state = game.onInput(state, 'a', { kind: 'tap' }, 1200)
    const snap = game.snapshot(state, 1200)
    expect(snap.scores.a).toBe(3)
  })

  test('a tap is judged at its reported time, so an honest round trip still scores PERFECT', () => {
    const game = new PixelBeat()
    // Tapped right on the 1200 ms beat, reaching the server 150 ms later.
    let lagged = game.init(baseCtx())
    lagged = game.onInput(lagged, 'a', { kind: 'tap', at: 1200 }, 1350)
    expect(game.snapshot(lagged, 1350).scores.a).toBe(3)
    // The same arrival without a reported time only rates GOOD.
    let bare = game.init(baseCtx())
    bare = game.onInput(bare, 'a', { kind: 'tap' }, 1350)
    expect(game.snapshot(bare, 1350).scores.a).toBe(1)
  })

  test('a reported time is only credited within a bounded window of the server measurement', () => {
    const game = new PixelBeat()
    const scoreOf = (at: number, now: number): number => {
      const s = game.onInput(game.init(baseCtx()), 'a', { kind: 'tap', at }, now)
      return game.snapshot(s, now).scores.a ?? 0
    }
    // 400 ms behind is more than a round trip: only 250 ms is credited, 150 ms off the beat = GOOD.
    expect(scoreOf(1200, 1600)).toBe(1)
    // Further behind, the credited time is out of the beat's reach.
    expect(scoreOf(1200, 1700)).toBe(0)
    // A claim ahead of the server's clock is credited 50 ms ahead at most.
    expect(scoreOf(1200, 1000)).toBe(1)
    // A non-finite claim falls back to the server's own measurement.
    expect(scoreOf(Number.NaN, 1200)).toBe(3)
  })

  test('spamming scores a third of tapping on the beat at most', () => {
    const game = new PixelBeat()
    const ctx = baseCtx({ config: { durationMs: 40_000 } })
    let spam = game.init(ctx)
    let onBeat = game.init(ctx)
    for (let t = 0; t < 40_000; t += 50) spam = game.onInput(spam, 'a', { kind: 'tap', at: t }, t)
    for (const t of onBeat.beatTimes) {
      onBeat = game.onInput(onBeat, 'a', { kind: 'tap', at: t }, t + 120)
    }
    const accurate = game.snapshot(onBeat, 40_000).scores.a ?? 0
    expect(accurate).toBe(3 * onBeat.beatTimes.length)
    expect(game.snapshot(spam, 40_000).scores.a ?? 0).toBeLessThanOrEqual(accurate / 3)
  })

  test('getResult ranks the higher-scoring player first', () => {
    const game = new PixelBeat()
    let state = game.init(baseCtx())
    state = game.onInput(state, 'a', { kind: 'tap' }, 1200)
    state = game.onInput(state, 'a', { kind: 'tap' }, 1850)
    state = game.onInput(state, 'b', { kind: 'tap' }, 1525)
    const result = game.getResult(state)
    expect(result.placements[0]).toBe('a')
    expect(result.ranks?.a).toBe(0)
    expect(result.ranks?.b).toBe(1)
  })

  test('isFinished is false before endsAt and true at/after it', () => {
    const game = new PixelBeat()
    const state = game.init(baseCtx())
    expect(game.isFinished(state, 2999)).toBe(false)
    expect(game.isFinished(state, 3000)).toBe(true)
    expect(game.isFinished(state, 3100)).toBe(true)
  })

  test('a malformed input is a no-op', () => {
    const game = new PixelBeat()
    const before = game.init(baseCtx())
    const badInput = { kind: 'nope' } as unknown as PixelBeatInput
    const after = game.onInput(before, 'a', badInput, 1200)
    const snap = game.snapshot(after, 1200)
    expect(snap.scores.a).toBe(0)
    expect(snap.streaks.a).toBe(0)
  })
})
