import type { QuickDrawInput, QuickDrawSnapshot } from '@pp/shared'
import { type DuelOutcome, rankDuels } from '../services/duelRanking'
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
  winner: PlayerId | null // set once done (null = nobody drew in time: both lose)
  drawnBy: Map<PlayerId, number> // valid tap time (>= fireAt), per player
  falseStart: Set<PlayerId> // players who tapped before the signal
  forfeit: boolean // decided by the opponent leaving
}

export interface QuickDrawState {
  duels: Duel[]
  playerDuel: Map<PlayerId, number>
  startedAt: number
  endsAt: number
}

// Duel format: a western reaction shootout. Players are seeded-paired 1v1; each duel waits a seeded
// delay before the signal fires. The first valid tap after the signal wins; a tap before it is a false
// start that loses instantly, and a duel nobody draws in time is lost by both. Duels rank across the
// room in tiers (rankDuels): winners by reaction time, the bye in the middle, losers below — beaten by
// a quicker draw first, then the no-shows, then the false starts. Pure — time arrives as `now`,
// randomness via the injected port; the raw fire time never reaches the wire.
export class QuickDraw implements MiniGame<QuickDrawState, QuickDrawInput> {
  readonly id = 'quick-draw'
  readonly format = 'duel' as const

  init(ctx: MiniGameInitCtx): QuickDrawState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const pairs = pairPlayers(ctx.players, ctx.random, ctx.byeCounts)
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
        winner: null,
        drawnBy: new Map(),
        falseStart: new Set(),
        forfeit: false,
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
    // No per-tick physics; a duel where nobody reacted is lost by both at the timer (see getResult).
    if (now >= state.endsAt) {
      for (const duel of state.duels) {
        if (!duel.done) duel.done = true
      }
    }
    return state
  }

  // The opponent of a player who left wins the standoff by forfeit.
  leave(state: QuickDrawState, playerId: PlayerId, _now: number): QuickDrawState {
    const duel = state.duels[state.playerDuel.get(playerId) ?? -1]
    if (!duel?.b || duel.done) return state
    duel.done = true
    duel.winner = playerId === duel.a ? duel.b : duel.a
    duel.forfeit = true
    return state
  }

  isFinished(state: QuickDrawState, now: number): boolean {
    return now >= state.endsAt || state.duels.every((d) => d.done)
  }

  getResult(state: QuickDrawState): NormalizedResult {
    // Margins: winners by reaction time (a win without drawing — the rival jumped or left — ranks below
    // every timed one); losers beaten by a draw (the quicker that draw, the higher), then the
    // no-shows, then the false starts.
    const span = state.endsAt - state.startedAt
    const outcomes: DuelOutcome[] = []
    const stats: Record<PlayerId, string> = {}
    // Whoever won because the rival jumped the gun never got the chance to draw: not idle.
    const waiting: PlayerId[] = []
    for (const duel of state.duels) {
      if (!duel.b) {
        outcomes.push({ id: duel.a, tier: 'bye' })
        stats[duel.a] = '—'
        continue
      }
      const winnerMs = duel.winner !== null ? duel.drawnBy.get(duel.winner) : undefined
      const opponentJumped = duel.falseStart.size > 0
      for (const pid of [duel.a, duel.b]) {
        const drew = duel.drawnBy.get(pid)
        if (pid === duel.winner) {
          outcomes.push({
            id: pid,
            tier: 'win',
            margin: drew !== undefined ? duel.fireAt - drew : -span,
          })
          if (opponentJumped) waiting.push(pid)
        } else {
          const margin = duel.falseStart.has(pid)
            ? -3 * span
            : winnerMs !== undefined
              ? duel.fireAt - winnerMs
              : -2 * span
          outcomes.push({ id: pid, tier: 'loss', margin })
        }
        stats[pid] =
          drew !== undefined
            ? `${drew - duel.fireAt} ms`
            : duel.falseStart.has(pid)
              ? 'false start'
              : duel.winner === null
                ? 'no tap'
                : '—'
      }
    }
    const result = rankDuels(outcomes, stats)
    return waiting.length > 0 ? { ...result, waiting } : result
  }

  snapshot(state: QuickDrawState, now: number): QuickDrawSnapshot {
    const ended = now >= state.endsAt
    const players: QuickDrawSnapshot['players'] = {}
    for (const duel of state.duels) {
      for (const pid of [duel.a, duel.b]) {
        if (!pid) continue
        const opp = pid === duel.a ? duel.b : duel.a
        const done = duel.done || ended
        const ms = duel.drawnBy.get(pid)
        players[pid] = {
          opponentId: opp,
          fired: now >= duel.fireAt,
          youDrew: duel.drawnBy.has(pid) || duel.falseStart.has(pid),
          done,
          // No draws: a duel nobody won by the timer is lost by both. A bye neither wins nor loses.
          won: done && opp !== null ? duel.winner === pid : null,
          reactionMs: ms !== undefined ? ms - duel.fireAt : null,
          oppLeft: duel.forfeit && duel.winner === pid,
        }
      }
    }
    return { roundRemainingMs: Math.max(0, state.endsAt - now), players }
  }
}
