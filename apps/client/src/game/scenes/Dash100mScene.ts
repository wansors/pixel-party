import type { SceneDeps } from './MiniGameScene'
import { TrackRaceSceneBase } from './TrackRaceSceneBase'

// 100 m Dash: the shared track race canvas on a flat 100 m straight — wait for the gun, then alternate
// LEFT/RIGHT as fast as you can.
export class Dash100mScene extends TrackRaceSceneBase {
  protected readonly withHurdles = false

  constructor(...deps: SceneDeps) {
    super('dash-100m', ...deps)
  }
}
