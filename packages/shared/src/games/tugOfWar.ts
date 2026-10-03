import type { TeamId } from '../theme'

// Tug of War wire shapes (team format). The rope offset and per-team averages are server-authoritative;
// team membership rides in the snapshot so the scene can colour the self player's side without needing
// the lobby roster. The logic lives server-side in the domain module.
export interface TugOfWarSnapshot {
  // Rope position in [-1, 1]: negative = red pulling ahead, positive = blue. 0 = centred.
  offset: number
  // Pulls per member so far, per team (1 decimal): the average is what moves the rope, so uneven
  // teams compare fairly. A member who left no longer counts.
  avg: Record<TeamId, number>
  // playerId -> team, so the scene knows which side the local player pulls for.
  teams: Record<string, TeamId>
  remainingMs: number
  done: boolean
}

// One input = one pull toward the sender's team. The server knows the sender's team from the round's
// membership snapshot, so the payload carries no team of its own.
export interface TugOfWarInput {
  kind: 'pull'
}
