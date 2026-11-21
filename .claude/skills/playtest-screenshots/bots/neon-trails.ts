// Neon Trails bot: keeps riding while the next two cells are free; otherwise (or now and then) turns
// toward whichever side opens onto the most free room (a capped flood fill), so bots last a while and
// box each other in like players do.
type Dir = 'up' | 'down' | 'left' | 'right'
interface View {
  pts: number[]
  dir: Dir
  alive: boolean
}
interface Snap {
  riders: Record<string, View>
  cols: number
  rows: number
}

const DELTA: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}
const SIDES: Record<Dir, Dir[]> = {
  up: ['left', 'right'],
  down: ['left', 'right'],
  left: ['up', 'down'],
  right: ['up', 'down'],
}

function cellsOf(pts: number[], cols: number): number[] {
  const out: number[] = pts.length ? [pts[0] as number] : []
  for (let i = 1; i < pts.length; i++) {
    const from = pts[i - 1] as number
    const to = pts[i] as number
    const sx = Math.sign((to % cols) - (from % cols))
    const sy = Math.sign(Math.floor(to / cols) - Math.floor(from / cols))
    for (let c = from; c !== to; ) {
      c += sy * cols + sx
      out.push(c)
    }
  }
  return out
}

export default function play(snapshot: unknown, me: string): unknown {
  const s = snapshot as Snap
  const mine = s?.riders?.[me]
  if (!mine?.alive) return null
  const { cols, rows } = s
  const taken = new Set<number>()
  for (const r of Object.values(s.riders))
    if (r.alive) for (const c of cellsOf(r.pts, cols)) taken.add(c)
  const head = mine.pts[mine.pts.length - 1] as number
  const free = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < cols && y < rows && !taken.has(y * cols + x)
  const room = (dir: Dir): number => {
    const [dx, dy] = DELTA[dir]
    const sx = (head % cols) + dx
    const sy = Math.floor(head / cols) + dy
    if (!free(sx, sy)) return -1
    const seen = new Set([sy * cols + sx])
    const queue = [[sx, sy]]
    while (queue.length && seen.size < 160) {
      const [x, y] = queue.shift() as [number, number]
      for (const [ddx, ddy] of Object.values(DELTA)) {
        const nx = x + ddx
        const ny = y + ddy
        const k = ny * cols + nx
        if (free(nx, ny) && !seen.has(k)) {
          seen.add(k)
          queue.push([nx, ny])
        }
      }
    }
    return seen.size
  }
  const [dx, dy] = DELTA[mine.dir]
  const hx = head % cols
  const hy = Math.floor(head / cols)
  const clear = free(hx + dx, hy + dy) && free(hx + 2 * dx, hy + 2 * dy)
  if (clear && Math.random() > 0.04) return null
  const [a, b] = SIDES[mine.dir] as [Dir, Dir]
  const ra = room(a)
  const rb = room(b)
  const ahead = clear ? room(mine.dir) : -1
  const best = ra >= rb ? a : b
  if (Math.max(ra, rb) <= ahead) return null
  return { kind: 'turn', dir: best }
}
