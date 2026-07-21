import type { MiniGameFormat, MiniGameId } from '@pp/shared'
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
}

export interface MiniGameInitCtx {
  players: PlayerId[]
  seed: number
  random: Random
  // Round start time (server clock). A timed game derives its deadline from this.
  now: number
  config?: Record<string, unknown>
}

// The pluggable mini-game contract. Pure domain logic: no I/O and no direct clock/RNG access — all
// randomness flows through the injected Random port (seeded per round) and time is passed in as `now`.
// The session engine is agnostic; it inits, feeds validated inputs, ticks real-time games, and
// consumes getResult().
export interface MiniGame<State, Input> {
  readonly id: MiniGameId
  readonly format: MiniGameFormat
  init(ctx: MiniGameInitCtx): State
  // Server-validated input application. Returns the next state (immutable-style or mutated + returned).
  onInput(state: State, playerId: PlayerId, input: Input, now: number): State
  // Only real-time games implement tick; turn-based/instantaneous games omit it.
  tick?(state: State, dt: number, now: number): State
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
