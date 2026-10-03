import type { NormalizedResult, PlayerId } from '../minigames/MiniGame'

// Ranks the players who never played the round — no input at all, or gone mid-round — below everyone
// who did, sharing last place (D28). The players who played keep their order and ranks. A no-op when
// nobody (or everybody) played, so an all-AFK round keeps the game's own result.
export function demoteIdle(
  result: NormalizedResult,
  played: ReadonlySet<PlayerId>,
): NormalizedResult {
  const rankOf = (id: PlayerId, idx: number): number => result.ranks?.[id] ?? idx
  const active = result.placements.filter((id) => played.has(id))
  if (active.length === 0 || active.length === result.placements.length) return result
  const ranks: Record<PlayerId, number> = {}
  let last = 0
  result.placements.forEach((id, idx) => {
    if (!played.has(id)) return
    ranks[id] = rankOf(id, idx)
    last = Math.max(last, ranks[id] + 1)
  })
  const idle = result.placements.filter((id) => !played.has(id))
  for (const id of idle) ranks[id] = last
  return { ...result, placements: [...active, ...idle], ranks }
}
