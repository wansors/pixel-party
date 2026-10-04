import type { ServerMsg } from '@pp/shared'
import type { Room } from '../../domain/entities/Room'
import type { PlayerId } from '../../domain/minigames/MiniGame'
import type { Random } from '../../domain/ports/Random'
import type { Clock } from '../ports/Clock'
import type { Publisher } from '../ports/Publisher'
import type { SessionConfig } from './SessionEngine'
import { SessionEngine } from './SessionEngine'

// Owns the live session engines keyed by room code. The simulation loop calls tickAll() each tick; the
// WS adapter routes START_SESSION -> start() and MINIGAME_INPUT -> input().
export class SessionManager {
  private readonly engines = new Map<string, SessionEngine>()

  constructor(
    private readonly publisher: Publisher,
    private readonly clock: Clock,
    private readonly random: Random,
    private readonly config: SessionConfig,
  ) {}

  isRunning(roomCode: string): boolean {
    return this.engines.has(roomCode)
  }

  get runningCount(): number {
    return this.engines.size
  }

  start(room: Room): boolean {
    if (this.engines.has(room.code)) return false
    const engine = new SessionEngine(room, this.publisher, this.clock, this.random, this.config)
    this.engines.set(room.code, engine)
    engine.start()
    return true
  }

  // Host skip of the current round; false when no round is running.
  skip(roomCode: string, byPlayerId: PlayerId): boolean {
    return this.engines.get(roomCode)?.skipRound(byPlayerId) ?? false
  }

  input(roomCode: string, playerId: PlayerId, input: unknown): void {
    this.engines.get(roomCode)?.onInput(playerId, input)
  }

  // State-restore messages for a reconnecting socket; empty if no session is running for that room.
  resumeMessages(roomCode: string): ServerMsg[] {
    return this.engines.get(roomCode)?.resumeMessages() ?? []
  }

  stop(roomCode: string): void {
    this.engines.delete(roomCode)
  }

  tickAll(): void {
    for (const [code, engine] of this.engines) {
      engine.tick()
      if (engine.isFinished) this.engines.delete(code)
    }
  }
}

export type { SessionConfig }
