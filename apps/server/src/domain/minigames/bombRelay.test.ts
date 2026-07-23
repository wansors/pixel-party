import { describe, expect, test } from 'bun:test'
import type { MiniGameInitCtx } from './MiniGame'
import { BombRelay } from './bombRelay'

// next() = 0 -> every hidden fuse is exactly FUSE_MIN (2500ms), which keeps the timing tests exact.
const ctx = (): MiniGameInitCtx => ({
  players: ['a', 'b', 'c', 'd'],
  seed: 1,
  random: { next: () => 0 },
  now: 0,
  teams: { a: 'red', b: 'red', c: 'blue', d: 'blue' },
  config: { durationMs: 25_000 },
})

const LEG_TAPS = 12

describe('BombRelay', () => {
  test('filling a leg scores a relay and rotates the holder', () => {
    const game = new BombRelay()
    let state = game.init(ctx())
    expect(game.snapshot(state, 1).teams.red?.holderId).toBe('a')
    for (let i = 0; i < LEG_TAPS; i++) state = game.onInput(state, 'a', { kind: 'mash' }, 1)
    const red = game.snapshot(state, 1).teams.red
    expect(red?.relays).toBe(1)
    expect(red?.holderId).toBe('b') // rotated to the next member
    expect(red?.legProgress).toBe(0)
  })

  test('only the current holder can mash', () => {
    const game = new BombRelay()
    let state = game.init(ctx())
    state = game.onInput(state, 'b', { kind: 'mash' }, 1) // 'a' holds, not 'b'
    expect(game.snapshot(state, 1).teams.red?.legProgress).toBe(0)
  })

  test('the fuse blowing scores an explosion and rotates the holder', () => {
    const game = new BombRelay()
    let state = game.init(ctx())
    state = game.tick(state, 0, 2500) // fuse (2500ms) expires
    const red = game.snapshot(state, 2500).teams.red
    expect(red?.explosions).toBe(1)
    expect(red?.holderId).toBe('b')
  })

  test('ranks teams by relays (winner rank 0)', () => {
    const game = new BombRelay()
    let state = game.init(ctx())
    for (let i = 0; i < LEG_TAPS; i++) state = game.onInput(state, 'a', { kind: 'mash' }, 1)
    const result = game.getResult(state)
    expect(result.ranks?.red).toBe(0)
    expect(result.ranks?.blue).toBe(1)
    expect(result.placements[0]).toBe('red')
  })
})
