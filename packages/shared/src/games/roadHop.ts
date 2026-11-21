// Road Hop wire shapes and the hop rules shared by the server and the client's prediction (D48). A
// crossing game on one shared field: everyone starts on the pavement at the bottom and hops (one cell
// per press) across five lanes of traffic, a grass verge and five lanes of river to the far bank — a
// crossing scores, then you start over. A vehicle squashes you; in the river you must ride the logs
// and rafts (they carry you along) — the water, or being carried off the edge, sends you back too. No
// one is eliminated: the round is a 60-second race for the most crossings.
//
// Everything that moves is a pure function of the round clock: lane things loop at their lane's speed
// times a pace that eases in over the round (D40), so the server and every client place them exactly
// alike. A player's run is integrated on a fixed HOP.dtMs grid with plain arithmetic only (no
// Math.pow/sin…), so the client predicts its own hopper bit for bit. Hops carry the time they were
// pressed (on the client's estimate of the server's round clock) and the server judges HOP.judgeMs
// behind real time, so a hop counts exactly when it was pressed.

export const HOP = {
  // The field: 11 cells wide, 13 rows from the start pavement (0) to the far bank (12).
  cols: 11,
  rows: 13,
  verge: 6,
  goal: 12,
  // Everyone waits on the pavement this long (GET READY) — the traffic is already moving.
  startDelayMs: 1500,
  // Integration step (ms) — hop times snap up to this grid.
  dtMs: 10,
  // How far behind real time the server judges: the most a hop's trip may take.
  judgeMs: 150,
  // Hops closer than this are dropped (mashing).
  minHopGapMs: 110,
  // After a squash or a splash you're out of play this long, then start over on the pavement.
  respawnMs: 1000,
  // On the far bank: a moment to cheer, then back to the start for another crossing.
  homeMs: 600,
  // Hitboxes, in cells: your half-width, how much a vehicle's ends forgive, how far past a log's end
  // you still stand on it, and how far past the field's edge a ride carries you before you're gone.
  bodyHalf: 0.3,
  carInset: 0.12,
  floatGrace: 0.2,
  sweptAt: 0.35,
} as const

// The traffic's pace (× each lane's speed) eases in over the round (D40), then holds.
export const HOP_PACE = { from: 1, to: 1.8, rampMs: 50_000 } as const

// Hop directions (input `dir`, and the hopper's facing).
export const HOP_UP = 0
export const HOP_RIGHT = 1
export const HOP_DOWN = 2
export const HOP_LEFT = 3

// Why a run ended (HopBody.last).
export const HOP_NONE = 0
export const HOP_SQUASHED = 1
export const HOP_SPLASHED = 2
export const HOP_CROSSED = 3

export type HopKind = 'car' | 'sport' | 'tractor' | 'van' | 'truck' | 'log' | 'raft'

export interface HopThing {
  // Position along the lane's loop (cells) at lane time 0.
  u: number
  len: number
  kind: HopKind
  // Paint variant (cosmetic).
  look: number
}

export interface HopLane {
  row: number
  river: boolean
  dir: 1 | -1
  // Cells per second at pace 1.
  speed: number
  // The lane's things loop over this many cells (wider than the field: they wrap off screen).
  loop: number
  things: HopThing[]
}

// "Lane seconds" elapsed `t` ms into the round: the integral of the pace — from + (to−from)·(t/T)²
// up to T, then `to`.
export function hopLaneTime(t: number): number {
  if (t <= 0) return 0
  const { from, to, rampMs: T } = HOP_PACE
  const s = Math.min(t, T)
  const ramped = (from * s + ((to - from) * s * s * s) / (3 * T * T)) / 1000
  return ramped + (t > T ? (to * (t - T)) / 1000 : 0)
}

// The left edge (field cells: 0..cols is on screen) of a lane thing at lane time `lt`.
export function hopLeft(lane: HopLane, thing: HopThing, lt: number): number {
  let u = (thing.u + lane.dir * lane.speed * lt) % lane.loop
  if (u < 0) u += lane.loop
  return u - (lane.loop - HOP.cols) / 2
}

// One hopper's run at a point in time (ms since the round started).
export interface HopBody {
  t: number
  row: number
  // Center, in cells (0 = the field's left edge). Whole cell + 0.5 on solid ground; a ride drifts it.
  x: number
  // 0 = in play; otherwise the round time it starts over (after a squash, a splash or a crossing).
  waitUntil: number
  crossings: number
  deaths: number
  // The furthest row reached on this run (for the tie-break at the bell).
  best: number
  // How the last run ended (HOP_SQUASHED / HOP_SPLASHED / HOP_CROSSED) and when.
  last: number
  lastAt: number
  // Facing (the last hop's direction; cosmetic).
  dir: number
}

export interface HopMove {
  // Round time it was pressed (snapped to the grid).
  at: number
  dir: number
}

export const hopSnap = (t: number): number => Math.ceil(t / HOP.dtMs) * HOP.dtMs

export function hopNewBody(home: number, t: number = HOP.startDelayMs): HopBody {
  return {
    t,
    row: 0,
    x: home,
    waitUntil: 0,
    crossings: 0,
    deaths: 0,
    best: 0,
    last: HOP_NONE,
    lastAt: 0,
    dir: HOP_UP,
  }
}

// Where player `index` of `count` starts each run (a cell center, spread along the pavement).
export function hopHome(index: number, count: number): number {
  return Math.min(HOP.cols - 1, Math.floor(((index + 0.5) * HOP.cols) / Math.max(1, count))) + 0.5
}

const laneAt = (lanes: readonly HopLane[], row: number): HopLane | undefined =>
  lanes.find((l) => l.row === row)

// Whether a body at (`row`, `x`) at lane time `lt` is squashed or in the water (HOP_NONE = fine).
export function hopHazard(lanes: readonly HopLane[], row: number, x: number, lt: number): number {
  const lane = laneAt(lanes, row)
  if (!lane) return HOP_NONE
  if (lane.river) {
    if (x < -HOP.sweptAt || x > HOP.cols + HOP.sweptAt) return HOP_SPLASHED
    for (const th of lane.things) {
      const left = hopLeft(lane, th, lt)
      if (x >= left - HOP.floatGrace && x <= left + th.len + HOP.floatGrace) return HOP_NONE
    }
    return HOP_SPLASHED
  }
  for (const th of lane.things) {
    const left = hopLeft(lane, th, lt) + HOP.carInset
    const right = left + th.len - 2 * HOP.carInset
    if (x + HOP.bodyHalf > left && x - HOP.bodyHalf < right) return HOP_SQUASHED
  }
  return HOP_NONE
}

const snapCell = (x: number): number => Math.min(HOP.cols - 1, Math.max(0, Math.floor(x))) + 0.5

// One integration step (HOP.dtMs): start over if the wait is up, take the hop due at this step's start
// (`dir` −1 = none; ignored while waiting), ride the lane, then judge the new moment — unless
// `collide` is false (a rival carried forward on a stale view: shown, never judged).
export function hopStep(
  b: HopBody,
  lanes: readonly HopLane[],
  dir: number,
  home: number,
  collide = true,
): void {
  if (b.waitUntil > 0 && b.t >= b.waitUntil) {
    b.waitUntil = 0
    b.row = 0
    b.x = home
    b.best = 0
    b.dir = HOP_UP
  }
  const playing = b.waitUntil === 0
  if (playing && dir >= 0 && dir <= 3) {
    b.dir = dir
    if (dir === HOP_UP) b.row = Math.min(HOP.goal, b.row + 1)
    else if (dir === HOP_DOWN) b.row = Math.max(0, b.row - 1)
    else b.x = Math.min(HOP.cols - 0.5, Math.max(0.5, b.x + (dir === HOP_RIGHT ? 1 : -1)))
    if (!laneAt(lanes, b.row)?.river) b.x = snapCell(b.x)
    if (b.row > b.best) b.best = b.row
  }
  const lt0 = hopLaneTime(b.t)
  b.t += HOP.dtMs
  const lt1 = hopLaneTime(b.t)
  if (!playing) return
  if (b.row === HOP.goal) {
    b.crossings += 1
    b.last = HOP_CROSSED
    b.lastAt = b.t
    b.waitUntil = b.t + HOP.homeMs
    return
  }
  const lane = laneAt(lanes, b.row)
  if (lane?.river) b.x += lane.dir * lane.speed * (lt1 - lt0)
  if (!collide) return
  const hit = hopHazard(lanes, b.row, b.x, lt1)
  if (hit !== HOP_NONE) {
    b.deaths += 1
    b.last = hit
    b.lastAt = b.t
    b.waitUntil = b.t + HOP.respawnMs
  }
}

// Carries a body forward to `until` (round ms, on the grid), taking the given hops (snapped,
// ascending) at their times. At most one hop per step; extra ones due at the same step are dropped.
export function hopRun(
  b: HopBody,
  until: number,
  moves: readonly HopMove[],
  lanes: readonly HopLane[],
  home: number,
  collide = true,
): void {
  let i = 0
  while (i < moves.length && (moves[i] as HopMove).at < b.t) i++
  while (b.t < until) {
    let dir = -1
    while (i < moves.length && (moves[i] as HopMove).at <= b.t) {
      if (dir < 0) dir = (moves[i] as HopMove).dir
      i++
    }
    hopStep(b, lanes, dir, home, collide)
  }
}

export interface HopperView {
  // Judged run at body.t...
  body: HopBody
  // ...and the hops already taken after it.
  moves: HopMove[]
  // Where this player starts each run (cell center).
  home: number
  // The last input `seq` the server has taken (0 = none).
  ack: number
}

export interface RoadHopSnapshot {
  lanes: HopLane[]
  hoppers: Record<string, HopperView>
  // Round time (ms since the round started — GO is at HOP.startDelayMs) at this snapshot.
  t: number
  // playerId -> crossings, for the live standings.
  progress: Record<string, number>
  remainingMs: number
}

// Hop one cell. `at` is when it was pressed (round ms on the client's estimate of the server clock).
export interface RoadHopInput {
  kind: 'hop'
  dir: number
  at?: number
  seq?: number
}
