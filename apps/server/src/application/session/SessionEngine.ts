import type { MiniGameId, ScoreEntryDto, ServerMsg } from '@pp/shared'
import { MINIGAMES_BY_ID } from '@pp/shared'
import type { Room } from '../../domain/entities/Room'
import type { MiniGame, PlayerId } from '../../domain/minigames/MiniGame'
import { createMiniGame } from '../../domain/minigames/registry'
import type { Random } from '../../domain/ports/Random'
import { awardPoints } from '../../domain/services/scoring'
import type { Clock } from '../ports/Clock'
import type { Publisher } from '../ports/Publisher'

export interface SessionConfig {
  introMs: number
  resultMs: number
  tickHz: number
  snapshotEveryNTicks: number
  defaultDurationMs: number
  baseSeed: number
}

type Phase = 'intro' | 'playing' | 'result' | 'final'

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
  private readonly cumulative = new Map<PlayerId, number>()
  // Players are snapshotted at round start so a mid-round leave/join can't reshape the result.
  private roundPlayers: PlayerId[] = []

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
    const pool = this.room.minigameIds.length ? [...this.room.minigameIds] : ['button-masher']
    const count = this.room.rounds > 0 ? this.room.rounds : pool.length
    this.sequence = Array.from({ length: count }, (_, i) => pool[i % pool.length] as MiniGameId)
    this.roundIndex = 0
    this.beginIntro(this.clock.now())
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
      case 'result':
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
    this.gameState = game.init({
      players: this.roundPlayers,
      seed: this.config.baseSeed + this.roundIndex,
      random: this.random,
      now,
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
    const roundPoints = awardPoints(result)
    for (const [playerId, pts] of roundPoints) {
      this.cumulative.set(playerId, (this.cumulative.get(playerId) ?? 0) + pts)
    }
    this.publish({
      type: 'ROUND_RESULT',
      round: this.roundIndex + 1,
      result: {
        minigameId: id,
        placements: result.placements,
        scores: toScoreEntries(roundPoints),
      },
    })
    this.publish({ type: 'SCOREBOARD', scores: toScoreEntries(this.cumulative) })
    this.room.setPhase('scoreboard')
    this.phase = 'result'
    this.phaseEndsAt = now + this.config.resultMs
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
