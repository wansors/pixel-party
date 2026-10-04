import { describe, expect, test } from 'bun:test'
import { BombRelay } from './bombRelay'
import type { MiniGameInitCtx } from './MiniGame'

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

  test('mashes count up to the human mashing ceiling per second', () => {
    const game = new BombRelay()
    let state = game.init(ctx())
    // An autoclicker's burst counts 15 mashes a second: the first 12 pass the bomb on, and the next
    // holder's allowance is their own.
    for (let i = 0; i < 40; i++) state = game.onInput(state, 'a', { kind: 'mash' }, 1)
    expect(game.snapshot(state, 1).teams.red?.relays).toBe(1)
    for (let i = 0; i < 40; i++) state = game.onInput(state, 'b', { kind: 'mash' }, 2)
    expect(game.snapshot(state, 2).teams.red?.relays).toBe(2)
    // Back to 'a' within the same second: only 3 of its 15 are left.
    for (let i = 0; i < 40; i++) state = game.onInput(state, 'a', { kind: 'mash' }, 3)
    expect(game.snapshot(state, 3).teams.red?.legProgress).toBe(3)
    for (let i = 0; i < 9; i++) state = game.onInput(state, 'a', { kind: 'mash' }, 1001)
    expect(game.snapshot(state, 1001).teams.red?.relays).toBe(3)
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

  test('an idle holder is skipped: no relay, no boom, a fresh fuse for the next one', () => {
    const game = new BombRelay()
    let state = game.init(ctx())
    state = game.tick(state, 0, 1700)
    expect(game.snapshot(state, 1700).teams.red?.holderId).toBe('a')
    state = game.tick(state, 0, 1800) // 1.8 s holding it without a single mash
    const red = game.snapshot(state, 1800).teams.red
    expect(red?.holderId).toBe('b')
    expect(red?.relays).toBe(0)
    expect(red?.explosions).toBe(0)
    // The fuse was re-armed at the skip: nothing blows at the old 2500 ms mark.
    state = game.tick(state, 0, 2500)
    expect(game.snapshot(state, 2500).teams.red?.explosions).toBe(0)
    expect(game.snapshot(state, 2500).teams.red?.holderId).toBe('b')
  })

  test('mashing keeps the idle skip away', () => {
    const game = new BombRelay()
    let state = game.init(ctx())
    state = game.onInput(state, 'a', { kind: 'mash' }, 1000)
    state = game.tick(state, 0, 1800)
    expect(game.snapshot(state, 1800).teams.red?.holderId).toBe('a')
  })

  test('a leaver drops out of the chain; the bomb never parks on them', () => {
    const game = new BombRelay()
    const base = ctx()
    let state = game.init({
      ...base,
      players: ['a', 'b', 'e', 'c', 'd'],
      teams: { ...base.teams, e: 'red' },
    })
    for (let i = 0; i < LEG_TAPS; i++) state = game.onInput(state, 'a', { kind: 'mash' }, 100)
    for (let i = 0; i < 4; i++) state = game.onInput(state, 'b', { kind: 'mash' }, 200)
    // Someone else leaving keeps the bomb (and the leg) where it is.
    state = game.leave(state, 'a', 300)
    let red = game.snapshot(state, 300).teams.red
    expect(red?.members).toEqual(['b', 'e'])
    expect(red?.holderId).toBe('b')
    expect(red?.legProgress).toBe(4)
    // The holder leaving hands the bomb straight to the next member.
    state = game.leave(state, 'b', 400)
    red = game.snapshot(state, 400).teams.red
    expect(red?.holderId).toBe('e')
    expect(red?.legProgress).toBe(0)
    // A lone member passes to themself, and the relay still scores.
    for (let i = 0; i < LEG_TAPS; i++) state = game.onInput(state, 'e', { kind: 'mash' }, 500)
    expect(game.snapshot(state, 500).teams.red?.relays).toBe(2)
    expect(game.getResult(state).stats?.a).toBe('2 passes') // leavers keep their team's line
  })

  test('a team everyone left stops ticking without blowing up', () => {
    const game = new BombRelay()
    let state = game.init(ctx())
    state = game.leave(state, 'a', 0)
    state = game.leave(state, 'b', 0)
    for (let t = 0; t <= 20_000; t += 50) state = game.tick(state, 50, t)
    const red = game.snapshot(state, 20_000).teams.red
    expect(red?.explosions).toBe(0)
    expect(red?.holderId).toBe('')
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
