import type { MiniGameId } from '@pp/shared'
import type { MiniGame } from './MiniGame'
import { BalloonChicken } from './balloonChicken'
import { BugSmash } from './bugSmash'
import { ButtonMasher } from './buttonMasher'
import { ColorTrap } from './colorTrap'
import { HigherLower } from './higherLower'
import { MemoryFlash } from './memoryFlash'
import { NumberRush } from './numberRush'
import { OddOneOut } from './oddOneOut'
import { PixelHoops } from './pixelHoops'
import { PixelSplit } from './pixelSplit'
import { PixelWeight } from './pixelWeight'
import { QuickMath } from './quickMath'
import { ReactionDuel } from './reactionDuel'
import { Simon } from './simon'
import { StopClock } from './stopClock'
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
}

export const MINIGAME_IDS: readonly MiniGameId[] = Object.keys(FACTORIES)

export function createMiniGame(id: MiniGameId): MiniGame<unknown, unknown> | undefined {
  return FACTORIES[id]?.()
}
