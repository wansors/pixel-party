import type { TeamId } from '../theme'

// Fleet Battle wire shapes (team format). Battleship, but the two SHARED fleets belong to the teams,
// not individuals — any teammate can fire on their team's turn. The snapshot is PUBLIC by design but
// never carries ship positions — only the result of each shot (hit/miss) — so the server stays
// authoritative. It's a single room-wide snapshot (not per-player like the duel version): every
// player on a team sees the same team-scoped view, keyed by team here.

export interface FleetBattleTeamView {
  // Shots fired BY this team, at the enemy team's grid.
  shots: { cell: number; hit: boolean }[]
  // This team's own cell indices that the enemy has hit (revealed damage).
  damage: number[]
  fleetCells: number // total ship cells per team
}

export interface FleetBattleSnapshot {
  grid: number // side length; the board has grid*grid cells
  roundRemainingMs: number
  turn: TeamId
  turnRemainingMs: number
  teams: Record<TeamId, FleetBattleTeamView>
  // playerId -> team, so the scene knows which side the local player is on (and which is the enemy).
  playerTeams: Record<string, TeamId>
  done: boolean
  winner: TeamId | null // null = draw (round timer, equal damage)
}

// One input = fire at a cell on the enemy team's grid. Honoured only when it's the sender's team's
// turn, for an in-range cell the team hasn't already fired at. The first valid shot from a team
// consumes that team's turn slot — teammates' late shots for the same turn are no-ops.
export interface FleetBattleInput {
  kind: 'fire'
  cell: number
}
