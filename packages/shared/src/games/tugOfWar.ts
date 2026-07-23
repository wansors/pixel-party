import type { TeamId } from '../theme'

// Tug of War wire shapes (team format). The rope offset and per-team totals are server-authoritative;
// team membership rides in the snapshot so the scene can colour the self player's side without needing
// the lobby roster. The logic lives server-side in the domain module.
export interface TugOfWarSnapshot {
  // Rope position in [-1, 1]: negative = red pulling ahead, positive = blue. 0 = centred.
  offset: number
  // Total pulls accumulated per team this round.
  red: number
  blue: number
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
