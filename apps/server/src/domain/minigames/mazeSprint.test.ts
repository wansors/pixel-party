import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { MazeSprint } from './mazeSprint'

const SIZE = 9
const CELLS = SIZE * SIZE
const EXIT_INDEX = CELLS - 1

const half: Random = { next: () => 0.5 }
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const init = (players: string[], random: Random = half, now = 0) =>
  new MazeSprint().init({ players, seed: 1, random, now, config: { durationMs: 45_000 } })

// A cycling sequence of draws so the seeded carve doesn't take the same branch every time.
const cycling = (values: number[]): Random => {
  let i = 0
  return { next: () => values[i++ % values.length] as number }
}

// Mirrors the domain's own wall-bit adjacency so the test can check connectivity and find a path
// independently of the implementation under test.
function neighborsOf(
  walls: number[],
  cell: number,
): { dir: 'up' | 'right' | 'down' | 'left'; cell: number }[] {
  const row = Math.floor(cell / SIZE)
  const col = cell % SIZE
  const mask = walls[cell] as number
  const out: { dir: 'up' | 'right' | 'down' | 'left'; cell: number }[] = []
  if (!(mask & 1) && row > 0) out.push({ dir: 'up', cell: cell - SIZE })
  if (!(mask & 2) && col < SIZE - 1) out.push({ dir: 'right', cell: cell + 1 })
  if (!(mask & 4) && row < SIZE - 1) out.push({ dir: 'down', cell: cell + SIZE })
  if (!(mask & 8) && col > 0) out.push({ dir: 'left', cell: cell - 1 })
  return out
}

function reachable(walls: number[], from: number, to: number): boolean {
  const visited = new Array<boolean>(CELLS).fill(false)
  visited[from] = true
  const queue = [from]
  let head = 0
  while (head < queue.length) {
    const cur = queue[head++] as number
    if (cur === to) return true
    for (const { cell } of neighborsOf(walls, cur)) {
      if (!visited[cell]) {
        visited[cell] = true
        queue.push(cell)
      }
    }
  }
  return false
}

function findPath(walls: number[], from: number, to: number): ('up' | 'right' | 'down' | 'left')[] {
  const prevCell = new Array<number>(CELLS).fill(-1)
  const prevDir = new Array<'up' | 'right' | 'down' | 'left' | ''>(CELLS).fill('')
  const visited = new Array<boolean>(CELLS).fill(false)
  visited[from] = true
  const queue = [from]
  let head = 0
  while (head < queue.length) {
    const cur = queue[head++] as number
    if (cur === to) break
    for (const { dir, cell } of neighborsOf(walls, cur)) {
      if (!visited[cell]) {
        visited[cell] = true
        prevCell[cell] = cur
        prevDir[cell] = dir
        queue.push(cell)
      }
    }
  }
  const path: ('up' | 'right' | 'down' | 'left')[] = []
  let cur = to
  while (cur !== from) {
    const dir = prevDir[cur]
    if (!dir) throw new Error('unreachable in test fixture')
    path.unshift(dir)
    cur = prevCell[cur] as number
  }
  return path
}

describe('MazeSprint', () => {
  test('the generated maze is fully connected: the exit is reachable from the entrance', () => {
    const s = init(['p'])
    expect(reachable(s.walls, 0, s.exitIndex)).toBe(true)
  })

  test('the maze stays fully connected across varied random draws too', () => {
    const seeds = [
      cycling([0.1, 0.9, 0.3, 0.7, 0.05, 0.99, 0.4, 0.6, 0.2, 0.8]),
      cycling([0.99, 0.01, 0.5, 0.25, 0.75, 0.33, 0.66, 0.12, 0.88]),
    ]
    for (const random of seeds) {
      const s = init(['p'], random)
      expect(reachable(s.walls, 0, s.exitIndex)).toBe(true)
    }
  })

  test('cell 0 is always boundary-walled to the north and west', () => {
    // Cell 0 (top-left) has no north/west neighbor, so the carve can never clear those bits.
    const s = init(['p'])
    expect((s.walls[0] as number) & 1).toBeGreaterThan(0)
    expect((s.walls[0] as number) & 8).toBeGreaterThan(0)
  })

  test('a move into a boundary wall is a no-op', () => {
    const game = new MazeSprint()
    let s = init(['p'])
    s = game.onInput(s, 'p', { kind: 'move', dir: 'up' }, 1)
    expect(nn(s.pos.get('p'))).toBe(0)
    expect(nn(s.steps.get('p'))).toBe(0)
    s = game.onInput(s, 'p', { kind: 'move', dir: 'left' }, 1)
    expect(nn(s.pos.get('p'))).toBe(0)
    expect(nn(s.steps.get('p'))).toBe(0)
  })

  test('a valid move updates position and increments steps', () => {
    const game = new MazeSprint()
    let s = init(['p'])
    const [firstStep] = findPath(s.walls, 0, s.exitIndex)
    s = game.onInput(s, 'p', { kind: 'move', dir: nn(firstStep) }, 1)
    expect(nn(s.pos.get('p'))).not.toBe(0)
    expect(nn(s.steps.get('p'))).toBe(1)
  })

  test('reaching the exit sets doneAt and further moves are then no-ops', () => {
    const game = new MazeSprint()
    let s = init(['p'])
    const path = findPath(s.walls, 0, s.exitIndex)
    let now = 1
    for (const dir of path) {
      s = game.onInput(s, 'p', { kind: 'move', dir }, now)
      now += 1
    }
    expect(s.pos.get('p')).toBe(EXIT_INDEX)
    expect(nn(s.doneAt.get('p'))).toBeGreaterThan(0)
    const stepsAtFinish = nn(s.steps.get('p'))
    const after = game.onInput(s, 'p', { kind: 'move', dir: 'down' }, now)
    expect(after).toBe(s)
    expect(nn(after.steps.get('p'))).toBe(stepsAtFinish)
  })

  test('getResult ranks a finisher above a non-finisher, and an earlier finisher above a later one', () => {
    const game = new MazeSprint()
    let s = init(['a', 'b', 'c'])
    const path = findPath(s.walls, 0, s.exitIndex)
    let now = 1
    for (const dir of path) {
      s = game.onInput(s, 'a', { kind: 'move', dir }, now)
      now += 1
    }
    now = 100_000
    for (const dir of path) {
      s = game.onInput(s, 'b', { kind: 'move', dir }, now)
      now += 1
    }
    // 'c' never moves.
    const result = game.getResult(s)
    expect(result.placements[0]).toBe('a')
    expect(result.placements[1]).toBe('b')
    expect(result.placements[2]).toBe('c')
  })

  test('isFinished is false before the deadline until everyone finishes', () => {
    const game = new MazeSprint()
    let s = init(['a', 'b'])
    expect(game.isFinished(s, 1)).toBe(false)
    const path = findPath(s.walls, 0, s.exitIndex)
    let now = 1
    for (const dir of path) {
      s = game.onInput(s, 'a', { kind: 'move', dir }, now)
      now += 1
    }
    expect(game.isFinished(s, now)).toBe(false)
    for (const dir of path) {
      s = game.onInput(s, 'b', { kind: 'move', dir }, now)
      now += 1
    }
    expect(game.isFinished(s, now)).toBe(true)
  })

  test('isFinished becomes true at the deadline even if nobody has finished', () => {
    const game = new MazeSprint()
    const s = init(['a', 'b'])
    expect(game.isFinished(s, s.endsAt - 1)).toBe(false)
    expect(game.isFinished(s, s.endsAt)).toBe(true)
  })

  test('snapshot exposes the shared maze and per-player progress', () => {
    const game = new MazeSprint()
    const s = init(['p'])
    const snap = game.snapshot(s, 0)
    expect(snap.size).toBe(SIZE)
    expect(snap.walls).toEqual(s.walls)
    expect(snap.exitIndex).toBe(EXIT_INDEX)
    expect(snap.pos.p).toBe(0)
    expect(snap.progress.p).toBe(0)
    expect(snap.doneAt.p).toBe(0)
    expect(snap.remainingMs).toBe(45_000)
  })
})
