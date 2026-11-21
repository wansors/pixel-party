import { AVATARS, cleanName, PLAYER_COLORS } from '@pp/shared'
import type { LiveRoomRegistry } from '../ports/LiveRoomRegistry'

export interface UpdateProfileInput {
  code: string
  playerId: string
  name: string
  avatar?: string
  color?: string
}

export type UpdateProfileResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'unknown_player' | 'not_in_lobby' | 'invalid_name' | 'name_taken' }

// SET_PROFILE (D40): a member renames themself — or picks another avatar/color — from the lobby. Same
// rules as JOIN: the name is cleaned and must be unique in the room (case-insensitive; re-spelling your
// own name is fine); an avatar/color outside the offered sets keeps the current one. Lobby only, so a
// round never sees a name change mid-play.
export class UpdateProfileUseCase {
  constructor(private readonly rooms: LiveRoomRegistry) {}

  execute(input: UpdateProfileInput): UpdateProfileResult {
    const room = this.rooms.get(input.code)
    const player = room?.get(input.playerId)
    if (!room || !player) return { ok: false, reason: 'unknown_player' }
    if (room.phase !== 'lobby') return { ok: false, reason: 'not_in_lobby' }
    const name = cleanName(input.name)
    if (!name) return { ok: false, reason: 'invalid_name' }
    if (room.hasName(name, player.id)) return { ok: false, reason: 'name_taken' }
    const avatar =
      input.avatar !== undefined && (AVATARS as readonly string[]).includes(input.avatar)
        ? input.avatar
        : player.avatar
    const color =
      input.color !== undefined && PLAYER_COLORS.includes(input.color) ? input.color : player.color
    const changed = name !== player.name || avatar !== player.avatar || color !== player.color
    if (changed) player.setProfile(name, avatar, color)
    return { ok: true, changed }
  }
}
