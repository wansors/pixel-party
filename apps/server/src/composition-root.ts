import type { SessionConfig } from './application/session/SessionEngine'
import { CreateRoomUseCase } from './application/use-cases/CreateRoomUseCase'
import { JoinRoomUseCase } from './application/use-cases/JoinRoomUseCase'
import { config } from './config'
import { CryptoIdGenerator } from './infrastructure/driven/id/CryptoIdGenerator'
import { SeededRandom } from './infrastructure/driven/random/SeededRandom'
import { SystemClock } from './infrastructure/driven/time/SystemClock'
import { startGameServer } from './infrastructure/driving/ws/GameSocket'
import { LiveRooms } from './infrastructure/live/LiveRooms'
import { createLogger } from './infrastructure/observability/logger'
import { createMetrics } from './infrastructure/observability/metrics'

// The single wiring point: build the concrete adapters and every use case, then start the server.
// No DI framework; no database in Phase 1 (LiveRooms is the authoritative in-memory store).
export function bootstrap() {
  const clock = new SystemClock()
  const random = new SeededRandom(config.seed)
  const ids = new CryptoIdGenerator()
  const logger = createLogger()
  const metrics = createMetrics()
  const rooms = new LiveRooms(
    ids,
    config.roomCodeLen,
    config.roomMaxPlayers,
    clock,
    config.handicapEnabled,
  )

  const createRoom = new CreateRoomUseCase(rooms)
  const joinRoom = new JoinRoomUseCase(rooms, ids)

  const sessionConfig: SessionConfig = {
    introMs: 5000,
    roundResultMs: 4000,
    scoreboardMs: 4000,
    tickHz: config.tickHz,
    snapshotEveryNTicks: config.snapshotEveryNTicks,
    defaultDurationMs: 10_000,
    baseSeed: config.seed,
    handicap: {
      enabled: config.handicapEnabled,
      maxBonusPct: config.handicapMaxBonusPct,
    },
  }

  const server = startGameServer({
    rooms,
    createRoom,
    joinRoom,
    clock,
    random,
    sessionConfig,
    logger,
    metrics,
    roomIdleTimeoutSec: config.roomIdleTimeoutSec,
  })

  logger.info('server_listening', { url: `http://localhost:${server.port}` })
  return server
}
