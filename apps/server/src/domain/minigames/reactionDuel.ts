import type { ReactionInput, ReactionSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const MIN_DELAY_MS = 1500
const DELAY_SPREAD_MS = 3000
const REACT_WINDOW_MS = 5000

export interface ReactionState {
  players: PlayerId[]
  greenAt: number
  deadline: number
  reactions: Map<PlayerId, number>
  falseStarts: Set<PlayerId>
}

// Real-time FFA reflex test. The green-light delay is drawn from the injected Random port (seeded per
// round) so it is reproducible; time arrives as `now`. Fastest valid reaction wins; a tap before green
// is a false start, and false starts / no-taps rank last.
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
    else state.reactions.set(playerId, now - state.greenAt)
    return state
  }

  isFinished(state: ReactionState, now: number): boolean {
    const resolved = state.reactions.size + state.falseStarts.size
    return resolved >= state.players.length || now >= state.deadline
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
    return { placements, ranks }
  }

  snapshot(state: ReactionState, now: number): ReactionSnapshot {
    return {
      light: now >= state.greenAt ? 'green' : 'red',
      greenInMs: Math.max(0, state.greenAt - now),
      reactions: Object.fromEntries(state.reactions),
      falseStarts: [...state.falseStarts],
    }
  }
}
