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
  // True once the round's final snapshot arrived: the game is over and frozen until ROUND_RESULT.
  final = false
  // playerId -> display name, mirrored from the room roster so scenes can show real names instead of
  // falling back to a slice of the (opaque) player id.
  names: Record<string, string> = {}
  // playerId -> 0xRRGGBB player color (same roster mirror), so scenes paint each player in the color
  // that identifies them everywhere else (lobby, HUD, scoreboards — art-direction §6).
  colors: Record<string, number> = {}

  // A scene's best-effort label for `id`: the real display name if known, else a short id fallback.
  nameOf(id: string): string {
    return this.names[id] ?? id.slice(0, 6)
  }

  // A player's identity color, or a neutral fallback for an unknown id.
  colorOf(id: string, fallback = 0x7b88a8): number {
    return this.colors[id] ?? fallback
  }

  reset(): void {
    this.round = 0
    this.minigameId = undefined
    this.tick = 0
    this.state = null
    this.final = false
  }
}
