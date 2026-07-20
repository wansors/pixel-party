import type { MiniGameId, RoomPhase } from '@pp/shared'
import type { Player } from './Player'

// The authoritative in-memory room aggregate: roster, host, session config and phase. No I/O — the
// live registry holds instances of this and the WS adapter reads/mutates them through use cases.
export class Room {
  private readonly players = new Map<string, Player>()
  private _hostId: string | null = null
  private _phase: RoomPhase = 'lobby'
  private _minigameIds: MiniGameId[] = []
  private _rounds = 0

  private constructor(
    readonly code: string,
    private readonly maxPlayers: number,
  ) {}

  static create(code: string, maxPlayers: number): Room {
    return new Room(code, maxPlayers)
  }

  get phase(): RoomPhase {
    return this._phase
  }
  get hostId(): string | null {
    return this._hostId
  }
  get minigameIds(): readonly MiniGameId[] {
    return this._minigameIds
  }
  get rounds(): number {
    return this._rounds
  }
  get isFull(): boolean {
    return this.players.size >= this.maxPlayers
  }
  get isEmpty(): boolean {
    return this.players.size === 0
  }
  // During a live session, disconnected seats stay in the roster (so scores survive a reconnect); the
  // room is only torn down once nobody is connected.
  get hasConnectedPlayers(): boolean {
    return this.list().some((p) => p.connected)
  }

  list(): Player[] {
    return [...this.players.values()]
  }
  get(playerId: string): Player | undefined {
    return this.players.get(playerId)
  }
  hasName(name: string): boolean {
    const n = name.trim().toLowerCase()
    return this.list().some((p) => p.name.toLowerCase() === n)
  }

  // First joiner becomes host; host reassigns to the next member when the current host leaves.
  add(player: Player): void {
    this.players.set(player.id, player)
    if (this._hostId === null) this._hostId = player.id
  }

  remove(playerId: string): void {
    this.players.delete(playerId)
    if (this._hostId === playerId) {
      this._hostId = this.players.keys().next().value ?? null
    }
  }

  isHost(playerId: string): boolean {
    return this._hostId === playerId
  }

  configure(minigameIds: MiniGameId[], rounds: number): void {
    this._minigameIds = [...minigameIds]
    this._rounds = rounds
  }

  setPhase(phase: RoomPhase): void {
    this._phase = phase
  }
}
