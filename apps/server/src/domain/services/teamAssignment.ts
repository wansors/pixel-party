import { TEAM_IDS, type TeamId } from '@pp/shared'
import type { PlayerId } from '../minigames/MiniGame'
import type { Random } from '../ports/Random'

// Balanced random split into the two fixed teams. Deterministic via the Random port (seeded), so a
// session is reproducible: shuffle the players, then deal them out round-robin — starting from a seeded
// team, so the odd player out isn't always red's — so team sizes differ by at most one. Pure — no
// clock/RNG access beyond the injected port.
export function balancedTeams(
  playerIds: readonly PlayerId[],
  random: Random,
): Map<PlayerId, TeamId> {
  const shuffled = [...playerIds]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j] as PlayerId, shuffled[i] as PlayerId]
  }
  const first = Math.floor(random.next() * TEAM_IDS.length)
  const out = new Map<PlayerId, TeamId>()
  shuffled.forEach((id, idx) => {
    out.set(id, TEAM_IDS[(first + idx) % TEAM_IDS.length] as TeamId)
  })
  return out
}

// The team with fewer members; a tie is broken by the Random port when given (else the first team).
// Used to slot a late joiner without a reshuffle.
export function smallerTeam(counts: Map<TeamId, number>, random?: Random): TeamId {
  const fewest = Math.min(...TEAM_IDS.map((id) => counts.get(id) ?? 0))
  const tied = TEAM_IDS.filter((id) => (counts.get(id) ?? 0) === fewest)
  return tied[random ? Math.floor(random.next() * tied.length) : 0] as TeamId
}
