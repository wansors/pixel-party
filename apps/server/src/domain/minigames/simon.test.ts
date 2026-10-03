import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { Simon, type SimonState } from './simon'

// Small seeded generator (mulberry32) so sequences and relabellings are real but reproducible.
function seeded(seed: number): Random {
  let a = seed >>> 0
  return {
    next: () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), a | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

const init = (players: string[], seed = 1): SimonState =>
  new Simon().init({ players, seed, random: seeded(seed), now: 0, config: { durationMs: 60_000 } })

// The i-th pad as `id` sees it (from their own snapshot view once it's long enough).
const padOf = (s: SimonState, id: string, i: number): number => {
  const p = s.ps.get(id)
  if (!p) throw new Error(`no player ${id}`)
  return p.pads[s.seq[i] as number] as number
}
const pad = (n: number) => ({ kind: 'pad' as const, pad: n })

// Plays `id` through `levels` full levels, one pad per ms from `t`; returns the time after.
function clear(game: Simon, s: SimonState, id: string, levels: number, t: number): number {
  let now = t
  const start = (s.ps.get(id)?.level ?? 1) - 1
  for (let level = start + 1; level <= start + levels; level++) {
    for (let i = 0; i < level; i++) game.onInput(s, id, pad(padOf(s, id, i)), now++)
  }
  return now
}

describe('Simon', () => {
  test('the right pads advance a level; a wrong pad ends the run', () => {
    const game = new Simon()
    const s = init(['a'])
    clear(game, s, 'a', 2, 100)
    expect(s.ps.get('a')).toMatchObject({ level: 3, pos: 0, alive: true })
    game.onInput(s, 'a', pad((padOf(s, 'a', 0) + 1) % 4), 200)
    expect(s.ps.get('a')?.alive).toBe(false)
    expect(game.isFinished(s, 200)).toBe(true)
  })

  test('at the same level, dying sooner never ranks higher', () => {
    const game = new Simon()
    const s = init(['early', 'late'])
    // Both clear 2 levels at the same pace; `late` also gets 2 pads into level 3, then both die.
    clear(game, s, 'early', 2, 100)
    clear(game, s, 'late', 2, 100)
    game.onInput(s, 'early', pad((padOf(s, 'early', 0) + 1) % 4), 200)
    game.onInput(s, 'late', pad(padOf(s, 'late', 0)), 300)
    game.onInput(s, 'late', pad(padOf(s, 'late', 1)), 301)
    game.onInput(s, 'late', pad((padOf(s, 'late', 2) + 1) % 4), 9000)
    const r = game.getResult(s)
    expect(r.placements).toEqual(['late', 'early'])
    expect(r.ranks).toEqual({ late: 0, early: 1 })
    expect(r.stats).toEqual({ late: 'level 2', early: 'level 2' })
  })

  test('levels completed rank first, then position, then the sooner last clear', () => {
    const game = new Simon()
    const s = init(['slow', 'fast', 'best'])
    clear(game, s, 'slow', 2, 5000)
    clear(game, s, 'fast', 2, 100)
    clear(game, s, 'best', 3, 9000)
    const r = game.getResult(s)
    expect(r.placements).toEqual(['best', 'fast', 'slow'])
    expect(r.ranks).toEqual({ best: 0, fast: 1, slow: 2 })
  })

  test('identical runs tie', () => {
    const game = new Simon()
    const s = init(['a', 'b'])
    clear(game, s, 'a', 1, 100)
    clear(game, s, 'b', 1, 100)
    expect(game.getResult(s).ranks).toEqual({ a: 0, b: 0 })
  })

  test('the wire shows each player only their own prefix, in their own pad colours', () => {
    const game = new Simon()
    // Over several seeds, some pair of players sees the shared sequence relabelled differently.
    let differs = false
    for (let seed = 1; seed <= 10; seed++) {
      const s = init(['a', 'b'], seed)
      clear(game, s, 'a', 4, 100)
      const snap = game.snapshot(s, 200)
      expect(snap.players.a?.seq).toHaveLength(5)
      expect(snap.players.b?.seq).toHaveLength(1)
      expect(snap.players.a?.seq).toEqual([0, 1, 2, 3, 4].map((i) => padOf(s, 'a', i)))
      // Same rhythm (repeats in the same places) for both players.
      const shape = (id: string) => [1, 2, 3, 4].map((i) => padOf(s, id, i) === padOf(s, id, i - 1))
      expect(shape('a')).toEqual(shape('b'))
      if (s.ps.get('a')?.pads.join() !== s.ps.get('b')?.pads.join()) differs = true
    }
    expect(differs).toBe(true)
  })

  test('a leaver is out, so the round ends once everyone else is', () => {
    const game = new Simon()
    let s = init(['a', 'gone'])
    game.onInput(s, 'a', pad((padOf(s, 'a', 0) + 1) % 4), 100)
    expect(game.isFinished(s, 100)).toBe(false)
    s = game.leave(s, 'gone', 200)
    expect(game.isFinished(s, 200)).toBe(true)
  })
})
