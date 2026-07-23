import type {
  MiniGameId,
  RoundResultDto,
  ScoreEntryDto,
  ServerMsg,
  TeamId,
  TeamRoundResult,
} from '@pp/shared'
import { MINIGAMES_BY_ID } from '@pp/shared'
import type { Room } from '../../domain/entities/Room'
import type { MiniGame, NormalizedResult, PlayerId } from '../../domain/minigames/MiniGame'
import { createMiniGame } from '../../domain/minigames/registry'
import type { Random } from '../../domain/ports/Random'
import { awardPoints, awardTeamPoints } from '../../domain/services/scoring'
import type { Clock } from '../ports/Clock'
import type { Publisher } from '../ports/Publisher'

export interface SessionConfig {
  introMs: number
  // The post-round reveal is two dwell steps: first the round's own result (who won THIS mini-game),
  // then the cumulative scoreboard — each shown long enough to read before the next round.
  roundResultMs: number
  scoreboardMs: number
  tickHz: number
  snapshotEveryNTicks: number
  defaultDurationMs: number
  baseSeed: number
}

type Phase = 'intro' | 'playing' | 'roundResult' | 'scoreboard' | 'final'

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
    // No-repeat within a session: draw distinct games from the pool in a seeded-random order and cap
    // the round count at the number of distinct games (a game never plays twice in one session).
    const pool = this.room.minigameIds.length
      ? [...new Set(this.room.minigameIds)]
      : ['button-masher']
    const order = this.shuffle(pool)
    const requested = this.room.rounds > 0 ? this.room.rounds : order.length
    this.sequence = order.slice(0, Math.min(requested, order.length)) as MiniGameId[]
    this.roundIndex = 0
    this.beginIntro(this.clock.now())
  }

  // Fisher-Yates via the Random port — deterministic given the RNG stream (same as the game rolls).
  private shuffle(items: readonly string[]): string[] {
    const a = [...items]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.random.next() * (i + 1))
      ;[a[i], a[j]] = [a[j] as string, a[i] as string]
    }
    return a
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
    if (game.isFinished(this.gameState, now)) this.endRound(now)
  }

  private endRound(now: number): void {
    const game = this.game as MiniGame<unknown, unknown>
    const id = this.sequence[this.roundIndex] as MiniGameId
    const result = game.getResult(this.gameState)
    // Team rounds distribute points by team position; FFA rounds award per player directly.
    const isTeam = game.format === 'team'
    const roundPoints = isTeam ? awardTeamPoints(result, this.roundTeams) : awardPoints(result)
    for (const [playerId, pts] of roundPoints) {
      this.cumulative.set(playerId, (this.cumulative.get(playerId) ?? 0) + pts)
    }
    const { placements, teams } = isTeam
      ? this.teamResultView(result)
      : { placements: result.placements, teams: undefined }
    this.lastResult = {
      minigameId: id,
      placements,
      scores: toScoreEntries(roundPoints),
      stats: result.stats,
      teams,
    }
    // Reveal the round's own outcome first; the cumulative scoreboard follows after its own dwell.
    this.publish({ type: 'ROUND_RESULT', round: this.roundIndex + 1, result: this.lastResult })
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

  private beginScoreboard(now: number): void {
    this.publish({ type: 'SCOREBOARD', scores: toScoreEntries(this.cumulative) })
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
    this.publish({ type: 'FINAL_RANKING', scores: toScoreEntries(this.cumulative) })
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
      case 'playing': {
        const msgs: ServerMsg[] = [scoreboard, roundIntro(0)]
        if (this.game) {
          msgs.push({
            type: 'ROUND_STATE',
            round: this.roundIndex + 1,
            tick: this.tickCount,
            state: this.game.snapshot ? this.game.snapshot(this.gameState, now) : this.gameState,
          })
        }
        return msgs
      }
      case 'roundResult': {
        // Still on the round-result reveal: replay only that; the cumulative scoreboard broadcasts to
        // the room when this phase advances.
        const msgs: ServerMsg[] = []
        if (this.lastResult) {
          msgs.push({ type: 'ROUND_RESULT', round: this.roundIndex + 1, result: this.lastResult })
        }
        return msgs
      }
      case 'scoreboard': {
        // Replay the round result then the cumulative scoreboard so the client lands on the latter.
        const msgs: ServerMsg[] = []
        if (this.lastResult) {
          msgs.push({ type: 'ROUND_RESULT', round: this.roundIndex + 1, result: this.lastResult })
        }
        msgs.push(scoreboard)
        return msgs
      }
      case 'final':
        return [{ type: 'FINAL_RANKING', scores: toScoreEntries(this.cumulative) }]
    }
  }

  private publish(msg: ServerMsg): void {
    this.publisher.toRoom(this.room.code, msg)
  }
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
