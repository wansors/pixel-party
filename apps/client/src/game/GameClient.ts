import type { ClientMsg, MiniGameId, ServerMsg } from '@pp/shared'
import Phaser from 'phaser'
import { RoundState } from './RoundState'
import type { Sfx } from './Sfx'
import type { Translate } from './i18n'
import { ensurePixelFontLoaded, installTextColorGuard } from './pixelStyle'
import { SCENES } from './scenes'
import { ServerMsgRouter } from './serverMsgRouter'

// Pure Phaser config factory — testable without `new Phaser.Game` (which needs a DOM/canvas). Scenes
// are added (inactive) in boot(); startRound(id) starts the matching one.
export function gameConfig(parent: string): Phaser.Types.Core.GameConfig {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1024
  const h = typeof window !== 'undefined' ? window.innerHeight : 768
  return {
    type: Phaser.AUTO,
    scale: { mode: Phaser.Scale.RESIZE, width: w, height: h },
    parent,
    pixelArt: true,
    // Several simultaneous touches: two-thumb drumming (Button Masher, Tug of War) must not drop the
    // taps that land while the other thumb is still down (Phaser's default is a single pointer).
    input: { activePointers: 3 },
    backgroundColor: '#10121c',
    scene: [],
  }
}

// Boots Phaser and exposes a thin API to Angular. Angular owns the WebSocket and DOM chrome; Phaser owns
// the canvas and its own loop — they talk only through this boundary (server messages in via handle(),
// inputs out via the injected send).
export class GameClient {
  private game?: Phaser.Game
  private activeScene?: MiniGameId
  readonly state = new RoundState()

  private readonly router = new ServerMsgRouter()
    .on('WELCOME', (msg) => {
      this.state.selfId = msg.playerId
    })
    .on('ROUND_INTRO', (msg) => {
      // A new round owns the render buffer from here on: stop the previous round's scene and drop its
      // snapshot, so nothing still running can read the incoming game's state.
      this.stopActive()
      this.state.round = msg.round
      this.state.minigameId = msg.minigameId
      this.state.tick = 0
      this.state.state = null
      this.state.final = false
    })
    .on('ROUND_STATE', (msg) => {
      this.state.tick = msg.tick
      this.state.state = msg.state
      this.state.final = msg.final === true
    })
    .on('ROUND_RESULT', () => this.stopActive())
    .on('FINAL_RANKING', () => this.stopActive())

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {}

  boot(parent: string): void {
    if (this.game) return
    void ensurePixelFontLoaded()
    installTextColorGuard()
    this.game = new Phaser.Game(gameConfig(parent))
    // Tooling hook: the playtest perf probe (`localStorage.pp_perf`) reads frame cost and live objects
    // off the game instance. Off for players.
    if (typeof localStorage !== 'undefined' && localStorage.getItem('pp_perf')) {
      ;(window as unknown as { __ppGame?: Phaser.Game }).__ppGame = this.game
    }
    // Register every scene inactive; a round starts the right one by id (scene key === mini-game id).
    const deps = [this.send, this.state, this.sfx, this.t] as const
    for (const [id, Scene] of Object.entries(SCENES)) {
      this.game.scene.add(id, new Scene(...deps), false)
    }
  }

  // Switch the active scene to the round's mini-game (no-op if already active).
  startRound(id: MiniGameId): void {
    if (!this.game || this.activeScene === id) return
    this.stopActive()
    this.state.minigameId = id
    this.game.scene.start(id)
    this.activeScene = id
  }

  // Re-measure the container and resize the canvas to it NOW. Phaser only polls its parent's size
  // every 500 ms and refresh() alone reuses the last measurement, so a scene started right after the
  // round view appears would otherwise lay itself out against the stale (parked, full-room) size.
  refresh(): void {
    if (!this.game) return
    this.game.scale.getParentBounds()
    this.game.scale.refresh()
  }

  handle(msg: ServerMsg): void {
    this.router.dispatch(msg)
  }

  destroy(): void {
    this.game?.destroy(true)
    this.game = undefined
    this.activeScene = undefined
  }

  private stopActive(): void {
    if (!this.game) return
    for (const key of Object.keys(SCENES)) {
      if (this.game.scene.isActive(key)) this.game.scene.stop(key)
    }
    this.activeScene = undefined
  }
}
