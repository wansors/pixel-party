import type { MiniGameFormat, MiniGameId } from './catalog/minigames'

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
  // Host-only: configure the session (which games, how many rounds). Ignored from non-hosts.
  | { type: 'HOST_CONFIG'; minigameIds: MiniGameId[]; rounds: number }
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
  // Session over — final ranking.
  | { type: 'FINAL_RANKING'; scores: ScoreEntryDto[] }
  // Generic per-intent acknowledgement (ok/reject with a stable machine reason).
  | { type: 'ACK'; intent: ClientMsgType; ok: boolean; reason?: string }
  | { type: 'JOIN_REJECTED'; reason: JoinRejectReason }
  | { type: 'ERROR'; reason: string }

export type ServerMsgType = ServerMsg['type']
