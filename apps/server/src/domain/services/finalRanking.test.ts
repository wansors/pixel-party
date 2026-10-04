import { describe, expect, test } from 'bun:test'
import { finalRanking, type Tiebreakers } from './finalRanking'

const tb = (
  firsts: Record<string, number>,
  positionSum: Record<string, number>,
  roundsPlayed: Record<string, number>,
): Tiebreakers => ({
  firsts: new Map(Object.entries(firsts)),
  positionSum: new Map(Object.entries(positionSum)),
  roundsPlayed: new Map(Object.entries(roundsPlayed)),
})

describe('finalRanking', () => {
  test('orders by total points descending', () => {
    const r = finalRanking(
      new Map([
        ['a', 20],
        ['b', 30],
      ]),
      tb({}, {}, {}),
    )
    expect(r[0]?.playerId).toBe('b')
    expect(r[0]?.rank).toBe(1)
    expect(r[1]?.playerId).toBe('a')
    expect(r[1]?.rank).toBe(2)
  })

  test('equal points break by most first places', () => {
    const r = finalRanking(
      new Map([
        ['a', 30],
        ['b', 30],
      ]),
      tb({ a: 1, b: 3 }, { a: 4, b: 4 }, { a: 4, b: 4 }),
    )
    expect(r[0]?.playerId).toBe('b') // more firsts
    expect(r[0]?.rank).toBe(1)
    expect(r[1]?.rank).toBe(2)
  })

  test('equal points and firsts break by best average position', () => {
    const r = finalRanking(
      new Map([
        ['a', 30],
        ['b', 30],
      ]),
      // same firsts; a has the lower average position (better)
      tb({ a: 2, b: 2 }, { a: 3, b: 8 }, { a: 4, b: 4 }),
    )
    expect(r[0]?.playerId).toBe('a')
    expect(r[1]?.playerId).toBe('b')
  })

  test('fully-equal players share a rank; the next drops below', () => {
    const r = finalRanking(
      new Map([
        ['a', 30],
        ['b', 30],
        ['c', 10],
      ]),
      tb({ a: 2, b: 2, c: 0 }, { a: 4, b: 4, c: 12 }, { a: 4, b: 4, c: 4 }),
    )
    const a = r.find((e) => e.playerId === 'a')
    const b = r.find((e) => e.playerId === 'b')
    const c = r.find((e) => e.playerId === 'c')
    expect(a?.rank).toBe(1)
    expect(b?.rank).toBe(1) // identical on all tiebreakers → shared rank
    expect(c?.rank).toBe(3) // dense: the third row keeps its positional rank
  })
})
