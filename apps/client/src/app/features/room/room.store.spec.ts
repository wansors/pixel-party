import { extractLiveMetric } from './room.store'

describe('extractLiveMetric', () => {
  it('reads the first player-keyed numeric tally it finds', () => {
    expect(extractLiveMetric({ counts: { a: 3, b: 5 }, remainingMs: 100 })).toEqual({ a: 3, b: 5 })
    expect(extractLiveMetric({ scores: { a: 1 } })).toEqual({ a: 1 })
  })

  it('ignores snapshots without a readable tally', () => {
    expect(extractLiveMetric(null)).toBeNull()
    expect(extractLiveMetric({ players: { a: { alive: true } } })).toBeNull()
    expect(extractLiveMetric({ scores: { a: 'x' } })).toBeNull()
  })
})
