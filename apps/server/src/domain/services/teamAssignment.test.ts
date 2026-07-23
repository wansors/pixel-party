import { describe, expect, test } from 'bun:test'
import type { TeamId } from '@pp/shared'
import type { Random } from '../ports/Random'
import { balancedTeams, smallerTeam } from './teamAssignment'

// Deterministic stub: cycles a fixed sequence so the shuffle is reproducible in tests.
function seq(values: number[]): Random {
  let i = 0
  return { next: () => values[i++ % values.length] as number }
}

describe('balancedTeams', () => {
  test('assigns every player to a valid team', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const out = balancedTeams(ids, seq([0.1, 0.5, 0.9, 0.3, 0.7]))
    expect(out.size).toBe(5)
    for (const id of ids) expect(['red', 'blue']).toContain(out.get(id) as TeamId)
  })

  test('team sizes differ by at most one', () => {
    for (const n of [2, 3, 4, 7, 10]) {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`)
      const out = balancedTeams(ids, seq([0.2, 0.8, 0.4, 0.6, 0.1]))
      const red = [...out.values()].filter((t) => t === 'red').length
      const blue = [...out.values()].filter((t) => t === 'blue').length
      expect(Math.abs(red - blue)).toBeLessThanOrEqual(1)
    }
  })

  test('is deterministic for the same RNG stream', () => {
    const ids = ['a', 'b', 'c', 'd']
    const a = balancedTeams(ids, seq([0.3, 0.6, 0.1, 0.9]))
    const b = balancedTeams(ids, seq([0.3, 0.6, 0.1, 0.9]))
    expect([...a.entries()]).toEqual([...b.entries()])
  })
})

describe('smallerTeam', () => {
  test('returns the team with fewer members', () => {
    expect(
      smallerTeam(
        new Map<TeamId, number>([
          ['red', 3],
          ['blue', 1],
        ]),
      ),
    ).toBe('blue')
  })
  test('ties resolve to the first team', () => {
    expect(
      smallerTeam(
        new Map<TeamId, number>([
          ['red', 2],
          ['blue', 2],
        ]),
      ),
    ).toBe('red')
  })
})
