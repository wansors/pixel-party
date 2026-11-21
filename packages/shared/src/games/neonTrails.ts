// Neon Trails wire shapes and the rules shared by the server and the client's prediction (D41). A
// light-trail arena: every rider moves one cell per step on ONE shared grid and leaves a solid wall
// behind; riding into a wall, any trail or another rider head-on knocks you out (and your trail
// fades away). Last rider standing wins. The pace is a pure function of the step count (an integer
// table, identical on every engine), quickening a notch every TRAILS.levelSteps steps — so the server
// and every client agree on when step k happens without exchanging timing.

export type TrailDir = 'up' | 'down' | 'left' | 'right'

export const TRAILS = {
  // Riders hold still this long after the round starts (GET READY → GO!).
  startDelayMs: 1200,
  // Turns booked ahead of the next steps: two quick taps inside one step (a U-turn) both apply.
  turnQueue: 2,
  // Every this many steps the riders speed up a notch...
  levelSteps: 40,
  // ...to the next step length (ms per cell): about -8% a notch, an exponential ramp that reaches top
  // speed ~35 s in (integers, so every JS engine schedules the very same steps).
  stepMs: [120, 110, 101, 93, 86, 79, 73, 68, 63, 59, 55],
} as const

export const TRAIL_OPPOSITE: Record<TrailDir, TrailDir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}
export const TRAIL_DELTA: Record<TrailDir, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

// The arena for `n` riders: more riders, more room (cols × rows, 3:2).
export function trailArena(n: number): { cols: number; rows: number } {
  if (n <= 2) return { cols: 36, rows: 24 }
  if (n <= 4) return { cols: 42, rows: 28 }
  if (n <= 8) return { cols: 48, rows: 32 }
  return { cols: 54, rows: 36 }
}

// Speed notch (0-based) the riders are on while taking step k (1-based).
export function trailLevel(k: number): number {
  return Math.min(TRAILS.stepMs.length - 1, Math.floor(Math.max(0, k - 1) / TRAILS.levelSteps))
}

// Steps due by `t` ms into the round (0 during the start delay).
export function trailStepsAt(t: number): number {
  let left = t - TRAILS.startDelayMs
  if (left < 0) return 0
  let steps = 0
  const last = TRAILS.stepMs.length - 1
  for (let level = 0; level < last; level++) {
    const ms = TRAILS.stepMs[level] as number
    const span = ms * TRAILS.levelSteps
    if (left < span) return steps + Math.floor(left / ms)
    left -= span
    steps += TRAILS.levelSteps
  }
  return steps + Math.floor(left / (TRAILS.stepMs[last] as number))
}

// Round time (ms) at which step k happens — the inverse of trailStepsAt.
export function trailStepTime(k: number): number {
  let t = TRAILS.startDelayMs
  for (let i = 1; i <= k; i++) t += TRAILS.stepMs[trailLevel(i)] as number
  return t
}

// A queued turn: the direction and the step (1-based count since GO) it applies on.
export interface TrailTurn {
  dir: TrailDir
  at: number
}

// One rider's movement state, the same on both sides.
export interface TrailRider {
  // Trail vertices as cell indices (y * cols + x): the start, every corner, and the head (last).
  pts: number[]
  dir: TrailDir
  turns: TrailTurn[] // oldest first, `at` ascending
  alive: boolean
}

export const trailHead = (r: { pts: readonly number[] }): number => r.pts[r.pts.length - 1] ?? 0

// Whether `dir` can be queued now: never the heading the rider will have once its queued turns ran
// (a no-op) nor straight back into its own trail.
export function trailCanTurn(r: TrailRider, dir: TrailDir): boolean {
  if (!r.alive || r.turns.length >= TRAILS.turnQueue) return false
  const heading = r.turns.at(-1)?.dir ?? r.dir
  return dir !== heading && dir !== TRAIL_OPPOSITE[heading]
}

// Step k's move for one rider: takes the turn due by k (if any) and returns the cell it rides into,
// or -1 off the arena. Doesn't move it — the caller judges collisions, then calls trailMove.
export function trailNext(r: TrailRider, k: number, cols: number, rows: number): number {
  while (r.turns[0] && r.turns[0].at <= k) {
    const turn = r.turns.shift() as TrailTurn
    if (turn.dir !== r.dir && turn.dir !== TRAIL_OPPOSITE[r.dir]) {
      r.dir = turn.dir
      // The cell it turns on becomes a corner of the trail.
      r.pts.push(trailHead(r))
    }
  }
  const head = trailHead(r)
  const [dx, dy] = TRAIL_DELTA[r.dir]
  const x = (head % cols) + dx
  const y = Math.floor(head / cols) + dy
  return x < 0 || x >= cols || y < 0 || y >= rows ? -1 : y * cols + x
}

// Ride into `cell` (the head vertex moves; the corners stay).
export function trailMove(r: TrailRider, cell: number): void {
  r.pts[r.pts.length - 1] = cell
}

// Every cell of a trail polyline, in order (vertices are on one row or column pairwise).
export function trailCells(pts: readonly number[], cols: number): number[] {
  const out: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const to = pts[i] as number
    if (i === 0) {
      out.push(to)
      continue
    }
    const from = pts[i - 1] as number
    if (from === to) continue
    const fx = from % cols
    const fy = Math.floor(from / cols)
    const sx = Math.sign((to % cols) - fx)
    const sy = Math.sign(Math.floor(to / cols) - fy)
    let x = fx
    let y = fy
    while (y * cols + x !== to) {
      x += sx
      y += sy
      out.push(y * cols + x)
    }
  }
  return out
}

export interface TrailView {
  // Trail vertices (cell indices): start, corners, head last.
  pts: number[]
  dir: TrailDir
  alive: boolean
  // Turns queued for later steps, as [dir, step].
  turns: [TrailDir, number][]
  // Step on which the rider crashed (0 = still riding).
  outAt: number
  // The last input `seq` the server has taken (0 = none): the client replays only later ones.
  ack: number
}

export interface TrailsSnapshot {
  // playerId -> rider. Out riders keep their last vertices (the client fades the trail out).
  riders: Record<string, TrailView>
  cols: number
  rows: number
  // Steps taken so far and the round's elapsed ms at this snapshot: the client keeps riding on the
  // server's clock between snapshots (trailStepsAt).
  step: number
  t: number
  // playerId -> steps survived, for the live standings.
  progress: Record<string, number>
  remainingMs: number
}

// Turn. `at` asks for the step to turn on (the client's next step, as it sees it): the server honours
// it while it's still ahead, or turns on its next step when the request arrives late.
export interface TrailsInput {
  kind: 'turn'
  dir: TrailDir
  at?: number
  seq?: number
}
