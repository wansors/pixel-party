import type { PongInput, PongSnapshot } from '@pp/shared'
import { type DuelOutcome, rankDuels } from '../services/duelRanking'
import { pairPlayers } from '../services/pairing'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 45_000
const WIN_SCORE = 5
// A duel tied at the timer plays a golden point (the next point wins) for at most this long, then draws.
const OVERTIME_MS = 10_000
const LEFT_X = 0.04
const RIGHT_X = 0.96
const PAD_HALF = 0.13
const BALL_START_VX = 0.55 // normalized units per second
const BALL_MAX_VY = 0.5
const SPEEDUP = 1.05
const MAX_VX = 1.4

interface Ball {
  x: number
  y: number
  vx: number
  vy: number
}

interface Duel {
  a: PlayerId
  b: PlayerId | null
  padY: Map<PlayerId, number>
  score: Map<PlayerId, number>
  ball: Ball
  serves: number // increments each serve → deterministic serve direction
  golden: boolean // tied at the timer: the next point wins
  done: boolean
  winner: PlayerId | null // set once done (null = a draw, or a bye)
  forfeit: boolean // decided by a player leaving
}

export interface PongState {
  duels: Duel[]
  playerDuel: Map<PlayerId, number>
  startedAt: number
  endsAt: number
  overtimeEndsAt: number
}

// Real-time 1v1 Pong. Players are seeded-paired; the server owns the ball. Deterministic: the only RNG
// is the seeded initial serve direction at init; every later serve is derived from a per-duel counter so
// tick() (which has no Random port) stays reproducible. First to WIN_SCORE wins; at the timer the leader
// wins, and a tied duel plays a golden point (capped by OVERTIME_MS, then a draw). Duels rank across the
// room in tiers (rankDuels): wins, then draws and the bye, then losses — each by point difference.
export class Pong implements MiniGame<PongState, PongInput> {
  readonly id = 'pixel-pong'
  readonly format = 'duel' as const

  init(ctx: MiniGameInitCtx): PongState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const pairs = pairPlayers(ctx.players, ctx.random, ctx.byeCounts)
    const duels: Duel[] = []
    const playerDuel = new Map<PlayerId, number>()
    for (const { a, b } of pairs) {
      const idx = duels.length
      playerDuel.set(a, idx)
      if (b) playerDuel.set(b, idx)
      const padY = new Map<PlayerId, number>([[a, 0.5]])
      const score = new Map<PlayerId, number>([[a, 0]])
      if (b) {
        padY.set(b, 0.5)
        score.set(b, 0)
      }
      // Seeded first serve: direction toward a random side, gentle vertical angle.
      const toRight = ctx.random.next() < 0.5
      const vy = (ctx.random.next() - 0.5) * BALL_MAX_VY
      duels.push({
        a,
        b,
        padY,
        score,
        ball: { x: 0.5, y: 0.5, vx: toRight ? BALL_START_VX : -BALL_START_VX, vy },
        serves: 0,
        golden: false,
        done: b === null,
        winner: null,
        forfeit: false,
      })
    }
    const endsAt = ctx.now + durationMs
    return { duels, playerDuel, startedAt: ctx.now, endsAt, overtimeEndsAt: endsAt + OVERTIME_MS }
  }

  onInput(state: PongState, playerId: PlayerId, input: PongInput, now: number): PongState {
    if (input.kind !== 'move' || typeof input.y !== 'number' || !Number.isFinite(input.y)) {
      return state
    }
    if (now < state.startedAt) return state
    const idx = state.playerDuel.get(playerId)
    if (idx === undefined) return state
    const duel = state.duels[idx] as Duel
    if (duel.done || duel.b === null) return state
    duel.padY.set(playerId, Math.max(0, Math.min(1, input.y)))
    return state
  }

  tick(state: PongState, dt: number, now: number): PongState {
    const step = dt / 1000
    for (const duel of state.duels) {
      if (duel.done) continue
      if (now >= state.overtimeEndsAt) {
        // The golden point never came: a draw.
        duel.done = true
        continue
      }
      if (now >= state.endsAt && !duel.golden) {
        // The bell: the leader wins; a tie goes to a golden point.
        const lead = (duel.score.get(duel.a) ?? 0) - (duel.score.get(duel.b as PlayerId) ?? 0)
        if (lead !== 0) {
          duel.done = true
          duel.winner = lead > 0 ? duel.a : duel.b
          continue
        }
        duel.golden = true
      }
      this.advance(duel, step)
    }
    return state
  }

  private advance(duel: Duel, step: number): void {
    const ball = duel.ball
    ball.x += ball.vx * step
    ball.y += ball.vy * step
    // Top / bottom walls.
    if (ball.y < 0) {
      ball.y = 0
      ball.vy = Math.abs(ball.vy)
    } else if (ball.y > 1) {
      ball.y = 1
      ball.vy = -Math.abs(ball.vy)
    }
    const left = duel.a
    const right = duel.b as PlayerId
    // Left paddle / left goal.
    if (ball.x <= LEFT_X) {
      if (Math.abs(ball.y - (duel.padY.get(left) ?? 0.5)) <= PAD_HALF) {
        ball.x = LEFT_X
        this.bounce(duel, ball, left, +1)
      } else {
        this.scorePoint(duel, right)
      }
    } else if (ball.x >= RIGHT_X) {
      if (Math.abs(ball.y - (duel.padY.get(right) ?? 0.5)) <= PAD_HALF) {
        ball.x = RIGHT_X
        this.bounce(duel, ball, right, -1)
      } else {
        this.scorePoint(duel, left)
      }
    }
  }

  // Reflect off a paddle: reverse x, speed up (capped), and angle vy by where it struck the paddle.
  private bounce(duel: Duel, ball: Ball, padOwner: PlayerId, dir: 1 | -1): void {
    const offset = (ball.y - (duel.padY.get(padOwner) ?? 0.5)) / PAD_HALF // -1..1
    const speed = Math.min(MAX_VX, Math.abs(ball.vx) * SPEEDUP)
    ball.vx = dir * speed
    ball.vy = offset * BALL_MAX_VY
  }

  private scorePoint(duel: Duel, scorer: PlayerId): void {
    duel.score.set(scorer, (duel.score.get(scorer) ?? 0) + 1)
    if (duel.golden || (duel.score.get(scorer) ?? 0) >= WIN_SCORE) {
      duel.done = true
      duel.winner = scorer
      return
    }
    this.serve(duel)
  }

  // Deterministic serve: alternate direction + vertical angle by the serve counter (no RNG in tick).
  private serve(duel: Duel): void {
    duel.serves += 1
    const toRight = duel.serves % 2 === 0
    const vy = (((duel.serves % 3) - 1) / 1) * (BALL_MAX_VY * 0.5) // -0.5,0,+0.5 pattern
    duel.ball = { x: 0.5, y: 0.5, vx: toRight ? BALL_START_VX : -BALL_START_VX, vy }
  }

  // A player who leaves forfeits: their opponent wins on the spot.
  leave(state: PongState, playerId: PlayerId, _now: number): PongState {
    const duel = state.duels[state.playerDuel.get(playerId) ?? -1]
    if (!duel?.b || duel.done) return state
    duel.done = true
    duel.winner = playerId === duel.a ? duel.b : duel.a
    duel.forfeit = true
    return state
  }

  isFinished(state: PongState, now: number): boolean {
    return now >= state.overtimeEndsAt || state.duels.every((d) => d.done)
  }

  getResult(state: PongState): NormalizedResult {
    const outcomes: DuelOutcome[] = []
    const stats: Record<PlayerId, string> = {}
    for (const duel of state.duels) {
      if (!duel.b) {
        outcomes.push({ id: duel.a, tier: 'bye' })
        stats[duel.a] = '—'
        continue
      }
      const winner = resolveWinner(duel)
      for (const pid of [duel.a, duel.b]) {
        const opp = pid === duel.a ? duel.b : duel.a
        const tier = winner === null ? 'draw' : winner === pid ? 'win' : 'loss'
        const margin = (duel.score.get(pid) ?? 0) - (duel.score.get(opp) ?? 0)
        outcomes.push({ id: pid, tier, margin })
        stats[pid] = `${duel.score.get(pid) ?? 0} pts`
      }
    }
    return rankDuels(outcomes, stats)
  }

  snapshot(state: PongState, now: number): PongSnapshot {
    const over = now >= state.overtimeEndsAt
    const overtime = now >= state.endsAt && state.duels.some((d) => d.golden && !d.done)
    const players: PongSnapshot['players'] = {}
    for (const duel of state.duels) {
      const done = duel.done || over
      const winner = resolveWinner(duel)
      for (const pid of [duel.a, duel.b]) {
        if (!pid) continue
        const opp = pid === duel.a ? duel.b : duel.a
        const side = pid === duel.a ? 'left' : 'right'
        players[pid] = {
          opponentId: opp,
          side,
          youY: duel.padY.get(pid) ?? 0.5,
          oppY: opp ? (duel.padY.get(opp) ?? 0.5) : 0.5,
          // Mirror the ball for the right-side player so "your paddle" is always drawn on the left.
          ballX: side === 'left' ? duel.ball.x : 1 - duel.ball.x,
          ballY: duel.ball.y,
          scoreYou: duel.score.get(pid) ?? 0,
          scoreOpp: opp ? (duel.score.get(opp) ?? 0) : 0,
          golden: duel.golden && !done,
          done,
          won: done && opp !== null && winner !== null ? winner === pid : null,
          oppLeft: duel.forfeit && winner === pid,
        }
      }
    }
    // Once the bell has rung, the clock counts down the golden points still being played.
    const clockEndsAt = overtime ? state.overtimeEndsAt : state.endsAt
    return { roundRemainingMs: Math.max(0, clockEndsAt - now), players }
  }
}

// Winner of a duel: the stored winner once decided, else the leader on points (a duel still running
// when the round is cut short) — equal is a draw (null), as is a bye.
function resolveWinner(duel: Duel): PlayerId | null {
  if (duel.b === null) return null
  if (duel.done) return duel.winner
  const aScore = duel.score.get(duel.a) ?? 0
  const bScore = duel.score.get(duel.b) ?? 0
  return aScore > bScore ? duel.a : bScore > aScore ? duel.b : null
}
