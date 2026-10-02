import { describe, expect, test } from 'bun:test'
import type { GlassSide } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { GlassBridge, type GlassBridgeState } from './glassBridge'

const game = new GlassBridge()
const init = (players: string[], seed = 7, durationMs = 75_000): GlassBridgeState =>
  game.init({ players, seed, random: new SeededRandom(seed), now: 0, config: { durationMs } })
const other = (s: GlassSide): GlassSide => (s === 'L' ? 'R' : 'L')
const safeOf = (s: GlassBridgeState, row: number): GlassSide => s.safe[row] as GlassSide
// Advances the simulation tick by tick (50 ms, the default 20 Hz loop) up to `until`.
const run = (s: GlassBridgeState, from: number, until: number): number => {
  let t = from
  while (t < until) {
    t += 50
    game.tick(s, 50, t)
  }
  return t
}
// Runs until the active runner is deciding (or the round is over).
const toDecide = (s: GlassBridgeState, from: number): number => {
  let t = from
  while (s.phase !== 'decide' && s.phase !== 'done' && t < s.endsAt) t = run(s, t, t + 50)
  return t
}

describe('GlassBridge', () => {
  test('sizes the bridge from the field and seats a seeded vest order', () => {
    const players = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const s = init(players)
    expect(s.safe).toHaveLength(10)
    expect([...s.order].sort()).toEqual(players)
    expect(init(['a', 'b']).safe).toHaveLength(4) // small rooms still get a real bridge
    expect(init(Array.from({ length: 10 }, (_, i) => `p${i}`)).safe).toHaveLength(12)
    // #1 is up first and walks out after the lead-in.
    expect(s.active).toBe(s.order[0] ?? null)
    expect(s.runners.get(s.order[0] as string)?.vest).toBe(1)
    expect(s.phase).toBe('walk')
  })

  test('is deterministic per seed', () => {
    const a = init(['a', 'b', 'c', 'd'], 42)
    const b = init(['a', 'b', 'c', 'd'], 42)
    expect(a.order).toEqual(b.order)
    expect(a.safe).toEqual(b.safe)
    expect(a.glints).toEqual(b.glints)
  })

  test('a jump onto the tempered panel reveals the row and moves on to the next one', () => {
    const s = init(['a', 'b', 'c'])
    let t = toDecide(s, 0)
    expect(s.target).toBe(0)
    const runner = s.active as string
    game.onInput(s, runner, { kind: 'jump', side: safeOf(s, 0) }, t)
    expect(s.phase).toBe('jump')
    t = toDecide(s, t)
    expect(s.revealed[0]).toBe(true)
    expect(s.active).toBe(runner)
    expect(s.target).toBe(1)
    expect(s.runners.get(runner)?.reached).toBe(1)
  })

  test('a wrong jump shatters the panel, eliminates the runner and the next vest auto-walks', () => {
    const s = init(['a', 'b', 'c'])
    let t = toDecide(s, 0)
    const first = s.active as string
    game.onInput(s, first, { kind: 'jump', side: safeOf(s, 0) }, t)
    t = toDecide(s, t)
    game.onInput(s, first, { kind: 'jump', side: other(safeOf(s, 1)) }, t)
    t = run(s, t, t + 500)
    expect(s.phase).toBe('fall')
    expect(s.runners.get(first)?.status).toBe('fallen')
    expect(s.broken[1]).toBe(other(safeOf(s, 1)))
    expect(s.revealed[1]).toBe(true)
    // The next vest walks both solved rows without a decision and stops at row 2.
    const second = s.order[1] as string
    t = toDecide(s, t)
    expect(s.active).toBe(second)
    expect(s.target).toBe(2)
    expect(s.runners.get(second)?.pos).toBe(1)
  })

  test('only the active runner may jump; everyone else can point, and arrows reset per row', () => {
    const s = init(['a', 'b', 'c'])
    let t = toDecide(s, 0)
    const [active, waiting] = [s.active as string, s.order[1] as string]
    game.onInput(s, waiting, { kind: 'jump', side: 'L' }, t)
    expect(s.phase).toBe('decide')
    game.onInput(s, active, { kind: 'point', side: 'L' }, t)
    game.onInput(s, waiting, { kind: 'point', side: 'R' }, t)
    expect([...s.pointers]).toEqual([[waiting, 'R']])
    game.onInput(s, waiting, { kind: 'point', side: null }, t)
    expect(s.pointers.size).toBe(0)
    game.onInput(s, waiting, { kind: 'point', side: 'R' }, t)
    game.onInput(s, active, { kind: 'jump', side: safeOf(s, 0) }, t)
    t = toDecide(s, t)
    expect(s.target).toBe(1)
    expect(s.pointers.size).toBe(0)
    // Junk never throws or changes state.
    game.onInput(s, 'stranger', { kind: 'point', side: 'L' }, t)
    game.onInput(s, active, { kind: 'jump', side: 'X' as GlassSide }, t)
    expect(s.pointers.size).toBe(0)
    expect(s.phase).toBe('decide')
  })

  test('hesitating past the jump timer forces the seeded jump', () => {
    const s = init(['a', 'b'])
    const t = toDecide(s, 0)
    run(s, t, t + 4000)
    expect(s.phase).toBe('jump')
    expect(s.jumpSide).toBe(s.forced[0] ?? null)
  })

  test('the snapshot hides unrevealed panels except for the glint while a row is decided', () => {
    const s = init(['a', 'b', 'c'])
    const t = toDecide(s, 0)
    const snap = game.snapshot(s, t)
    expect(snap.rows.every((r) => r.safe === null && r.broken === null)).toBe(true)
    expect(snap.decideMs).toBeGreaterThan(0)
    // Hold the decision and look at the moment the first flash is lit.
    const at = s.glints[0] as number
    s.phaseEndsAt = at + 1000
    const lit = game.snapshot(s, at + 10)
    expect(lit.glint).toEqual({ id: 1, row: 0, side: safeOf(s, 0) })
    expect(game.snapshot(s, at + 400).glint).toBeNull()
  })

  test('crossing ends with everyone left walking the solved bridge; survivors share 1st', () => {
    const s = init(['a', 'b', 'c'])
    let t = 0
    const first = s.order[0] as string
    for (let row = 0; row < s.safe.length; row++) {
      t = toDecide(s, t)
      game.onInput(s, first, { kind: 'jump', side: safeOf(s, row) }, t)
    }
    // The other two auto-walk the fully solved bridge and cross without a single decision.
    while (s.phase !== 'done') t = run(s, t, t + 50)
    expect(game.isFinished(s, t)).toBe(true)
    expect(t).toBeLessThan(s.endsAt)
    const result = game.getResult(s)
    for (const id of s.order) {
      expect(s.runners.get(id)?.status).toBe('crossed')
      expect(result.ranks?.[id]).toBe(0)
      expect(result.stats?.[id]).toBe(`${s.safe.length}/${s.safe.length}`)
    }
  })

  test('ranks the fallen by rows reached; the clock ends the round for whoever is left', () => {
    const s = init(['a', 'b', 'c', 'd'], 3, 20_000)
    const [v1, v2] = [s.order[0] as string, s.order[1] as string]
    let t = toDecide(s, 0)
    game.onInput(s, v1, { kind: 'jump', side: other(safeOf(s, 0)) }, t) // #1 falls on row 0
    t = toDecide(s, t)
    expect(s.active).toBe(v2)
    game.onInput(s, v2, { kind: 'jump', side: safeOf(s, 1) }, t) // #2 walks row 0, lands row 1
    t = toDecide(s, t)
    game.onInput(s, v2, { kind: 'jump', side: other(safeOf(s, 2)) }, t) // …and falls on row 2
    t = toDecide(s, t)
    // #3 walked the three solved rows and is deciding row 3 when the bridge clock runs out.
    s.endsAt = t + 100
    run(s, t, s.endsAt)
    expect(s.phase).toBe('done')
    expect(game.isFinished(s, s.endsAt)).toBe(true)
    const result = game.getResult(s)
    expect(result.stats?.[v1]).toBe('0/6')
    expect(result.stats?.[v2]).toBe('2/6')
    // #3 stood on row 2 when time ran out (3 rows); #4 never left the platform.
    const [v3, v4] = [s.order[2] as string, s.order[3] as string]
    expect(result.placements[0]).toBe(v3)
    expect(result.ranks?.[v2]).toBeLessThan(result.ranks?.[v1] ?? -1)
    expect(result.ranks?.[v4]).toBe(result.ranks?.[v1])
  })
})
