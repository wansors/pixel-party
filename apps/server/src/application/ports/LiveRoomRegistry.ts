import type { Room } from '../../domain/entities/Room'

// The in-memory authoritative store of live rooms (Phase 1 has no database — this IS the source of
// truth for a session's lifetime; everything is discarded when the room closes).
export interface LiveRoomRegistry {
  create(): Room
  get(code: string): Room | undefined
  remove(code: string): void
  list(): Room[]
}
