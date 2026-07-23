import type { TeamId } from '../theme'

// Bomb Relay wire shapes (team format). Hot-potato relay: each team shares one bomb held by one member
// at a time; the holder mashes to fill their leg and pass it on (a relay), racing a HIDDEN seeded fuse.
// The fuse time is never on the wire (that's the tension) — only progress/relays/explosions are.
export interface BombRelayTeamView {
  holderId: string // the member currently holding the bomb (only they may mash)
  legProgress: number // taps by the current holder toward legTarget
  legTarget: number
  relays: number // legs completed this round
  explosions: number // times the fuse blew while holding
  members: string[]
}

export interface BombRelaySnapshot {
  // Per-team view keyed by teamId ('red' | 'blue').
  teams: Record<TeamId, BombRelayTeamView>
  // playerId -> team, so the scene can find the local player's team and whether they hold the bomb.
  playerTeam: Record<string, TeamId>
  roundRemainingMs: number
}

// One input = one mash. Counted only for the member currently holding their team's bomb.
export interface BombRelayInput {
  kind: 'mash'
}
