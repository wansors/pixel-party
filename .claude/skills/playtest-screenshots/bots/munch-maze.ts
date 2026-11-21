// Munch Maze bot: runs the shared world (from $PP_REPO) forward to "now", then walks a breadth-first
// path to the nearest seed — or, when a pigeon is close, to the nearest chilli; while spicy it hunts the
// nearest pigeon instead. Cells next to a (non-fleeing) pigeon count as blocked. It reads a slightly
// stale snapshot and re-plans only per snapshot, so pigeons still catch it now and then.
const shared = await import(`${process.env.PP_REPO}/packages/shared/src/games/munchMaze.ts`)
const { MAZE, MAZE_DIRS, mazeClone, mazeOpen, mazeChilli, mazeRun, mazeSnap, mazePigeonCount } =
  shared

interface Runner {
  x: number
  y: number
  want: number
  spicyUntil: number
  downUntil: number
}
interface World {
  t: number
  runners: Runner[]
  pigeons: { x: number; y: number; homeUntil: number }[]
  food: number[]
  players: number
}
interface Snap {
  world: World
  ids: string[]
  turns: unknown[][]
  t: number
}

export default function play(snapshot: unknown, me: string): unknown {
  const s = snapshot as Snap
  const i = s?.ids?.indexOf(me) ?? -1
  if (i < 0) return null
  const now = mazeSnap(s.t + 30)
  if (now < MAZE.startDelayMs) return null
  const w = mazeClone(s.world) as World
  mazeRun(w, now, s.turns)
  const r = w.runners[i] as Runner
  if (r.downUntil > w.t) return null
  const U = MAZE.unit
  const cx = Math.round(r.x / U)
  const cy = Math.round(r.y / U)
  const spicy = r.spicyUntil > w.t
  const count = mazePigeonCount(w.t, w.players)
  const birds = w.pigeons
    .slice(0, count)
    .filter((p) => p.homeUntil <= w.t)
    .map((p) => [Math.round(p.x / U), Math.round(p.y / U)] as const)
  const danger = new Set<number>()
  if (!spicy)
    for (const [bx, by] of birds)
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          danger.add((by + dy) * MAZE.w + ((bx + dx + MAZE.w) % MAZE.w))
  const close = birds.some(([bx, by]) => Math.abs(bx - cx) + Math.abs(by - cy) <= 4)
  // Seeds with someone already on them aren't worth the trip; each bot breaks ties its own way (so a
  // bunch of bots don't walk around as one clump).
  const taken = new Set(
    w.runners
      .filter((_o, k) => k !== i)
      .map((o) => Math.round(o.y / U) * MAZE.w + Math.round(o.x / U)),
  )
  let h = 0
  for (const ch of me) h = (h * 31 + ch.charCodeAt(0)) | 0
  const order = [0, 1, 2, 3].map((d) => (d + Math.abs(h)) % 4)
  const goal = (x: number, y: number): boolean => {
    if (spicy) return birds.some(([bx, by]) => bx === x && by === y)
    if (taken.has(y * MAZE.w + x)) return false
    const food = w.food[y * MAZE.w + x] === 0
    return food && (close ? mazeChilli(x, y) || !mazeChilli(x, y) : !mazeChilli(x, y))
  }
  // Breadth-first: the first step of the shortest path to a goal.
  const start = cy * MAZE.w + cx
  const first = new Map<number, number>([[start, -1]])
  let frontier = [start]
  let pick = -1
  while (frontier.length && pick < 0) {
    const next: number[] = []
    for (const cell of frontier) {
      const x = cell % MAZE.w
      const y = Math.floor(cell / MAZE.w)
      if (cell !== start && goal(x, y)) {
        pick = first.get(cell) as number
        break
      }
      for (const dir of order) {
        const d = MAZE_DIRS[dir] as readonly [number, number]
        const nx = (x + d[0] + MAZE.w) % MAZE.w
        const ny = y + d[1]
        if (!mazeOpen(x + d[0], ny)) continue
        const n = ny * MAZE.w + nx
        if (first.has(n) || danger.has(n)) continue
        first.set(n, cell === start ? dir : (first.get(cell) as number))
        next.push(n)
      }
    }
    frontier = next
  }
  if (pick < 0 || pick === r.want) return null
  return { kind: 'turn', dir: pick, at: now }
}
