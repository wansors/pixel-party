import type { MiniGameId } from '@pp/shared'
import type { MiniGame } from './MiniGame'
import { BalloonChicken } from './balloonChicken'
import { BombRelay } from './bombRelay'
import { BugSmash } from './bugSmash'
import { ButtonMasher } from './buttonMasher'
import { ColorTrap } from './colorTrap'
import { FruitCatch } from './fruitCatch'
import { HigherLower } from './higherLower'
import { MatchPairs } from './matchPairs'
import { MemoryFlash } from './memoryFlash'
import { NumberRush } from './numberRush'
import { OddOneOut } from './oddOneOut'
import { PixelDash } from './pixelDash'
import { PixelHoops } from './pixelHoops'
import { PixelRain } from './pixelRain'
import { PixelSplit } from './pixelSplit'
import { PixelWeight } from './pixelWeight'
import { Pong } from './pong'
import { QuickDraw } from './quickDraw'
import { QuickMath } from './quickMath'
import { ReactionDuel } from './reactionDuel'
import { Roulette } from './roulette'
import { Simon } from './simon'
import { SinkTheFleet } from './sinkTheFleet'
import { SnakeArena } from './snakeArena'
import { StopClock } from './stopClock'
import { SudokuRace } from './sudokuRace'
import { Sumo } from './sumo'
import { Trivia } from './trivia'
import { TugOfWar } from './tugOfWar'

// Mini-game registry: id -> factory. The session engine is agnostic — it looks up a factory by id and
// runs the round. Adding a game = one domain module + one entry here (+ its client scene + catalog meta).
const FACTORIES: Record<MiniGameId, () => MiniGame<unknown, unknown>> = {
  'button-masher': () => new ButtonMasher() as unknown as MiniGame<unknown, unknown>,
  'reaction-duel': () => new ReactionDuel() as unknown as MiniGame<unknown, unknown>,
  'color-trap': () => new ColorTrap() as unknown as MiniGame<unknown, unknown>,
  trivia: () => new Trivia() as unknown as MiniGame<unknown, unknown>,
  'balloon-chicken': () => new BalloonChicken() as unknown as MiniGame<unknown, unknown>,
  'fruit-catch': () => new FruitCatch() as unknown as MiniGame<unknown, unknown>,
  'pixel-rain': () => new PixelRain() as unknown as MiniGame<unknown, unknown>,
  'pixel-dash': () => new PixelDash() as unknown as MiniGame<unknown, unknown>,
  'snake-arena': () => new SnakeArena() as unknown as MiniGame<unknown, unknown>,
  'pixel-pong': () => new Pong() as unknown as MiniGame<unknown, unknown>,
  'sumo-push': () => new Sumo() as unknown as MiniGame<unknown, unknown>,
  'number-rush': () => new NumberRush() as unknown as MiniGame<unknown, unknown>,
  'quick-math': () => new QuickMath() as unknown as MiniGame<unknown, unknown>,
  'odd-one-out': () => new OddOneOut() as unknown as MiniGame<unknown, unknown>,
  'higher-lower': () => new HigherLower() as unknown as MiniGame<unknown, unknown>,
  'bug-smash': () => new BugSmash() as unknown as MiniGame<unknown, unknown>,
  'stop-clock': () => new StopClock() as unknown as MiniGame<unknown, unknown>,
  'memory-flash': () => new MemoryFlash() as unknown as MiniGame<unknown, unknown>,
  simon: () => new Simon() as unknown as MiniGame<unknown, unknown>,
  'pixel-hoops': () => new PixelHoops() as unknown as MiniGame<unknown, unknown>,
  'pixel-weight': () => new PixelWeight() as unknown as MiniGame<unknown, unknown>,
  'pixel-split': () => new PixelSplit() as unknown as MiniGame<unknown, unknown>,
  'tug-of-war': () => new TugOfWar() as unknown as MiniGame<unknown, unknown>,
  'sink-the-fleet': () => new SinkTheFleet() as unknown as MiniGame<unknown, unknown>,
  'bomb-relay': () => new BombRelay() as unknown as MiniGame<unknown, unknown>,
  'match-pairs': () => new MatchPairs() as unknown as MiniGame<unknown, unknown>,
  'quick-draw': () => new QuickDraw() as unknown as MiniGame<unknown, unknown>,
  'pixel-roulette': () => new Roulette() as unknown as MiniGame<unknown, unknown>,
  'sudoku-race': () => new SudokuRace() as unknown as MiniGame<unknown, unknown>,
}

export const MINIGAME_IDS: readonly MiniGameId[] = Object.keys(FACTORIES)

export function createMiniGame(id: MiniGameId): MiniGame<unknown, unknown> | undefined {
  return FACTORIES[id]?.()
}
