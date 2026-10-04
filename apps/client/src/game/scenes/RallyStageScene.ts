import type { CourseCar, CourseRaceSnapshot } from '@pp/shared'
import { CourseRaceSceneBase } from './CourseRaceSceneBase'
import type { SceneDeps } from './MiniGameScene'

// Rally Stage: a point-to-point time trial on gravel and tarmac — everyone drives the same stage at
// once, rivals shown as ghosts. Split times pop at each checkpoint; the stage clock runs on top.
export class RallyStageScene extends CourseRaceSceneBase {
  constructor(...deps: SceneDeps) {
    super('rally-stage', 'stage', ...deps)
  }

  protected statusOf(me: CourseCar, snap: CourseRaceSnapshot): string {
    return this.t('game.courseRace.stageStatus', {
      cp: me.checkpoint,
      cps: snap.checkpoints,
      pct: Math.floor(me.progress * 100),
    })
  }
}
