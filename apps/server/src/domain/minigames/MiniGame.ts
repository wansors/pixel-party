import type { MiniGameFormat, MiniGameId, TeamId } from '@pp/shared'
import type { Random } from '../ports/Random'

export type PlayerId = string

// A placement ordering the scoring engine turns into points uniformly, regardless of format.
export interface NormalizedResult {
  // playerIds (or teamIds) in finishing order; index 0 = 1st. Ties: repeat the rank via `ties`.
  placements: PlayerId[]
  // Optional explicit rank per player for tie handling (equal rank = tie). Defaults to index order.
  ranks?: Record<PlayerId, number>
  // Optional per-player performance detail for the round-result screen (e.g. "142 ms", "5 correct").
  // Game-specific and purely presentational — it never feeds scoring.
  stats?: Record<PlayerId, string>
  // Duel games: who sat the round out with a bye. The engine rotates byes across the session (it feeds
  // the counts back through MiniGameInitCtx.byeCounts) and never treats a bye as idling.
  byes?: PlayerId[]
  // Players who never got the chance to act (e.g. still queued when a turn-based round ran out of time):
  // exempt from the engine's idle demotion, like byes.
  waiting?: PlayerId[]
}

export interface MiniGameInitCtx {
  players: PlayerId[]
  seed: number
  random: Random
  // Round start time (server clock). A timed game derives its deadline from this.
  now: number
  // Team membership for team-format games (playerId -> team). Absent/empty for FFA games.
  teams?: Record<PlayerId, TeamId>
  // Duel games: byes each player has had so far this session — pass to pairPlayers so the next bye
  // goes to someone with the fewest.
  byeCounts?: Record<PlayerId, number>
  config?: Record<string, unknown>
}

// The pluggable mini-game contract. Pure domain logic: no I/O and no direct clock/RNG access — all
// randomness flows through the injected Random port (seeded per round) and time is passed in as `now`.
// The session engine is agnostic; it inits, feeds validated inputs, ticks real-time games, and
// consumes getResult().
//
// Seats (D28): `players` holds only the players connected when the round starts, and only their inputs
// reach onInput. In the result the engine ranks anyone who never sent an input (or left mid-round)
// below everyone who played — games don't need their own "idle player" tiebreaks.
export interface MiniGame<State, Input> {
  readonly id: MiniGameId
  readonly format: MiniGameFormat
  init(ctx: MiniGameInitCtx): State
  // Server-validated input application. Returns the next state (immutable-style or mutated + returned).
  onInput(state: State, playerId: PlayerId, input: Input, now: number): State
  // Only real-time games implement tick; turn-based/instantaneous games omit it.
  tick?(state: State, dt: number, now: number): State
  // A round player has been disconnected for longer than the engine's grace period (a page reload
  // isn't punished). Implement it when turns, pairs, a relay or an "everyone is done" finish depend on
  // every player: mark the leaver out/done so the round carries on without them (the engine already
  // ranks them last). Optional — games that don't care omit it.
  leave?(state: State, playerId: PlayerId, now: number): State
  isFinished(state: State, now: number): boolean
  getResult(state: State): NormalizedResult
  // Optional wire-facing view for ROUND_STATE (defaults to the raw state when omitted).
  snapshot?(state: State, now: number): unknown
}

export interface MiniGameEntry<State = unknown, Input = unknown> {
  readonly id: MiniGameId
  readonly format: MiniGameFormat
  factory(): MiniGame<State, Input>
}
