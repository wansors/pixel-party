import type { MiniGameId } from '@pp/shared'

// The shared, mutable view the active Phaser scene renders from. GameClient's ServerMsgRouter writes
// authoritative snapshots here; the scene reads it each frame. No game rules live client-side — the
// server is authoritative; this is a render buffer.
export class RoundState {
  selfId?: string
  round = 0
  minigameId?: MiniGameId
  tick = 0
  // Opaque per-mini-game snapshot payload (the active scene knows its own shape).
  state: unknown = null

  reset(): void {
    this.round = 0
    this.minigameId = undefined
    this.tick = 0
    this.state = null
  }
}
