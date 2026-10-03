import type { CourseCar, CourseRaceSnapshot } from '@pp/shared'
import { CourseRaceSceneBase } from './CourseRaceSceneBase'
import type { SceneDeps } from './MiniGameScene'

// Rally Stage: a point-to-point time trial on gravel and tarmac — everyone drives the same stage at
// once, rivals shown as ghosts. Split times pop at each checkpoint.
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

  protected progressPop(prev: CourseCar, me: CourseCar): string | null {
    if (me.checkpoint <= prev.checkpoint || me.splitMs === null) return null
    return this.t('game.courseRace.split', { time: formatSplit(me.splitMs) })
  }
}

function formatSplit(ms: number): string {
  const tenths = Math.floor(ms / 100)
  return `${Math.floor(tenths / 600)}:${String(Math.floor((tenths % 600) / 10)).padStart(2, '0')}.${tenths % 10}`
}
