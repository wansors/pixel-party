import { type FieldEventLook, FieldEventSceneBase } from './FieldEventSceneBase'
import type { SceneDeps } from './MiniGameScene'

// Long Jump: the shared field-event canvas on a runway into the sand pit — hit the board, hold JUMP
// to set the take-off angle, release to fly. Three attempts, best mark counts.
export class LongJumpScene extends FieldEventSceneBase {
  protected readonly look: FieldEventLook = { kind: 'jump', viewM: 16, markStep: 1, markTo: 11 }

  constructor(...deps: SceneDeps) {
    super('long-jump', ...deps)
  }
}
