import type { MiniGameId, PlayerRadarDto, SessionSummaryDto, SkillAxis } from '@pp/shared'
import type { PlayerId } from '../minigames/MiniGame'

// Per-round inputs the session engine feeds the post-match analysis. Purely presentational (Phase 4):
// derived from the round results the engine already computes, never fed back into scoring.
export interface RoundAnalysis {
  minigameId: MiniGameId
  axes: readonly SkillAxis[]
  // Per-player standing in this round, 0..1: 1 = won, 0 = last, ties share their average place (see
  // placementShares). Players absent from the round (late join / left) are simply omitted.
  norm: Map<PlayerId, number>
  // Representative round winner (FFA: the winner; team: a member of the winning team). null if nobody
  // scored.
  winnerId: PlayerId | null
  // Dense 1-based standings position per player AFTER this round.
  standings: Map<PlayerId, number>
}

// The radar's neutral value and how many rounds' worth of it every axis starts with (D31): a value is
// the player's average standing on that axis shrunk toward the middle of the room, so one lucky or
// unlucky round can't pin an axis to the rim or the centre — it takes a few rounds to stand out.
export const RADAR_NEUTRAL = 0.5
const RADAR_PRIOR_ROUNDS = 1

// Where each player finished in a round as a 0..1 share of the field: 1 = first, 0 = last, linear in
// between, ties averaged over the places they share. Measures "how you did against this room" — unlike
// points / winner's points, it doesn't punish the steep award table's tail. A room of one is neutral.
export function placementShares(points: ReadonlyMap<PlayerId, number>): Map<PlayerId, number> {
  const sorted = [...points.entries()].sort((a, b) => b[1] - a[1])
  const n = sorted.length
  const out = new Map<PlayerId, number>()
  for (let i = 0; i < n; ) {
    let j = i
    while (j + 1 < n && sorted[j + 1]?.[1] === sorted[i]?.[1]) j++
    const place = (i + j) / 2
    for (let k = i; k <= j; k++) {
      out.set((sorted[k] as [PlayerId, number])[0], n > 1 ? 1 - place / (n - 1) : RADAR_NEUTRAL)
    }
    i = j + 1
  }
  return out
}

// Each player's standing per skill axis → a 0..1 radar value (0.5 = the middle of the room), shrunk
// toward neutral by RADAR_PRIOR_ROUNDS. Only axes the session actually exercised end up present; the
// client draws the rest as "not measured yet".
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
    for (const [axis, { sum, n }] of sums) {
      if (n > 0) axes[axis] = (sum + RADAR_NEUTRAL * RADAR_PRIOR_ROUNDS) / (n + RADAR_PRIOR_ROUNDS)
    }
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
