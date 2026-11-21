// Munch Maze wire shapes and the world rules shared by the server and the client's prediction (D50).
// A maze chase in a park: everyone runs the same hedge maze at once, gobbling seeds (1 point each; an
// eaten seed grows back after a while). Pigeons want the seeds too and peck anyone they catch (−3 and
// a moment dazed, then back to your start). A chilli makes you SPICY for a few seconds: the pigeons
// flee — catch one for +5 — and touching a rival who isn't spicy tackles them and steals up to 5 of
// their seeds. More pigeons join and they speed up as the round goes on (D40). Highest score wins.
//
// The whole world (runners, pigeons, seeds) is integrated on a fixed MAZE.dtMs grid with integer
// arithmetic only, so the server and every client compute it identically from the same turns. Turns
// carry the time they were pressed (on the client's estimate of the server's round clock) and the
// server judges MAZE.judgeMs behind real time; the client runs the world forward from the last judged
// state with every turn it knows, so your own runner answers on the frame you press.

// '#' hedge · '.' seed · 'o' chilli. The middle row wraps around (a tunnel at both ends).
export const MAZE_LAYOUT: readonly string[] = [
  '###################',
  '#o.......#.......o#',
  '#.##.###.#.###.##.#',
  '#.................#',
  '#.##.#.#####.#.##.#',
  '#....#...#...#....#',
  '####.###.#.###.####',
  '####...........####',
  '.....#.##.##.#.....',
  '####...........####',
  '####.#.#####.#.####',
  '#........#........#',
  '#.##.###.#.###.##.#',
  '#o.#...........#.o#',
  '#..#.#.#####.#.#..#',
  '#....#.......#....#',
  '###################',
]

export const MAZE = {
  w: 19,
  h: 17,
  tunnelRow: 8,
  // Where the pigeons roost (and return to when shooed).
  nest: [9, 8] as const,
  // Up to 12 starting cells, spread out, in seat order.
  spawns: [
    [4, 3],
    [14, 11],
    [14, 3],
    [4, 11],
    [8, 1],
    [10, 15],
    [10, 1],
    [8, 15],
    [4, 5],
    [14, 13],
    [14, 5],
    [4, 13],
  ] as const,
  // GET READY this long; the pigeons take off at GO.
  startDelayMs: 1500,
  dtMs: 10,
  judgeMs: 150,
  // Sub-cell units per cell (positions are integers in these units; a cell's center is a multiple).
  unit: 10,
  // Speeds in thousandths of a unit per step (550 = 5.5 cells/s).
  runSpeed: 550,
  spicySpeed: 620,
  pigeonSpeed: [380, 560] as const,
  fleeSpeed: 420,
  pigeonRampMs: 50_000,
  // Pigeons: 2 + one per 4 players at GO, one more at each of these round times, never over `maxPigeons`.
  pigeonJoins: [25_000, 45_000] as const,
  maxPigeons: 6,
  // Touching distance (units, Manhattan).
  touch: 7,
  spicyMs: 5000,
  dazedMs: 1200,
  // After starting over you can't be pecked or tackled (nor tackle) for this long.
  safeMs: 1500,
  shooedMs: 3000,
  chilliRegrowMs: 15_000,
  // The chillies first appear this long after GO (no spicy rush at the whistle).
  chilliFirstMs: 6000,
  // Seeds grow back faster in a bigger room: max(4 s, 12 s − 0.7 s per player).
  seedRegrowMs: [12_000, 700, 4000] as const,
  peckCost: 3,
  pigeonPoints: 5,
  stealMax: 5,
} as const

// Directions (input `dir`, facing): up, right, down, left; −1 = standing still.
export const MAZE_DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
]

export interface MazeRunner {
  // Position in units (cell × MAZE.unit at a center).
  x: number
  y: number
  dir: number
  // The way the player last asked to go (taken at the next opening).
  want: number
  acc: number
  score: number
  spicyUntil: number
  // > t: dazed where they were caught; then they start over.
  downUntil: number
  safeUntil: number
  // Seeds eaten, pigeons shooed, tackles made, times pecked, times tackled (sounds + result).
  seeds: number
  shoos: number
  tackles: number
  pecks: number
  tackled: number
  spawn: number
}

export interface MazePigeon {
  x: number
  y: number
  dir: number
  acc: number
  // > t: roosting (not yet joined, or shooed back to the nest).
  homeUntil: number
}

export interface MazeWorld {
  t: number
  runners: MazeRunner[]
  pigeons: MazePigeon[]
  // Per cell (row-major): −1 no seed spot, 0 a seed / chilli is there, > 0 the time it grows back.
  food: number[]
  players: number
}

export interface MazeTurn {
  // Round time it was pressed (snapped to the grid).
  at: number
  dir: number
}

export const mazeSnap = (t: number): number => Math.ceil(t / MAZE.dtMs) * MAZE.dtMs

const U = MAZE.unit
const WU = MAZE.w * U

export const mazeOpen = (cx: number, cy: number): boolean => {
  if (cy < 0 || cy >= MAZE.h) return false
  if (cx < 0 || cx >= MAZE.w) return cy === MAZE.tunnelRow
  return MAZE_LAYOUT[cy]?.[cx] !== '#'
}

export const mazeChilli = (cx: number, cy: number): boolean => MAZE_LAYOUT[cy]?.[cx] === 'o'

// Pigeons active at round time `t` for `players` players.
export function mazePigeonCount(t: number, players: number): number {
  let n = 2 + Math.floor(players / 4)
  for (const at of MAZE.pigeonJoins) if (t >= at) n++
  return Math.min(MAZE.maxPigeons, n)
}

export function mazeSeedRegrow(players: number): number {
  const [base, per, min] = MAZE.seedRegrowMs
  return Math.max(min, base - per * players)
}

// A pigeon's speed at round time `t` (eases in, D40) — integer thousandths of a unit per step.
export function mazePigeonSpeed(t: number): number {
  const [from, to] = MAZE.pigeonSpeed
  const p = Math.min(1, Math.max(0, (t - MAZE.startDelayMs) / MAZE.pigeonRampMs))
  return from + Math.floor(((to - from) * Math.floor(p * 1000) * Math.floor(p * 1000)) / 1e6)
}

export function mazeNewWorld(players: number, t: number = MAZE.startDelayMs): MazeWorld {
  const food: number[] = []
  for (let y = 0; y < MAZE.h; y++)
    for (let x = 0; x < MAZE.w; x++)
      food.push(!mazeOpen(x, y) ? -1 : mazeChilli(x, y) ? t + MAZE.chilliFirstMs : 0)
  const [nx, ny] = MAZE.nest
  food[ny * MAZE.w + nx] = -1
  const runners: MazeRunner[] = Array.from({ length: players }, (_, i) => {
    const [sx, sy] = MAZE.spawns[i % MAZE.spawns.length] as readonly [number, number]
    return {
      x: sx * U,
      y: sy * U,
      dir: -1,
      want: -1,
      acc: 0,
      score: 0,
      spicyUntil: 0,
      downUntil: 0,
      safeUntil: 0,
      seeds: 0,
      shoos: 0,
      tackles: 0,
      pecks: 0,
      tackled: 0,
      spawn: i % MAZE.spawns.length,
    }
  })
  const pigeons: MazePigeon[] = Array.from({ length: MAZE.maxPigeons }, () => ({
    x: nx * U,
    y: ny * U,
    dir: -1,
    acc: 0,
    homeUntil: 0,
  }))
  return { t, runners, pigeons, food, players }
}

export const mazeClone = (w: MazeWorld): MazeWorld => ({
  t: w.t,
  runners: w.runners.map((r) => ({ ...r })),
  pigeons: w.pigeons.map((p) => ({ ...p })),
  food: [...w.food],
  players: w.players,
})

const atCenter = (x: number, y: number): boolean => x % U === 0 && y % U === 0
const canGo = (x: number, y: number, dir: number): boolean => {
  const d = MAZE_DIRS[dir]
  return !!d && mazeOpen(x / U + d[0], y / U + d[1])
}

// One unit along `dir`, wrapping through the tunnel.
function nudge(e: { x: number; y: number }, dir: number): void {
  const d = MAZE_DIRS[dir]
  if (!d) return
  e.x = (e.x + d[0] + WU) % WU
  e.y += d[1]
}

const alive = (r: MazeRunner, t: number): boolean => r.downUntil <= t && r.safeUntil <= t

// The pigeon's choice at a cell center: toward its target (away from it while it's spicy), never back
// the way it came unless there's no other way; ties go up, left, down, right.
function pigeonTurn(w: MazeWorld, p: MazePigeon, index: number): number {
  const cx = p.x / U
  const cy = p.y / U
  let best = -1
  let bestD = 0
  let target: MazeRunner | undefined
  for (const r of w.runners) {
    if (!alive(r, w.t)) continue
    const d = (r.x - p.x) * (r.x - p.x) + (r.y - p.y) * (r.y - p.y)
    if (!target || d < bestD) {
      target = r
      bestD = d
    }
  }
  const flee = !!target && target.spicyUntil > w.t
  let tx: number
  let ty: number
  if (!target) {
    // Nobody to chase: each pigeon heads for "its" corner, rotating every 8 s.
    const corner = (index + Math.floor(w.t / 8000)) % 4
    tx = corner % 2 ? MAZE.w - 2 : 1
    ty = corner < 2 ? 1 : MAZE.h - 2
  } else {
    tx = target.x / U
    ty = target.y / U
    // Every third pigeon cuts the runner off: it aims two cells ahead of them.
    const ahead = MAZE_DIRS[target.dir]
    if (index % 3 === 1 && ahead) {
      tx += ahead[0] * 2
      ty += ahead[1] * 2
    }
  }
  bestD = 0
  for (const dir of [0, 3, 2, 1]) {
    if (!canGo(p.x, p.y, dir) || (p.dir >= 0 && dir === (p.dir + 2) % 4)) continue
    const d = MAZE_DIRS[dir] as readonly [number, number]
    const nx = cx + d[0]
    const ny = cy + d[1]
    const dist = (nx - tx) * (nx - tx) + (ny - ty) * (ny - ty)
    if (best < 0 || (flee ? dist > bestD : dist < bestD)) {
      best = dir
      bestD = dist
    }
  }
  if (best < 0 && p.dir >= 0 && canGo(p.x, p.y, (p.dir + 2) % 4)) best = (p.dir + 2) % 4
  return best
}

function startOver(r: MazeRunner, t: number): void {
  const [sx, sy] = MAZE.spawns[r.spawn] as readonly [number, number]
  r.x = sx * U
  r.y = sy * U
  r.dir = -1
  r.want = -1
  r.acc = 0
  r.spicyUntil = 0
  r.safeUntil = t + MAZE.safeMs
}

// One integration step (MAZE.dtMs): take the turns due (`turns[i]` = runner i's new way, −1 = none),
// move every runner and pigeon, eat, grow back, then settle every touch.
export function mazeStep(w: MazeWorld, turns: readonly number[]): void {
  const t = w.t
  // Runners.
  w.runners.forEach((r, i) => {
    if (r.downUntil > 0 && r.downUntil <= t) {
      r.downUntil = 0
      startOver(r, t)
    }
    if (r.downUntil > t) return
    const turn = turns[i] ?? -1
    if (turn >= 0 && turn <= 3) {
      r.want = turn
      // Turning back is allowed anywhere.
      if (r.dir >= 0 && turn === (r.dir + 2) % 4) r.dir = turn
    }
    r.acc += r.spicyUntil > t ? MAZE.spicySpeed : MAZE.runSpeed
    while (r.acc >= 1000) {
      r.acc -= 1000
      if (atCenter(r.x, r.y)) {
        if (r.want >= 0 && canGo(r.x, r.y, r.want)) r.dir = r.want
        else if (r.dir >= 0 && !canGo(r.x, r.y, r.dir)) r.dir = -1
        if (r.dir < 0) {
          r.acc = 0
          break
        }
      }
      nudge(r, r.dir)
      if (atCenter(r.x, r.y)) eat(w, r)
    }
  })
  // Pigeons: the first `count` fly, the rest roost.
  const count = mazePigeonCount(t, w.players)
  const speed = mazePigeonSpeed(t)
  w.pigeons.forEach((p, i) => {
    if (i >= count || t < MAZE.startDelayMs || p.homeUntil > t) return
    const fleeing = w.runners.some((r) => r.spicyUntil > t)
    p.acc += fleeing ? MAZE.fleeSpeed : speed
    while (p.acc >= 1000) {
      p.acc -= 1000
      if (atCenter(p.x, p.y)) {
        p.dir = pigeonTurn(w, p, i)
        if (p.dir < 0) {
          p.acc = 0
          break
        }
      }
      nudge(p, p.dir)
    }
  })
  w.t = t + MAZE.dtMs
  // Seeds and chillies grow back.
  for (let i = 0; i < w.food.length; i++) {
    const at = w.food[i] as number
    if (at > 0 && at <= w.t) w.food[i] = 0
  }
  touches(w, count)
}

function eat(w: MazeWorld, r: MazeRunner): void {
  const cx = r.x / U
  const cy = r.y / U
  if (cx < 0 || cx >= MAZE.w) return
  const i = cy * MAZE.w + cx
  if (w.food[i] !== 0) return
  if (mazeChilli(cx, cy)) {
    r.spicyUntil = w.t + MAZE.spicyMs
    w.food[i] = w.t + MAZE.chilliRegrowMs
    return
  }
  r.score += 1
  r.seeds += 1
  w.food[i] = w.t + mazeSeedRegrow(w.players)
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => {
  const dx = Math.abs(a.x - b.x)
  return Math.min(dx, WU - dx) + Math.abs(a.y - b.y) <= MAZE.touch
}

// Pigeon pecks / shoos, then tackles (a spicy runner on one who isn't).
function touches(w: MazeWorld, count: number): void {
  const t = w.t
  const [nx, ny] = MAZE.nest
  for (const r of w.runners) {
    if (!alive(r, t)) continue
    for (let i = 0; i < count; i++) {
      const p = w.pigeons[i] as MazePigeon
      if (p.homeUntil > t || t < MAZE.startDelayMs || !near(r, p)) continue
      if (r.spicyUntil > t) {
        r.score += MAZE.pigeonPoints
        r.shoos += 1
        p.x = nx * U
        p.y = ny * U
        p.dir = -1
        p.acc = 0
        p.homeUntil = t + MAZE.shooedMs
      } else {
        r.score = Math.max(0, r.score - MAZE.peckCost)
        r.pecks += 1
        r.downUntil = t + MAZE.dazedMs
        r.spicyUntil = 0
        break
      }
    }
  }
  for (const a of w.runners) {
    if (a.spicyUntil <= t || !alive(a, t)) continue
    for (const b of w.runners) {
      if (b === a || b.spicyUntil > t || !alive(b, t) || !near(a, b)) continue
      const steal = Math.min(MAZE.stealMax, b.score)
      b.score -= steal
      a.score += steal
      a.tackles += 1
      b.tackled += 1
      b.downUntil = t + MAZE.dazedMs
    }
  }
}

// Carries the world forward to `until` (round ms, on the grid), taking each runner's turns (snapped,
// ascending) at their times; several due at one step: the last one wins.
export function mazeRun(
  w: MazeWorld,
  until: number,
  turns: readonly (readonly MazeTurn[])[],
): void {
  const idx = turns.map(() => 0)
  turns.forEach((list, r) => {
    while ((idx[r] as number) < list.length && (list[idx[r] as number] as MazeTurn).at < w.t)
      idx[r] = (idx[r] as number) + 1
  })
  const due: number[] = turns.map(() => -1)
  while (w.t < until) {
    for (let r = 0; r < turns.length; r++) {
      const list = turns[r] as readonly MazeTurn[]
      due[r] = -1
      while ((idx[r] as number) < list.length && (list[idx[r] as number] as MazeTurn).at <= w.t) {
        due[r] = (list[idx[r] as number] as MazeTurn).dir
        idx[r] = (idx[r] as number) + 1
      }
    }
    mazeStep(w, due)
  }
}

export interface MunchMazeSnapshot {
  // Judged world (players in `ids` order)...
  world: MazeWorld
  ids: string[]
  // ...and each player's turns already pressed after it (same order).
  turns: MazeTurn[][]
  // playerId -> the last input `seq` the server has taken.
  acks: Record<string, number>
  // Round time (ms since the round started — GO is at MAZE.startDelayMs) at this snapshot.
  t: number
  // playerId -> score, for the live standings.
  progress: Record<string, number>
  remainingMs: number
}

// Go `dir` (0 up, 1 right, 2 down, 3 left) at the next opening. `at` = when it was pressed.
export interface MunchMazeInput {
  kind: 'turn'
  dir: number
  at?: number
  seq?: number
}
