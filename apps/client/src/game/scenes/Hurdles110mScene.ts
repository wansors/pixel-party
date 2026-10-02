import type { SceneDeps } from './MiniGameScene'
import { TrackRaceSceneBase } from './TrackRaceSceneBase'

// 110 m Hurdles: the shared track race canvas with ten barriers per lane and a JUMP button — clip one
// and it goes down, taking most of your speed with it.
export class Hurdles110mScene extends TrackRaceSceneBase {
  protected readonly withHurdles = true

  constructor(...deps: SceneDeps) {
    super('hurdles-110m', ...deps)
  }
}
