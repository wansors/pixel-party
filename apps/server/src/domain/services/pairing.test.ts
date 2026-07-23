import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { pairPlayers } from './pairing'

function seq(values: number[]): Random {
  let i = 0
  return { next: () => values[i++ % values.length] as number }
}

describe('pairPlayers', () => {
  test('pairs an even roster with no byes, each player once', () => {
    const pairs = pairPlayers(['a', 'b', 'c', 'd'], seq([0.1, 0.9, 0.5, 0.3]))
    expect(pairs).toHaveLength(2)
    expect(pairs.every((p) => p.b !== null)).toBe(true)
    const seen = pairs.flatMap((p) => [p.a, p.b])
    expect(new Set(seen)).toEqual(new Set(['a', 'b', 'c', 'd']))
  })

  test('an odd roster leaves exactly one bye', () => {
    const pairs = pairPlayers(['a', 'b', 'c', 'd', 'e'], seq([0.2, 0.7, 0.4, 0.6, 0.1]))
    expect(pairs).toHaveLength(3)
    const byes = pairs.filter((p) => p.b === null)
    expect(byes).toHaveLength(1)
    const seen = pairs.flatMap((p) => (p.b ? [p.a, p.b] : [p.a]))
    expect(new Set(seen)).toEqual(new Set(['a', 'b', 'c', 'd', 'e']))
  })

  test('is deterministic for the same RNG stream', () => {
    const a = pairPlayers(['a', 'b', 'c', 'd'], seq([0.3, 0.6, 0.1, 0.9]))
    const b = pairPlayers(['a', 'b', 'c', 'd'], seq([0.3, 0.6, 0.1, 0.9]))
    expect(a).toEqual(b)
  })
})
