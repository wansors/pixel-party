import { describe, expect, test } from 'bun:test'
import type { MiniGameInitCtx } from './MiniGame'
import { TugOfWar } from './tugOfWar'

const baseCtx = (): MiniGameInitCtx => ({
  players: ['a', 'b', 'c', 'd'],
  seed: 1,
  random: { next: () => 0 },
  now: 0,
  teams: { a: 'red', b: 'red', c: 'blue', d: 'blue' },
  config: { durationMs: 1000 },
})

describe('TugOfWar', () => {
  test('the team that pulls more per capita wins', () => {
    const game = new TugOfWar()
    let state = game.init(baseCtx())
    // Red pulls hard; blue does nothing.
    for (let i = 0; i < 40; i++) {
      state = game.onInput(state, 'a', { kind: 'pull' }, 10)
      state = game.onInput(state, 'b', { kind: 'pull' }, 10)
    }
    const result = game.getResult(state)
    expect(result.ranks?.red).toBe(0)
    expect(result.ranks?.blue).toBe(1)
    expect(result.placements).toContain('red')
  })

  test('a decisive per-capita lead ends the round before the timer', () => {
    const game = new TugOfWar()
    let state = game.init(baseCtx())
    // 30 pulls / 2 members = 15 per capita each... push past the 25 threshold.
    for (let i = 0; i < 60; i++) state = game.onInput(state, 'a', { kind: 'pull' }, 10)
    expect(game.isFinished(state, 10)).toBe(true) // well before endsAt = 1000
  })

  test('equal per-capita effort is a tie at the timer', () => {
    const game = new TugOfWar()
    let state = game.init(baseCtx())
    for (let i = 0; i < 10; i++) {
      state = game.onInput(state, 'a', { kind: 'pull' }, 10)
      state = game.onInput(state, 'c', { kind: 'pull' }, 10)
    }
    expect(game.isFinished(state, 999)).toBe(false)
    expect(game.isFinished(state, 1000)).toBe(true)
    const result = game.getResult(state)
    expect(result.ranks?.red).toBe(0)
    expect(result.ranks?.blue).toBe(0)
  })

  test('ignores pulls outside the round window and from non-members', () => {
    const game = new TugOfWar()
    let state = game.init(baseCtx())
    state = game.onInput(state, 'a', { kind: 'pull' }, -5) // before start
    state = game.onInput(state, 'a', { kind: 'pull' }, 2000) // after end
    state = game.onInput(state, 'ghost', { kind: 'pull' }, 10) // not in a team
    const snap = game.snapshot(state, 10)
    expect(snap.red).toBe(0)
    expect(snap.blue).toBe(0)
  })
})
