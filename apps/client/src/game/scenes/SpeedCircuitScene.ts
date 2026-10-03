import type { CourseCar, CourseRaceSnapshot } from '@pp/shared'
import { CourseRaceSceneBase } from './CourseRaceSceneBase'
import type { SceneDeps } from './MiniGameScene'

// Speed Circuit: two laps wheel-to-wheel on a proper circuit — slipstream (wind lines behind a rival)
// and boost pads (a flame) on the straights.
export class SpeedCircuitScene extends CourseRaceSceneBase {
  constructor(...deps: SceneDeps) {
    super('speed-circuit', 'circuit', ...deps)
  }

  protected statusOf(me: CourseCar, snap: CourseRaceSnapshot): string {
    return this.t('game.courseRace.circuitStatus', { lap: me.lap, laps: snap.laps, pos: me.pos })
  }

  protected progressPop(prev: CourseCar, me: CourseCar): string | null {
    return me.lap > prev.lap ? this.t('game.courseRace.lap', { lap: me.lap }) : null
  }
}
