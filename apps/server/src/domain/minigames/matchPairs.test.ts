import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { MatchPairs } from './matchPairs'

const half: Random = { next: () => 0.5 }
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const init = (players: string[], now = 0) =>
  new MatchPairs().init({ players, seed: 1, random: half, now, config: { durationMs: 60_000 } })

// Find two card indices holding the same pairId (a matching pair) in the shared layout.
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
    expect(a.values.length).toBe(16)
    expect(a.values).toEqual(b.values)
    const counts = new Map<number, number>()
    for (const v of a.values) counts.set(v, (counts.get(v) ?? 0) + 1)
    expect(counts.size).toBe(8)
    for (const c of counts.values()) expect(c).toBe(2)
  })

  test('flipping two matching cards marks them matched', () => {
    const game = new MatchPairs()
    let s = init(['p'])
    const [i, j] = matchingPair(s.values)
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
    const second = nn(s.values.findIndex((v, idx) => idx !== first && v !== s.values[first]))
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
    let s = init(['a', 'b'])
    // Player a clears the whole board pair by pair.
    const seen = new Set<number>()
    for (let i = 0; i < s.values.length; i++) {
      if (seen.has(i)) continue
      const j = nn(s.values.findIndex((v, idx) => idx > i && v === s.values[i]))
      seen.add(i)
      seen.add(j)
      s = game.onInput(s, 'a', { kind: 'flip', index: i }, 10)
      s = game.onInput(s, 'a', { kind: 'flip', index: j }, 10)
    }
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
    expect(reveal[first]).toBe(nn(s.values[first]))
    expect(nn(snap.boards.p).up).toEqual([first])
  })
})
