import { describe, expect, test } from 'bun:test'
import { DEFAULT_AWARD_TABLE, awardPoints } from './scoring'

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
