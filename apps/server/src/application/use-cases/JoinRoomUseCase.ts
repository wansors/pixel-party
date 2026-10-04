import { AVATARS, cleanName, type JoinRejectReason, PLAYER_COLORS } from '@pp/shared'
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
  | { ok: true; playerId: string; isHost: boolean; rejoinToken: string }
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
    // Identity is shown on every screen in the room: clean the name like the join form does, and keep
    // the color and avatar to the sets the client offers (an unknown one falls back to the first).
    const name = cleanName(input.name)
    if (!name) return { ok: false, reason: 'invalid_name' }
    if (room.hasName(name)) return { ok: false, reason: 'name_taken' }

    const player = Player.create({
      id: this.ids.playerId(),
      name,
      color: PLAYER_COLORS.includes(input.color) ? input.color : (PLAYER_COLORS[0] as string),
      avatar: (AVATARS as readonly string[]).includes(input.avatar) ? input.avatar : AVATARS[0],
      touch: input.touch,
      rejoinToken: this.ids.secret(),
    })
    room.add(player)
    return {
      ok: true,
      playerId: player.id,
      isHost: room.isHost(player.id),
      rejoinToken: player.rejoinToken,
    }
  }
}
