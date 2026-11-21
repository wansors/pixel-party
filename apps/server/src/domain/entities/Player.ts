import type { TeamId } from '@pp/shared'

export interface PlayerProps {
  id: string
  name: string
  color: string
  avatar: string
  // Joined from a touch-first device (phone/tablet) — only drives the lobby's mobile hints.
  touch?: boolean
  // Secret proof of the seat for REJOIN (the id is public: every LOBBY_STATE lists it).
  rejoinToken?: string
}

// Anonymous, ephemeral player (no account in Phase 1). Private constructor + static factories:
// create() mints a fresh lobby member; reconstitute() trusts already-validated live state.
export class Player {
  private _team?: TeamId

  private constructor(
    readonly id: string,
    private _name: string,
    private _color: string,
    private _avatar: string,
    private _ready = false,
    private _connected = true,
    readonly touch = false,
    readonly rejoinToken = '',
  ) {}

  static create(props: PlayerProps): Player {
    const name = props.name.trim()
    if (name.length === 0) throw new Error('player name must not be empty')
    return new Player(
      props.id,
      name,
      props.color,
      props.avatar,
      false,
      true,
      props.touch === true,
      props.rejoinToken ?? '',
    )
  }

  static reconstitute(props: PlayerProps & { ready: boolean; connected: boolean }): Player {
    return new Player(
      props.id,
      props.name,
      props.color,
      props.avatar,
      props.ready,
      props.connected,
      props.touch === true,
      props.rejoinToken ?? '',
    )
  }

  get name(): string {
    return this._name
  }
  get color(): string {
    return this._color
  }
  get avatar(): string {
    return this._avatar
  }
  get ready(): boolean {
    return this._ready
  }
  get connected(): boolean {
    return this._connected
  }
  get team(): TeamId | undefined {
    return this._team
  }

  setReady(ready: boolean): void {
    this._ready = ready
  }
  setConnected(connected: boolean): void {
    this._connected = connected
  }
  setTeam(team: TeamId | undefined): void {
    this._team = team
  }
  // Lobby profile edit (SET_PROFILE): the caller has already cleaned and checked every value.
  setProfile(name: string, avatar: string, color: string): void {
    if (name.trim().length === 0) throw new Error('player name must not be empty')
    this._name = name.trim()
    this._avatar = avatar
    this._color = color
  }
}
