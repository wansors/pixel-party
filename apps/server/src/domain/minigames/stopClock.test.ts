import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { StopClock, type StopClockState } from './stopClock'

// next() = 0.5 → every target sits at 0.2 + 0.5 * 0.6 = 0.5.
const half: Random = { next: () => 0.5 }
const init = (players: string[]): StopClockState =>
  new StopClock().init({ players, seed: 1, random: half, now: 0, config: { durationMs: 25_000 } })
const stop = (attempt: number, pos: number) => ({ kind: 'stop' as const, attempt, pos })

describe('StopClock', () => {
  test('targets are seeded and kept inside the sweep', () => {
    const s = init(['a'])
    expect(s.targets).toEqual([0.5, 0.5, 0.5])
  })

  test('each stop adds its absolute error; stale or duplicate stops are dropped', () => {
    const game = new StopClock()
    let s = init(['a'])
    s = game.onInput(s, 'a', stop(0, 0.6), 100)
    s = game.onInput(s, 'a', stop(0, 0.9), 110) // attempt 0 already taken
    s = game.onInput(s, 'a', stop(2, 0.5), 120) // not the live attempt
    expect(s.attemptsDone.get('a')).toBe(1)
    expect(s.totalError.get('a')).toBeCloseTo(0.1)
  })

  test('the result stat is the penalised error the ranking uses', () => {
    const game = new StopClock()
    let s = init(['a', 'b', 'idle'])
    for (let i = 0; i < 3; i++) s = game.onInput(s, 'a', stop(i, 0.6), 100 + i) // 0.30 total
    s = game.onInput(s, 'b', stop(0, 0.5), 100) // perfect, then ran out of time: 0 + 2 misses
    const r = game.getResult(s)
    expect(r.placements).toEqual(['a', 'b', 'idle'])
    expect(r.stats).toEqual({ a: '0.30 off', b: '2.00 off', idle: '3.00 off' })
  })

  test('the final snapshot shows the penalised totals; a live one the raw running error', () => {
    const game = new StopClock()
    let s = init(['a', 'b'])
    s = game.onInput(s, 'a', stop(0, 0.6), 100)
    expect(game.snapshot(s, 200).totalError.a).toBeCloseTo(0.1)
    expect(game.snapshot(s, 200).totalError.b).toBe(0)
    expect(game.snapshot(s, s.endsAt).totalError.a).toBeCloseTo(2.1)
    expect(game.snapshot(s, s.endsAt).totalError.b).toBe(3)
  })

  test('the round ends early once everyone used their tries — a leaver forfeits theirs', () => {
    const game = new StopClock()
    let s = init(['a', 'gone'])
    for (let i = 0; i < 3; i++) s = game.onInput(s, 'a', stop(i, 0.5), 100 + i)
    expect(game.isFinished(s, 200)).toBe(false)
    s = game.onInput(s, 'gone', stop(0, 0.7), 150)
    s = game.leave(s, 'gone', 300)
    expect(game.isFinished(s, 300)).toBe(true)
    // The forfeited tries are charged like misses, so the leaver can't sneak ahead.
    expect(game.getResult(s).stats?.gone).toBe('2.20 off')
    expect(game.getResult(s).placements).toEqual(['a', 'gone'])
  })

  test('stops after the buzzer are ignored', () => {
    const game = new StopClock()
    let s = init(['a'])
    s = game.onInput(s, 'a', stop(0, 0.5), s.endsAt)
    expect(s.attemptsDone.get('a')).toBe(0)
    expect(game.isFinished(s, s.endsAt)).toBe(true)
  })
})
