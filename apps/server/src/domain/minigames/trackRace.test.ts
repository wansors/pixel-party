import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { MIN_STRIDE_MS } from './athleticsCore'
import { AIR_MS, Dash100m, FALSE_START_PENALTY_MS, HURDLES_110M, Hurdles110m } from './trackRace'
import type { TrackRaceState } from './trackRace'

// next()=0.5 → the gun fires at 1600 + 700 = 2300 ms after the round starts.
const half: Random = { next: () => 0.5 }
const GUN = 2300
const TICK = 50

const initDash = (players: string[]) =>
  new Dash100m().init({ players, seed: 1, random: half, now: 0, config: { durationMs: 30_000 } })
const initHurdles = (players: string[]) =>
  new Hurdles110m().init({ players, seed: 1, random: half, now: 0, config: { durationMs: 35_000 } })

// Drives the race tick by tick from `from` to `to`, letting `each` inject inputs at every tick.
function run(
  game: Dash100m | Hurdles110m,
  s: TrackRaceState,
  from: number,
  to: number,
  each: (now: number) => void = () => {},
): TrackRaceState {
  let state = s
  for (let now = from; now <= to; now += TICK) {
    each(now)
    state = game.tick(state, TICK, now)
  }
  return state
}

// A runner alternating feet every `gapMs` from the gun on.
const alternate =
  (game: Dash100m | Hurdles110m, s: TrackRaceState, pid: string, gapMs: number, start = GUN) =>
  (now: number) => {
    if (now < start || (now - start) % gapMs !== 0) return
    const foot = ((now - start) / gapMs) % 2 === 0 ? 'L' : 'R'
    game.onInput(s, pid, { kind: 'step', foot }, now)
  }

describe('TrackRace (100 m dash)', () => {
  test('stays in the blocks until the seeded gun, then phase flips to go', () => {
    const game = new Dash100m()
    const s = initDash(['a'])
    expect(s.gunAt).toBe(GUN)
    expect(game.snapshot(s, GUN - 1).phase).toBe('set')
    expect(game.snapshot(s, GUN).phase).toBe('go')
    expect(game.snapshot(s, GUN + 500).raceMs).toBe(500)
  })

  test('only alternating feet build speed', () => {
    const game = new Dash100m()
    const s = initDash(['alt', 'same'])
    game.onInput(s, 'alt', { kind: 'step', foot: 'L' }, GUN + 100)
    game.onInput(s, 'alt', { kind: 'step', foot: 'R' }, GUN + 200)
    game.onInput(s, 'same', { kind: 'step', foot: 'L' }, GUN + 100)
    game.onInput(s, 'same', { kind: 'step', foot: 'L' }, GUN + 200)
    const alt = s.lanes.get('alt')?.runner.v ?? 0
    const same = s.lanes.get('same')?.runner.v ?? 0
    expect(alt).toBeGreaterThan(same)
  })

  test('strides faster than the rate cap are ignored', () => {
    const game = new Dash100m()
    const s = initDash(['a'])
    game.onInput(s, 'a', { kind: 'step', foot: 'L' }, GUN + 100)
    const v1 = s.lanes.get('a')?.runner.v
    game.onInput(s, 'a', { kind: 'step', foot: 'R' }, GUN + 100 + MIN_STRIDE_MS - 1)
    expect(s.lanes.get('a')?.runner.v).toBe(v1 as number)
  })

  test('a stride before the gun is a false start held in the blocks after it', () => {
    const game = new Dash100m()
    const s = initDash(['a'])
    game.onInput(s, 'a', { kind: 'step', foot: 'L' }, GUN - 300)
    expect(s.lanes.get('a')?.falseStart).toBe(true)
    // Held: taps during the penalty do nothing.
    game.onInput(s, 'a', { kind: 'step', foot: 'R' }, GUN + 200)
    expect(s.lanes.get('a')?.runner.v).toBe(0)
    expect(game.snapshot(s, GUN + 200).runners[0]?.held).toBe(true)
    // Free to go once the penalty is served.
    game.onInput(s, 'a', { kind: 'step', foot: 'L' }, GUN + FALSE_START_PENALTY_MS)
    expect(s.lanes.get('a')?.runner.v).toBeGreaterThan(0)
  })

  test('the faster tapper wins; ranks by race time with a stats string', () => {
    const game = new Dash100m()
    let s = initDash(['fast', 'slow', 'idle'])
    s = run(game, s, GUN, 25_000, (now) => {
      alternate(game, s, 'fast', 100)(now)
      alternate(game, s, 'slow', 200)(now)
    })
    const fast = s.lanes.get('fast')
    const slow = s.lanes.get('slow')
    expect(fast?.finishAt).toBeGreaterThan(0)
    expect(slow?.finishAt).toBeGreaterThan(fast?.finishAt as number)
    const result = game.getResult(s)
    expect(result.placements).toEqual(['fast', 'slow', 'idle'])
    expect(result.stats?.fast).toMatch(/^\d+\.\d\ds$/)
    expect(result.stats?.idle).toBe('0m')
    // 10 strides/s ≈ 9.3 m/s cruising: a plausible sprint time.
    const secs = ((fast?.finishAt as number) - GUN) / 1000
    expect(secs).toBeGreaterThan(9.5)
    expect(secs).toBeLessThan(13)
  })

  test('the first finish closes the round after the finish window; all home ends it early', () => {
    const game = new Dash100m()
    let s = initDash(['a', 'b'])
    s = run(game, s, GUN, 16_000, alternate(game, s, 'a', 100))
    const finishAt = s.lanes.get('a')?.finishAt as number
    expect(finishAt).toBeGreaterThan(0)
    expect(s.endsAt).toBeLessThanOrEqual(finishAt + 10_000 + TICK)
    expect(game.isFinished(s, 16_000)).toBe(false)
    expect(game.isFinished(s, s.endsAt)).toBe(true)

    let solo = initDash(['a'])
    solo = run(game, solo, GUN, 16_000, alternate(game, solo, 'a', 100))
    expect(game.isFinished(solo, 16_000)).toBe(true)
  })

  test('snapshot reports places for finishers', () => {
    const game = new Dash100m()
    let s = initDash(['a', 'b'])
    s = run(game, s, GUN, 18_000, (now) => {
      alternate(game, s, 'a', 100)(now)
      alternate(game, s, 'b', 150)(now)
    })
    const snap = game.snapshot(s, 18_000)
    expect(snap.runners.find((r) => r.id === 'a')?.place).toBe(1)
    expect(snap.runners.find((r) => r.id === 'b')?.place).toBe(2)
    expect(snap.hurdles).toEqual([])
  })

  test('ignores junk input kinds and bad feet', () => {
    const game = new Dash100m()
    const s = initDash(['a'])
    game.onInput(s, 'a', { kind: 'mash' } as never, GUN + 100)
    game.onInput(s, 'a', { kind: 'step', foot: 'X' } as never, GUN + 100)
    game.onInput(s, 'a', { kind: 'jump' }, GUN + 100)
    const lane = s.lanes.get('a')
    expect(lane?.runner.v).toBe(0)
    expect(lane?.airUntil).toBe(0)
  })
})

describe('TrackRace (110 m hurdles)', () => {
  test('uses the regulation hurdle layout', () => {
    expect(HURDLES_110M).toHaveLength(10)
    expect(HURDLES_110M[0]).toBe(13.72)
    expect(HURDLES_110M[9]).toBeCloseTo(13.72 + 9 * 9.14, 2)
    expect(initHurdles(['a']).distance).toBe(110)
  })

  test('running into a hurdle knocks it down and costs speed', () => {
    const game = new Hurdles110m()
    let s = initHurdles(['a'])
    let vBefore = 0
    s = run(game, s, GUN, 6000, (now) => {
      alternate(game, s, 'a', 100)(now)
      const lane = s.lanes.get('a')
      if (lane && lane.knocked.length === 0) vBefore = lane.runner.v
    })
    const lane = s.lanes.get('a')
    expect(lane?.knocked[0]).toBe(0)
    expect(lane?.runner.v ?? 0).toBeLessThan(vBefore)
  })

  test('jumping just before a hurdle clears it; no strides count in the air', () => {
    const game = new Hurdles110m()
    let s = initHurdles(['a'])
    let jumped = false
    s = run(game, s, GUN, 6000, (now) => {
      const lane = s.lanes.get('a')
      if (!lane) return
      const ahead = (HURDLES_110M[0] as number) - lane.runner.x
      if (!jumped && ahead > 0 && ahead < 2) {
        jumped = true
        game.onInput(s, 'a', { kind: 'jump' }, now)
        const v = lane.runner.v
        game.onInput(s, 'a', { kind: 'step', foot: lane.runner.lastFoot === 'L' ? 'R' : 'L' }, now)
        expect(lane.runner.v).toBe(v)
      }
      alternate(game, s, 'a', 100)(now)
    })
    expect(jumped).toBe(true)
    expect(s.lanes.get('a')?.knocked.includes(0)).toBe(false)
    expect(game.snapshot(s, 6000).runners[0]?.air).toBe(false)
  })

  test('a jump is airborne for AIR_MS and cannot be re-triggered mid-air', () => {
    const game = new Hurdles110m()
    const s = initHurdles(['a'])
    game.onInput(s, 'a', { kind: 'jump' }, GUN + 100)
    game.onInput(s, 'a', { kind: 'jump' }, GUN + 200)
    expect(s.lanes.get('a')?.airUntil).toBe(GUN + 100 + AIR_MS)
    const snap = game.snapshot(s, GUN + 100 + AIR_MS / 2)
    expect(snap.runners[0]?.air).toBe(true)
    expect(snap.runners[0]?.airT).toBeCloseTo(0.5, 1)
  })
})
