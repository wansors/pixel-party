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
