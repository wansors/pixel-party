import type { MiniGameFormat, MiniGameId, SkillAxis } from './catalog/minigames'
import type { TeamId } from './theme'

// Wire-contract version: bump on any BREAKING wire change (renamed/removed message types or fields,
// changed semantics). The server stamps it on WELCOME; the client compares against its own compiled
// constant and surfaces a "please refresh" notice on mismatch — a stale cached bundle then fails loud
// instead of misbehaving silently.
export const PROTOCOL_VERSION = 1

// ---------------------------------------------------------------------------------------------------
// Shared DTOs
// ---------------------------------------------------------------------------------------------------

// Anonymous player identity (no accounts in Phase 1): a unique color + preset pixel avatar + name.
export interface PlayerDto {
  id: string
  name: string
  color: string
  avatar: string
  ready: boolean
  connected: boolean
  // Team assignment (Phase 2). Present only while the room's line-up includes a team-format game.
  team?: TeamId
}

// The room lifecycle phase drives which UI/scene is active.
export type RoomPhase = 'lobby' | 'round-intro' | 'round' | 'round-result' | 'scoreboard' | 'final'

export interface ScoreEntryDto {
  playerId: string
  points: number
  rank: number
}

// A per-round outcome: the placement ordering the scoring engine turns into points.
export interface RoundResultDto {
  minigameId: MiniGameId
  // playerIds in finishing order (index 0 = 1st). Ties are represented by equal ranks in `scores`.
  placements: string[]
  scores: ScoreEntryDto[]
  // Optional per-player performance detail for the round-result screen (e.g. "142 ms", "5 correct",
  // "streak 7"). Game-specific and purely presentational — it never feeds scoring. Keyed by playerId.
  stats?: Record<string, string>
  // Present for team-format rounds: the team ranking behind the per-player points, for the "TEAM RED
  // WINS" banner. Ordered by rank (index 0 = winning team). Purely presentational.
  teams?: TeamRoundResult[]
  // Catch-up bonus points added to a player's award this round (Phase 3), keyed by playerId. Only
  // present when handicap is enabled and the bonus is non-zero — the results screen shows it as "+N".
  handicap?: Record<string, number>
  // Skill radar so far (Phase 4), built from every round played up to and including this one — the same
  // shape as `FINAL_RANKING.radars`, just recomputed earlier. Lets the round-result screen show the
  // profile taking shape round by round instead of only once at the end.
  radars?: PlayerRadarDto[]
}

export interface TeamRoundResult {
  id: TeamId
  rank: number
  points: number
  memberIds: string[]
}

// ---------------------------------------------------------------------------------------------------
// Phase 4 — post-match analysis. All presentational: computed from the round results the engine
// already produces; never feeds scoring or the line-up.
// ---------------------------------------------------------------------------------------------------

// A player's skill profile across the session: a 0..1 score per axis (1 = won every game on that axis).
// Only axes actually played this session are present — the radar draws whatever it receives.
export interface PlayerRadarDto {
  playerId: string
  axes: Partial<Record<SkillAxis, number>>
}

// Session banter surface: who won each round, who won the most, and the biggest climb up the standings.
export interface SessionSummaryDto {
  // Round-by-round winner (index 0 = round 1). `winnerId` is null if nobody scored that round.
  perRound: { minigameId: MiniGameId; winnerId: string | null }[]
  // Player with the most round wins (null if there were no rounds / no winners).
  mostRoundWins: { playerId: string; wins: number } | null
  // Largest improvement in standings position from a player's worst point to the final (0 if none).
  biggestComeback: { playerId: string; positionsGained: number } | null
}

// ---------------------------------------------------------------------------------------------------
// Client -> Server intents. Identity is resolved server-side from ws.data — intents carry ids only,
// never the sender's identity.
// ---------------------------------------------------------------------------------------------------

export type ClientMsg =
  // Announce presence after the socket opens (name/color/avatar chosen on the join screen).
  | { type: 'JOIN'; name: string; color: string; avatar: string }
  // Reclaim an existing seat after a socket drop (transient reconnect or page reload). Carries the
  // previously minted playerId; the server re-attaches it and replays the current session state.
  | { type: 'REJOIN'; playerId: string }
  | { type: 'SET_READY'; ready: boolean }
  // Host-only: configure the session (which games, how many rounds, catch-up on/off). Ignored from
  // non-hosts. `handicap` omitted = leave the current setting unchanged.
  | { type: 'HOST_CONFIG'; minigameIds: MiniGameId[]; rounds: number; handicap?: boolean }
  // Host-only: move a player to a team (team-format line-ups only).
  | { type: 'SET_TEAM'; playerId: string; team: TeamId }
  // Host-only: re-roll the balanced team assignment.
  | { type: 'SHUFFLE_TEAMS' }
  // Host-only: hand the host role to another member.
  | { type: 'TRANSFER_HOST'; playerId: string }
  // Host-only: remove another member from the room.
  | { type: 'KICK_PLAYER'; playerId: string }
  // Host-only: begin the session.
  | { type: 'START_SESSION' }
  // Per-frame/round input for the active mini-game. Opaque payload validated by the active game.
  | { type: 'MINIGAME_INPUT'; input: unknown }
  | { type: 'LEAVE' }

export type ClientMsgType = ClientMsg['type']

// ---------------------------------------------------------------------------------------------------
// Server -> Client messages.
// ---------------------------------------------------------------------------------------------------

export type JoinRejectReason = 'room_not_found' | 'room_full' | 'session_in_progress' | 'name_taken'

export type ServerMsg =
  // First frame after upgrade: server-resolved identity + protocol version for the refresh check.
  | {
      type: 'WELCOME'
      protocolVersion: number
      playerId: string
      roomCode: string
      isHost: boolean
    }
  // Full lobby snapshot (roster + readiness + host config); re-sent on any lobby change.
  | {
      type: 'LOBBY_STATE'
      phase: RoomPhase
      players: PlayerDto[]
      hostId: string
      minigameIds: MiniGameId[]
      rounds: number
      // True when the configured line-up includes a team-format game — the lobby then shows team UI.
      usesTeams: boolean
      // Whether bounded scoring catch-up is enabled for this session (host toggle; Phase 3).
      handicap: boolean
    }
  // A round is about to start: countdown intro so clients can preload the scene.
  | {
      type: 'ROUND_INTRO'
      round: number
      totalRounds: number
      minigameId: MiniGameId
      format: MiniGameFormat
      startsInMs: number
    }
  // Throttled authoritative snapshot of the active mini-game state. Opaque per-game state blob.
  | { type: 'ROUND_STATE'; round: number; tick: number; state: unknown }
  // A round finished — placements + points for this round.
  | { type: 'ROUND_RESULT'; round: number; result: RoundResultDto }
  // Session-wide cumulative ranking (shown between rounds).
  | { type: 'SCOREBOARD'; scores: ScoreEntryDto[] }
  // Session over — final ranking, plus the Phase 4 post-match analysis (radar per player + summary).
  // The analysis fields are optional so an older client simply ignores them.
  | {
      type: 'FINAL_RANKING'
      scores: ScoreEntryDto[]
      radars?: PlayerRadarDto[]
      summary?: SessionSummaryDto
    }
  // Generic per-intent acknowledgement (ok/reject with a stable machine reason).
  | { type: 'ACK'; intent: ClientMsgType; ok: boolean; reason?: string }
  | { type: 'JOIN_REJECTED'; reason: JoinRejectReason }
  // This client's seat was removed by the host — it should leave the room and return to the entry screen.
  | { type: 'KICKED' }
  | { type: 'ERROR'; reason: string }

export type ServerMsgType = ServerMsg['type']
