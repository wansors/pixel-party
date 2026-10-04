import { describe, expect, test } from 'bun:test'
import {
  RADAR_NEUTRAL,
  type RoundAnalysis,
  buildRadars,
  buildSummary,
  placementShares,
} from './sessionAnalysis'

const round = (over: Partial<RoundAnalysis>): RoundAnalysis => ({
  minigameId: 'button-masher',
  axes: ['speed'],
  norm: new Map(),
  winnerId: null,
  standings: new Map(),
  ...over,
})

describe('placementShares', () => {
  test('first is 1, last is 0, linear in between; ties share their places', () => {
    const shares = placementShares(
      new Map([
        ['a', 10],
        ['b', 5],
        ['c', 5],
        ['d', 0],
      ]),
    )
    expect(shares.get('a')).toBe(1)
    expect(shares.get('b')).toBe(0.5)
    expect(shares.get('c')).toBe(0.5)
    expect(shares.get('d')).toBe(0)
  })

  test('a room of one is neutral', () => {
    expect(placementShares(new Map([['solo', 10]])).get('solo')).toBe(RADAR_NEUTRAL)
  })
})

describe('buildRadars', () => {
  test('averages standings per axis, shrunk toward neutral, only for axes played', () => {
    const history: RoundAnalysis[] = [
      round({
        minigameId: 'button-masher',
        axes: ['speed'],
        norm: new Map([
          ['a', 1],
          ['b', 0],
        ]),
      }),
      round({
        minigameId: 'trivia',
        axes: ['knowledge'],
        norm: new Map([
          ['a', 0],
          ['b', 1],
        ]),
      }),
    ]
    const radars = buildRadars(history, ['a', 'b'])
    const a = radars.find((r) => r.playerId === 'a')
    // One round won → above the middle, but one round can't pin an axis to the rim (or the centre).
    expect(a?.axes.speed).toBe(0.75)
    expect(a?.axes.knowledge).toBe(0.25)
    // Axes never exercised this session are absent.
    expect(a?.axes.memory).toBeUndefined()
  })

  test('standing out takes several rounds', () => {
    const won = round({ axes: ['speed'], norm: new Map([['a', 1]]) })
    const [a] = buildRadars([won, won, won, won], ['a'])
    expect(a?.axes.speed).toBe(0.9)
  })

  test('a game tagged with multiple axes feeds each of them', () => {
    const history: RoundAnalysis[] = [
      round({ minigameId: 'number-rush', axes: ['focus', 'speed'], norm: new Map([['a', 0.8]]) }),
    ]
    const [a] = buildRadars(history, ['a'])
    expect(a?.axes.focus).toBe(0.65)
    expect(a?.axes.speed).toBe(0.65)
  })

  test('players absent from a round are skipped, not zeroed', () => {
    const history: RoundAnalysis[] = [
      round({ axes: ['speed'], norm: new Map([['a', 1]]) }),
      round({
        axes: ['speed'],
        norm: new Map([
          ['a', 0],
          ['b', 1],
        ]),
      }),
    ]
    const b = buildRadars(history, ['a', 'b']).find((r) => r.playerId === 'b')
    // b only played round 2 → its speed is that round's value (shrunk), not diluted by the missed round.
    expect(b?.axes.speed).toBe(0.75)
  })
})

describe('buildSummary', () => {
  test('counts round wins and picks the most', () => {
    const history: RoundAnalysis[] = [
      round({
        winnerId: 'a',
        standings: new Map([
          ['a', 1],
          ['b', 2],
        ]),
      }),
      round({
        winnerId: 'a',
        standings: new Map([
          ['a', 1],
          ['b', 2],
        ]),
      }),
      round({
        winnerId: 'b',
        standings: new Map([
          ['a', 1],
          ['b', 2],
        ]),
      }),
    ]
    const s = buildSummary(history, ['a', 'b'])
    expect(s.mostRoundWins).toEqual({ playerId: 'a', wins: 2 })
    expect(s.perRound).toHaveLength(3)
    expect(s.perRound[2]?.winnerId).toBe('b')
  })

  test('biggest comeback = worst standing minus final standing', () => {
    const history: RoundAnalysis[] = [
      round({
        standings: new Map([
          ['a', 1],
          ['b', 4],
        ]),
      }),
      round({
        standings: new Map([
          ['a', 3],
          ['b', 4],
        ]),
      }),
      // b climbs from 4th to 1st → gained 3; a ends 2nd having been 1st → no gain.
      round({
        standings: new Map([
          ['a', 2],
          ['b', 1],
        ]),
      }),
    ]
    const s = buildSummary(history, ['a', 'b'])
    expect(s.biggestComeback).toEqual({ playerId: 'b', positionsGained: 3 })
  })

  test('no rounds → empty summary', () => {
    const s = buildSummary([], [])
    expect(s.perRound).toEqual([])
    expect(s.mostRoundWins).toBeNull()
    expect(s.biggestComeback).toBeNull()
  })
})
