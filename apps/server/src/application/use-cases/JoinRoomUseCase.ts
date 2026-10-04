import type { JoinRejectReason } from '@pp/shared'
import { Player } from '../../domain/entities/Player'
import type { IdGenerator } from '../ports/IdGenerator'
import type { LiveRoomRegistry } from '../ports/LiveRoomRegistry'

export interface JoinRoomInput {
  code: string
  name: string
  color: string
  avatar: string
  touch?: boolean
}

export type JoinRoomResult =
  | { ok: true; playerId: string; isHost: boolean }
  | { ok: false; reason: JoinRejectReason }

export class JoinRoomUseCase {
  constructor(
    private readonly rooms: LiveRoomRegistry,
    private readonly ids: IdGenerator,
  ) {}

  execute(input: JoinRoomInput): JoinRoomResult {
    const room = this.rooms.get(input.code)
    if (!room) return { ok: false, reason: 'room_not_found' }
    if (room.phase !== 'lobby') return { ok: false, reason: 'session_in_progress' }
    if (room.isFull) return { ok: false, reason: 'room_full' }
    if (room.hasName(input.name)) return { ok: false, reason: 'name_taken' }

    const player = Player.create({
      id: this.ids.playerId(),
      name: input.name,
      color: input.color,
      avatar: input.avatar,
      touch: input.touch,
    })
    room.add(player)
    return { ok: true, playerId: player.id, isHost: room.isHost(player.id) }
  }
}
