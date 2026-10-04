import { fitsPlayers, MINIGAMES_BY_ID, type MiniGameId, TEAM_IDS } from '@pp/shared'
import type { Room } from '../entities/Room'

// Whether `room` can play `id` right now (D27/D28): its connected headcount is inside the game's player
// range and, for a team game, each team has someone connected (no 4-v-0 walkovers).
export function gameFitsRoom(id: MiniGameId, room: Room): boolean {
  const meta = MINIGAMES_BY_ID.get(id)
  if (!meta || !fitsPlayers(id, room.connectedCount)) return false
  if (meta.format !== 'team') return true
  const connected = room.list().filter((p) => p.connected)
  return TEAM_IDS.every((team) => connected.some((p) => p.team === team))
}

// The host's picks this room can play right now — distinct, in pick order.
export function playableLineup(room: Room): MiniGameId[] {
  return [...new Set(room.minigameIds)].filter((id) => gameFitsRoom(id, room))
}
