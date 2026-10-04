// Freeze Doll wire shapes ("Red Light, Green Light"). A real-time FFA elimination race: every player has
// their own lane toward a giant pixel doll. While she faces away (GREEN) a chant plays — its tempo is the
// tell: she turns when it ends. A head twitch (TURN) comes first; sometimes it is only a fake-out and she
// looks away again, sometimes (later in the round) a sudden spin cuts the chant short. Once she faces the
// field (RED) her laser sweeps across the lanes and from the moment the beam reaches a lane, anyone in it
// still moving is hit: a first hit stuns and knocks the runner back, a second one eliminates them.
//
// Movement has momentum (hold WALK, or RUN for more speed but a longer slide when you let go), so the
// skill is stopping in time. The server owns the doll timeline, the physics and every hit.

// The laser sweep: the first lane is judged FREEZE_DOLL_SWEEP.delayMs after RED starts, the last one
// `.ms` later (lanes in between evenly). Each RED it starts at a seeded lane and runs one way, wrapping
// round at the edge of the field, so every lane is as likely to be judged early as late (an edge lane
// isn't alternately first and last). Shared so the client draws the beam where the server judges.
export const FREEZE_DOLL_SWEEP = { delayMs: 100, ms: 400 } as const

// How far into the sweep `lane` is reached: 0 = the first lane judged (`from`), 1 = the last one.
export function freezeDollSweepAt(lane: number, lanes: number, from: number, dir: 1 | -1): number {
  if (lanes <= 1) return 0
  return (((((lane - from) * dir) % lanes) + lanes) % lanes) / (lanes - 1)
}

// Runner physics (field lengths per second): RUN is ~1.6× WALK but slides ~400 ms when released
// (WALK: ~150 ms). Shared so the client moves your own runner the moment you press.
export const FREEZE_DOLL = {
  walk: 0.048,
  run: 0.077,
  // field lengths / s² — full RUN in ~150 ms
  accel: 0.5,
  walkGlideMs: 150,
  runGlideMs: 400,
} as const

export function freezeDollSpeed(mode: FreezeDollMode): number {
  return mode === 'run' ? FREEZE_DOLL.run : mode === 'walk' ? FREEZE_DOLL.walk : 0
}

// One step of a runner toward `target` speed: accelerate, or brake over the glide of the speed it had
// when it started slowing (`brake` remembers that deceleration; 0 = not braking). Then move.
export function freezeDollMove(
  r: { x: number; v: number; brake: number },
  target: number,
  step: number,
): void {
  const { walk, run, accel, walkGlideMs, runGlideMs } = FREEZE_DOLL
  if (r.v < target) {
    r.v = Math.min(target, r.v + accel * step)
    r.brake = 0
  } else if (r.v > target) {
    if (r.brake === 0) {
      const glideMs =
        r.v <= walk
          ? walkGlideMs
          : walkGlideMs + (runGlideMs - walkGlideMs) * Math.min(1, (r.v - walk) / (run - walk))
      r.brake = r.v / (glideMs / 1000)
    }
    r.v = Math.max(target, r.v - r.brake * step)
    if (r.v === target) r.brake = 0
  }
  r.x += r.v * step
}

// ready = the opening beat before the first chant (nobody can move yet, nobody is judged).
export type FreezeDollLight = 'ready' | 'green' | 'turn' | 'red'

export type FreezeDollMode = 'stop' | 'walk' | 'run'

export type FreezeDollStatus = 'racing' | 'stunned' | 'finished' | 'out'

export interface FreezeDollRunner {
  id: string
  lane: number
  // Progress along the lane, 0 = start line, 1 = finish line.
  x: number
  // Current speed (field lengths / s), for dead reckoning between snapshots.
  v: number
  hearts: number
  status: FreezeDollStatus
}

export interface FreezeDollSnapshot {
  light: FreezeDollLight
  // GREEN: the chant's full nominal length and how far into it we are (a sudden spin cuts it short).
  songMs: number
  songElapsedMs: number
  // RED: time since the doll faced the field, the lane the sweep starts at and its direction (1 =
  // toward higher lanes) — see freezeDollSweepAt.
  redElapsedMs: number
  sweepFrom: number
  sweepDir: 1 | -1
  lanes: number
  runners: FreezeDollRunner[]
  remainingMs: number
}

export interface FreezeDollInput {
  kind: 'move'
  mode: FreezeDollMode
}
