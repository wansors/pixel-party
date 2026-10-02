// Track & field wire shapes, shared by the four Konami-style athletics events. Every event runs on the
// same sprint model: alternate LEFT/RIGHT taps to build speed (the same foot twice does nothing).
//
//  - Track races (`dash-100m`, `hurdles-110m`): everyone sprints side by side in their own lane from a
//    common starting gun; hurdles add a JUMP to clear each barrier. Ranked by finish time.
//  - Field events (`long-jump`, `javelin-throw`): each player takes three run-ups of their own; hold
//    JUMP/THROW before the foul line to set the angle, release to launch. Ranked by best mark.
//
// The server owns the run physics, the gun, fouls and marks; clients render (dead-reckoning runners
// from `x` + `v`) and send taps.

export type AthleticsFoot = 'L' | 'R'

export interface TrackRunner {
  id: string
  // Metres from the start line (keeps growing past the finish while the runner slows down).
  x: number
  // Current speed, m/s (clients extrapolate `x` with it between snapshots).
  v: number
  // Race time in ms once across the line, else null.
  finishMs: number | null
  // 1-based finishing place once across the line, else null.
  place: number | null
  // Jumped the gun: held in the blocks for a penalty after the start.
  falseStart: boolean
  // Still serving the false-start penalty (can't run yet).
  held: boolean
  // Airborne over a hurdle right now, and how far through the jump (0..1).
  air: boolean
  airT: number
  // Hurdle indices this runner knocked down.
  knocked: number[]
}

export interface TrackRaceSnapshot {
  // Race length in metres and hurdle positions (empty for the flat sprint).
  distance: number
  hurdles: number[]
  // 'set' until the (unannounced, seeded) starting gun fires.
  phase: 'set' | 'go'
  // Race clock since the gun (0 before it).
  raceMs: number
  runners: TrackRunner[]
  remainingMs: number
}

export type TrackRaceInput = { kind: 'step'; foot: AthleticsFoot } | { kind: 'jump' }

export type FieldPhase = 'ready' | 'run' | 'aim' | 'flight' | 'mark' | 'done'

export interface FieldAthlete {
  id: string
  phase: FieldPhase
  // Time spent in the current phase, ms (drives the aim needle, the flight arc, the mark pause).
  phaseMs: number
  // 0-based attempt in progress (== attempts when done).
  attempt: number
  // Run-up position and speed (metres from the start of the runway, m/s).
  x: number
  v: number
  // Take-off point, launch angle (degrees) and landing point once launched (metres, absolute).
  takeoffX: number
  angle: number
  landX: number | null
  // One entry per finished attempt: the measured mark in metres, or null for a foul.
  marks: (number | null)[]
  best: number | null
}

export interface FieldEventSnapshot {
  // Where the runway ends (take-off board / throwing arc), metres from the runway start.
  foulLine: number
  attempts: number
  // Phase timings and the aim needle's speed/limit, so clients can animate between snapshots.
  readyMs: number
  flightMs: number
  markMs: number
  angleRate: number
  maxAngle: number
  athletes: FieldAthlete[]
  remainingMs: number
}

// `jump` doubles as THROW: down = plant and start raising the angle, up = release.
export type FieldEventInput =
  | { kind: 'step'; foot: AthleticsFoot }
  | { kind: 'jump'; down: boolean }
