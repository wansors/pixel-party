import { describe, expect, test } from 'bun:test'
import { BALLOON_CHICKEN } from '@pp/shared'
import type { Random } from '../ports/Random'
import { BalloonChicken, type BalloonChickenState } from './balloonChicken'

// next() = 0 -> every balloon bursts on its 4th pump (MIN_THRESHOLD).
const zero: Random = { next: () => 0 }
const game = new BalloonChicken()
const init = (players: string[], random: Random = zero) =>
  game.init({ players, seed: 1, random, now: 0, config: { durationMs: 20_000 } })
const pump = (s: BalloonChickenState, id: string, times: number, now = 1000) => {
  for (let i = 0; i < times; i++) game.onInput(s, id, { kind: 'pump' }, now)
  return s
}
const cash = (s: BalloonChickenState, id: string, now = 1000) =>
  game.onInput(s, id, { kind: 'cashout' }, now)

describe('BalloonChicken', () => {
  test('one seeded burst sequence for everybody, hidden from the snapshot', () => {
    let n = 0
    const varied: Random = { next: () => [0.1, 0.9, 0.5][n++ % 3] as number }
    const s = init(['a', 'b', 'c'], varied)
    expect(s.thresholds).toEqual([5, 17, 11])
    const snap = game.snapshot(s, 0)
    expect(JSON.stringify(snap)).not.toContain('threshold')
    expect(snap.players.a).toEqual({ pumps: 0, banked: 0, outcomes: [] })
  })

  test('cashing out banks the balloon and brings the next one', () => {
    let s = pump(init(['a']), 'a', 3)
    s = cash(s, 'a')
    expect(s.players.get('a')).toEqual({ pumps: 0, banked: 30, outcomes: ['cashed'] })
    s = pump(s, 'a', 2)
    expect(s.players.get('a')?.pumps).toBe(2)
  })

  test("a burst loses that balloon's points and moves on", () => {
    let s = pump(init(['a']), 'a', 2)
    s = cash(s, 'a') // 20 banked
    s = pump(s, 'a', 4) // balloon 2 bursts on pump 4
    expect(s.players.get('a')).toEqual({ pumps: 0, banked: 20, outcomes: ['cashed', 'burst'] })
  })

  test('the same choices make the same score for everybody', () => {
    let s = init(['a', 'b'])
    for (const id of ['a', 'b']) {
      s = pump(s, id, 3)
      s = cash(s, id)
    }
    expect(game.getResult(s).ranks).toEqual({ a: 0, b: 0 })
  })

  test('cashing out an untouched balloon is ignored', () => {
    const s = cash(init(['a']), 'a')
    expect(s.players.get('a')?.outcomes).toEqual([])
  })

  test('a balloon still in hand at the buzzer bursts', () => {
    let s = pump(init(['a', 'b']), 'a', 3)
    s = cash(s, 'a')
    s = pump(s, 'a', 3)
    s = pump(s, 'b', 3) // never cashed out
    game.tick(s, 50, 19_999)
    expect(s.players.get('b')?.pumps).toBe(3)
    game.tick(s, 50, 20_000)
    expect(s.players.get('a')).toEqual({ pumps: 0, banked: 30, outcomes: ['cashed', 'burst'] })
    expect(s.players.get('b')).toEqual({ pumps: 0, banked: 0, outcomes: ['burst'] })
    const r = game.getResult(s)
    expect(r.placements).toEqual(['a', 'b'])
    expect(r.stats).toEqual({ a: '30 banked', b: '0 banked' })
  })

  test('the round ends once everybody still here has used every balloon', () => {
    let s = init(['a', 'b'])
    for (let i = 0; i < BALLOON_CHICKEN.balloons; i++) {
      s = pump(s, 'a', 1)
      s = cash(s, 'a')
    }
    expect(s.players.get('a')?.outcomes).toHaveLength(BALLOON_CHICKEN.balloons)
    // Done: further input is ignored.
    s = pump(s, 'a', 1)
    expect(s.players.get('a')?.pumps).toBe(0)
    expect(game.isFinished(s, 2000)).toBe(false)
    s = game.leave(s, 'b')
    expect(game.isFinished(s, 2000)).toBe(true)
  })

  test('input outside the round window is ignored', () => {
    const s = game.onInput(init(['a']), 'a', { kind: 'pump' }, 20_000)
    expect(s.players.get('a')?.pumps).toBe(0)
  })
})
