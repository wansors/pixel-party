import type { ServerMsg } from '@pp/shared'

// Outbound port: the session engine emits server messages to a room without knowing about WebSockets.
// The infrastructure adapter (BunPublisher) fans it out over the room topic.
export interface Publisher {
  toRoom(roomCode: string, msg: ServerMsg): void
}
