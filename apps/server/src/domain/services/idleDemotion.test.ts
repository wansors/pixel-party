import { describe, expect, test } from 'bun:test'
import { demoteIdle } from './idleDemotion'
import { awardPoints } from './scoring'

describe('demoteIdle', () => {
  test('a player who never played ranks below everyone who did, even on a won tiebreak', () => {
    const r = demoteIdle(
      { placements: ['idle', 'a', 'b'], ranks: { idle: 0, a: 1, b: 1 } },
      new Set(['a', 'b']),
    )
    expect(r.placements).toEqual(['a', 'b', 'idle'])
    const pts = awardPoints(r)
    expect(pts.get('a')).toBe(pts.get('b'))
    expect(pts.get('idle')).toBeLessThan(pts.get('a') as number)
  })

  test('idle players share last place', () => {
    const r = demoteIdle({ placements: ['x', 'a', 'y'] }, new Set(['a']))
    expect(r.placements).toEqual(['a', 'x', 'y'])
    expect(r.ranks?.x).toBe(r.ranks?.y)
  })

  test('a no-op when nobody or everybody played', () => {
    const result = { placements: ['a', 'b'] }
    expect(demoteIdle(result, new Set())).toBe(result)
    expect(demoteIdle(result, new Set(['a', 'b']))).toBe(result)
  })
})
