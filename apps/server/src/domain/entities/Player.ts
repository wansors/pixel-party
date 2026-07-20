export interface PlayerProps {
  id: string
  name: string
  color: string
  avatar: string
}

// Anonymous, ephemeral player (no account in Phase 1). Private constructor + static factories:
// create() mints a fresh lobby member; reconstitute() trusts already-validated live state.
export class Player {
  private constructor(
    readonly id: string,
    private _name: string,
    readonly color: string,
    readonly avatar: string,
    private _ready = false,
    private _connected = true,
  ) {}

  static create(props: PlayerProps): Player {
    const name = props.name.trim()
    if (name.length === 0) throw new Error('player name must not be empty')
    return new Player(props.id, name, props.color, props.avatar)
  }

  static reconstitute(props: PlayerProps & { ready: boolean; connected: boolean }): Player {
    return new Player(props.id, props.name, props.color, props.avatar, props.ready, props.connected)
  }

  get name(): string {
    return this._name
  }
  get ready(): boolean {
    return this._ready
  }
  get connected(): boolean {
    return this._connected
  }

  setReady(ready: boolean): void {
    this._ready = ready
  }
  setConnected(connected: boolean): void {
    this._connected = connected
  }
}
