import type { LiveRoomRegistry } from '../ports/LiveRoomRegistry'

export interface CreateRoomResult {
  code: string
}

export class CreateRoomUseCase {
  constructor(private readonly rooms: LiveRoomRegistry) {}

  execute(): CreateRoomResult {
    const room = this.rooms.create()
    return { code: room.code }
  }
}
