import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { MatchPairs } from './matchPairs'

const half: Random = { next: () => 0.5 }
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const init = (players: string[], now = 0, random: Random = half) =>
  new MatchPairs().init({ players, seed: 1, random, now, config: { durationMs: 60_000 } })
const layout = (s: ReturnType<typeof init>, id: string): number[] => nn(s.layouts.get(id))

// Small seeded generator (mulberry32) so layouts differ the way they do in a real round.
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

// Clears `id`'s whole board pair by pair at time `t`.
function clearBoard(game: MatchPairs, s: ReturnType<typeof init>, id: string, t: number): void {
  const values = layout(s, id)
  const seen = new Set<number>()
  for (let i = 0; i < values.length; i++) {
    if (seen.has(i)) continue
    const j = nn(values.findIndex((v, idx) => idx > i && v === values[i]))
    seen.add(i)
    seen.add(j)
    game.onInput(s, id, { kind: 'flip', index: i }, t)
    game.onInput(s, id, { kind: 'flip', index: j }, t)
  }
}

// Find two card indices holding the same pairId (a matching pair) in a layout.
const matchingPair = (values: number[]): [number, number] => {
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      if (values[i] === values[j]) return [i, j]
    }
  }
  throw new Error('no matching pair')
}

describe('MatchPairs', () => {
  test('builds a seeded layout (deterministic; each pairId appears exactly twice)', () => {
    const a = init(['p'])
    const b = init(['p'])
    expect(layout(a, 'p').length).toBe(16)
    expect(layout(a, 'p')).toEqual(layout(b, 'p'))
    const counts = new Map<number, number>()
    for (const v of layout(a, 'p')) counts.set(v, (counts.get(v) ?? 0) + 1)
    expect(counts.size).toBe(8)
    for (const c of counts.values()) expect(c).toBe(2)
  })

  test('each player gets their own permutation of the same pair set', () => {
    const s = init(['a', 'b', 'c'], 0, seeded(3))
    const sorted = (id: string) => [...layout(s, id)].sort((x, y) => x - y)
    expect(sorted('a')).toEqual(sorted('b'))
    expect(sorted('a')).toEqual(sorted('c'))
    expect(layout(s, 'a')).not.toEqual(layout(s, 'b'))
    expect(layout(s, 'b')).not.toEqual(layout(s, 'c'))
    // Same seed, same deal.
    expect(init(['a', 'b', 'c'], 0, seeded(3)).layouts).toEqual(s.layouts)
  })

  test("a rival's reveals are keyed to their own layout, not yours", () => {
    const game = new MatchPairs()
    const s = init(['a', 'b'], 0, seeded(5))
    clearBoard(game, s, 'b', 10)
    const theirs = nn(game.snapshot(s, 10).reveal.b)
    expect(Object.keys(theirs)).toHaveLength(16)
    // Read as a map of a's cards, b's reveals get several of them wrong.
    const wrong = layout(s, 'a').filter((v, i) => theirs[i] !== v).length
    expect(wrong).toBeGreaterThan(4)
  })

  test('flipping two matching cards marks them matched', () => {
    const game = new MatchPairs()
    let s = init(['p'])
    const [i, j] = matchingPair(layout(s, 'p'))
    s = game.onInput(s, 'p', { kind: 'flip', index: i }, 0)
    s = game.onInput(s, 'p', { kind: 'flip', index: j }, 0)
    const matched = nn(s.matched.get('p'))
    expect(matched.has(i)).toBe(true)
    expect(matched.has(j)).toBe(true)
    expect(nn(s.up.get('p')).length).toBe(0)
    expect(nn(s.attempts.get('p'))).toBe(0)
  })

  test('a mismatch increments attempts, stays shown, and the next flip clears it', () => {
    const game = new MatchPairs()
    let s = init(['p'])
    // Two indices with different pairIds.
    const first = 0
    const values = layout(s, 'p')
    const second = nn(values.findIndex((v, idx) => idx !== first && v !== values[first]))
    s = game.onInput(s, 'p', { kind: 'flip', index: first }, 0)
    s = game.onInput(s, 'p', { kind: 'flip', index: second }, 0)
    expect(nn(s.attempts.get('p'))).toBe(1)
    expect(nn(s.up.get('p'))).toEqual([first, second])
    // Next flip clears the shown mismatch and starts a fresh first flip.
    const third = 1
    s = game.onInput(s, 'p', { kind: 'flip', index: third }, 0)
    expect(nn(s.up.get('p'))).toEqual([third])
    expect(nn(s.matched.get('p')).size).toBe(0)
  })

  test('clearing all pairs sets done and ranks a finisher above a non-finisher', () => {
    const game = new MatchPairs()
    const s = init(['a', 'b'])
    clearBoard(game, s, 'a', 10)
    expect(nn(s.doneAt.get('a'))).toBe(10)
    expect(game.isFinished(s, 10)).toBe(false)
    const result = game.getResult(s)
    expect(result.placements[0]).toBe('a')
    expect(nn(result.ranks).a).toBe(0)
    expect(nn(result.ranks).b).toBe(1)
    expect(nn(result.stats).a).toBe('done')
  })

  test('snapshot never reveals a face-down card value', () => {
    const game = new MatchPairs()
    let s = init(['p'])
    const first = 0
    s = game.onInput(s, 'p', { kind: 'flip', index: first }, 0)
    const snap = game.snapshot(s, 0)
    const reveal = nn(snap.reveal.p)
    expect(Object.keys(reveal)).toEqual([`${first}`])
    expect(reveal[first]).toBe(nn(layout(s, 'p')[first]))
    expect(nn(snap.boards.p).up).toEqual([first])
  })

  test('a leaver is not waited for: the round ends once everyone else has cleared their board', () => {
    const game = new MatchPairs()
    let s = init(['a', 'gone'])
    clearBoard(game, s, 'a', 10)
    expect(game.isFinished(s, 20)).toBe(false)
    s = game.leave(s, 'gone', 20)
    expect(game.isFinished(s, 20)).toBe(true)
    // Their (late) flips no longer count.
    s = game.onInput(s, 'gone', { kind: 'flip', index: 0 }, 30)
    expect(nn(s.up.get('gone'))).toEqual([])
  })
})
