import type Phaser from 'phaser'
import { AsteroidsScene } from './AsteroidsScene'
import { BalloonChickenScene } from './BalloonChickenScene'
import { BombRelayScene } from './BombRelayScene'
import { BomberExpressScene } from './BomberExpressScene'
import { BrawlScene } from './BrawlScene'
import { BubblePopScene } from './BubblePopScene'
import { BugSmashScene } from './BugSmashScene'
import { ButtonMasherScene } from './ButtonMasherScene'
import { ColorTrapScene } from './ColorTrapScene'
import { Dash100mScene } from './Dash100mScene'
import { FleetBattleScene } from './FleetBattleScene'
import { FreezeDollScene } from './FreezeDollScene'
import { FruitCatchScene } from './FruitCatchScene'
import { GlassBridgeScene } from './GlassBridgeScene'
import { HigherLowerScene } from './HigherLowerScene'
import { HoneycombCutScene } from './HoneycombCutScene'
import { Hurdles110mScene } from './Hurdles110mScene'
import { JavelinThrowScene } from './JavelinThrowScene'
import { LineClearSprintScene } from './LineClearSprintScene'
import { LongJumpScene } from './LongJumpScene'
import { MatchPairsScene } from './MatchPairsScene'
import { MazeSprintScene } from './MazeSprintScene'
import { MemoryFlashScene } from './MemoryFlashScene'
import { MicroRaceScene } from './MicroRaceScene'
import type { SceneDeps } from './MiniGameScene'
import { NumberRushScene } from './NumberRushScene'
import { OddOneOutScene } from './OddOneOutScene'
import { PangScene } from './PangScene'
import { PixelBeatScene } from './PixelBeatScene'
import { PixelDashScene } from './PixelDashScene'
import { PixelHoopsScene } from './PixelHoopsScene'
import { PixelRainScene } from './PixelRainScene'
import { PixelSplitScene } from './PixelSplitScene'
import { PixelWeightScene } from './PixelWeightScene'
import { PongScene } from './PongScene'
import { QuickDrawScene } from './QuickDrawScene'
import { QuickMathScene } from './QuickMathScene'
import { QuickTetrisScene } from './QuickTetrisScene'
import { RallyStageScene } from './RallyStageScene'
import { ReactionScene } from './ReactionScene'
import { RoomRushScene } from './RoomRushScene'
import { RouletteScene } from './RouletteScene'
import { SimonScene } from './SimonScene'
import { SinkTheFleetScene } from './SinkTheFleetScene'
import { SnakeArenaScene } from './SnakeArenaScene'
import { SpeedCircuitScene } from './SpeedCircuitScene'
import { StarBlasterScene } from './StarBlasterScene'
import { StopClockScene } from './StopClockScene'
import { SudokuRaceScene } from './SudokuRaceScene'
import { SumoIceScene } from './SumoIceScene'
import { SumoScene } from './SumoScene'
import { TriviaScene } from './TriviaScene'
import { TugOfWarScene } from './TugOfWarScene'

export type SceneCtor = new (...deps: SceneDeps) => Phaser.Scene

// The one place a mini-game id maps to its Phaser scene. GameClient registers every entry and a round
// starts its scene by id; the spec checks this stays in lock-step with the shared MINIGAMES catalog.
export const SCENES: Readonly<Record<string, SceneCtor>> = {
  'reaction-duel': ReactionScene,
  'button-masher': ButtonMasherScene,
  'color-trap': ColorTrapScene,
  trivia: TriviaScene,
  'balloon-chicken': BalloonChickenScene,
  'number-rush': NumberRushScene,
  'quick-math': QuickMathScene,
  'odd-one-out': OddOneOutScene,
  'higher-lower': HigherLowerScene,
  'bug-smash': BugSmashScene,
  'stop-clock': StopClockScene,
  'memory-flash': MemoryFlashScene,
  simon: SimonScene,
  'pixel-hoops': PixelHoopsScene,
  'pixel-weight': PixelWeightScene,
  'pixel-split': PixelSplitScene,
  'fruit-catch': FruitCatchScene,
  'pixel-rain': PixelRainScene,
  'pixel-dash': PixelDashScene,
  'snake-arena': SnakeArenaScene,
  'pixel-pong': PongScene,
  'sumo-push': SumoScene,
  'match-pairs': MatchPairsScene,
  'quick-draw': QuickDrawScene,
  'pixel-roulette': RouletteScene,
  'sudoku-race': SudokuRaceScene,
  'pixel-beat': PixelBeatScene,
  'maze-sprint': MazeSprintScene,
  'line-clear-sprint': LineClearSprintScene,
  'quick-tetris': QuickTetrisScene,
  'bubble-pop': BubblePopScene,
  'dash-100m': Dash100mScene,
  'hurdles-110m': Hurdles110mScene,
  'long-jump': LongJumpScene,
  'javelin-throw': JavelinThrowScene,
  'micro-race': MicroRaceScene,
  'glass-bridge': GlassBridgeScene,
  'freeze-doll': FreezeDollScene,
  'room-rush': RoomRushScene,
  'sumo-ice': SumoIceScene,
  pang: PangScene,
  'star-blaster': StarBlasterScene,
  asteroids: AsteroidsScene,
  'bomber-express': BomberExpressScene,
  brawl: BrawlScene,
  'rally-stage': RallyStageScene,
  'speed-circuit': SpeedCircuitScene,
  'honeycomb-cut': HoneycombCutScene,
  'tug-of-war': TugOfWarScene,
  'bomb-relay': BombRelayScene,
  'fleet-battle': FleetBattleScene,
  'sink-the-fleet': SinkTheFleetScene,
}
