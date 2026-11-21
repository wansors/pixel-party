import { describe, expect, test } from 'bun:test'
import {
  MAZE,
  MAZE_DIRS,
  MAZE_LAYOUT,
  type MazeWorld,
  mazeNewWorld,
  mazeOpen,
  mazePigeonCount,
  mazePigeonSpeed,
  mazeRun,
  mazeSeedRegrow,
  mazeStep,
} from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { MunchMaze, type MunchMazeState } from './munchMaze'

const game = new MunchMaze()
const init = (players: string[]): MunchMazeState =>
  game.init({
    players,
    seed: 1,
    random: new SeededRandom(1),
    now: 0,
    config: { durationMs: 60_000 },
  })
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const GO = MAZE.startDelayMs
const U = MAZE.unit
// A world with every pigeon roosting for good (tests bring one out on purpose).
function quiet(players: number): MazeWorld {
  const w = mazeNewWorld(players, GO)
  for (const p of w.pigeons) p.homeUntil = 1e9
  return w
}
const place = (e: { x: number; y: number }, cx: number, cy: number) => {
  e.x = cx * U
  e.y = cy * U
}
const cell = (e: { x: number; y: number }) => [e.x / U, e.y / U]

describe('Munch Maze rules (shared)', () => {
  test('the maze: symmetric, connected, no dead ends, a tunnel on the middle row', () => {
    expect(MAZE_LAYOUT).toHaveLength(MAZE.h)
    const open: [number, number][] = []
    for (let y = 0; y < MAZE.h; y++) {
      const row = nn(MAZE_LAYOUT[y])
      expect(row).toHaveLength(MAZE.w)
      expect(row).toBe([...row].reverse().join(''))
      for (let x = 0; x < MAZE.w; x++) if (row[x] !== '#') open.push([x, y])
    }
    const exits = (x: number, y: number) =>
      MAZE_DIRS.filter(([dx, dy]) => mazeOpen(x + dx, y + dy)).map(([dx, dy]) => [
        (x + dx + MAZE.w) % MAZE.w,
        y + dy,
      ])
    for (const [x, y] of open) expect(exits(x, y).length).toBeGreaterThanOrEqual(2)
    const seen = new Set(['1,1'])
    const stack = [[1, 1]]
    while (stack.length) {
      const [x, y] = nn(stack.pop())
      for (const [nx, ny] of exits(nn(x), nn(y)))
        if (!seen.has(`${nx},${ny}`)) {
          seen.add(`${nx},${ny}`)
          stack.push([nn(nx), nn(ny)])
        }
    }
    expect(seen.size).toBe(open.length)
    for (const [sx, sy] of MAZE.spawns) expect(mazeOpen(sx, sy)).toBe(true)
  })

  test('more pigeons join, faster, as the round goes on (D40); seeds grow back faster in a crowd', () => {
    expect(mazePigeonCount(GO, 2)).toBe(2)
    expect(mazePigeonCount(GO, 12)).toBe(5)
    expect(mazePigeonCount(30_000, 4)).toBe(4)
    expect(mazePigeonCount(50_000, 12)).toBe(MAZE.maxPigeons)
    expect(mazePigeonSpeed(GO)).toBe(MAZE.pigeonSpeed[0])
    expect(mazePigeonSpeed(GO + 40_000) - mazePigeonSpeed(GO + 30_000)).toBeGreaterThan(
      mazePigeonSpeed(GO + 20_000) - mazePigeonSpeed(GO + 10_000),
    )
    expect(mazePigeonSpeed(GO + 99_000)).toBe(MAZE.pigeonSpeed[1])
    expect(mazeSeedRegrow(12)).toBeLessThan(mazeSeedRegrow(2))
  })

  test('a runner goes its way at 5.5 cells a second and stops at a hedge', () => {
    const w = quiet(1)
    const r = nn(w.runners[0])
    place(r, 1, 3)
    mazeRun(w, GO + 1000, [[{ at: GO, dir: 1 }]])
    expect(r.dir).toBe(1)
    expect(r.x).toBe(1 * U + 55)
    mazeRun(w, GO + 4000, [[]])
    // Row 3 runs to column 17; the hedge stops it there.
    expect(cell(r)).toEqual([17, 3])
    expect(r.dir).toBe(-1)
  })

  test('a turn pressed early is taken at the next opening; turning back works anywhere', () => {
    const w = quiet(1)
    const r = nn(w.runners[0])
    place(r, 1, 3)
    // Going right, ask for down: row 4 opens below column 4.
    mazeRun(w, GO + 300, [[{ at: GO, dir: 1 }]])
    mazeRun(w, GO + 1200, [[{ at: GO + 300, dir: 2 }]])
    expect(r.x).toBe(4 * U)
    expect(r.dir).toBe(2)
    const back = quiet(1)
    const b = nn(back.runners[0])
    place(b, 1, 3)
    mazeRun(back, GO + 250, [[{ at: GO, dir: 1 }]])
    const mid = b.x
    expect(mid % U).not.toBe(0)
    mazeStep(back, [3])
    expect(b.dir).toBe(3)
    expect(b.x).toBeLessThan(mid + 1)
  })

  test('the middle row wraps around', () => {
    const w = quiet(1)
    const r = nn(w.runners[0])
    place(r, 1, MAZE.tunnelRow)
    mazeRun(w, GO + 800, [[{ at: GO, dir: 3 }]])
    expect(r.x).toBeGreaterThan(15 * U)
    expect(r.y).toBe(MAZE.tunnelRow * U)
  })

  test('seeds score and grow back; a chilli makes you spicy and scores nothing', () => {
    const w = quiet(2)
    const r = nn(w.runners[0])
    place(r, 1, 3)
    mazeRun(w, GO + 400, [[{ at: GO, dir: 1 }], []])
    expect(r.score).toBe(2)
    const spot = 3 * MAZE.w + 2
    expect(w.food[spot]).toBeGreaterThan(w.t)
    mazeRun(w, (w.food[spot] as number) + MAZE.dtMs, [[], []])
    expect(w.food[spot]).toBe(0)
    const c = quiet(1)
    const s = nn(c.runners[0])
    place(s, 1, 3)
    c.food[3 * MAZE.w + 1] = -1
    c.food[2 * MAZE.w + 1] = -1
    // The chillies only show up a few seconds after GO.
    expect(c.food[1 * MAZE.w + 1]).toBe(GO + MAZE.chilliFirstMs)
    c.food[1 * MAZE.w + 1] = 0
    mazeRun(c, GO + 600, [[{ at: GO, dir: 0 }]])
    expect(cell(s)).toEqual([1, 1])
    expect(s.spicyUntil).toBeGreaterThan(c.t)
    expect(s.score).toBe(0)
  })

  test('a pigeon pecks: −3, dazed, then back to the start and safe for a moment', () => {
    const w = quiet(1)
    const r = nn(w.runners[0])
    r.score = 10
    place(r, 5, 3)
    const p = nn(w.pigeons[0])
    p.homeUntil = 0
    place(p, 6, 3)
    p.dir = 3
    mazeStep(w, [-1])
    mazeRun(w, w.t + 100, [[]])
    expect(r.pecks).toBe(1)
    expect(r.score).toBe(10 - MAZE.peckCost)
    expect(r.downUntil).toBeGreaterThan(w.t)
    mazeRun(w, r.downUntil + MAZE.dtMs, [[]])
    expect(cell(r)).toEqual([...nn(MAZE.spawns[0])])
    expect(r.safeUntil).toBeGreaterThan(w.t)
  })

  test('spicy, you shoo the pigeon (+5) and tackle a rival for up to 5 seeds', () => {
    const w = quiet(2)
    const [a, b] = [nn(w.runners[0]), nn(w.runners[1])]
    a.spicyUntil = 1e9
    place(a, 5, 3)
    const p = nn(w.pigeons[0])
    p.homeUntil = 0
    place(p, 5, 3)
    place(b, 15, 3)
    mazeStep(w, [-1, -1])
    expect(a.shoos).toBe(1)
    expect(a.score).toBe(MAZE.pigeonPoints)
    expect(p.homeUntil).toBeGreaterThan(w.t)
    expect(cell(p)).toEqual([...MAZE.nest])
    b.score = 3
    place(b, 5, 3)
    mazeStep(w, [-1, -1])
    expect(a.tackles).toBe(1)
    expect(b.tackled).toBe(1)
    expect(b.score).toBe(0)
    expect(a.score).toBe(MAZE.pigeonPoints + 3)
    expect(b.downUntil).toBeGreaterThan(w.t)
  })

  test('a runner just back at the start can’t be tackled', () => {
    const w = quiet(2)
    const [a, b] = [nn(w.runners[0]), nn(w.runners[1])]
    a.spicyUntil = 1e9
    b.score = 9
    b.safeUntil = 1e9
    place(a, 5, 3)
    place(b, 5, 3)
    mazeStep(w, [-1, -1])
    expect(b.score).toBe(9)
  })
})

describe('MunchMaze', () => {
  test('turns before GO are ignored; after it they count when pressed, clamped to now', () => {
    const s = init(['a', 'b'])
    game.onInput(s, 'a', { kind: 'turn', dir: 1, seq: 4 }, 700)
    expect(s.turns[0]).toEqual([])
    expect(s.acks[0]).toBe(4)
    game.onInput(s, 'a', { kind: 'turn', dir: 1, at: GO + 30 }, GO + 50)
    game.onInput(s, 'a', { kind: 'turn', dir: 2, at: GO + 99_000 }, GO + 200)
    expect(s.turns[0]).toEqual([
      { at: GO + 30, dir: 1 },
      { at: GO + 200, dir: 2 },
    ])
  })

  test('mashing and junk are dropped', () => {
    const s = init(['a'])
    game.onInput(s, 'a', { kind: 'turn', dir: 1, at: GO + 100 }, GO + 100)
    game.onInput(s, 'a', { kind: 'turn', dir: 2, at: GO + 110 }, GO + 110)
    game.onInput(s, 'a', { kind: 'turn', dir: 4 }, GO + 300)
    game.onInput(s, 'a', { kind: 'turn', dir: -1 }, GO + 300)
    expect(s.turns[0]).toHaveLength(1)
  })

  test('the server runs the world on everyone’s turns, behind real time', () => {
    const s = init(['a', 'b'])
    game.onInput(s, 'a', { kind: 'turn', dir: 1, at: GO }, GO + 10)
    game.tick(s, 0, GO + 1000)
    expect(s.world.t).toBe(GO + 1000 - MAZE.judgeMs)
    const [sx] = nn(MAZE.spawns[0])
    expect(nn(s.world.runners[0]).x).toBeGreaterThan(sx * U)
    expect(nn(s.world.runners[1]).dir).toBe(-1)
    expect(s.turns[0]).toEqual([])
  })

  test('the round runs to the bell; score ranks, fewer pecks and tackles taken break ties', () => {
    const s = init(['a', 'b', 'c'])
    Object.assign(nn(s.world.runners[0]), { score: 40, pecks: 3 })
    Object.assign(nn(s.world.runners[1]), { score: 52, pecks: 9 })
    Object.assign(nn(s.world.runners[2]), { score: 40, pecks: 1, tackled: 1 })
    expect(game.isFinished(s, 59_000)).toBe(false)
    expect(game.isFinished(s, 60_000)).toBe(true)
    const res = game.getResult(s)
    expect(res.placements).toEqual(['b', 'c', 'a'])
    expect(res.stats).toEqual({ a: '40 pts', b: '52 pts', c: '40 pts' })
  })

  test('the snapshot carries a copy of the world, the turns, the acks and the clock', () => {
    const s = init(['a', 'b'])
    game.onInput(s, 'b', { kind: 'turn', dir: 3, at: GO + 40, seq: 7 }, GO + 50)
    const snap = game.snapshot(s, GO + 50)
    expect(snap.ids).toEqual(['a', 'b'])
    expect(snap.turns).toEqual([[], [{ at: GO + 40, dir: 3 }]])
    expect(snap.acks).toEqual({ a: 0, b: 7 })
    expect(snap.t).toBe(GO + 50)
    mazeRun(snap.world, GO + 3000, snap.turns)
    expect(s.world.t).toBe(GO)
  })

  test('everyone leaving ends the round early', () => {
    const s = init(['a', 'b'])
    game.leave(s, 'a', 1000)
    expect(game.isFinished(s, 1000)).toBe(false)
    game.leave(s, 'b', 1000)
    expect(game.isFinished(s, 1000)).toBe(true)
  })
})
