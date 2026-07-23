import { describe, expect, test } from 'bun:test'
import type { TeamId } from '@pp/shared'
import { DEFAULT_AWARD_TABLE, awardPoints, awardTeamPoints } from './scoring'

describe('awardPoints', () => {
  test('awards table points in placement order (no ties)', () => {
    const out = awardPoints({ placements: ['a', 'b', 'c'] })
    expect(out.get('a')).toBe(DEFAULT_AWARD_TABLE[0])
    expect(out.get('b')).toBe(DEFAULT_AWARD_TABLE[1])
    expect(out.get('c')).toBe(DEFAULT_AWARD_TABLE[2])
  })

  test('averages points across a tie for first (10 + 7) / 2 = 8.5', () => {
    const out = awardPoints({ placements: ['a', 'b', 'c'], ranks: { a: 0, b: 0, c: 1 } })
    expect(out.get('a')).toBe(8.5)
    expect(out.get('b')).toBe(8.5)
    // next player takes 3rd position
    expect(out.get('c')).toBe(DEFAULT_AWARD_TABLE[2])
  })

  test('last of a full room scores 0', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`)
    const out = awardPoints({ placements: ids })
    expect(out.get('p9')).toBe(0)
  })
})

describe('awardTeamPoints', () => {
  const membership = new Map<TeamId, string[]>([
    ['red', ['a', 'b']],
    ['blue', ['c', 'd', 'e']],
  ])

  test('every member gets their team position points, not diluted by team size', () => {
    // Red wins (position 0 -> 10), blue second (position 1 -> 7). Uneven sizes must not matter.
    const out = awardTeamPoints(
      { placements: ['red', 'blue'], ranks: { red: 0, blue: 1 } },
      membership,
    )
    expect(out.get('a')).toBe(10)
    expect(out.get('b')).toBe(10)
    expect(out.get('c')).toBe(7)
    expect(out.get('d')).toBe(7)
    expect(out.get('e')).toBe(7)
  })

  test('a team tie averages the two team positions ((10 + 7) / 2 = 8.5) for everyone', () => {
    const out = awardTeamPoints(
      { placements: ['red', 'blue'], ranks: { red: 0, blue: 0 } },
      membership,
    )
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(out.get(id)).toBe(8.5)
  })
})
