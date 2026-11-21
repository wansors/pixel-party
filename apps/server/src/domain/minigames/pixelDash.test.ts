import { describe, expect, test } from 'bun:test'
import { DASH } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import type { Random } from '../ports/Random'
import { PixelDash, type PixelDashState } from './pixelDash'

const AIR_MS = DASH.airMs

// Deterministic RNG: next()=0.5 → every obstacle gap is FIRST/700+300 spacing, reproducible.
const half: Random = { next: () => 0.5 }
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const init = (players: string[], now = 0) =>
  new PixelDash().init({ players, seed: 1, random: half, now, config: { durationMs: 40_000 } })
// The ideal take-off for an obstacle: the apex of the jump right over it.
const apex = (s: PixelDashState, i: number): number =>
  s.startedAt + nn(s.obstacles[i]).arriveAt - AIR_MS / 2

// Plays a whole 30 s round from a list of press times (ticking along, so birds and trips resolve);
// returns the share of obstacles cleared.
function clearRate(
  seed: number,
  presses: (s: PixelDashState) => number[],
  finish?: (s: PixelDashState, game: PixelDash) => PixelDashState,
): number {
  const game = new PixelDash()
  let s = game.init({
    players: ['p'],
    seed,
    random: new SeededRandom(seed),
    now: 0,
    config: { durationMs: 30_000 },
  })
  for (const at of presses(s)) {
    s = game.tick(s, 0, at)
    s = game.onInput(s, 'p', { kind: 'jump' }, at)
  }
  if (finish) s = finish(s, game)
  return nn(s.cleared.get('p')).size / s.obstacles.length
}

describe('PixelDash', () => {
  test('builds a seeded obstacle track (deterministic from the Random port)', () => {
    const a = init(['p'])
    const b = init(['p'])
    expect(a.obstacles.length).toBeGreaterThan(0)
    expect(a.obstacles.map((o) => o.arriveAt)).toEqual(b.obstacles.map((o) => o.arriveAt))
    // First obstacle arrives ~1500ms in; gaps are positive and increasing.
    expect(nn(a.obstacles[0]).arriveAt).toBe(1500)
    expect(nn(a.obstacles[1]).arriveAt).toBeGreaterThan(nn(a.obstacles[0]).arriveAt)
  })

  test('being in the air when an obstacle arrives clears it; a perfect apex costs no accuracy', () => {
    const game = new PixelDash()
    let s = init(['p'])
    s = game.onInput(s, 'p', { kind: 'jump' }, apex(s, 0))
    expect(s.cleared.get('p')?.size).toBe(1)
    expect(s.timingError.get('p')).toBe(0)
    expect(s.stumbles.get('p')).toBe(0)
  })

  test('a jump that lands before the obstacle arrives clears nothing — the obstacle trips you', () => {
    const game = new PixelDash()
    let s = init(['p'])
    const o = nn(s.obstacles[0])
    s = game.onInput(s, 'p', { kind: 'jump' }, s.startedAt + o.arriveAt - AIR_MS - 100)
    expect(s.cleared.get('p')?.size).toBe(0)
    s = game.tick(s, 50, s.startedAt + o.arriveAt + 500)
    expect(s.stumbles.get('p')).toBe(1)
  })

  test('no jumping again while airborne or landing; a wasted jump grounds you longer', () => {
    const game = new PixelDash()
    let s = init(['p'])
    const t0 = apex(s, 0)
    s = game.onInput(s, 'p', { kind: 'jump' }, t0)
    expect(s.readyAt.get('p')).toBeGreaterThan(t0 + AIR_MS)
    // A clearing jump: the next one is allowed a short landing later...
    const clearReady = nn(s.readyAt.get('p'))
    // ...a wasted one (nothing arriving while airborne) costs a longer recovery.
    s = game.onInput(s, 'p', { kind: 'jump' }, clearReady)
    expect(nn(s.readyAt.get('p')) - clearReady).toBeGreaterThan(clearReady - t0)
    // Presses before then don't even take off: obstacle 1 isn't cleared by a press in its window.
    const second = apex(s, 1)
    expect(second).toBeLessThan(nn(s.readyAt.get('p')))
    s = game.onInput(s, 'p', { kind: 'jump' }, second)
    expect(s.cleared.get('p')?.size).toBe(1)
  })

  test('an obstacle passing without a jump becomes a stumble via tick (once)', () => {
    const game = new PixelDash()
    let s = init(['p'])
    const o = nn(s.obstacles[0])
    const now = s.startedAt + o.arriveAt + 500 // well past arrival + the late grace
    s = game.tick(s, 50, now)
    expect(s.stumbles.get('p')).toBe(1)
    expect(s.resolvedMiss.get('p')?.has(o.id)).toBe(true)
    // Ticking again does not double-count.
    s = game.tick(s, 50, now + 50)
    expect(s.stumbles.get('p')).toBe(1)
  })

  test('mashing jump every 200 ms no longer clears the track; timed jumps mostly do', () => {
    let mash = 0
    let timed = 0
    let perfect = 0
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8]
    const finish = (s: PixelDashState, game: PixelDash) => game.tick(s, 0, s.endsAt + 1000)
    for (const seed of seeds) {
      mash += clearRate(seed, () => Array.from({ length: 150 }, (_, i) => i * 200), finish)
      // A decent human: aims at the apex of every ground obstacle, up to ±80 ms off (a fixed spread,
      // no RNG needed), and stays down for the birds — the tight pairs still catch them out now and then.
      timed += clearRate(
        seed,
        (s) =>
          s.obstacles.flatMap((o, i) =>
            o.high ? [] : [o.arriveAt - AIR_MS / 2 + ((i * 37) % 161) - 80],
          ),
        finish,
      )
      perfect += clearRate(
        seed,
        (s) => s.obstacles.flatMap((o) => (o.high ? [] : [o.arriveAt - AIR_MS / 2])),
        finish,
      )
    }
    expect(mash / seeds.length).toBeLessThan(0.5)
    expect(timed / seeds.length).toBeGreaterThan(0.8)
    expect(timed / seeds.length).toBeLessThan(0.99)
    expect(perfect / seeds.length).toBe(1)
  })

  test('ranks more clears first; equal clears go to the more accurate jumper', () => {
    const game = new PixelDash()
    let s = init(['sharp', 'sloppy', 'idle'])
    s = game.onInput(s, 'sharp', { kind: 'jump' }, apex(s, 0) + 10)
    s = game.onInput(s, 'sloppy', { kind: 'jump' }, apex(s, 0) + 150)
    const result = game.getResult(s)
    expect(result.placements).toEqual(['sharp', 'sloppy', 'idle'])
    expect(result.ranks).toEqual({ sharp: 0, sloppy: 1, idle: 2 })
    expect(result.stats?.sharp).toBe('1 cleared')
  })

  test('snapshot shows obstacles approaching and just past, plus everyone`s stumbles', () => {
    const game = new PixelDash()
    let s = init(['p'])
    const first = nn(s.obstacles[0])
    // Sample when the first obstacle is ~half a lead-window away.
    const snap = game.snapshot(s, s.startedAt + first.arriveAt - 600)
    expect(snap.obstacles.some((o) => o.id === first.id)).toBe(true)
    expect(snap.obstacles.every((o) => o.t >= -0.35 && o.t <= 1.15)).toBe(true)
    expect(snap.scores.p).toBe(0)
    // Past the runner it stays on the wire (scrolling off) and its stumble is reported.
    const past = s.startedAt + first.arriveAt + 200
    s = game.tick(s, 50, past)
    const later = game.snapshot(s, past)
    expect(later.obstacles.find((o) => o.id === first.id)?.t).toBeLessThan(0)
    expect(later.stumbles.p).toBe(1)
  })
})

describe('PixelDash track ramp', () => {
  test('obstacles come closer together late in the round, never closer than a jump and a landing', () => {
    const game = new PixelDash()
    for (const r of [0, 0.5, 0.99]) {
      const s = game.init({ players: ['p'], seed: 1, random: { next: () => r }, now: 0 })
      const gaps = s.obstacles.slice(1).map((o, i) => o.arriveAt - (s.obstacles[i]?.arriveAt ?? 0))
      expect(gaps.at(-1) ?? 0).toBeLessThan(gaps[0] ?? 0)
      // A jump plus a landing always fits between two obstacles (pairs included).
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(DASH.airMs + DASH.landMs)
    }
  })

  test('the squeeze is non-linear: gaps and the lead window shrink most in the last quarter', () => {
    const game = new PixelDash()
    const s = game.init({ players: ['p'], seed: 1, random: { next: () => 0.5 }, now: 0 })
    const gapAt = (ms: number): number => {
      const i = s.obstacles.findIndex((o) => o.arriveAt >= ms)
      return nn(s.obstacles[i]).arriveAt - nn(s.obstacles[i - 1]).arriveAt
    }
    expect(gapAt(30_000) - gapAt(38_000)).toBeGreaterThan(2 * (gapAt(2000) - gapAt(10_000)))
    const leadAt = (ms: number): number => game.snapshot(s, ms).leadMs ?? 0
    expect(leadAt(0)).toBe(1200)
    expect(leadAt(40_000)).toBe(600)
    expect(leadAt(30_000) - leadAt(40_000)).toBeGreaterThan(2 * (leadAt(0) - leadAt(10_000)))
  })
})

describe('PixelDash birds, pairs and trips (D53)', () => {
  // next() = 0 → a bird whenever one may come (every other obstacle from a fifth in), and pairs.
  const busy = () =>
    new PixelDash().init({
      players: ['p'],
      seed: 1,
      random: { next: () => 0 },
      now: 0,
      config: { durationMs: 40_000 },
    })

  test('birds only from a fifth of the round in, never two in a row; pairs only from 35 %', () => {
    const s = busy()
    const birds = s.obstacles.filter((o) => o.high)
    expect(birds.length).toBeGreaterThan(5)
    for (const b of birds) expect(b.arriveAt).toBeGreaterThanOrEqual(40_000 * 0.2)
    s.obstacles.forEach((o, i) => {
      if (o.high) expect(s.obstacles[i - 1]?.high).toBe(false)
    })
    const pairGap = DASH.airMs + DASH.landMs + 70
    const pairs = s.obstacles
      .slice(1)
      .filter((o, i) => o.arriveAt - nn(s.obstacles[i]).arriveAt === pairGap)
    expect(pairs.length).toBeGreaterThan(0)
    for (const o of pairs) expect(o.arriveAt).toBeGreaterThanOrEqual(40_000 * 0.35)
  })

  test('a bird passes over a runner who stays down: it counts as cleared', () => {
    const game = new PixelDash()
    let s = busy()
    const bird = nn(s.obstacles.find((o) => o.high))
    s = game.tick(s, 0, s.startedAt + bird.arriveAt + 200)
    expect(s.cleared.get('p')?.has(bird.id)).toBe(true)
  })

  test('jumping into a bird knocks you down when it arrives, and trips you', () => {
    const game = new PixelDash()
    let s = busy()
    const bird = nn(s.obstacles.find((o) => o.high))
    const arrive = s.startedAt + bird.arriveAt
    s = game.tick(s, 0, arrive - 120)
    const before = nn(s.stumbles.get('p'))
    s = game.onInput(s, 'p', { kind: 'jump' }, arrive - 100)
    // Not yet: the stumble lands when the bird does.
    expect(s.stumbles.get('p')).toBe(before)
    s = game.tick(s, 0, arrive + 100)
    expect(s.stumbles.get('p')).toBe(before + 1)
    expect(s.resolvedMiss.get('p')?.has(bird.id)).toBe(true)
    expect(s.cleared.get('p')?.has(bird.id)).toBe(false)
    expect(nn(s.readyAt.get('p'))).toBeGreaterThanOrEqual(arrive + DASH.tripMs - 40)
  })

  test('a ground obstacle that gets past you trips you too', () => {
    const game = new PixelDash()
    let s = init(['p'])
    const o = nn(s.obstacles[0])
    const arrive = s.startedAt + o.arriveAt
    s = game.tick(s, 0, arrive + 100)
    expect(nn(s.readyAt.get('p'))).toBeGreaterThanOrEqual(arrive + DASH.tripMs - 40)
    // A press while tripped doesn't take off.
    const before = nn(s.readyAt.get('p'))
    s = game.onInput(s, 'p', { kind: 'jump' }, arrive + 150)
    expect(s.readyAt.get('p')).toBe(before)
  })

  test('the snapshot flags birds', () => {
    const game = new PixelDash()
    const s = busy()
    const bird = nn(s.obstacles.find((o) => o.high))
    const snap = game.snapshot(s, s.startedAt + bird.arriveAt - 300)
    expect(snap.obstacles.find((o) => o.id === bird.id)?.high).toBe(true)
    expect(snap.obstacles.filter((o) => o.id !== bird.id).every((o) => o.high === undefined)).toBe(
      true,
    )
  })
})
