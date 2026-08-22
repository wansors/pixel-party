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
  // playerId -> display name, mirrored from the room roster so scenes can show real names instead of
  // falling back to a slice of the (opaque) player id.
  names: Record<string, string> = {}

  // A scene's best-effort label for `id`: the real display name if known, else a short id fallback.
  nameOf(id: string): string {
    return this.names[id] ?? id.slice(0, 6)
  }

  reset(): void {
    this.round = 0
    this.minigameId = undefined
    this.tick = 0
    this.state = null
  }
}
