// Snake Arena bot: heads for its apple and keeps a few cells of room ahead (it plays on a late
// snapshot, so it still traps itself now and then — like a person).
type Snake = { body: number[]; alive: boolean; dir: Dir; waiting: boolean; turns: [Dir, number][] }
type Snap = { snakes: Record<string, Snake>; food: Record<string, number>; grid: number }
type Dir = 'up' | 'down' | 'left' | 'right'

const STEP: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}
const BACK: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }

export default function play(s: Snap, me: string): unknown {
  const snake = s.snakes[me]
  if (!snake?.alive || snake.turns.length) return null
  const g = s.grid
  const head = snake.body[0] ?? 0
  const [hx, hy] = [head % g, Math.floor(head / g)]
  const food = s.food[me] ?? 0
  const [fx, fy] = [food % g, Math.floor(food / g)]
  // Free cells straight ahead in `d` (up to 4): the bot sees the board a step or two late, so it
  // wants room to spare.
  const run = (d: Dir): number => {
    const [dx, dy] = STEP[d]
    let n = 0
    for (let k = 1; k <= 4; k++) {
      const x = hx + dx * k
      const y = hy + dy * k
      if (x < 0 || y < 0 || x >= g || y >= g || snake.body.slice(0, -1).includes(y * g + x)) break
      n++
    }
    return n
  }
  const dist = (d: Dir): number => {
    const [dx, dy] = STEP[d]
    return Math.abs(hx + dx - fx) + Math.abs(hy + dy - fy)
  }
  const value = (d: Dir): number => (run(d) >= 3 ? 0 : 100 - run(d) * 10) + dist(d)
  const options = (Object.keys(STEP) as Dir[])
    .filter((d) => (snake.waiting ? true : d !== BACK[snake.dir]) && run(d) > 0)
    .sort((a, b) => value(a) - value(b))
  const pick = options[0]
  if (!pick || (pick === snake.dir && !snake.waiting)) return null
  return { kind: 'turn', dir: pick }
}
