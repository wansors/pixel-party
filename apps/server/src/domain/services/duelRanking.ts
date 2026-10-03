import type { NormalizedResult, PlayerId } from '../minigames/MiniGame'

export type DuelTier = 'win' | 'draw' | 'bye' | 'loss'

export interface DuelOutcome {
  id: PlayerId
  tier: DuelTier
  // Game-specific "by how much" (ms ahead, point difference, hits landed…): bigger ranks higher within
  // the tier. Equal tier + margin is a tie.
  margin?: number
}

const TIER_ORDER: Record<DuelTier, number> = { win: 0, draw: 1, bye: 1, loss: 2 }

// Ranks simultaneous 1v1 duels across the whole room (D28): every win above every draw or bye, above
// every loss — so neither a bye nor a draw scores like a win — and inside a tier the bigger margin
// first, so the position table is used in full instead of two flat tiers. Byes are reported so the
// engine can rotate them.
export function rankDuels(
  outcomes: readonly DuelOutcome[],
  stats?: Record<PlayerId, string>,
): NormalizedResult {
  const sorted = [...outcomes].sort(
    (x, y) => TIER_ORDER[x.tier] - TIER_ORDER[y.tier] || (y.margin ?? 0) - (x.margin ?? 0),
  )
  const ranks: Record<PlayerId, number> = {}
  sorted.forEach((o, i) => {
    const prev = sorted[i - 1]
    const tied =
      prev !== undefined &&
      TIER_ORDER[prev.tier] === TIER_ORDER[o.tier] &&
      (prev.margin ?? 0) === (o.margin ?? 0)
    ranks[o.id] = tied ? (ranks[prev.id] as number) : i
  })
  const byes = outcomes.filter((o) => o.tier === 'bye').map((o) => o.id)
  return {
    placements: sorted.map((o) => o.id),
    ranks,
    ...(stats ? { stats } : {}),
    ...(byes.length > 0 ? { byes } : {}),
  }
}
