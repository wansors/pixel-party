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
    let state = game.init({ ...baseCtx(), config: { durationMs: 10_000 } })
    // 60 pulls by one of two red members (one every 70 ms, under the rate cap) = 30 per capita, past
    // the 25 threshold.
    for (let i = 0; i < 60; i++) state = game.onInput(state, 'a', { kind: 'pull' }, 10 + i * 70)
    expect(game.isFinished(state, 4200)).toBe(true) // well before endsAt = 10000
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

  test('pulls count up to the human mashing ceiling per second', () => {
    const game = new TugOfWar()
    let state = game.init({ ...baseCtx(), config: { durationMs: 10_000 } })
    // An autoclicker: 50 pulls in the same instant count as 15.
    for (let i = 0; i < 50; i++) state = game.onInput(state, 'a', { kind: 'pull' }, 10)
    expect(game.snapshot(state, 10).avg.red).toBe(7.5)
    // A teammate has their own allowance; a second later the window has rolled over.
    state = game.onInput(state, 'b', { kind: 'pull' }, 20)
    state = game.onInput(state, 'a', { kind: 'pull' }, 1010)
    expect(game.snapshot(state, 1010).avg.red).toBe(8.5)
  })

  test('ignores pulls outside the round window and from non-members', () => {
    const game = new TugOfWar()
    let state = game.init(baseCtx())
    state = game.onInput(state, 'a', { kind: 'pull' }, -5) // before start
    state = game.onInput(state, 'a', { kind: 'pull' }, 2000) // after end
    state = game.onInput(state, 'ghost', { kind: 'pull' }, 10) // not in a team
    const snap = game.snapshot(state, 10)
    expect(snap.avg).toEqual({ red: 0, blue: 0 })
  })

  test('the snapshot shows pulls per member, which is what moves the rope', () => {
    const game = new TugOfWar()
    let state = game.init({
      ...baseCtx(),
      players: ['a', 'b', 'c', 'd', 'e'],
      teams: { a: 'red', b: 'red', c: 'blue', d: 'blue', e: 'blue' },
    })
    for (let i = 0; i < 6; i++) state = game.onInput(state, 'a', { kind: 'pull' }, 10)
    for (let i = 0; i < 7; i++) state = game.onInput(state, 'c', { kind: 'pull' }, 10)
    const snap = game.snapshot(state, 10)
    expect(snap.avg).toEqual({ red: 3, blue: 2.3 }) // 6/2 vs 7/3: fewer pulls, but red leads
    expect(snap.offset).toBeLessThan(0)
  })

  test('a member who leaves stops counting in the average', () => {
    const game = new TugOfWar()
    let state = game.init(baseCtx())
    for (let i = 0; i < 10; i++) {
      state = game.onInput(state, 'a', { kind: 'pull' }, 10)
      state = game.onInput(state, 'c', { kind: 'pull' }, 10)
    }
    // b (red) never pulls and drops: red's average is a's alone from now on.
    state = game.leave(state, 'b')
    let snap = game.snapshot(state, 20)
    expect(snap.avg).toEqual({ red: 10, blue: 5 })
    expect(snap.teams.b).toBeUndefined()
    state = game.onInput(state, 'b', { kind: 'pull' }, 30) // gone: ignored
    expect(game.snapshot(state, 30).avg.red).toBe(10)
    // A team emptied by leavers pulls nothing (no division by zero) and loses the tug.
    state = game.leave(state, 'a')
    snap = game.snapshot(state, 40)
    expect(snap.avg.red).toBe(0)
    expect(Number.isFinite(snap.offset)).toBe(true)
    expect(game.getResult(state).ranks).toEqual({ red: 1, blue: 0 })
  })
})
