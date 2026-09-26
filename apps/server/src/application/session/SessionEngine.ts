import type {
  MiniGameId,
  PlayerRadarDto,
  RoundResultDto,
  ScoreEntryDto,
  ServerMsg,
  SessionSummaryDto,
  SkillAxis,
  TeamId,
  TeamRoundResult,
} from '@pp/shared'
import { MINIGAMES_BY_ID } from '@pp/shared'
import type { Room } from '../../domain/entities/Room'
import type { MiniGame, NormalizedResult, PlayerId } from '../../domain/minigames/MiniGame'
import { createMiniGame } from '../../domain/minigames/registry'
import type { Random } from '../../domain/ports/Random'
import { finalRanking } from '../../domain/services/finalRanking'
import { type HandicapConfig, applyScoringHandicap } from '../../domain/services/handicap'
import { awardPoints, awardTeamPoints } from '../../domain/services/scoring'
import {
  type RoundAnalysis,
  buildRadars,
  buildSummary,
} from '../../domain/services/sessionAnalysis'
import type { Clock } from '../ports/Clock'
import type { Publisher } from '../ports/Publisher'

export interface SessionConfig {
  introMs: number
  // The post-round reveal: the round's own result (who won THIS mini-game) and the cumulative
  // scoreboard are published together (the client shows them on one screen); the screen then dwells
  // for roundResultMs + scoreboardMs before the next round's intro.
  roundResultMs: number
  scoreboardMs: number
  // Freeze on the final state before the reveal: when a round finishes, its last snapshot is published
  // flagged `final` and the result is held back this long, so players actually see how the round ended
  // (the winning pull, the last catch) instead of being cut to the results mid-action. Optional; absent
  // or 0 reveals immediately.
  roundEndGraceMs?: number
  tickHz: number
  snapshotEveryNTicks: number
  defaultDurationMs: number
  baseSeed: number
  // Optional bounded scoring catch-up (scoring-system.md §3.1). Ships OFF; when enabled it only inflates
  // trailing players' own awards within a cap — never reorders a round.
  handicap: HandicapConfig
}

type Phase = 'intro' | 'playing' | 'finishing' | 'roundResult' | 'scoreboard' | 'final'

// Per-room session state machine. Deterministic by construction: time arrives via the Clock port and
// randomness via the Random port, so a session is reproducible from (seed, input timeline). The engine
// drives rounds sequentially: intro countdown -> play -> per-round result -> next round -> final.
export class SessionEngine {
  private phase: Phase = 'intro'
  private phaseEndsAt = 0
  private roundIndex = 0
  private sequence: MiniGameId[] = []
  private game?: MiniGame<unknown, unknown>
  private gameState: unknown
  private tickCount = 0
  // Last published round result, kept so a reconnecting client can be shown the scoreboard it missed.
  private lastResult?: RoundResultDto
  private readonly cumulative = new Map<PlayerId, number>()
  // Players are snapshotted at round start so a mid-round leave/join can't reshape the result.
  private roundPlayers: PlayerId[] = []
  // Team membership snapshotted at round start (empty for FFA rounds); drives team scoring.
  private roundTeams = new Map<TeamId, PlayerId[]>()
  // Phase 4 post-match analysis: one entry per finished round, consumed to build the final radar +
  // session summary. Presentational only — never feeds scoring.
  private readonly analysis: RoundAnalysis[] = []
  private finalRadars: PlayerRadarDto[] = []
  private finalSummary?: SessionSummaryDto
  // Final-ranking tiebreakers (scoring-system.md §5): count of round wins (shared top position) and the
  // running sum of per-round positions, so equal totals break by most firsts then best average position.
  private readonly firsts = new Map<PlayerId, number>()
  private readonly positionSum = new Map<PlayerId, number>()
  private readonly roundsPlayed = new Map<PlayerId, number>()

  constructor(
    private readonly room: Room,
    private readonly publisher: Publisher,
    private readonly clock: Clock,
    private readonly random: Random,
    private readonly config: SessionConfig,
  ) {}

  get isFinished(): boolean {
    return this.phase === 'final'
  }

  start(): void {
    // No-repeat within a session: draw distinct games from the pool and cap the round count at the
    // number of distinct games (a game never plays twice in one session).
    const pool = this.room.minigameIds.length
      ? [...new Set(this.room.minigameIds)]
      : ['button-masher']
    const requested = this.room.rounds > 0 ? this.room.rounds : pool.length
    this.sequence = this.orderPool(pool, Math.min(requested, pool.length)) as MiniGameId[]
    this.roundIndex = 0
    this.beginIntro(this.clock.now())
  }

  // Seeded draw (via the Random port) that avoids placing two games with the same primary skill axis
  // back-to-back — e.g. two `knowledge` games in a row — unless every remaining candidate would repeat
  // it, in which case the constraint is dropped rather than stalling the draw.
  private orderPool(pool: readonly string[], count: number): string[] {
    const remaining = [...pool]
    const sequence: string[] = []
    let prevAxis: SkillAxis | undefined
    while (sequence.length < count && remaining.length > 0) {
      const candidates = remaining.filter((id) => primaryAxis(id) !== prevAxis)
      const drawFrom = candidates.length > 0 ? candidates : remaining
      const pick = drawFrom[Math.floor(this.random.next() * drawFrom.length)] as string
      sequence.push(pick)
      remaining.splice(remaining.indexOf(pick), 1)
      prevAxis = primaryAxis(pick)
    }
    return sequence
  }

  onInput(playerId: PlayerId, input: unknown): void {
    if (this.phase !== 'playing' || !this.game) return
    this.gameState = this.game.onInput(this.gameState, playerId, input, this.clock.now())
  }

  // Advanced once per simulation tick.
  tick(): void {
    const now = this.clock.now()
    switch (this.phase) {
      case 'intro':
        if (now >= this.phaseEndsAt) this.startPlaying(now)
        return
      case 'playing':
        this.tickPlaying(now)
        return
      case 'finishing':
        if (now >= this.phaseEndsAt) this.endRound(now)
        return
      case 'roundResult':
        if (now >= this.phaseEndsAt) this.beginScoreboard(now)
        return
      case 'scoreboard':
        if (now >= this.phaseEndsAt) this.advance(now)
        return
      case 'final':
        return
    }
  }

  private beginIntro(now: number): void {
    const id = this.sequence[this.roundIndex] as MiniGameId
    const meta = MINIGAMES_BY_ID.get(id)
    this.room.setPhase('round-intro')
    this.phase = 'intro'
    this.phaseEndsAt = now + this.config.introMs
    this.publish({
      type: 'ROUND_INTRO',
      round: this.roundIndex + 1,
      totalRounds: this.sequence.length,
      minigameId: id,
      format: meta?.format ?? 'ffa',
      startsInMs: this.config.introMs,
    })
  }

  private startPlaying(now: number): void {
    const id = this.sequence[this.roundIndex] as MiniGameId
    const meta = MINIGAMES_BY_ID.get(id)
    const durationMs =
      meta && meta.durationSec > 0 ? meta.durationSec * 1000 : this.config.defaultDurationMs
    const game = createMiniGame(id)
    if (!game) {
      // Unknown id (bad host config): skip the round rather than wedge the session.
      this.advance(now)
      return
    }
    this.game = game
    this.roundPlayers = this.room.list().map((p) => p.id)
    // Snapshot team membership for the round (empty for FFA games) and feed it to the game.
    this.roundTeams = new Map()
    const teams: Record<PlayerId, TeamId> = {}
    for (const p of this.room.list()) {
      if (!p.team) continue
      teams[p.id] = p.team
      const bucket = this.roundTeams.get(p.team) ?? []
      bucket.push(p.id)
      this.roundTeams.set(p.team, bucket)
    }
    this.gameState = game.init({
      players: this.roundPlayers,
      seed: this.config.baseSeed + this.roundIndex,
      random: this.random,
      now,
      teams,
      config: { durationMs },
    })
    this.tickCount = 0
    this.phase = 'playing'
    this.room.setPhase('round')
  }

  private tickPlaying(now: number): void {
    const game = this.game
    if (!game) return
    if (game.tick) {
      this.gameState = game.tick(this.gameState, 1000 / this.config.tickHz, now)
    }
    this.tickCount++
    if (this.tickCount % this.config.snapshotEveryNTicks === 0) {
      this.publish({
        type: 'ROUND_STATE',
        round: this.roundIndex + 1,
        tick: this.tickCount,
        state: game.snapshot ? game.snapshot(this.gameState, now) : this.gameState,
      })
    }
    if (game.isFinished(this.gameState, now)) this.beginFinish(now)
  }

  // The round is over: publish its final state (flagged, so clients can show a FINISH moment), freeze
  // the game (no more ticks or inputs) and reveal the result after the grace period.
  private beginFinish(now: number): void {
    const game = this.game
    if (!game) return
    this.publish({
      type: 'ROUND_STATE',
      round: this.roundIndex + 1,
      tick: this.tickCount,
      state: game.snapshot ? game.snapshot(this.gameState, now) : this.gameState,
      final: true,
    })
    const grace = this.config.roundEndGraceMs ?? 0
    if (grace <= 0) {
      this.endRound(now)
      return
    }
    this.phase = 'finishing'
    this.phaseEndsAt = now + grace
  }

  private endRound(now: number): void {
    const game = this.game as MiniGame<unknown, unknown>
    const id = this.sequence[this.roundIndex] as MiniGameId
    const result = game.getResult(this.gameState)
    // Team rounds distribute points by team position; FFA rounds award per player directly.
    const isTeam = game.format === 'team'
    const basePoints = isTeam ? awardTeamPoints(result, this.roundTeams) : awardPoints(result)
    // Optional bounded catch-up on the awarded points, keyed off the standings BEFORE this round. The
    // host lobby toggle (room.handicap) is the on/off switch; the cap comes from server config.
    const standingsBefore = new Map(this.cumulative)
    const { points: roundPoints, bonus } = applyScoringHandicap(basePoints, standingsBefore, {
      enabled: this.room.handicap,
      maxBonusPct: this.config.handicap.maxBonusPct,
    })
    for (const [playerId, pts] of roundPoints) {
      this.cumulative.set(playerId, (this.cumulative.get(playerId) ?? 0) + pts)
    }
    const { placements, teams } = isTeam
      ? this.teamResultView(result)
      : { placements: result.placements, teams: undefined }
    // Surface the catch-up bonus for transparency: keep only the non-zero entries (omit entirely when
    // handicap is off or nobody got a boost).
    const handicap: Record<PlayerId, number> = {}
    for (const [pid, b] of bonus) if (b > 0) handicap[pid] = Math.round(b * 10) / 10
    // Radar reflects skill, so it normalizes the BASE award (before any catch-up bonus). Recorded before
    // building the radar below so this round's own result is already folded in.
    this.recordAnalysis(id, basePoints, placements)
    this.lastResult = {
      minigameId: id,
      placements,
      scores: toScoreEntries(roundPoints),
      stats: result.stats,
      teams,
      handicap: Object.keys(handicap).length > 0 ? handicap : undefined,
      radars: buildRadars(this.analysis, [...this.cumulative.keys()]),
    }
    this.accumulateTiebreak(basePoints)
    // Reveal the round's own outcome and the updated cumulative standings together: the client renders
    // both on one results screen, so a separate later SCOREBOARD would leave it showing the previous
    // round's totals (or none, in round 1) for the whole first dwell.
    this.publish({ type: 'ROUND_RESULT', round: this.roundIndex + 1, result: this.lastResult })
    this.publish({ type: 'SCOREBOARD', scores: toScoreEntries(this.cumulative) })
    this.room.setPhase('round-result')
    this.phase = 'roundResult'
    this.phaseEndsAt = now + this.config.roundResultMs
  }

  // Wire view for a team round: teams ordered by rank (winner first), player placements expanded to
  // that order, plus the per-team summary that drives the "TEAM RED WINS" banner.
  private teamResultView(result: NormalizedResult): {
    placements: PlayerId[]
    teams: TeamRoundResult[]
  } {
    const teamPoints = awardPoints(result)
    const rankOf = (t: string): number => result.ranks?.[t] ?? 0
    const ordered = [...result.placements].sort((a, b) => rankOf(a) - rankOf(b))
    const teams: TeamRoundResult[] = ordered.map((t) => ({
      id: t as TeamId,
      rank: rankOf(t),
      points: teamPoints.get(t) ?? 0,
      memberIds: this.roundTeams.get(t as TeamId) ?? [],
    }))
    const placements = ordered.flatMap((t) => this.roundTeams.get(t as TeamId) ?? [])
    return { placements, teams }
  }

  // Capture this round for the post-match analysis. Normalization is points-relative: the round's top
  // scorer maps to 1.0 and the rest scale down by the award table — a simple, format-agnostic proxy for
  // "how well did they do on this game's skill".
  private recordAnalysis(
    id: MiniGameId,
    roundPoints: Map<PlayerId, number>,
    placements: PlayerId[],
  ): void {
    const maxPts = Math.max(0, ...roundPoints.values())
    const norm = new Map<PlayerId, number>()
    for (const [pid, pts] of roundPoints) norm.set(pid, maxPts > 0 ? pts / maxPts : 0)
    this.analysis.push({
      minigameId: id,
      axes: MINIGAMES_BY_ID.get(id)?.axes ?? [],
      norm,
      winnerId: placements[0] ?? null,
      standings: this.standingsSnapshot(),
    })
  }

  // Dense 1-based standings position per player from the current cumulative totals.
  private standingsSnapshot(): Map<PlayerId, number> {
    const map = new Map<PlayerId, number>()
    for (const e of toScoreEntries(this.cumulative)) map.set(e.playerId, e.rank)
    return map
  }

  // Accumulate this round's 0-based positions (from the base award; ties share the position) into the
  // tiebreaker tallies: a "first" is any player sharing the top position.
  private accumulateTiebreak(basePoints: Map<PlayerId, number>): void {
    const sorted = [...basePoints.entries()].sort((a, b) => b[1] - a[1])
    let position = 0
    let prev: number | undefined
    sorted.forEach(([pid, pts], idx) => {
      if (idx > 0 && pts !== prev) position = idx
      prev = pts
      if (position === 0) this.firsts.set(pid, (this.firsts.get(pid) ?? 0) + 1)
      this.positionSum.set(pid, (this.positionSum.get(pid) ?? 0) + position)
      this.roundsPlayed.set(pid, (this.roundsPlayed.get(pid) ?? 0) + 1)
    })
  }

  private finalRanking(): ScoreEntryDto[] {
    return finalRanking(this.cumulative, {
      firsts: this.firsts,
      positionSum: this.positionSum,
      roundsPlayed: this.roundsPlayed,
    })
  }

  // Second half of the results dwell (the SCOREBOARD itself already went out with the round result).
  private beginScoreboard(now: number): void {
    this.room.setPhase('scoreboard')
    this.phase = 'scoreboard'
    this.phaseEndsAt = now + this.config.scoreboardMs
  }

  private advance(now: number): void {
    this.roundIndex++
    if (this.roundIndex < this.sequence.length) {
      this.beginIntro(now)
      return
    }
    this.phase = 'final'
    this.room.setPhase('final')
    const players = [...this.cumulative.keys()]
    this.finalRadars = buildRadars(this.analysis, players)
    this.finalSummary = buildSummary(this.analysis, players)
    this.publish({
      type: 'FINAL_RANKING',
      scores: this.finalRanking(),
      radars: this.finalRadars,
      summary: this.finalSummary,
    })
  }

  // Ordered messages that rebuild the current session view for a single reconnecting socket. Mirrors
  // what the client would have received live, so its normal message handlers restore the right screen.
  resumeMessages(): ServerMsg[] {
    const now = this.clock.now()
    const scoreboard: ServerMsg = { type: 'SCOREBOARD', scores: toScoreEntries(this.cumulative) }
    const id = this.sequence[this.roundIndex] as MiniGameId
    const meta = MINIGAMES_BY_ID.get(id)
    const roundIntro = (startsInMs: number): ServerMsg => ({
      type: 'ROUND_INTRO',
      round: this.roundIndex + 1,
      totalRounds: this.sequence.length,
      minigameId: id,
      format: meta?.format ?? 'ffa',
      startsInMs,
    })
    switch (this.phase) {
      case 'intro':
        return [scoreboard, roundIntro(Math.max(0, this.phaseEndsAt - now))]
      case 'playing':
      case 'finishing': {
        const msgs: ServerMsg[] = [scoreboard, roundIntro(0)]
        if (this.game) {
          msgs.push({
            type: 'ROUND_STATE',
            round: this.roundIndex + 1,
            tick: this.tickCount,
            state: this.game.snapshot ? this.game.snapshot(this.gameState, now) : this.gameState,
            ...(this.phase === 'finishing' ? { final: true } : {}),
          })
        }
        return msgs
      }
      case 'roundResult':
      case 'scoreboard': {
        // On the results screen: replay the round result, then the cumulative scoreboard shown with it.
        const msgs: ServerMsg[] = []
        if (this.lastResult) {
          msgs.push({ type: 'ROUND_RESULT', round: this.roundIndex + 1, result: this.lastResult })
        }
        msgs.push(scoreboard)
        return msgs
      }
      case 'final':
        return [
          {
            type: 'FINAL_RANKING',
            scores: this.finalRanking(),
            radars: this.finalRadars,
            summary: this.finalSummary,
          },
        ]
    }
  }

  private publish(msg: ServerMsg): void {
    this.publisher.toRoom(this.room.code, msg)
  }
}

// A game's primary category for the no-consecutive-repeat draw (its first tagged skill axis).
function primaryAxis(id: string): SkillAxis | undefined {
  return MINIGAMES_BY_ID.get(id)?.axes[0]
}

// Sort by points desc into ranked entries with dense 1-based ranks (ties share a rank).
function toScoreEntries(points: Map<PlayerId, number>): ScoreEntryDto[] {
  const sorted = [...points.entries()].sort((a, b) => b[1] - a[1])
  let rank = 1
  let prev: number | undefined
  return sorted.map(([playerId, pts], idx) => {
    if (idx > 0 && pts !== prev) rank = idx + 1
    prev = pts
    return { playerId, points: pts, rank }
  })
}
