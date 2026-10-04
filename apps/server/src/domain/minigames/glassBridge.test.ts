import { describe, expect, test } from 'bun:test'
import type { GlassSide } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { decideMsFor, GlassBridge, type GlassBridgeState } from './glassBridge'

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

  test('the solver outranks the vests who walk the solved bridge after them', () => {
    const s = init(['a', 'b', 'c'])
    let t = 0
    const first = s.order[0] as string
    for (let row = 0; row < s.safe.length; row++) {
      t = toDecide(s, t)
      game.onInput(s, first, { kind: 'jump', side: safeOf(s, row) }, t)
    }
    // Nothing left to decide: the other two stroll across the solved bridge at once.
    t = run(s, t, t + 500)
    expect(game.isFinished(s, t)).toBe(true)
    const result = game.getResult(s)
    const rows = s.safe.length
    for (const id of s.order) expect(s.runners.get(id)?.status).toBe('crossed')
    // Every row was a blind step for #1 (+1 for crossing); the walkers only get the crossing ★, and
    // having had nothing to decide they're excused from the idle demotion.
    expect(result.placements[0]).toBe(first)
    expect(result.stats?.[first]).toBe(`★${rows + 1} · ${rows}/${rows}`)
    const [v2, v3] = [s.order[1] as string, s.order[2] as string]
    expect(result.ranks?.[v2]).toBe(1)
    expect(result.ranks?.[v3]).toBe(1)
    expect(result.stats?.[v2]).toBe(`★1 · ${rows}/${rows}`)
    expect(result.waiting).toEqual([v2, v3])
  })

  test('a jump on a glint you saw holds but scores no ★; one too quick to react still does', () => {
    const s = init(['a', 'b', 'c'])
    let t = toDecide(s, 0)
    const runner = s.active as string
    // Row 0: wait for the first flash and jump on it once it has been lit long enough to read.
    const glint = s.glints[0] as number
    s.phaseEndsAt = glint + 2000
    t = run(s, t, glint + 300)
    game.onInput(s, runner, { kind: 'jump', side: safeOf(s, 0) }, t)
    t = toDecide(s, t)
    expect(s.target).toBe(1)
    expect(s.runners.get(runner)?.blind).toBe(0)
    expect(game.snapshot(s, t).players.find((p) => p.id === runner)?.score).toBe(0)
    // Row 1: a flash right as you jump is too late to have helped — still a blind step.
    const next = s.glints.find((at) => at > t) as number
    s.phaseEndsAt = next + 2000
    t = run(s, t, next + 100)
    game.onInput(s, runner, { kind: 'jump', side: safeOf(s, 1) }, t)
    toDecide(s, t)
    expect(s.runners.get(runner)?.blind).toBe(1)
  })

  test('the buzzer credits an unfinished turn; queued vests are excused, not ranked with the fallen', () => {
    const s = init(['a', 'b', 'c', 'd'], 3, 20_000)
    const [v1, v2] = [s.order[0] as string, s.order[1] as string]
    let t = toDecide(s, 0)
    game.onInput(s, v1, { kind: 'jump', side: other(safeOf(s, 0)) }, t) // #1 falls on row 0
    t = toDecide(s, t)
    expect(s.active).toBe(v2)
    game.onInput(s, v2, { kind: 'jump', side: safeOf(s, 1) }, t) // #2 walks row 0, lands row 1 blind
    t = toDecide(s, t)
    game.onInput(s, v2, { kind: 'jump', side: safeOf(s, 2) }, t) // …lands row 2 blind
    t = toDecide(s, t)
    game.onInput(s, v2, { kind: 'jump', side: other(safeOf(s, 3)) }, t) // …and falls on row 3
    t = toDecide(s, t)
    // #3 walked the four solved rows and is deciding row 4 when the bridge clock runs out.
    const [v3, v4] = [s.order[2] as string, s.order[3] as string]
    expect(s.active).toBe(v3)
    s.endsAt = t + 100
    run(s, t, s.endsAt)
    expect(s.phase).toBe('done')
    expect(game.isFinished(s, s.endsAt)).toBe(true)
    const result = game.getResult(s)
    expect(result.stats?.[v1]).toBe('★0 · 0/6')
    expect(result.stats?.[v2]).toBe('★2 · 3/6')
    // #3 (cut short on the bridge) and #4 (never left the platform) get the turn's par ★.
    expect(result.stats?.[v3]).toBe('★1 · 4/6')
    expect(result.stats?.[v4]).toBe('★1 · 0/6')
    expect(result.placements[0]).toBe(v2)
    expect(result.ranks?.[v3]).toBe(1)
    expect(result.ranks?.[v4]).toBe(1)
    expect(result.ranks?.[v1]).toBe(3)
    // #4 never had a jump timer; #3 did (and must have acted to escape the idle demotion).
    expect(result.waiting).toEqual([v4])
  })

  test('a leaver in the queue is skipped; a leaver on the bridge hands it to the next vest', () => {
    const s = init(['a', 'b', 'c', 'd'])
    const [v1, v2, v3, v4] = s.order as [string, string, string, string]
    let t = toDecide(s, 0)
    game.leave(s, v2, t)
    game.onInput(s, v2, { kind: 'point', side: 'L' }, t)
    expect(s.runners.get(v2)?.status).toBe('left')
    game.onInput(s, v1, { kind: 'jump', side: other(safeOf(s, 0)) }, t) // #1 falls
    t = toDecide(s, t)
    expect(s.active).toBe(v3)
    game.leave(s, v3, t) // gone mid-decision: #4 walks out at once
    expect(s.runners.get(v3)?.status).toBe('left')
    expect(s.active).toBe(v4)
    t = toDecide(s, t)
    expect(s.target).toBe(1)
    game.onInput(s, v4, { kind: 'jump', side: other(safeOf(s, 1)) }, t)
    while (s.phase !== 'done' && t < s.endsAt) t = run(s, t, t + 50)
    // Nobody left to cross: the round ends early instead of waiting on the gone seats.
    expect(game.isFinished(s, t)).toBe(true)
    expect(t).toBeLessThan(s.endsAt)
    expect(game.snapshot(s, t).players.map((p) => p.status)).toEqual([
      'fallen',
      'left',
      'left',
      'fallen',
    ])
    expect(game.getResult(s).waiting).toEqual([])
  })

  test('big rooms get a shorter jump timer, so every vest gets a turn even if all stall', () => {
    expect(decideMsFor(8, 10, 75_000)).toBe(4000)
    expect(decideMsFor(9, 11, 75_000)).toBe(4000)
    expect(decideMsFor(10, 12, 75_000)).toBe(3800)
    expect(decideMsFor(12, 12, 75_000)).toBe(3500)
    expect(decideMsFor(12, 12, 30_000)).toBe(2000)
    for (let seed = 1; seed <= 40; seed++) {
      const players = Array.from({ length: 12 }, (_, i) => `p${i}`)
      const s = init(players, seed)
      expect(game.snapshot(s, 0).decideTotalMs).toBe(3500)
      // Nobody touches anything: every jump is forced at the end of the timer.
      run(s, 0, s.endsAt)
      for (const id of players) {
        const r = s.runners.get(id)
        expect(r?.decided || r?.status === 'crossed').toBe(true)
      }
      expect(s.phase).toBe('done')
    }
  })
})
