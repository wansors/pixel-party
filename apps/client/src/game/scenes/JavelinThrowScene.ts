import { type FieldEventLook, FieldEventSceneBase } from './FieldEventSceneBase'
import type { SceneDeps } from './MiniGameScene'

// Javelin: the shared field-event canvas with a throwing arc and a long grass field — build speed,
// hold THROW before the line to aim, release, and follow the javelin all the way down.
export class JavelinThrowScene extends FieldEventSceneBase {
  protected readonly look: FieldEventLook = { kind: 'throw', viewM: 18, markStep: 10, markTo: 110 }

  constructor(...deps: SceneDeps) {
    super('javelin-throw', ...deps)
  }
}
