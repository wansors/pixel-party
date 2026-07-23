import { describe, expect, test } from 'bun:test'
import { type HandicapConfig, applyScoringHandicap } from './handicap'

const ON: HandicapConfig = { enabled: true, maxBonusPct: 0.2 }
const OFF: HandicapConfig = { enabled: false, maxBonusPct: 0.2 }

describe('applyScoringHandicap', () => {
  test('disabled → points unchanged, zero bonus', () => {
    const base = new Map([
      ['a', 10],
      ['b', 5],
    ])
    const standings = new Map([
      ['a', 30],
      ['b', 0],
    ])
    const { points, bonus } = applyScoringHandicap(base, standings, OFF)
    expect(points.get('a')).toBe(10)
    expect(points.get('b')).toBe(5)
    expect(bonus.get('b')).toBe(0)
  })

  test('leader gets no bonus, furthest-behind gets the full cap', () => {
    const base = new Map([
      ['a', 10],
      ['b', 10],
    ])
    const standings = new Map([
      ['a', 40], // leader
      ['b', 0], // last
    ])
    const { points, bonus } = applyScoringHandicap(base, standings, ON)
    expect(points.get('a')).toBe(10) // leader untouched
    expect(bonus.get('a')).toBe(0)
    expect(points.get('b')).toBeCloseTo(12) // +20% of 10
    expect(bonus.get('b')).toBeCloseTo(2)
  })

  test('bonus scales linearly with how far behind a player is', () => {
    const base = new Map([
      ['a', 10],
      ['b', 10],
      ['c', 10],
    ])
    const standings = new Map([
      ['a', 20], // leader
      ['b', 10], // halfway
      ['c', 0], // last
    ])
    const { bonus } = applyScoringHandicap(base, standings, ON)
    expect(bonus.get('a')).toBe(0)
    expect(bonus.get('b')).toBeCloseTo(1) // halfway back → +10%
    expect(bonus.get('c')).toBeCloseTo(2) // last → +20%
  })

  test('never reorders: the bonus is capped below the gap to the next placement', () => {
    // a won the round (10) from the lead; b was 2nd (7) from behind. Even fully boosted, b (7*1.2=8.4)
    // stays below a's 10 for the round — handicap narrows, never flips.
    const base = new Map([
      ['a', 10],
      ['b', 7],
    ])
    const standings = new Map([
      ['a', 50],
      ['b', 0],
    ])
    const { points } = applyScoringHandicap(base, standings, ON)
    expect(points.get('a')).toBe(10)
    expect(points.get('b') as number).toBeLessThan(points.get('a') as number)
  })

  test('round 1 (everyone level) → no handicap', () => {
    const base = new Map([
      ['a', 10],
      ['b', 7],
    ])
    const standings = new Map([
      ['a', 0],
      ['b', 0],
    ])
    const { bonus } = applyScoringHandicap(base, standings, ON)
    expect(bonus.get('a')).toBe(0)
    expect(bonus.get('b')).toBe(0)
  })
})
