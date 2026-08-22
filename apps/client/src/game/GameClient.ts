import type { ClientMsg, MiniGameId, ServerMsg } from '@pp/shared'
import Phaser from 'phaser'
import { RoundState } from './RoundState'
import type { Sfx } from './Sfx'
import type { Translate } from './i18n'
import { BalloonChickenScene } from './scenes/BalloonChickenScene'
import { BombRelayScene } from './scenes/BombRelayScene'
import { BubblePopScene } from './scenes/BubblePopScene'
import { BugSmashScene } from './scenes/BugSmashScene'
import { ButtonMasherScene } from './scenes/ButtonMasherScene'
import { ColorTrapScene } from './scenes/ColorTrapScene'
import { FleetBattleScene } from './scenes/FleetBattleScene'
import { FruitCatchScene } from './scenes/FruitCatchScene'
import { HigherLowerScene } from './scenes/HigherLowerScene'
import { LineClearSprintScene } from './scenes/LineClearSprintScene'
import { MatchPairsScene } from './scenes/MatchPairsScene'
import { MazeSprintScene } from './scenes/MazeSprintScene'
import { MemoryFlashScene } from './scenes/MemoryFlashScene'
import { NumberRushScene } from './scenes/NumberRushScene'
import { OddOneOutScene } from './scenes/OddOneOutScene'
import { PixelBeatScene } from './scenes/PixelBeatScene'
import { PixelDashScene } from './scenes/PixelDashScene'
import { PixelHoopsScene } from './scenes/PixelHoopsScene'
import { PixelRainScene } from './scenes/PixelRainScene'
import { PixelSplitScene } from './scenes/PixelSplitScene'
import { PixelWeightScene } from './scenes/PixelWeightScene'
import { PongScene } from './scenes/PongScene'
import { QuickDrawScene } from './scenes/QuickDrawScene'
import { QuickMathScene } from './scenes/QuickMathScene'
import { QuickTetrisScene } from './scenes/QuickTetrisScene'
import { ReactionScene } from './scenes/ReactionScene'
import { RouletteScene } from './scenes/RouletteScene'
import { SimonScene } from './scenes/SimonScene'
import { SinkTheFleetScene } from './scenes/SinkTheFleetScene'
import { SnakeArenaScene } from './scenes/SnakeArenaScene'
import { StopClockScene } from './scenes/StopClockScene'
import { SudokuRaceScene } from './scenes/SudokuRaceScene'
import { SumoScene } from './scenes/SumoScene'
import { TriviaScene } from './scenes/TriviaScene'
import { TugOfWarScene } from './scenes/TugOfWarScene'
import { ServerMsgRouter } from './serverMsgRouter'

// Scene keys MUST equal the mini-game ids so a round can start its scene by id. Every id registered in
// boot() below must appear here too, or switching away from that scene never stops it (see startRound).
const SCENE_IDS: MiniGameId[] = [
  'button-masher',
  'reaction-duel',
  'color-trap',
  'trivia',
  'balloon-chicken',
  'fruit-catch',
  'pixel-rain',
  'pixel-dash',
  'snake-arena',
  'pixel-pong',
  'sumo-push',
  'match-pairs',
  'quick-draw',
  'pixel-roulette',
  'number-rush',
  'quick-math',
  'odd-one-out',
  'higher-lower',
  'bug-smash',
  'stop-clock',
  'memory-flash',
  'simon',
  'pixel-hoops',
  'pixel-weight',
  'pixel-split',
  'tug-of-war',
  'sink-the-fleet',
  'bomb-relay',
  'sudoku-race',
  'pixel-beat',
  'fleet-battle',
  'maze-sprint',
  'line-clear-sprint',
  'quick-tetris',
  'bubble-pop',
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

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {}

  boot(parent: string): void {
    if (this.game) return
    this.game = new Phaser.Game(gameConfig(parent))
    // Register scenes inactive; the round starts the right one by id.
    const deps = [this.send, this.state, this.sfx, this.t] as const
    this.game.scene.add('button-masher', new ButtonMasherScene(...deps), false)
    this.game.scene.add('reaction-duel', new ReactionScene(...deps), false)
    this.game.scene.add('color-trap', new ColorTrapScene(...deps), false)
    this.game.scene.add('trivia', new TriviaScene(...deps), false)
    this.game.scene.add('balloon-chicken', new BalloonChickenScene(...deps), false)
    this.game.scene.add('fruit-catch', new FruitCatchScene(...deps), false)
    this.game.scene.add('pixel-rain', new PixelRainScene(...deps), false)
    this.game.scene.add('pixel-dash', new PixelDashScene(...deps), false)
    this.game.scene.add('snake-arena', new SnakeArenaScene(...deps), false)
    this.game.scene.add('pixel-pong', new PongScene(...deps), false)
    this.game.scene.add('sumo-push', new SumoScene(...deps), false)
    this.game.scene.add('match-pairs', new MatchPairsScene(...deps), false)
    this.game.scene.add('quick-draw', new QuickDrawScene(...deps), false)
    this.game.scene.add('pixel-roulette', new RouletteScene(...deps), false)
    this.game.scene.add('number-rush', new NumberRushScene(...deps), false)
    this.game.scene.add('quick-math', new QuickMathScene(...deps), false)
    this.game.scene.add('odd-one-out', new OddOneOutScene(...deps), false)
    this.game.scene.add('higher-lower', new HigherLowerScene(...deps), false)
    this.game.scene.add('bug-smash', new BugSmashScene(...deps), false)
    this.game.scene.add('stop-clock', new StopClockScene(...deps), false)
    this.game.scene.add('memory-flash', new MemoryFlashScene(...deps), false)
    this.game.scene.add('simon', new SimonScene(...deps), false)
    this.game.scene.add('pixel-hoops', new PixelHoopsScene(...deps), false)
    this.game.scene.add('pixel-weight', new PixelWeightScene(...deps), false)
    this.game.scene.add('pixel-split', new PixelSplitScene(...deps), false)
    this.game.scene.add('tug-of-war', new TugOfWarScene(...deps), false)
    this.game.scene.add('sink-the-fleet', new SinkTheFleetScene(...deps), false)
    this.game.scene.add('bomb-relay', new BombRelayScene(...deps), false)
    this.game.scene.add('sudoku-race', new SudokuRaceScene(...deps), false)
    this.game.scene.add('pixel-beat', new PixelBeatScene(...deps), false)
    this.game.scene.add('fleet-battle', new FleetBattleScene(...deps), false)
    this.game.scene.add('maze-sprint', new MazeSprintScene(...deps), false)
    this.game.scene.add('line-clear-sprint', new LineClearSprintScene(...deps), false)
    this.game.scene.add('quick-tetris', new QuickTetrisScene(...deps), false)
    this.game.scene.add('bubble-pop', new BubblePopScene(...deps), false)
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

  refresh(): void {
    this.game?.scale.refresh()
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
