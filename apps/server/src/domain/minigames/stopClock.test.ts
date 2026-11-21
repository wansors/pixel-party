import { describe, expect, test } from 'bun:test'
import { STOP_CLOCK, stopClockTimeoutMs } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import type { Random } from '../ports/Random'
import { StopClock, type StopClockState } from './stopClock'

// next() = 0.5 → each target sits mid-range: 3–5 → 4, 5–8 → 7, 7–11 → 9.
const half: Random = { next: () => 0.5 }
const init = (players: string[]): StopClockState =>
  new StopClock().init({ players, seed: 1, random: half, now: 0, config: { durationMs: 45_000 } })
const stop = (attempt: number, ms: number) => ({ kind: 'stop' as const, attempt, ms })
const PENALTY = STOP_CLOCK.missPenaltySec

describe('StopClock (blind stopwatch, D55)', () => {
  test('targets are seeded whole seconds, inside each try’s range, longer try by try', () => {
    expect(init(['a']).targets).toEqual([4, 7, 9])
    for (let seed = 1; seed <= 30; seed++) {
      const s = new StopClock().init({
        players: ['a'],
        seed,
        random: new SeededRandom(seed),
        now: 0,
      })
      s.targets.forEach((t, i) => {
        const [lo, hi] = STOP_CLOCK.ranges[i] as readonly [number, number]
        expect(Number.isInteger(t)).toBe(true)
        expect(t).toBeGreaterThanOrEqual(lo)
        expect(t).toBeLessThanOrEqual(hi)
      })
    }
    // Edge of the random range: next() → 1 never steps past the top.
    const top = new StopClock().init({
      players: ['a'],
      seed: 1,
      random: { next: () => 0.9999 },
      now: 0,
    })
    expect(top.targets).toEqual([5, 8, 11])
  })

  test('each stop adds its absolute error in seconds; stale, duplicate or junk stops are dropped', () => {
    const game = new StopClock()
    let s = init(['a'])
    s = game.onInput(s, 'a', stop(0, 4300), 100) // 0.3 s late
    s = game.onInput(s, 'a', stop(0, 4000), 110) // try 0 already taken
    s = game.onInput(s, 'a', stop(2, 9000), 120) // not the live try
    s = game.onInput(s, 'a', { kind: 'stop', attempt: 1, ms: Number.NaN }, 130)
    s = game.onInput(s, 'a', { kind: 'stop', attempt: 1, ms: '7000' as unknown as number }, 130)
    expect(s.attemptsDone.get('a')).toBe(1)
    expect(s.totalError.get('a')).toBeCloseTo(0.3)
    expect(s.times.get('a')).toEqual([4300])
    // Early counts the same as late.
    s = game.onInput(s, 'a', stop(1, 6500), 140)
    expect(s.totalError.get('a')).toBeCloseTo(0.8)
  })

  test('a reported time is clamped to the stopwatch’s range', () => {
    const game = new StopClock()
    let s = init(['a'])
    s = game.onInput(s, 'a', stop(0, -500), 100)
    expect(s.times.get('a')).toEqual([0])
    s = game.onInput(s, 'a', stop(1, 9e9), 100)
    expect(s.times.get('a')?.[1]).toBe(STOP_CLOCK.maxMs)
  })

  test('the stopwatch stops itself at twice the target plus two seconds', () => {
    expect(stopClockTimeoutMs(7)).toBe(16_000)
  })

  test('the result stat is the penalised error the ranking uses', () => {
    const game = new StopClock()
    let s = init(['a', 'b', 'idle'])
    const targets = s.targets
    targets.forEach((t, i) => {
      s = game.onInput(s, 'a', stop(i, t * 1000 + 100), 100 + i) // 0.30 total
    })
    s = game.onInput(s, 'b', stop(0, 4000), 100) // perfect, then ran out of time: 0 + 2 misses
    const r = game.getResult(s)
    expect(r.placements).toEqual(['a', 'b', 'idle'])
    expect(r.stats).toEqual({
      a: '0.30 off',
      b: `${(2 * PENALTY).toFixed(2)} off`,
      idle: `${(3 * PENALTY).toFixed(2)} off`,
    })
  })

  test('the snapshot carries every stopped time; the final one the penalised totals', () => {
    const game = new StopClock()
    let s = init(['a', 'b'])
    s = game.onInput(s, 'a', stop(0, 4250), 100)
    const live = game.snapshot(s, 200)
    expect(live.times).toEqual({ a: [4250], b: [] })
    expect(live.totalError.a).toBeCloseTo(0.25)
    expect(live.totalError.b).toBe(0)
    expect(game.snapshot(s, s.endsAt).totalError.a).toBeCloseTo(0.25 + 2 * PENALTY)
    expect(game.snapshot(s, s.endsAt).totalError.b).toBe(3 * PENALTY)
  })

  test('the round ends early once everyone used their tries — a leaver forfeits theirs', () => {
    const game = new StopClock()
    let s = init(['a', 'gone'])
    s.targets.forEach((t, i) => {
      s = game.onInput(s, 'a', stop(i, t * 1000), 100 + i)
    })
    expect(game.isFinished(s, 200)).toBe(false)
    s = game.onInput(s, 'gone', stop(0, 4200), 150)
    s = game.leave(s, 'gone', 300)
    expect(game.isFinished(s, 300)).toBe(true)
    // The forfeited tries are charged like misses, so the leaver can't sneak ahead.
    expect(game.getResult(s).stats?.gone).toBe(`${(0.2 + 2 * PENALTY).toFixed(2)} off`)
    expect(game.getResult(s).placements).toEqual(['a', 'gone'])
  })

  test('stops after the buzzer are ignored', () => {
    const game = new StopClock()
    let s = init(['a'])
    s = game.onInput(s, 'a', stop(0, 4000), s.endsAt)
    expect(s.attemptsDone.get('a')).toBe(0)
    expect(game.isFinished(s, s.endsAt)).toBe(true)
  })
})
