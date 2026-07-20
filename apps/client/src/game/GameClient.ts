import type { ClientMsg, MiniGameId, ServerMsg } from '@pp/shared'
import Phaser from 'phaser'
import { RoundState } from './RoundState'
import { BalloonChickenScene } from './scenes/BalloonChickenScene'
import { ButtonMasherScene } from './scenes/ButtonMasherScene'
import { ColorTrapScene } from './scenes/ColorTrapScene'
import { ReactionScene } from './scenes/ReactionScene'
import { TriviaScene } from './scenes/TriviaScene'
import { ServerMsgRouter } from './serverMsgRouter'

// Scene keys MUST equal the mini-game ids so a round can start its scene by id.
const SCENE_IDS: MiniGameId[] = [
  'button-masher',
  'reaction-duel',
  'color-trap',
  'trivia',
  'balloon-chicken',
]

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
      this.state.round = msg.round
      this.state.minigameId = msg.minigameId
      this.state.state = null
    })
    .on('ROUND_STATE', (msg) => {
      this.state.tick = msg.tick
      this.state.state = msg.state
    })

  constructor(private readonly send: (msg: ClientMsg) => void) {}

  boot(parent: string): void {
    if (this.game) return
    this.game = new Phaser.Game(gameConfig(parent))
    // Register scenes inactive; the round starts the right one by id.
    this.game.scene.add('button-masher', new ButtonMasherScene(this.send, this.state), false)
    this.game.scene.add('reaction-duel', new ReactionScene(this.send, this.state), false)
    this.game.scene.add('color-trap', new ColorTrapScene(this.send, this.state), false)
    this.game.scene.add('trivia', new TriviaScene(this.send, this.state), false)
    this.game.scene.add('balloon-chicken', new BalloonChickenScene(this.send, this.state), false)
  }

  // Switch the active scene to the round's mini-game (no-op if already active).
  startRound(id: MiniGameId): void {
    if (!this.game || this.activeScene === id) return
    for (const key of SCENE_IDS) {
      if (this.game.scene.isActive(key)) this.game.scene.stop(key)
    }
    this.game.scene.start(id)
    this.activeScene = id
  }

  handle(msg: ServerMsg): void {
    this.router.dispatch(msg)
  }

  destroy(): void {
    this.game?.destroy(true)
    this.game = undefined
    this.activeScene = undefined
  }
}
