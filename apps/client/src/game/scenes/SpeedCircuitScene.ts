import type { CourseCar, CourseRaceSnapshot } from '@pp/shared'
import { CourseRaceSceneBase } from './CourseRaceSceneBase'
import type { SceneDeps } from './MiniGameScene'

// Speed Circuit: two laps wheel-to-wheel on a proper circuit — slipstream (wind lines behind a rival)
// and boost pads (a flame) on the straights; lap times pop at the line.
export class SpeedCircuitScene extends CourseRaceSceneBase {
  constructor(...deps: SceneDeps) {
    super('speed-circuit', 'circuit', ...deps)
  }

  protected statusOf(me: CourseCar, snap: CourseRaceSnapshot): string {
    return this.t('game.courseRace.circuitStatus', { lap: me.lap, laps: snap.laps, pos: me.pos })
  }
}
