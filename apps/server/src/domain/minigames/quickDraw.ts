import type { QuickDrawInput, QuickDrawSnapshot } from '@pp/shared'
import { pairPlayers } from '../services/pairing'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 20_000
const MIN_DELAY_MS = 2000
const DELAY_SPREAD_MS = 3000

interface Duel {
  a: PlayerId
  b: PlayerId | null // null = bye
  fireAt: number
  done: boolean
  winner: PlayerId | null // set once done (null = draw)
  drawnBy: Map<PlayerId, number> // valid tap time (>= fireAt), per player
  falseStart: Set<PlayerId> // players who tapped before the signal
}

export interface QuickDrawState {
  duels: Duel[]
  playerDuel: Map<PlayerId, number>
  startedAt: number
  endsAt: number
}

// Duel format: a western reaction shootout. Players are seeded-paired 1v1; each duel waits a seeded
// delay before the signal fires. The first valid tap after the signal wins; a tap before it is a false
// start that loses instantly. Wins/losses aggregate into the round ranking. Pure — time arrives as
// `now`, randomness via the injected port; the raw fire time never reaches the wire.
export class QuickDraw implements MiniGame<QuickDrawState, QuickDrawInput> {
  readonly id = 'quick-draw'
  readonly format = 'duel' as const

  init(ctx: MiniGameInitCtx): QuickDrawState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const pairs = pairPlayers(ctx.players, ctx.random)
    const duels: Duel[] = []
    const playerDuel = new Map<PlayerId, number>()
    for (const { a, b } of pairs) {
      const idx = duels.length
      playerDuel.set(a, idx)
      if (b) playerDuel.set(b, idx)
      const delay = MIN_DELAY_MS + Math.floor(ctx.random.next() * DELAY_SPREAD_MS)
      duels.push({
        a,
        b,
        fireAt: ctx.now + delay,
        done: b === null, // a bye is resolved immediately
        winner: b === null ? a : null,
        drawnBy: new Map(),
        falseStart: new Set(),
      })
    }
    return { duels, playerDuel, startedAt: ctx.now, endsAt: ctx.now + durationMs }
  }

  onInput(
    state: QuickDrawState,
    playerId: PlayerId,
    input: QuickDrawInput,
    now: number,
  ): QuickDrawState {
    if (input.kind !== 'draw') return state
    if (now < state.startedAt || now >= state.endsAt) return state
    const idx = state.playerDuel.get(playerId)
    if (idx === undefined) return state
    const duel = state.duels[idx] as Duel
    if (duel.done) return state
    if (duel.drawnBy.has(playerId) || duel.falseStart.has(playerId)) return state
    const opponent = playerId === duel.a ? duel.b : duel.a
    if (!opponent) return state
    if (now < duel.fireAt) {
      // False start: jumping the signal loses the duel outright.
      duel.falseStart.add(playerId)
      duel.done = true
      duel.winner = opponent
    } else {
      // First valid reaction wins; inputs are applied one-at-a-time so ties are impossible.
      duel.drawnBy.set(playerId, now)
      duel.done = true
      duel.winner = playerId
    }
    return state
  }

  tick(state: QuickDrawState, _dt: number, now: number): QuickDrawState {
    // No per-tick physics; a duel where nobody reacted resolves as a draw at the timer (see getResult).
    if (now >= state.endsAt) {
      for (const duel of state.duels) {
        if (!duel.done) duel.done = true
      }
    }
    return state
  }

  isFinished(state: QuickDrawState, now: number): boolean {
    return now >= state.endsAt || state.duels.every((d) => d.done)
  }

  getResult(state: QuickDrawState): NormalizedResult {
    const placements: PlayerId[] = []
    const ranks: Record<PlayerId, number> = {}
    const stats: Record<PlayerId, string> = {}
    for (const duel of state.duels) {
      const winner = resolveWinner(duel)
      for (const pid of [duel.a, duel.b]) {
        if (!pid) continue
        placements.push(pid)
        // Winner (or a drawn player) shares the top rank; the loser drops to rank 1.
        ranks[pid] = winner === null || winner === pid ? 0 : 1
        const ms = duel.drawnBy.get(pid)
        stats[pid] =
          ms !== undefined
            ? `${ms - duel.fireAt} ms`
            : duel.falseStart.has(pid)
              ? 'false start'
              : '—'
      }
    }
    // Order placements winners-first so the round-result list reads top-down.
    placements.sort((x, y) => (ranks[x] ?? 0) - (ranks[y] ?? 0))
    return { placements, ranks, stats }
  }

  snapshot(state: QuickDrawState, now: number): QuickDrawSnapshot {
    const ended = now >= state.endsAt
    const players: QuickDrawSnapshot['players'] = {}
    for (const duel of state.duels) {
      for (const pid of [duel.a, duel.b]) {
        if (!pid) continue
        const opp = pid === duel.a ? duel.b : duel.a
        const done = duel.done || ended
        const winner = resolveWinner(duel)
        const ms = duel.drawnBy.get(pid)
        players[pid] = {
          opponentId: opp,
          fired: now >= duel.fireAt,
          youDrew: duel.drawnBy.has(pid) || duel.falseStart.has(pid),
          done,
          won: done ? (winner === null ? null : winner === pid) : null,
          reactionMs: ms !== undefined ? ms - duel.fireAt : null,
        }
      }
    }
    return { roundRemainingMs: Math.max(0, state.endsAt - now), players }
  }
}

// Winner of a duel: the bye's `a`, or the stored winner once decided. An undecided duel (nobody ever
// reacted) is a draw (null). Returns null for a still-ongoing duel too; callers gate on `done` first.
function resolveWinner(duel: Duel): PlayerId | null {
  if (duel.b === null) return duel.a
  return duel.winner
}
