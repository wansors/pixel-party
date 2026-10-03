import { describe, expect, test } from 'bun:test'
import { rankDuels } from './duelRanking'
import { awardPoints } from './scoring'

describe('rankDuels', () => {
  test('wins above draws and byes, above losses', () => {
    const r = rankDuels([
      { id: 'loser', tier: 'loss' },
      { id: 'bye', tier: 'bye' },
      { id: 'winner', tier: 'win' },
    ])
    expect(r.placements).toEqual(['winner', 'bye', 'loser'])
    const pts = awardPoints(r)
    expect(pts.get('winner')).toBeGreaterThan(pts.get('bye') as number)
    expect(pts.get('bye')).toBeGreaterThan(pts.get('loser') as number)
    expect(r.byes).toEqual(['bye'])
  })

  test('a bigger margin ranks higher inside a tier; equal margins tie', () => {
    const r = rankDuels([
      { id: 'w1', tier: 'win', margin: 120 },
      { id: 'w2', tier: 'win', margin: 300 },
      { id: 'w3', tier: 'win', margin: 120 },
      { id: 'l1', tier: 'loss', margin: -300 },
    ])
    expect(r.placements).toEqual(['w2', 'w1', 'w3', 'l1'])
    expect(r.ranks?.w1).toBe(r.ranks?.w3)
    expect(r.ranks?.w2).toBeLessThan(r.ranks?.w1 as number)
  })

  test('a draw and a bye share the middle tier', () => {
    const r = rankDuels([
      { id: 'd1', tier: 'draw' },
      { id: 'b', tier: 'bye' },
      { id: 'd2', tier: 'draw' },
    ])
    expect(new Set(Object.values(r.ranks ?? {}))).toEqual(new Set([0]))
  })
})
