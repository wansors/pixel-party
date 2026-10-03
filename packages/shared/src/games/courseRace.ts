import { type MicroRacePoint, sampleSpline } from './microRace'

// Course racers built on the Micro Race engine, on courses bigger than a screen (the client follows
// your car and shows a minimap):
//  - Rally Stage (`rally-stage`): a point-to-point time trial on a twisty stage of gravel and tarmac.
//    Everyone starts together but drives as a ghost (no contact); checkpoints give split times.
//  - Speed Circuit (`speed-circuit`): a multi-lap, wheel-to-wheel race on a proper circuit, with a
//    slipstream (tuck in behind a car for more top speed) and boost pads on the straights.
// Both apps derive the same centreline from a course def (`sampleCourse`).

export type CourseKind = 'stage' | 'circuit'
export type CourseSurface = 'gravel' | 'tarmac'
export type CourseTheme = 'forest' | 'desert' | 'gp' | 'night'

export interface CourseDef {
  readonly kind: CourseKind
  readonly theme: CourseTheme
  readonly world: { readonly w: number; readonly h: number }
  readonly halfWidth: number
  // Control points: an open road (stage, first → last) or a closed loop (circuit).
  readonly points: readonly (readonly [number, number])[]
  // Stage surface stretches as [from, to) fractions of the road (default: tarmac).
  readonly gravel?: readonly (readonly [number, number])[]
  // Circuit boost pads as [from, to) fractions of the lap.
  readonly boosts?: readonly (readonly [number, number])[]
}

export const COURSE_SPACING = 8

export const RALLY_STAGES: readonly CourseDef[] = [
  {
    kind: 'stage',
    theme: 'forest',
    world: { w: 2400, h: 1600 },
    halfWidth: 36,
    points: [
      [150, 1450],
      [500, 1450],
      [760, 1310],
      [700, 1060],
      [420, 960],
      [260, 760],
      [440, 560],
      [800, 600],
      [1060, 800],
      [1320, 900],
      [1560, 760],
      [1520, 500],
      [1260, 360],
      [1310, 180],
      [1660, 160],
      [1960, 300],
      [2160, 560],
      [2010, 860],
      [2110, 1160],
      [2250, 1420],
    ],
    gravel: [
      [0, 0.34],
      [0.5, 0.8],
      [0.9, 1],
    ],
  },
  {
    kind: 'stage',
    theme: 'desert',
    world: { w: 2400, h: 1600 },
    halfWidth: 36,
    points: [
      [200, 200],
      [560, 250],
      [810, 450],
      [650, 710],
      [350, 810],
      [300, 1110],
      [560, 1350],
      [910, 1300],
      [1110, 1050],
      [1010, 790],
      [1260, 600],
      [1600, 650],
      [1720, 950],
      [1510, 1200],
      [1710, 1420],
      [2060, 1380],
      [2210, 1100],
      [2060, 800],
      [2160, 500],
      [2260, 200],
    ],
    gravel: [[0.3, 0.7]],
  },
]

// Corner radii ≥ ~64 units and ≥ 160 between non-adjacent stretches (checked in courseRace.test.ts).
export const SPEED_CIRCUITS: readonly CourseDef[] = [
  {
    kind: 'circuit',
    theme: 'gp',
    world: { w: 2600, h: 1700 },
    halfWidth: 48,
    points: [
      [520, 262],
      [1300, 240],
      [2000, 290],
      [2280, 470],
      [2270, 760],
      [2000, 890],
      [1560, 860],
      [1330, 1000],
      [1440, 1230],
      [2050, 1290],
      [2290, 1390],
      [2260, 1540],
      [1980, 1580],
      [1100, 1510],
      [520, 1450],
      [290, 1250],
      [300, 900],
      [420, 640],
      [320, 470],
      [370, 330],
    ],
    boosts: [
      [0.06, 0.09],
      [0.62, 0.65],
    ],
  },
  {
    kind: 'circuit',
    theme: 'night',
    world: { w: 2600, h: 1700 },
    halfWidth: 48,
    points: [
      [300, 850],
      [380, 430],
      [800, 260],
      [1500, 300],
      [2150, 260],
      [2380, 560],
      [2120, 790],
      [1720, 770],
      [1500, 960],
      [1780, 1190],
      [2250, 1250],
      [2340, 1480],
      [1700, 1560],
      [920, 1470],
      [660, 1360],
      [700, 1150],
      [520, 980],
    ],
    boosts: [
      [0.16, 0.19],
      [0.72, 0.75],
    ],
  },
]

export function courseDef(kind: CourseKind, index: number): CourseDef {
  const list = kind === 'stage' ? RALLY_STAGES : SPEED_CIRCUITS
  return list[Math.max(0, Math.min(list.length - 1, index))] as CourseDef
}

export function sampleCourse(def: CourseDef): MicroRacePoint[] {
  return sampleSpline(def.points, COURSE_SPACING, def.kind === 'circuit')
}

// Whether a stretch [from, to) fractions covers sample `i` of `n`.
export function inStretch(
  stretches: readonly (readonly [number, number])[] | undefined,
  i: number,
  n: number,
): boolean {
  const f = i / Math.max(1, n)
  return (stretches ?? []).some(([a, b]) => f >= a && f < b)
}

export interface CourseCar {
  id: string
  x: number
  y: number
  a: number
  // Race progress as a fraction of the whole race (laps included), 0…1.
  progress: number
  lap: number
  pos: number
  finishMs: number | null
  off: boolean
  hits: number
  resets: number
  // Stage: checkpoints passed and the split time at the last one. Circuit: slipstream / boost active.
  checkpoint: number
  splitMs: number | null
  draft: boolean
  boost: boolean
}

export interface CourseRaceSnapshot {
  kind: CourseKind
  course: number
  laps: number
  checkpoints: number
  goInMs: number
  cars: CourseCar[]
  remainingMs: number
  closing: boolean
}

// Same controls as Micro Race: steer in [-1, 1], throttle in [-1, 1] (negative = brake, then reverse).
export interface CourseRaceInput {
  kind: 'drive'
  steer: number
  throttle: number
}
