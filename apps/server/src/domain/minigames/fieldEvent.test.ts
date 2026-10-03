import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import {
  ANGLE_RATE,
  ATTEMPTS,
  type FieldEventState,
  JavelinThrow,
  LongJump,
  MARK_MS,
  MAX_ANGLE,
  READY_MS,
  RUN_TIMEOUT_MS,
} from './fieldEvent'

const rng: Random = { next: () => 0.5 }
const TICK = 50

const init = (game: LongJump | JavelinThrow, players: string[]) =>
  game.init({ players, seed: 1, random: rng, now: 0, config: { durationMs: 45_000 } })

// Ticks from `from` to `to` (inclusive), running `each` before every tick.
function run(
  game: LongJump | JavelinThrow,
  s: FieldEventState,
  from: number,
  to: number,
  each: (now: number) => void = () => {},
): FieldEventState {
  let state = s
  for (let now = from; now <= to; now += TICK) {
    each(now)
    state = game.tick(state, TICK, now)
  }
  return state
}

// Sprints (10 strides/s) from `from` until the athlete is `stopShort` metres from the board, then
// holds JUMP for `holdMs` and releases. Returns the time of release.
function attempt(
  game: LongJump | JavelinThrow,
  s: FieldEventState,
  pid: string,
  from: number,
  stopShort: number,
  holdMs: number,
): number {
  const a = s.athletes.get(pid)
  if (!a) throw new Error('no athlete')
  let pressedAt = -1
  let now = from
  for (; now < from + 20_000; now += TICK) {
    if (a.phase === 'run' && pressedAt < 0) {
      if (s.spec.foulLine - a.runner.x <= stopShort) {
        game.onInput(s, pid, { kind: 'jump', down: true }, now)
        pressedAt = now
      } else if (now % 100 === 0) {
        const foot = (now / 100) % 2 === 0 ? 'L' : 'R'
        game.onInput(s, pid, { kind: 'step', foot }, now)
      }
    }
    if (pressedAt >= 0 && now >= pressedAt + holdMs) {
      game.onInput(s, pid, { kind: 'jump', down: false }, now)
      return now
    }
    game.tick(s, TICK, now)
  }
  throw new Error('attempt never released')
}

describe('FieldEvent (long jump)', () => {
  test('ready → run after READY_MS; strides only count while running', () => {
    const game = new LongJump()
    let s = init(game, ['a'])
    game.onInput(s, 'a', { kind: 'step', foot: 'L' }, 100)
    expect(s.athletes.get('a')?.runner.v).toBe(0)
    s = run(game, s, 0, READY_MS)
    expect(s.athletes.get('a')?.phase).toBe('run')
    game.onInput(s, 'a', { kind: 'step', foot: 'L' }, READY_MS + 50)
    expect(s.athletes.get('a')?.runner.v).toBeGreaterThan(0)
  })

  test('a good run-up and a 45° take-off near the board lands a long mark', () => {
    const game = new LongJump()
    const s = init(game, ['a'])
    // Held 400 ms (the test releases on tick boundaries) → 44°, near the 45° sweet spot.
    attempt(game, s, 'a', 0, 0.4, 400)
    const a = s.athletes.get('a')
    expect(a?.phase).toBe('flight')
    expect(a?.angle).toBeCloseTo((400 / 1000) * ANGLE_RATE, 5)
    const mark = a?.marks[0] as number
    expect(mark).toBeGreaterThan(6)
    expect(mark).toBeLessThan(10)
  })

  test('a poor angle jumps shorter than 45°', () => {
    const good = new LongJump()
    const g = init(good, ['a'])
    attempt(good, g, 'a', 0, 0.4, 400)
    const flat = new LongJump()
    const f = init(flat, ['a'])
    attempt(flat, f, 'a', 0, 0.4, 100)
    expect(f.athletes.get('a')?.marks[0] as number).toBeLessThan(
      g.athletes.get('a')?.marks[0] as number,
    )
  })

  test('the mark is measured from the board: an early take-off wastes distance', () => {
    const near = new LongJump()
    const n = init(near, ['a'])
    attempt(near, n, 'a', 0, 0.3, 400)
    const early = new LongJump()
    const e = init(early, ['a'])
    attempt(early, e, 'a', 0, 4, 400)
    expect(e.athletes.get('a')?.marks[0] as number).toBeLessThan(
      n.athletes.get('a')?.marks[0] as number,
    )
  })

  test('running through the board is a foul (null mark)', () => {
    const game = new LongJump()
    let s = init(game, ['a'])
    s = run(game, s, 0, 12_000, (now) => {
      if (now % 100 === 0) {
        const foot = (now / 100) % 2 === 0 ? 'L' : 'R'
        game.onInput(s, 'a', { kind: 'step', foot }, now)
      }
    })
    expect(s.athletes.get('a')?.marks[0]).toBeNull()
  })

  test('holding too long auto-releases at MAX_ANGLE', () => {
    const game = new LongJump()
    const s = init(game, ['a'])
    run(game, s, 0, READY_MS + 500, (now) => {
      if (now === READY_MS + 100) game.onInput(s, 'a', { kind: 'step', foot: 'L' }, now)
      if (now === READY_MS + 400) game.onInput(s, 'a', { kind: 'jump', down: true }, now)
    })
    run(game, s, READY_MS + 550, READY_MS + 400 + (MAX_ANGLE / ANGLE_RATE) * 1000 + 100)
    expect(s.athletes.get('a')?.phase).toBe('flight')
    expect(s.athletes.get('a')?.angle).toBe(MAX_ANGLE)
  })

  test('an idle run-up is called a foul after the timeout', () => {
    const game = new LongJump()
    let s = init(game, ['a'])
    s = run(game, s, 0, READY_MS + RUN_TIMEOUT_MS + TICK)
    expect(s.athletes.get('a')?.marks).toEqual([null])
    expect(s.athletes.get('a')?.phase).toBe('mark')
  })

  test('three attempts then done; the round ends when everyone is done; best mark ranks', () => {
    const game = new LongJump()
    const s = init(game, ['a', 'b'])
    let now = 0
    for (let i = 0; i < ATTEMPTS; i++) {
      // Both athletes run up side by side and take off together (b slower, so shorter).
      const a = s.athletes.get('a')
      const b = s.athletes.get('b')
      if (!a || !b) throw new Error('missing')
      let pressed = false
      for (; now < 200_000; now += TICK) {
        if (a.phase === 'run' && b.phase === 'run') {
          if (!pressed && s.spec.foulLine - a.runner.x <= 0.5) {
            game.onInput(s, 'a', { kind: 'jump', down: true }, now)
            game.onInput(s, 'b', { kind: 'jump', down: true }, now)
            pressed = true
          } else if (now % 100 === 0) {
            const foot = (now / 100) % 2 === 0 ? 'L' : 'R'
            game.onInput(s, 'a', { kind: 'step', foot }, now)
            // b taps half as fast, so it reaches the board slower.
            if (now % 200 === 0) {
              game.onInput(s, 'b', { kind: 'step', foot: (now / 200) % 2 === 0 ? 'L' : 'R' }, now)
            }
          }
        }
        if (pressed && a.phase === 'aim' && now % 400 === 0) {
          game.onInput(s, 'a', { kind: 'jump', down: false }, now)
          game.onInput(s, 'b', { kind: 'jump', down: false }, now)
        }
        game.tick(s, TICK, now)
        if (a.attempt > i && b.attempt > i) break
      }
    }
    expect(s.athletes.get('a')?.marks).toHaveLength(ATTEMPTS)
    expect(s.athletes.get('a')?.phase).toBe('done')
    expect(game.isFinished(s, now)).toBe(true)
    const result = game.getResult(s)
    expect(result.placements[0]).toBe('a')
    expect(result.stats?.a).toMatch(/^\d+\.\d\dm$/)
    const snap = game.snapshot(s, now)
    expect(snap.athletes[0]?.best).toBe(Math.max(...(s.athletes.get('a')?.marks as number[])))
    expect(snap.markMs).toBe(MARK_MS)
  })

  test('an athlete who leaves is done at once (marks kept), so the round need not wait', () => {
    const game = new LongJump()
    const s = init(game, ['a', 'b'])
    const released = attempt(game, s, 'a', 0, 0.5, 400)
    run(game, s, released + TICK, released + 3000)
    game.leave(s, 'b', released + 3000)
    expect(s.athletes.get('b')?.phase).toBe('done')
    // 'a' still has attempts to take.
    expect(game.isFinished(s, released + 3000)).toBe(false)
    game.leave(s, 'a', released + 3000)
    expect(s.athletes.get('a')?.marks).toHaveLength(1)
    expect(game.isFinished(s, released + 3000)).toBe(true)
    expect(game.getResult(s).placements).toEqual(['a', 'b'])
  })

  test('an athlete without a valid mark ranks last with NM', () => {
    const game = new LongJump()
    const s = init(game, ['a', 'b'])
    attempt(game, s, 'a', 0, 0.5, 400)
    const result = game.getResult(s)
    expect(result.placements).toEqual(['a', 'b'])
    expect(result.stats?.b).toBe('NM')
  })
})

describe('FieldEvent (javelin)', () => {
  test('throws land tens of metres out', () => {
    const game = new JavelinThrow()
    const s = init(game, ['a'])
    attempt(game, s, 'a', 0, 0.5, 400)
    const mark = s.athletes.get('a')?.marks[0] as number
    expect(mark).toBeGreaterThan(55)
    expect(mark).toBeLessThan(110)
    expect(game.snapshot(s, 5000).foulLine).toBe(28)
  })
})
