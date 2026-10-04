// Bubble Pop bot: tries every column with the shared shot rules (needs PP_REPO) and fires where the
// next bubble pops the most, else where it sticks highest; one shot per call, like a quick human.
type Board = { grid: string; shot: number; done: boolean; jammed: boolean }
type Snap = { queue: string; boards: Record<string, Board> }
type Shared = {
  BUBBLE: { cols: number }
  bubbleNextShot: (
    board: readonly number[],
    colorAt: (i: number) => number,
    from: number,
    len: number,
  ) => { index: number; color: number }
  bubbleShoot: (
    board: number[],
    col: number,
    color: number,
  ) => { row: number; popped: number[]; dropped: number[] }
}

const repo = process.env.PP_REPO
const shared: Shared | null = repo ? await import(`${repo}/packages/shared/src/index.ts`) : null

export default function play(s: Snap, me: string): unknown {
  const b = s.boards[me]
  if (!shared || !b || b.done || b.jammed) return null
  const grid = Array.from(b.grid, Number)
  const colorAt = (i: number): number => Number(s.queue[i % s.queue.length])
  const { color } = shared.bubbleNextShot(grid, colorAt, b.shot, s.queue.length)
  let best = { col: Math.floor(shared.BUBBLE.cols / 2), value: Number.NEGATIVE_INFINITY }
  for (let col = 0; col < shared.BUBBLE.cols; col++) {
    const shot = shared.bubbleShoot([...grid], col, color)
    if (shot.row === -1) continue
    const value = (shot.popped.length + shot.dropped.length) * 10 - shot.row
    if (value > best.value) best = { col, value }
  }
  return { kind: 'shoot', col: best.col }
}
