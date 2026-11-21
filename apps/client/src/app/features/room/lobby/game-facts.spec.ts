import { playerRange, roundLength, unfitReason } from './game-facts'

describe('game facts (picker cards)', () => {
  it('formats a player range', () => {
    expect(playerRange(2, 2)).toBe('2')
    expect(playerRange(3, 8)).toBe('3-8')
  })

  it('formats a round length', () => {
    expect(roundLength(45)).toBe('45s')
    expect(roundLength(60)).toBe('1:00')
    expect(roundLength(100)).toBe('1:40')
  })

  it('tells a headcount problem from an empty team', () => {
    // A duel can't take one player; with two it fits, so a refusal would be about teams.
    expect(unfitReason('sink-the-fleet', 1)).toBe('range')
    expect(unfitReason('sink-the-fleet', 2)).toBe('teams')
  })
})
