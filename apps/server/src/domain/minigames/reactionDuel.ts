import type { ReactionInput, ReactionSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const MIN_DELAY_MS = 1500
const DELAY_SPREAD_MS = 3000
const REACT_WINDOW_MS = 5000
// Bounds on the client's own timing (see creditedMs): nobody reacts faster than a human can, and the
// client may claim back at most this much of the server's measurement as network latency.
const HUMAN_FLOOR_MS = 100
const MAX_LATENCY_CREDIT_MS = 150

export interface ReactionState {
  players: PlayerId[]
  greenAt: number
  deadline: number
  reactions: Map<PlayerId, number>
  falseStarts: Set<PlayerId>
  // Players gone mid-round: the round no longer waits for their tap.
  gone: Set<PlayerId>
}

// The server times a tap from green to arrival, which includes the round trip: the green light reaches
// the player late and the tap reaches the server late (≈ the winning margin on wifi). The client times
// it from the moment its own screen turned green, so the scene sends that too. It's trusted only so
// far: never faster than a human floor, never more than MAX_LATENCY_CREDIT_MS better than the server
// saw, never worse.
function creditedMs(serverMs: number, claimed: unknown): number {
  if (typeof claimed !== 'number' || !Number.isFinite(claimed)) return serverMs
  const floor = Math.max(HUMAN_FLOOR_MS, serverMs - MAX_LATENCY_CREDIT_MS)
  return Math.min(serverMs, Math.max(Math.round(claimed), floor))
}

// Real-time FFA reflex test. The green-light delay is drawn from the injected Random port (seeded per
// round) so it is reproducible; time arrives as `now`. Fastest valid reaction wins; a tap that reaches
// the server before green is a false start, and false starts / no-taps rank last.
export class ReactionDuel implements MiniGame<ReactionState, ReactionInput> {
  readonly id = 'reaction-duel'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): ReactionState {
    const delay = MIN_DELAY_MS + Math.floor(ctx.random.next() * DELAY_SPREAD_MS)
    const greenAt = ctx.now + delay
    return {
      players: [...ctx.players],
      greenAt,
      deadline: greenAt + REACT_WINDOW_MS,
      reactions: new Map(),
      falseStarts: new Set(),
      gone: new Set(),
    }
  }

  onInput(
    state: ReactionState,
    playerId: PlayerId,
    input: ReactionInput,
    now: number,
  ): ReactionState {
    if (input.kind !== 'tap') return state
    if (!state.players.includes(playerId)) return state
    if (state.reactions.has(playerId) || state.falseStarts.has(playerId)) return state
    if (now < state.greenAt) state.falseStarts.add(playerId)
    else state.reactions.set(playerId, creditedMs(now - state.greenAt, input.ms))
    return state
  }

  leave(state: ReactionState, playerId: PlayerId): ReactionState {
    state.gone.add(playerId)
    return state
  }

  isFinished(state: ReactionState, now: number): boolean {
    const resolved = state.players.filter(
      (id) => state.reactions.has(id) || state.falseStarts.has(id) || state.gone.has(id),
    )
    return resolved.length >= state.players.length || now >= state.deadline
  }

  getResult(state: ReactionState): NormalizedResult {
    const reactors = [...state.reactions.entries()].sort((a, b) => a[1] - b[1])
    // Everyone who didn't post a valid reaction (false start or no tap) shares the bottom rank.
    const losers = state.players.filter((id) => !state.reactions.has(id))
    const placements = [...reactors.map(([id]) => id), ...losers]

    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prevMs: number | undefined
    reactors.forEach(([id, ms], idx) => {
      if (idx > 0 && ms !== prevMs) rank = idx
      ranks[id] = rank
      prevMs = ms
    })
    const loserRank = reactors.length
    for (const id of losers) ranks[id] = loserRank
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) {
      if (state.falseStarts.has(id)) stats[id] = 'false start'
      else if (state.reactions.has(id)) stats[id] = `${state.reactions.get(id)} ms`
      else stats[id] = 'no tap'
    }
    return { placements, ranks, stats }
  }

  snapshot(state: ReactionState, now: number): ReactionSnapshot {
    return {
      players: state.players,
      light: now >= state.greenAt ? 'green' : 'red',
      greenInMs: Math.max(0, state.greenAt - now),
      reactions: Object.fromEntries(state.reactions),
      falseStarts: [...state.falseStarts],
    }
  }
}
