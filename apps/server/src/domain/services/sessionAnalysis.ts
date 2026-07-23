import type { MiniGameId, PlayerRadarDto, SessionSummaryDto, SkillAxis } from '@pp/shared'
import type { PlayerId } from '../minigames/MiniGame'

// Per-round inputs the session engine feeds the post-match analysis. Purely presentational (Phase 4):
// derived from the round results the engine already computes, never fed back into scoring.
export interface RoundAnalysis {
  minigameId: MiniGameId
  axes: readonly SkillAxis[]
  // Per-player normalized performance for this round, 0..1 (round winner ≈ 1). Players absent from the
  // round (late join / left) are simply omitted.
  norm: Map<PlayerId, number>
  // Representative round winner (FFA: the winner; team: a member of the winning team). null if nobody
  // scored.
  winnerId: PlayerId | null
  // Dense 1-based standings position per player AFTER this round.
  standings: Map<PlayerId, number>
}

// Average each player's normalized round results per skill axis → a 0..1 radar value per axis. Only
// axes the session actually exercised end up present.
export function buildRadars(
  history: readonly RoundAnalysis[],
  players: PlayerId[],
): PlayerRadarDto[] {
  return players.map((pid) => {
    const sums = new Map<SkillAxis, { sum: number; n: number }>()
    for (const round of history) {
      const v = round.norm.get(pid)
      if (v === undefined) continue
      for (const axis of round.axes) {
        const cur = sums.get(axis) ?? { sum: 0, n: 0 }
        cur.sum += v
        cur.n += 1
        sums.set(axis, cur)
      }
    }
    const axes: Partial<Record<SkillAxis, number>> = {}
    for (const [axis, { sum, n }] of sums) if (n > 0) axes[axis] = sum / n
    return { playerId: pid, axes }
  })
}

// Banter surface: per-round winners, who won the most rounds, and the biggest climb up the standings.
export function buildSummary(
  history: readonly RoundAnalysis[],
  players: PlayerId[],
): SessionSummaryDto {
  const perRound = history.map((r) => ({ minigameId: r.minigameId, winnerId: r.winnerId }))

  const wins = new Map<PlayerId, number>()
  for (const r of history) if (r.winnerId) wins.set(r.winnerId, (wins.get(r.winnerId) ?? 0) + 1)
  let mostRoundWins: SessionSummaryDto['mostRoundWins'] = null
  for (const [playerId, w] of wins) {
    if (!mostRoundWins || w > mostRoundWins.wins) mostRoundWins = { playerId, wins: w }
  }

  // Biggest comeback = worst standing a player ever held minus their final standing (positive = climbed).
  let biggestComeback: SessionSummaryDto['biggestComeback'] = null
  const last = history[history.length - 1]
  if (last) {
    for (const pid of players) {
      const finalPos = last.standings.get(pid)
      if (finalPos === undefined) continue
      let worst = finalPos
      for (const r of history) worst = Math.max(worst, r.standings.get(pid) ?? worst)
      const positionsGained = worst - finalPos
      if (
        positionsGained > 0 &&
        (!biggestComeback || positionsGained > biggestComeback.positionsGained)
      ) {
        biggestComeback = { playerId: pid, positionsGained }
      }
    }
  }

  return { perRound, mostRoundWins, biggestComeback }
}
