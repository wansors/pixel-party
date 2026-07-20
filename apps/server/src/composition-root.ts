import type { SessionConfig } from './application/session/SessionEngine'
import { CreateRoomUseCase } from './application/use-cases/CreateRoomUseCase'
import { JoinRoomUseCase } from './application/use-cases/JoinRoomUseCase'
import { config } from './config'
import { CryptoIdGenerator } from './infrastructure/driven/id/CryptoIdGenerator'
import { SeededRandom } from './infrastructure/driven/random/SeededRandom'
import { SystemClock } from './infrastructure/driven/time/SystemClock'
import { startGameServer } from './infrastructure/driving/ws/GameSocket'
import { LiveRooms } from './infrastructure/live/LiveRooms'

// The single wiring point: build the concrete adapters and every use case, then start the server.
// No DI framework; no database in Phase 1 (LiveRooms is the authoritative in-memory store).
export function bootstrap() {
  const clock = new SystemClock()
  const random = new SeededRandom(config.seed)
  const ids = new CryptoIdGenerator()
  const rooms = new LiveRooms(ids, config.roomCodeLen, config.roomMaxPlayers)

  const createRoom = new CreateRoomUseCase(rooms)
  const joinRoom = new JoinRoomUseCase(rooms, ids)

  const sessionConfig: SessionConfig = {
    introMs: 3000,
    resultMs: 5000,
    tickHz: config.tickHz,
    snapshotEveryNTicks: config.snapshotEveryNTicks,
    defaultDurationMs: 10_000,
    baseSeed: config.seed,
  }

  const server = startGameServer({
    rooms,
    createRoom,
    joinRoom,
    clock,
    random,
    sessionConfig,
  })

  console.log(`[server] pixel-party listening on http://localhost:${server.port}`)
  return server
}
