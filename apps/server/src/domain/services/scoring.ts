import type { TeamId } from '@pp/shared'
import type { NormalizedResult, PlayerId } from '../minigames/MiniGame'

// Position -> points award table (scoring-system.md §2). Strong reward for 1st, compressed flat tail so
// trailing players stay within comeback range; covers a full 12-player room, where only last place
// scores 0. Configurable — the engine only needs "position -> points". Index 0 = 1st place.
export const DEFAULT_AWARD_TABLE: readonly number[] = [10, 7, 5, 4, 3, 2, 2, 1, 1, 1, 1, 0]

const pointsForPosition = (pos: number, table: readonly number[]): number =>
  table[Math.min(pos, table.length - 1)] ?? 0

// Turn a normalized placement into per-player points, averaging over tied positions (§2.1). `ranks`
// (equal rank = tie) wins when present; otherwise placement index order is used with no ties.
export function awardPoints(
  result: NormalizedResult,
  table: readonly number[] = DEFAULT_AWARD_TABLE,
): Map<PlayerId, number> {
  const order = result.placements
  const rankOf = (id: PlayerId, idx: number): number => result.ranks?.[id] ?? idx

  // Group players by rank so a tie shares the averaged award of the positions the group occupies.
  const groups = new Map<number, PlayerId[]>()
  order.forEach((id, idx) => {
    const rank = rankOf(id, idx)
    const bucket = groups.get(rank) ?? []
    bucket.push(id)
    groups.set(rank, bucket)
  })

  const out = new Map<PlayerId, number>()
  let position = 0
  for (const rank of [...groups.keys()].sort((a, b) => a - b)) {
    const members = groups.get(rank) as PlayerId[]
    let sum = 0
    for (let i = 0; i < members.length; i++) sum += pointsForPosition(position + i, table)
    const avg = sum / members.length
    for (const id of members) out.set(id, avg)
    position += members.length
  }
  return out
}

// Team scoring distribution (scoring-system.md §2.2): rank the TEAMS via the same position table (with
// tie-averaging over team positions), then give EVERY member their team's points — not averaged over
// the number of members, so team size never dilutes the award. `teamResult` places team ids;
// `membership` maps each team to the players who were in the round.
export function awardTeamPoints(
  teamResult: NormalizedResult,
  membership: Map<TeamId, PlayerId[]>,
  table: readonly number[] = DEFAULT_AWARD_TABLE,
): Map<PlayerId, number> {
  const teamPoints = awardPoints(teamResult, table)
  const out = new Map<PlayerId, number>()
  for (const [team, members] of membership) {
    const pts = teamPoints.get(team) ?? 0
    for (const id of members) out.set(id, pts)
  }
  return out
}
