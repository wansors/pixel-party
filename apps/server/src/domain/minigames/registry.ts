import type { MiniGameId } from '@pp/shared'
import type { MiniGame } from './MiniGame'
import { BalloonChicken } from './balloonChicken'
import { ButtonMasher } from './buttonMasher'
import { ColorTrap } from './colorTrap'
import { ReactionDuel } from './reactionDuel'
import { Trivia } from './trivia'

// Mini-game registry: id -> factory. The session engine is agnostic — it looks up a factory by id and
// runs the round. Adding a game = one domain module + one entry here (+ its client scene + catalog meta).
const FACTORIES: Record<MiniGameId, () => MiniGame<unknown, unknown>> = {
  'button-masher': () => new ButtonMasher() as unknown as MiniGame<unknown, unknown>,
  'reaction-duel': () => new ReactionDuel() as unknown as MiniGame<unknown, unknown>,
  'color-trap': () => new ColorTrap() as unknown as MiniGame<unknown, unknown>,
  trivia: () => new Trivia() as unknown as MiniGame<unknown, unknown>,
  'balloon-chicken': () => new BalloonChicken() as unknown as MiniGame<unknown, unknown>,
}

export const MINIGAME_IDS: readonly MiniGameId[] = Object.keys(FACTORIES)

export function createMiniGame(id: MiniGameId): MiniGame<unknown, unknown> | undefined {
  return FACTORIES[id]?.()
}
