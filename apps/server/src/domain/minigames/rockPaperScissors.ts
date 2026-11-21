import {
  RPS,
  RPS_HANDS,
  type RpsHand,
  type RpsInput,
  type RpsPlayerView,
  type RpsSnapshot,
  type RpsThrow,
  rpsChooseMs,
  rpsOutcome,
} from '@pp/shared'
import { type DuelOutcome, rankDuels } from '../services/duelRanking'
import { pairPlayers } from '../services/pairing'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 45_000

interface Duel {
  a: PlayerId
  b: PlayerId | null // null = bye
  wins: Map<PlayerId, number>
  throwNo: number
  phase: 'choose' | 'reveal' | 'done'
  phaseEndsAt: number
  // This throw's picks (secret until the reveal).
  picks: Map<PlayerId, RpsHand>
  // Revealed throws: [a's hand, b's hand].
  history: [RpsHand | null, RpsHand | null][]
  winner: PlayerId | null // decided once done (null = a draw, or a bye)
  forfeit: boolean // decided by a player leaving
}

export interface RpsState {
  duels: Duel[]
  playerDuel: Map<PlayerId, number>
  startedAt: number
  endsAt: number
}

// Rock Paper Scissors (D43), duel format. Pairing comes from the seeded Random at init; the rest is the
// two players' picks. A throw is revealed as soon as both have picked (or when its window closes — an
// idle player loses it); first to RPS.winsNeeded wins. Each throw's window shrinks (rpsChooseMs). Duels
// rank across the room in tiers (rankDuels): wins, then draws and the bye, then losses — each by throws
// won.
export class RockPaperScissors implements MiniGame<RpsState, RpsInput> {
  readonly id = 'rock-paper-scissors'
  readonly format = 'duel' as const

  init(ctx: MiniGameInitCtx): RpsState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const duels: Duel[] = []
    const playerDuel = new Map<PlayerId, number>()
    for (const { a, b } of pairPlayers(ctx.players, ctx.random, ctx.byeCounts)) {
      playerDuel.set(a, duels.length)
      if (b) playerDuel.set(b, duels.length)
      duels.push({
        a,
        b,
        wins: new Map(
          b
            ? [
                [a, 0],
                [b, 0],
              ]
            : [[a, 0]],
        ),
        throwNo: 1,
        phase: b ? 'choose' : 'done',
        phaseEndsAt: ctx.now + rpsChooseMs(1),
        picks: new Map(),
        history: [],
        winner: null,
        forfeit: false,
      })
    }
    return { duels, playerDuel, startedAt: ctx.now, endsAt: ctx.now + durationMs }
  }

  onInput(state: RpsState, playerId: PlayerId, input: RpsInput, now: number): RpsState {
    if (now >= state.endsAt || input?.kind !== 'throw' || !RPS_HANDS.includes(input.hand))
      return state
    const d = state.duels[state.playerDuel.get(playerId) ?? -1]
    if (!d?.b || d.phase !== 'choose' || d.picks.has(playerId)) return state
    d.picks.set(playerId, input.hand)
    if (d.picks.size === 2) this.resolve(d, now)
    return state
  }

  private resolve(d: Duel, now: number): void {
    const b = d.b as PlayerId
    const ha = d.picks.get(d.a) ?? null
    const hb = d.picks.get(b) ?? null
    d.history.push([ha, hb])
    const outcome = rpsOutcome(ha, hb)
    if (outcome === 'win') d.wins.set(d.a, (d.wins.get(d.a) ?? 0) + 1)
    if (outcome === 'loss') d.wins.set(b, (d.wins.get(b) ?? 0) + 1)
    if ((d.wins.get(d.a) ?? 0) >= RPS.winsNeeded) d.winner = d.a
    else if ((d.wins.get(b) ?? 0) >= RPS.winsNeeded) d.winner = b
    d.phase = 'reveal'
    d.phaseEndsAt = now + RPS.revealMs
  }

  tick(state: RpsState, _dt: number, now: number): RpsState {
    for (const d of state.duels) {
      if (d.phase === 'done' || now < d.phaseEndsAt) continue
      if (d.phase === 'choose') {
        this.resolve(d, d.phaseEndsAt)
        continue
      }
      // Reveal over: the duel is decided, or on to the next throw.
      if (d.winner !== null) {
        d.phase = 'done'
        continue
      }
      d.throwNo += 1
      d.picks = new Map()
      d.phase = 'choose'
      d.phaseEndsAt += rpsChooseMs(d.throwNo)
    }
    return state
  }

  // A player who leaves forfeits: their opponent wins on the spot (unless the duel is already decided).
  leave(state: RpsState, playerId: PlayerId, _now: number): RpsState {
    const d = state.duels[state.playerDuel.get(playerId) ?? -1]
    if (!d?.b || d.phase === 'done' || d.winner !== null) return state
    d.winner = playerId === d.a ? d.b : d.a
    d.forfeit = true
    d.phase = 'done'
    return state
  }

  isFinished(state: RpsState, now: number): boolean {
    return now >= state.endsAt || state.duels.every((d) => d.phase === 'done')
  }

  // A duel still running at the bell goes to whoever won more throws (equal = draw).
  private winnerOf(d: Duel): PlayerId | null {
    if (d.phase === 'done' || d.winner !== null || !d.b) return d.winner
    const a = d.wins.get(d.a) ?? 0
    const b = d.wins.get(d.b) ?? 0
    return a === b ? null : a > b ? d.a : d.b
  }

  getResult(state: RpsState): NormalizedResult {
    const outcomes: DuelOutcome[] = []
    const stats: Record<PlayerId, string> = {}
    for (const d of state.duels) {
      if (!d.b) {
        outcomes.push({ id: d.a, tier: 'bye', margin: 0 })
        stats[d.a] = '—'
        continue
      }
      const winner = this.winnerOf(d)
      for (const pid of [d.a, d.b]) {
        const opp = pid === d.a ? d.b : d.a
        const tier = winner === null ? 'draw' : winner === pid ? 'win' : 'loss'
        outcomes.push({ id: pid, tier, margin: d.wins.get(pid) ?? 0 })
        stats[pid] = `${d.wins.get(pid) ?? 0}-${d.wins.get(opp) ?? 0}`
      }
    }
    return rankDuels(outcomes, stats)
  }

  snapshot(state: RpsState, now: number): RpsSnapshot {
    const ended = now >= state.endsAt
    const players: Record<string, RpsPlayerView> = {}
    for (const d of state.duels) {
      const winner = d.phase === 'done' || ended ? this.winnerOf(d) : null
      for (const pid of [d.a, d.b]) {
        if (!pid) continue
        const isA = pid === d.a
        const opp = isA ? d.b : d.a
        const history: RpsThrow[] = d.history.map(([ha, hb]) => {
          const mine = isA ? ha : hb
          const theirs = isA ? hb : ha
          return { mine, theirs, outcome: rpsOutcome(mine, theirs) }
        })
        players[pid] = {
          opponentId: opp,
          mine: d.wins.get(pid) ?? 0,
          theirs: opp ? (d.wins.get(opp) ?? 0) : 0,
          throwNo: d.throwNo,
          phase: ended ? 'done' : d.phase,
          msLeft: Math.max(0, d.phaseEndsAt - now),
          chooseMs: rpsChooseMs(d.throwNo),
          youChose: d.picks.has(pid),
          theyChose: opp ? d.picks.has(opp) : false,
          history,
          won: d.phase === 'done' || ended ? (winner === null ? null : winner === pid) : null,
          oppLeft: d.forfeit && winner === pid,
        }
      }
    }
    return { roundRemainingMs: Math.max(0, state.endsAt - now), players }
  }
}
