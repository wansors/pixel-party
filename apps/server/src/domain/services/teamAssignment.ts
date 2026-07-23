import { TEAM_IDS, type TeamId } from '@pp/shared'
import type { PlayerId } from '../minigames/MiniGame'
import type { Random } from '../ports/Random'

// Balanced random split into the two fixed teams. Deterministic via the Random port (seeded), so a
// session is reproducible: shuffle the players, then deal them out round-robin so team sizes differ by
// at most one. Pure — no clock/RNG access beyond the injected port.
export function balancedTeams(
  playerIds: readonly PlayerId[],
  random: Random,
): Map<PlayerId, TeamId> {
  const shuffled = [...playerIds]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j] as PlayerId, shuffled[i] as PlayerId]
  }
  const out = new Map<PlayerId, TeamId>()
  shuffled.forEach((id, idx) => out.set(id, TEAM_IDS[idx % TEAM_IDS.length] as TeamId))
  return out
}

// The team with fewer members (ties -> the first team). Used to slot a late joiner without a reshuffle.
export function smallerTeam(counts: Map<TeamId, number>): TeamId {
  let best = TEAM_IDS[0] as TeamId
  for (const id of TEAM_IDS) {
    if ((counts.get(id) ?? 0) < (counts.get(best) ?? 0)) best = id
  }
  return best
}
