import type { Clock } from '../../application/ports/Clock'
import type { IdGenerator } from '../../application/ports/IdGenerator'
import type { LiveRoomRegistry } from '../../application/ports/LiveRoomRegistry'
import { Room } from '../../domain/entities/Room'

// In-memory authoritative room store (Phase 1: no database). A room lives here only while active;
// when it empties or times out it is removed and everything it held is discarded.
export class LiveRooms implements LiveRoomRegistry {
  private readonly rooms = new Map<string, Room>()

  constructor(
    private readonly ids: IdGenerator,
    private readonly codeLen: number,
    private readonly maxPlayers: number,
    private readonly clock: Clock,
    // Initial handicap setting for new rooms (deployment default; the host can toggle it in the lobby).
    private readonly handicapDefault = false,
  ) {}

  create(): Room {
    // Retry on the (rare, short-code) collision so a fresh code is always unique in the live set.
    let code = this.ids.roomCode(this.codeLen)
    while (this.rooms.has(code)) code = this.ids.roomCode(this.codeLen)
    const room = Room.create(code, this.maxPlayers, this.handicapDefault)
    // Seed activity at creation so a room that is never joined ages toward the idle sweeper.
    room.touch(this.clock.now())
    this.rooms.set(code, room)
    return room
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase())
  }

  remove(code: string): void {
    this.rooms.delete(code.toUpperCase())
  }

  list(): Room[] {
    return [...this.rooms.values()]
  }
}
