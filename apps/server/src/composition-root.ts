import { networkInterfaces } from 'node:os'
import { APP_VERSION } from '@pp/shared'
import type { SessionConfig } from './application/session/SessionEngine'
import { CreateRoomUseCase } from './application/use-cases/CreateRoomUseCase'
import { JoinRoomUseCase } from './application/use-cases/JoinRoomUseCase'
import { config } from './config'
import { CryptoIdGenerator } from './infrastructure/driven/id/CryptoIdGenerator'
import { SeededRandom } from './infrastructure/driven/random/SeededRandom'
import { SystemClock } from './infrastructure/driven/time/SystemClock'
import { loadStaticSite } from './infrastructure/driving/http/staticSite'
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
    roundEndGraceMs: 1500,
    tickHz: config.tickHz,
    snapshotEveryNTicks: config.snapshotEveryNTicks,
    defaultDurationMs: 10_000,
    baseSeed: config.seed,
    handicap: {
      enabled: config.handicapEnabled,
      maxBonusPct: config.handicapMaxBonusPct,
    },
  }

  const site = config.serveClient ? loadStaticSite(config.clientDir) : null
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
    site,
  })

  logger.info('server_listening', {
    url: `http://localhost:${server.port}`,
    version: APP_VERSION,
    client: !!site,
  })
  if (site) {
    // Party mode: tell the host which address everyone else should open.
    const urls = lanUrls(server.port ?? config.port)
    logger.info('party_ready', { urls })
    console.log(`\n  ▶ Pixel Party v${APP_VERSION} is on — open ${urls[0]} on every device\n`)
  }
  return server
}

// This machine's LAN addresses as party URLs (localhost last, for a host playing on this machine).
function lanUrls(port: number): string[] {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a?.address}:${port}`)
  return [...lan, `http://localhost:${port}`]
}
