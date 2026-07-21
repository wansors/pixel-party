import type { HigherLowerInput, HigherLowerSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 22_000
const DECK_LEN = 40
const MIN_CARD = 2
const MAX_CARD = 14

export interface HigherLowerState {
  players: PlayerId[]
  deck: number[]
  startedAt: number
  endsAt: number
  // playerId -> current index in the shared deck (the streak length equals this index).
  pointer: Map<PlayerId, number>
  alive: Set<PlayerId>
  // playerId -> ms at which the player's run ended (miss or time), for tie-break ranking.
  streakMs: Map<PlayerId, number>
}

// Real-time FFA nerve game. A single seeded deck is shared by everyone; each player guesses whether the
// next card is higher or lower to extend a streak, and one wrong guess ends their run. The server owns
// the deck so upcoming cards are never revealed early. Pure domain logic.
export class HigherLower implements MiniGame<HigherLowerState, HigherLowerInput> {
  readonly id = 'higher-lower'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): HigherLowerState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const r = ctx.random
    // Build a deck with no two consecutive equal cards so every guess has a definite answer.
    const deck: number[] = [MIN_CARD + Math.floor(r.next() * (MAX_CARD - MIN_CARD + 1))]
    while (deck.length < DECK_LEN) {
      const next = MIN_CARD + Math.floor(r.next() * (MAX_CARD - MIN_CARD + 1))
      if (next !== deck[deck.length - 1]) deck.push(next)
    }
    return {
      players: [...ctx.players],
      deck,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      pointer: new Map(ctx.players.map((id) => [id, 0])),
      alive: new Set(ctx.players),
      streakMs: new Map(),
    }
  }

  onInput(
    state: HigherLowerState,
    playerId: PlayerId,
    input: HigherLowerInput,
    now: number,
  ): HigherLowerState {
    if (input.kind !== 'guess' || (input.dir !== 'higher' && input.dir !== 'lower')) return state
    if (now >= state.endsAt || !state.alive.has(playerId)) return state
    const ptr = state.pointer.get(playerId)
    if (ptr === undefined || input.index !== ptr) return state
    // No next card left → the player has cleared the deck; freeze the streak.
    if (ptr + 1 >= state.deck.length) {
      state.alive.delete(playerId)
      state.streakMs.set(playerId, now - state.startedAt)
      return state
    }
    const cur = state.deck[ptr] as number
    const nxt = state.deck[ptr + 1] as number
    const correct = input.dir === 'higher' ? nxt > cur : nxt < cur
    if (correct) {
      state.pointer.set(playerId, ptr + 1)
    } else {
      state.alive.delete(playerId)
      state.streakMs.set(playerId, now - state.startedAt)
    }
    return state
  }

  isFinished(state: HigherLowerState, now: number): boolean {
    return now >= state.endsAt || state.alive.size === 0
  }

  getResult(state: HigherLowerState): NormalizedResult {
    const streak = (id: PlayerId): number => state.pointer.get(id) ?? 0
    const sorted = [...state.players].sort((a, b) => {
      const sa = streak(a)
      const sb = streak(b)
      if (sb !== sa) return sb - sa
      // Same streak → whoever built it faster ranks higher (still-alive players used the full time).
      return (
        (state.streakMs.get(a) ?? Number.POSITIVE_INFINITY) -
        (state.streakMs.get(b) ?? Number.POSITIVE_INFINITY)
      )
    })
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: { s: number; t: number } | undefined
    sorted.forEach((id, idx) => {
      const s = streak(id)
      const t = state.streakMs.get(id) ?? Number.POSITIVE_INFINITY
      if (idx > 0 && prev && (s !== prev.s || t !== prev.t)) rank = idx
      ranks[id] = rank
      prev = { s, t }
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `streak ${streak(id)}`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: HigherLowerState, now: number): HigherLowerSnapshot {
    const cards: HigherLowerSnapshot['cards'] = {}
    const scores: Record<PlayerId, number> = {}
    for (const id of state.players) {
      const ptr = state.pointer.get(id) ?? 0
      cards[id] = { current: state.deck[ptr] as number, index: ptr, alive: state.alive.has(id) }
      scores[id] = ptr
    }
    return { cards, scores, remainingMs: Math.max(0, state.endsAt - now) }
  }
}
