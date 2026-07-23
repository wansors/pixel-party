import type { PlayerId } from '../minigames/MiniGame'

export interface HandicapConfig {
  enabled: boolean
  // Max fractional bonus for the furthest-behind player (e.g. 0.2 = +20%). Bounded so catch-up narrows
  // gaps without ever flipping a round's placement.
  maxBonusPct: number
}

export const NO_HANDICAP: HandicapConfig = { enabled: false, maxBonusPct: 0.2 }

export interface HandicapOutcome {
  points: Map<PlayerId, number>
  // Bonus points added per player (0 for the leader and when disabled). Presentational/transparency.
  bonus: Map<PlayerId, number>
}

// Scoring catch-up (scoring-system.md §3.1): trailing players earn a small bounded bonus on the points
// they just won, scaled by how far behind they are in the standings BEFORE this round. The leader gets
// nothing; the furthest-behind gets up to `maxBonusPct`. It never touches placement — only inflates a
// trailer's own award within the cap, so it closes gaps without handing out wins. No effect on round 1
// (everyone level) or when everyone is tied.
export function applyScoringHandicap(
  basePoints: Map<PlayerId, number>,
  standingsBefore: Map<PlayerId, number>,
  config: HandicapConfig,
): HandicapOutcome {
  const points = new Map(basePoints)
  const bonus = new Map<PlayerId, number>()
  for (const id of basePoints.keys()) bonus.set(id, 0)
  if (!config.enabled || config.maxBonusPct <= 0 || basePoints.size < 2) return { points, bonus }

  const totals = [...basePoints.keys()].map((id) => standingsBefore.get(id) ?? 0)
  const max = Math.max(...totals)
  const min = Math.min(...totals)
  if (max === min) return { points, bonus } // everyone level → nothing to catch up

  for (const id of basePoints.keys()) {
    const behind = (max - (standingsBefore.get(id) ?? 0)) / (max - min) // 0 = leader … 1 = last
    const base = basePoints.get(id) ?? 0
    const extra = base * behind * config.maxBonusPct
    points.set(id, base + extra)
    bonus.set(id, extra)
  }
  return { points, bonus }
}
