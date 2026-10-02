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
// `.ms` later (lanes in between evenly). Shared so the client draws the beam where the server judges.
export const FREEZE_DOLL_SWEEP = { delayMs: 100, ms: 400 } as const

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
  // RED: time since the doll faced the field, and the sweep direction (1 = lane 0 first).
  redElapsedMs: number
  sweepDir: 1 | -1
  lanes: number
  runners: FreezeDollRunner[]
  remainingMs: number
}

export interface FreezeDollInput {
  kind: 'move'
  mode: FreezeDollMode
}
