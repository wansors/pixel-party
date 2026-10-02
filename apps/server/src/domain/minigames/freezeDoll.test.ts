import { describe, expect, test } from 'bun:test'
import { FREEZE_DOLL_SWEEP } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { FreezeDoll, type FreezeDollState } from './freezeDoll'

const game = new FreezeDoll()
const init = (players: string[], seed = 5, durationMs = 50_000): FreezeDollState =>
  game.init({ players, seed, random: new SeededRandom(seed), now: 0, config: { durationMs } })
const runner = (s: FreezeDollState, id: string) => {
  const r = s.runners.find((x) => x.id === id)
  if (!r) throw new Error(`no runner ${id}`)
  return r
}
const seg = (s: FreezeDollState, light: string, nth = 0) => {
  const found = s.timeline.filter((x) => x.light === light)[nth]
  if (!found) throw new Error(`no ${light} #${nth}`)
  return found
}
// Ticks at the default 20 Hz from `from` (exclusive) to `to` (inclusive).
const run = (s: FreezeDollState, from: number, to: number): void => {
  for (let t = from + 50; t <= to; t += 50) game.tick(s, 50, t)
}

describe('FreezeDoll', () => {
  test('one lane per player, everyone on the start line with two hearts', () => {
    const s = init(['a', 'b', 'c', 'd'])
    expect(s.runners.map((r) => r.lane)).toEqual([0, 1, 2, 3])
    expect(s.runners.map((r) => r.id).sort()).toEqual(['a', 'b', 'c', 'd'])
    for (const r of s.runners) {
      expect(r.x).toBe(0)
      expect(r.hearts).toBe(2)
    }
  })

  test('the doll timeline is seeded, gapless and opens with a calm first chant', () => {
    const s = init(['a', 'b'], 9)
    expect(init(['a', 'b'], 9).timeline).toEqual(s.timeline)
    expect(s.timeline[0]?.light).toBe('ready')
    for (let i = 1; i < s.timeline.length; i++) {
      expect(s.timeline[i]?.from).toBe(s.timeline[i - 1]?.to ?? -1)
    }
    expect(s.timeline.at(-1)?.to ?? 0).toBeGreaterThanOrEqual(s.endsAt)
    const first = seg(s, 'green')
    expect(first.songMs).toBeGreaterThanOrEqual(3200)
    // Every real turn (the TURN right before a RED) in the first two cycles waits for the chant's end.
    const reals = s.timeline.filter(
      (x, i) => x.light === 'turn' && s.timeline[i + 1]?.light === 'red',
    )
    for (const t of reals.slice(0, 2)) expect(t.songFrozen).toBe(t.songMs)
  })

  test('nobody moves during the opening; WALK moves, RUN moves faster', () => {
    const s = init(['a', 'b'])
    game.onInput(s, 'a', { kind: 'move', mode: 'walk' }, 0)
    game.onInput(s, 'b', { kind: 'move', mode: 'run' }, 0)
    const ready = seg(s, 'ready')
    run(s, 0, ready.to - 50)
    expect(runner(s, 'a').x).toBe(0)
    const green = seg(s, 'green')
    run(s, ready.to - 50, green.from + 1000)
    expect(runner(s, 'a').x).toBeGreaterThan(0.03)
    expect(runner(s, 'b').x).toBeGreaterThan(runner(s, 'a').x * 1.4)
  })

  test('momentum: letting go of RUN slides much longer than letting go of WALK', () => {
    const s = init(['a', 'b'])
    const green = seg(s, 'green')
    game.onInput(s, 'a', { kind: 'move', mode: 'walk' }, 0)
    game.onInput(s, 'b', { kind: 'move', mode: 'run' }, 0)
    run(s, 0, green.from + 1500)
    game.onInput(s, 'a', { kind: 'move', mode: 'stop' }, green.from + 1500)
    game.onInput(s, 'b', { kind: 'move', mode: 'stop' }, green.from + 1500)
    run(s, green.from + 1500, green.from + 1700)
    expect(runner(s, 'a').v).toBe(0) // ~150 ms glide
    expect(runner(s, 'b').v).toBeGreaterThan(0) // still sliding
    run(s, green.from + 1700, green.from + 1950)
    expect(runner(s, 'b').v).toBe(0) // ~400 ms glide
  })

  test('the laser hits whoever still moves once the sweep reaches their lane', () => {
    const s = init(['a', 'b'], 5)
    const red = seg(s, 'red')
    // Two lanes: lane 0 is judged at +delay, lane 1 at +delay+ms (or the other way round).
    const [first, last] =
      red.dir === 1 ? [s.runners[0], s.runners[1]] : [s.runners[1], s.runners[0]]
    if (!first || !last) throw new Error('two runners expected')
    for (const r of s.runners) game.onInput(s, r.id, { kind: 'move', mode: 'walk' }, 0)
    run(s, 0, red.from + FREEZE_DOLL_SWEEP.delayMs + 50)
    expect(first.status).toBe('stunned')
    expect(first.hearts).toBe(1)
    expect(last.status).toBe('racing')
    // The later lane still had time to stop: freeze now and the beam finds nothing.
    game.onInput(s, last.id, { kind: 'move', mode: 'stop' }, red.from + 150)
    run(s, red.from + FREEZE_DOLL_SWEEP.delayMs + 50, red.to - 50)
    expect(last.hearts).toBe(2)
    // One hit per RED: the stunned runner, still holding WALK after the stun, is not hit again.
    expect(first.hearts).toBe(1)
  })

  test('a hit knocks the runner back; a second hit in a later RED eliminates them', () => {
    const s = init(['a', 'b'], 5)
    const a = runner(s, 'a')
    game.onInput(s, 'a', { kind: 'move', mode: 'run' }, 0)
    const red0 = seg(s, 'red')
    run(s, 0, red0.from - 50)
    const before = a.x
    run(s, red0.from - 50, red0.to)
    expect(a.hearts).toBe(1)
    expect(a.x).toBeLessThan(before)
    const red1 = seg(s, 'red', 1)
    run(s, red0.to, red1.to)
    expect(a.status).toBe('out')
    expect(a.outAt).toBeGreaterThan(red1.from)
    expect(game.isFinished(s, red1.to)).toBe(true) // only one runner left in the race
  })

  test('standing still through RED and moving during the head twitch are both safe', () => {
    const s = init(['a', 'b'], 5)
    const turn = s.timeline.find((x, i) => x.light === 'turn' && s.timeline[i + 1]?.light === 'red')
    if (!turn) throw new Error('no real turn')
    game.onInput(s, 'a', { kind: 'move', mode: 'walk' }, 0)
    run(s, 0, turn.from + 100)
    game.onInput(s, 'a', { kind: 'move', mode: 'stop' }, turn.from + 100)
    const red = seg(s, 'red')
    run(s, turn.from + 100, red.to)
    expect(runner(s, 'a').hearts).toBe(2)
    expect(runner(s, 'b').hearts).toBe(2)
  })

  test('ranks finishers by time, then distance, then the eliminated (last out first)', () => {
    const s = init(['a', 'b', 'c', 'd', 'e'])
    const at = (id: string, patch: Partial<ReturnType<typeof runner>>) =>
      Object.assign(runner(s, id), patch)
    at('a', { status: 'finished', x: 1, finishAt: 30_000 })
    at('b', { status: 'finished', x: 1, finishAt: 25_000 })
    at('c', { x: 0.6 })
    at('d', { status: 'out', x: 0.7, outAt: 20_000 })
    at('e', { status: 'out', x: 0.2, outAt: 10_000 })
    const result = game.getResult(s)
    expect(result.placements).toEqual(['b', 'a', 'c', 'd', 'e'])
    expect(result.stats?.b).toBe('25.0s')
    expect(result.stats?.c).toBe('60%')
    expect(game.isFinished(s, 31_000)).toBe(true) // c is the only one still racing
  })

  test('ignores junk input and inputs after the bell', () => {
    const s = init(['a'])
    game.onInput(s, 'a', { kind: 'move', mode: 'fly' as 'run' }, 0)
    game.onInput(s, 'zz', { kind: 'move', mode: 'run' }, 0)
    expect(runner(s, 'a').mode).toBe('stop')
    game.onInput(s, 'a', { kind: 'move', mode: 'run' }, s.endsAt)
    expect(runner(s, 'a').mode).toBe('stop')
    // A lone player keeps racing until they finish or the clock runs out.
    expect(game.isFinished(s, 1000)).toBe(false)
  })
})
