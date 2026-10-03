import {
  MARBLES,
  type MarblesInput,
  type MarblesPlayerView,
  type MarblesReveal,
  type MarblesSnapshot,
} from '@pp/shared'
import { pairPlayers } from '../services/pairing'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 50_000
const FORCED_TURNS = 40 // seeded fallback picks for players who let the timer run out

interface Duel {
  a: PlayerId
  b: PlayerId | null // null = bye
  marbles: Map<PlayerId, number>
  turn: number
  phase: 'choose' | 'reveal' | 'done'
  phaseEndsAt: number
  hidden: number | null
  bet: number | null
  odd: boolean | null
  last: MarblesReveal | null
  winner: PlayerId | null // decided once done (null = draw)
  forcedHide: number[]
  forcedOdd: boolean[]
}

export interface MarblesState {
  duels: Duel[]
  playerDuel: Map<PlayerId, number>
  startedAt: number
  endsAt: number
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

// Duel format: odd or even with marbles. Deterministic: pairing and the fallback picks for a timed-out
// turn are drawn from the seeded Random at init; the rest follows the two players' choices. The number
// hidden this turn stays off the wire until it's revealed.
export class MarblesDuel implements MiniGame<MarblesState, MarblesInput> {
  readonly id = 'marbles-duel'
  readonly format = 'duel' as const

  init(ctx: MiniGameInitCtx): MarblesState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const duels: Duel[] = []
    const playerDuel = new Map<PlayerId, number>()
    for (const { a, b } of pairPlayers(ctx.players, ctx.random)) {
      playerDuel.set(a, duels.length)
      if (b) playerDuel.set(b, duels.length)
      const marbles = new Map<PlayerId, number>([[a, MARBLES.start]])
      if (b) marbles.set(b, MARBLES.start)
      duels.push({
        a,
        b,
        marbles,
        turn: 0,
        phase: b ? 'choose' : 'done',
        phaseEndsAt: ctx.now + MARBLES.chooseMs,
        hidden: null,
        bet: null,
        odd: null,
        last: null,
        winner: b ? null : a,
        forcedHide: Array.from(
          { length: FORCED_TURNS },
          () => 1 + Math.floor(ctx.random.next() * 3),
        ),
        forcedOdd: Array.from({ length: FORCED_TURNS }, () => ctx.random.next() < 0.5),
      })
    }
    return { duels, playerDuel, startedAt: ctx.now, endsAt: ctx.now + durationMs }
  }

  // The hider this turn: a on even turns, b on odd ones.
  private hider(d: Duel): PlayerId {
    return d.turn % 2 === 0 || !d.b ? d.a : d.b
  }

  private guesser(d: Duel): PlayerId {
    return d.turn % 2 === 0 ? (d.b as PlayerId) : d.a
  }

  onInput(state: MarblesState, playerId: PlayerId, input: MarblesInput, now: number): MarblesState {
    if (now >= state.endsAt) return state
    const d = state.duels[state.playerDuel.get(playerId) ?? -1]
    if (!d?.b || d.phase !== 'choose') return state
    const mine = d.marbles.get(playerId) ?? 0
    if (input?.kind === 'hide' && playerId === this.hider(d)) {
      if (!isInt(input.count) || input.count < 1 || input.count > mine) return state
      d.hidden = input.count
    } else if (input?.kind === 'guess' && playerId === this.guesser(d)) {
      if (
        !isInt(input.bet) ||
        input.bet < 1 ||
        input.bet > mine ||
        typeof input.odd !== 'boolean'
      ) {
        return state
      }
      d.bet = input.bet
      d.odd = input.odd
    }
    // Both made their move: reveal right away.
    if (d.hidden !== null && d.bet !== null) this.resolve(d, now)
    return state
  }

  private resolve(d: Duel, now: number): void {
    const hider = this.hider(d)
    const guesser = this.guesser(d)
    const hiderHas = d.marbles.get(hider) ?? 0
    const guesserHas = d.marbles.get(guesser) ?? 0
    const k = d.turn % FORCED_TURNS
    const hidden = Math.min(hiderHas, d.hidden ?? d.forcedHide[k] ?? 1)
    const bet = Math.min(guesserHas, d.bet ?? 1)
    const odd = d.odd ?? d.forcedOdd[k] ?? true
    const correct = (hidden % 2 === 1) === odd
    const moved = correct ? Math.min(bet, hiderHas) : Math.min(bet, guesserHas)
    d.marbles.set(guesser, guesserHas + (correct ? moved : -moved))
    d.marbles.set(hider, hiderHas + (correct ? -moved : moved))
    d.last = { hidden, bet, odd, correct, moved, guesserId: guesser }
    d.phase = 'reveal'
    d.phaseEndsAt = now + MARBLES.revealMs
    if ((d.marbles.get(guesser) ?? 0) <= 0) d.winner = hider
    else if ((d.marbles.get(hider) ?? 0) <= 0) d.winner = guesser
  }

  tick(state: MarblesState, _dt: number, now: number): MarblesState {
    for (const d of state.duels) {
      if (d.phase === 'done' || now < d.phaseEndsAt) continue
      if (d.phase === 'choose') {
        this.resolve(d, d.phaseEndsAt)
        continue
      }
      // Reveal over: the duel is decided, or the roles swap for the next turn.
      if (d.winner !== null) {
        d.phase = 'done'
        continue
      }
      d.turn += 1
      d.hidden = null
      d.bet = null
      d.odd = null
      d.phase = 'choose'
      d.phaseEndsAt = d.phaseEndsAt + MARBLES.chooseMs
    }
    return state
  }

  isFinished(state: MarblesState, now: number): boolean {
    return now >= state.endsAt || state.duels.every((d) => d.phase === 'done')
  }

  // A duel still running at the bell goes to whoever holds more marbles (equal = draw).
  private winnerOf(d: Duel): PlayerId | null {
    if (d.phase === 'done' || d.winner !== null || !d.b) return d.winner
    const a = d.marbles.get(d.a) ?? 0
    const b = d.marbles.get(d.b) ?? 0
    return a === b ? null : a > b ? d.a : d.b
  }

  getResult(state: MarblesState): NormalizedResult {
    const placements: PlayerId[] = []
    const ranks: Record<PlayerId, number> = {}
    const stats: Record<PlayerId, string> = {}
    for (const d of state.duels) {
      const winner = this.winnerOf(d)
      for (const pid of [d.a, d.b]) {
        if (!pid) continue
        placements.push(pid)
        ranks[pid] = winner === null || winner === pid ? 0 : 1
        stats[pid] = `${d.marbles.get(pid) ?? 0}`
      }
    }
    placements.sort((x, y) => (ranks[x] ?? 0) - (ranks[y] ?? 0))
    return { placements, ranks, stats }
  }

  snapshot(state: MarblesState, now: number): MarblesSnapshot {
    const ended = now >= state.endsAt
    const players: Record<string, MarblesPlayerView> = {}
    for (const d of state.duels) {
      const winner = d.phase === 'done' || ended ? this.winnerOf(d) : null
      for (const pid of [d.a, d.b]) {
        if (!pid) continue
        const opp = pid === d.a ? d.b : d.a
        const hiding = d.b ? this.hider(d) === pid : true
        players[pid] = {
          opponentId: opp,
          mine: d.marbles.get(pid) ?? 0,
          theirs: opp ? (d.marbles.get(opp) ?? 0) : 0,
          role: hiding ? 'hide' : 'guess',
          turn: d.turn + 1,
          phase: ended ? 'done' : d.phase,
          msLeft: Math.max(0, d.phaseEndsAt - now),
          youChose: hiding ? d.hidden !== null : d.bet !== null,
          theyChose: hiding ? d.bet !== null : d.hidden !== null,
          last: d.phase === 'reveal' || d.phase === 'done' ? d.last : null,
          won: d.phase === 'done' || ended ? (winner === null ? null : winner === pid) : null,
        }
      }
    }
    return { roundRemainingMs: Math.max(0, state.endsAt - now), players }
  }
}
