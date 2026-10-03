// Maze Sprint bot: walks the shortest path to the exit, one step per call (150 ms), so the rivals'
// progress bars fill up at a human-ish pace.
type Snap = { size: number; walls: number[]; exitIndex: number; pos: Record<string, number> }
type Dir = 'up' | 'right' | 'down' | 'left'

const STEPS: [Dir, number, number][] = [
  ['up', 1, -1],
  ['right', 2, 1],
  ['down', 4, 1],
  ['left', 8, -1],
]

export default function play(s: Snap, me: string): unknown {
  const from = s.pos[me]
  if (from === undefined || from === s.exitIndex) return null
  // BFS back from the exit; then step to the neighbour one closer to it.
  const dist = new Array<number>(s.size * s.size).fill(-1)
  dist[s.exitIndex] = 0
  const queue = [s.exitIndex]
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head] as number
    for (const [dir, bit] of STEPS) {
      const next = neighbour(s, cur, dir, bit)
      if (next !== null && dist[next] === -1) {
        dist[next] = (dist[cur] as number) + 1
        queue.push(next)
      }
    }
  }
  const step = STEPS.find(([dir, bit]) => {
    const next = neighbour(s, from, dir, bit)
    return next !== null && dist[next] === (dist[from] as number) - 1
  })
  return step ? { kind: 'move', dir: step[0] } : null
}

function neighbour(s: Snap, cell: number, dir: Dir, bit: number): number | null {
  if ((s.walls[cell] ?? 15) & bit) return null
  const col = (cell % s.size) + (dir === 'right' ? 1 : dir === 'left' ? -1 : 0)
  const row = Math.floor(cell / s.size) + (dir === 'down' ? 1 : dir === 'up' ? -1 : 0)
  if (col < 0 || row < 0 || col >= s.size || row >= s.size) return null
  return row * s.size + col
}
