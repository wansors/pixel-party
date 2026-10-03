import type { HigherLowerInput, HigherLowerSnapshot, HigherLowerStatus } from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 22_000
const DECK_LEN = 40
const MIN_CARD = 2
const MAX_CARD = 14

interface Run {
  // This player's own seeded deck (no two consecutive cards equal, so every guess has an answer).
  deck: number[]
  // Index of the face-up card; the streak while playing.
  index: number
  status: HigherLowerStatus
  score: number
}

export interface HigherLowerState {
  players: PlayerId[]
  startedAt: number
  endsAt: number
  runs: Map<PlayerId, Run>
}

function dealDeck(r: Random): number[] {
  const draw = (): number => MIN_CARD + Math.floor(r.next() * (MAX_CARD - MIN_CARD + 1))
  const deck = [draw()]
  while (deck.length < DECK_LEN) {
    const next = draw()
    if (next !== deck[deck.length - 1]) deck.push(next)
  }
  return deck
}

// Real-time FFA nerve game. Every player gets their own seeded deck (a shared one leaked your next card
// on the wire: a rival one step ahead showed it face up). Each right guess on whether the next card is
// higher or lower extends the streak; BANK stops and keeps it; a miss ends the run and halves it. Odds
// swing with the face-up card (a 2 or an ace is a sure thing, a 7 or 8 a coin flip), so when to stop is
// the game. Still playing at the buzzer keeps the streak. Pure domain logic.
export class HigherLower implements MiniGame<HigherLowerState, HigherLowerInput> {
  readonly id = 'higher-lower'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): HigherLowerState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const runs = new Map<PlayerId, Run>()
    for (const id of ctx.players) {
      runs.set(id, { deck: dealDeck(ctx.random), index: 0, status: 'playing', score: 0 })
    }
    return { players: [...ctx.players], startedAt: ctx.now, endsAt: ctx.now + durationMs, runs }
  }

  onInput(
    state: HigherLowerState,
    playerId: PlayerId,
    input: HigherLowerInput,
    now: number,
  ): HigherLowerState {
    const run = state.runs.get(playerId)
    if (!run || run.status !== 'playing' || now >= state.endsAt) return state
    if (input.kind === 'bank') {
      run.status = 'banked'
      return state
    }
    if (input.kind !== 'guess' || (input.dir !== 'higher' && input.dir !== 'lower')) return state
    if (input.index !== run.index) return state
    const cur = run.deck[run.index] as number
    const nxt = run.deck[run.index + 1] as number
    if (input.dir === 'higher' ? nxt > cur : nxt < cur) {
      run.index++
      run.score = run.index
      // The deck ran out: nothing left to risk, the streak is banked.
      if (run.index + 1 >= run.deck.length) run.status = 'banked'
    } else {
      run.status = 'bust'
      run.score = Math.floor(run.score / 2)
    }
    return state
  }

  // Gone mid-round: their run stops where it is (the engine ranks them last anyway).
  leave(state: HigherLowerState, playerId: PlayerId): HigherLowerState {
    const run = state.runs.get(playerId)
    if (run?.status === 'playing') run.status = 'banked'
    return state
  }

  isFinished(state: HigherLowerState, now: number): boolean {
    if (now >= state.endsAt) return true
    for (const run of state.runs.values()) if (run.status === 'playing') return false
    return true
  }

  // Ranks by score alone (equal scores tie): speed doesn't decide, nerve does.
  getResult(state: HigherLowerState): NormalizedResult {
    const score = (id: PlayerId): number => state.runs.get(id)?.score ?? 0
    const sorted = [...state.players].sort((a, b) => score(b) - score(a))
    const ranks: Record<PlayerId, number> = {}
    sorted.forEach((id, idx) => {
      const prev = sorted[idx - 1]
      ranks[id] = prev !== undefined && score(prev) === score(id) ? (ranks[prev] as number) : idx
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `streak ${score(id)}`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: HigherLowerState, now: number): HigherLowerSnapshot {
    const cards: HigherLowerSnapshot['cards'] = {}
    const scores: Record<PlayerId, number> = {}
    for (const [id, run] of state.runs) {
      cards[id] = {
        current: run.deck[run.index] as number,
        index: run.index,
        status: run.status,
        next: run.status === 'playing' ? null : (run.deck[run.index + 1] ?? null),
      }
      scores[id] = run.score
    }
    return { cards, scores, remainingMs: Math.max(0, state.endsAt - now) }
  }
}
