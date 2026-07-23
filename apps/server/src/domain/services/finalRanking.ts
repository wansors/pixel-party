import type { ScoreEntryDto } from '@pp/shared'
import type { PlayerId } from '../minigames/MiniGame'

// Tiebreaker tallies gathered over the session (scoring-system.md §5).
export interface Tiebreakers {
  // Round wins (a "first" = sharing the top position in a round).
  firsts: Map<PlayerId, number>
  // Sum of 0-based positions and rounds played, for the average-position tiebreak.
  positionSum: Map<PlayerId, number>
  roundsPlayed: Map<PlayerId, number>
}

const avgPosition = (t: Tiebreakers, pid: PlayerId): number => {
  const rounds = t.roundsPlayed.get(pid) ?? 0
  return rounds > 0 ? (t.positionSum.get(pid) ?? 0) / rounds : Number.POSITIVE_INFINITY
}

// Final ranking with tiebreakers (scoring-system.md §5): order by total points desc, then most firsts,
// then best (lowest) average position. Two players share a rank only when ALL three are equal — so the
// podium reflects "won more games" / "placed better on average" instead of a flat points tie.
export function finalRanking(cumulative: Map<PlayerId, number>, tb: Tiebreakers): ScoreEntryDto[] {
  const sorted = [...cumulative.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    const fa = tb.firsts.get(a[0]) ?? 0
    const fb = tb.firsts.get(b[0]) ?? 0
    if (fb !== fa) return fb - fa
    return avgPosition(tb, a[0]) - avgPosition(tb, b[0])
  })
  let rank = 1
  let prevKey: string | undefined
  return sorted.map(([playerId, points], idx) => {
    const key = `${points}|${tb.firsts.get(playerId) ?? 0}|${avgPosition(tb, playerId)}`
    if (idx > 0 && key !== prevKey) rank = idx + 1
    prevKey = key
    return { playerId, points, rank }
  })
}
