import { describe, expect, test } from 'bun:test'
import {
  TRAILS,
  type TrailDir,
  trailArena,
  trailCells,
  trailHead,
  trailStepsAt,
  trailStepTime,
} from '@pp/shared'
import type { Random } from '../ports/Random'
import { NeonTrails, type NeonTrailsState } from './neonTrails'

const seq: Random = (() => {
  let i = 0
  return { next: () => ((i++ * 0.37) % 1) as number }
})()
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const init = (players: string[], durationMs = 60_000) =>
  new NeonTrails().init({ players, seed: 1, random: seq, now: 0, config: { durationMs } })

// Clears the arena and puts riders exactly where a test wants them (seat = order given).
function setup(
  s: NeonTrailsState,
  spots: Record<string, { x: number; y: number; dir: TrailDir }>,
): void {
  s.grid.fill(0)
  Object.entries(spots).forEach(([id, { x, y, dir }]) => {
    const r = nn(s.riders.get(id))
    const cell = y * s.cols + x
    r.pts = [cell, cell]
    r.dir = dir
    r.turns = []
    r.alive = true
    r.outAt = 0
    s.grid[cell] = r.seat
  })
}
// Runs the round up to (and including) step k.
const toStep = (game: NeonTrails, s: NeonTrailsState, k: number) =>
  game.tick(s, 0, trailStepTime(k))
const headXY = (s: NeonTrailsState, id: string) => {
  const h = trailHead(nn(s.riders.get(id)))
  return { x: h % s.cols, y: Math.floor(h / s.cols) }
}

describe('Neon Trails pace (shared)', () => {
  test('holds still through the start delay, then one step per stepMs', () => {
    expect(trailStepsAt(0)).toBe(0)
    expect(trailStepsAt(TRAILS.startDelayMs - 1)).toBe(0)
    expect(trailStepsAt(TRAILS.startDelayMs + TRAILS.stepMs[0] - 1)).toBe(0)
    expect(trailStepsAt(TRAILS.startDelayMs + TRAILS.stepMs[0])).toBe(1)
  })

  test('trailStepTime is the exact inverse of trailStepsAt', () => {
    for (let k = 1; k <= 700; k++) {
      expect(trailStepsAt(trailStepTime(k))).toBe(k)
      expect(trailStepsAt(trailStepTime(k) - 1)).toBe(k - 1)
    }
  })

  test('the ramp accelerates: always faster, and faster still in the second half (D40)', () => {
    const speeds = TRAILS.stepMs.map((ms) => 1000 / ms)
    for (let i = 1; i < speeds.length; i++)
      expect(speeds[i] as number).toBeGreaterThan(speeds[i - 1] as number)
    const mid = Math.floor(speeds.length / 2)
    const firstHalf = (speeds[mid] as number) - (speeds[0] as number)
    const secondHalf = (speeds.at(-1) as number) - (speeds[mid] as number)
    expect(secondHalf).toBeGreaterThan(firstHalf)
    // Top speed is more than twice the start, reached about 35 s in.
    expect(speeds.at(-1) as number).toBeGreaterThan(2 * (speeds[0] as number))
    const topAt = trailStepTime(TRAILS.levelSteps * (TRAILS.stepMs.length - 1) + 1)
    expect(topAt).toBeGreaterThan(30_000)
    expect(topAt).toBeLessThan(40_000)
  })

  test('trailCells walks a polyline cell by cell', () => {
    const cols = 10
    // (1,1) → (4,1) → (4,3)
    expect(trailCells([11, 14, 34], cols)).toEqual([11, 12, 13, 14, 24, 34])
    expect(trailCells([5, 5], cols)).toEqual([5])
  })
})

describe('NeonTrails', () => {
  test('seats every rider on its own row, on both flanks, facing in', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`)
    const s = init(ids)
    const { cols, rows } = trailArena(12)
    expect([s.cols, s.rows]).toEqual([cols, rows])
    const ys = new Set<number>()
    for (const id of ids) {
      const r = nn(s.riders.get(id))
      const { x, y } = headXY(s, id)
      ys.add(y)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThan(rows)
      expect(r.dir).toBe(x < cols / 2 ? 'right' : 'left')
      expect(s.grid[y * cols + x]).toBe(r.seat)
    }
    expect(ys.size).toBe(12)
  })

  test('riders ride one cell per step and leave a solid trail', () => {
    const game = new NeonTrails()
    const s = init(['a', 'b'])
    setup(s, { a: { x: 2, y: 2, dir: 'right' }, b: { x: 2, y: 10, dir: 'right' } })
    toStep(game, s, 5)
    expect(s.stepsTaken).toBe(5)
    expect(headXY(s, 'a')).toEqual({ x: 7, y: 2 })
    for (let x = 2; x <= 7; x++) expect(s.grid[2 * s.cols + x]).toBe(nn(s.riders.get('a')).seat)
  })

  test('a turn applies on the step it names; a reversal or a third queued turn is refused', () => {
    const game = new NeonTrails()
    const s = init(['a', 'b'])
    setup(s, { a: { x: 5, y: 5, dir: 'right' }, b: { x: 5, y: 15, dir: 'right' } })
    game.onInput(s, 'a', { kind: 'turn', dir: 'left', at: 1 }, 0)
    expect(nn(s.riders.get('a')).turns).toEqual([])
    game.onInput(s, 'a', { kind: 'turn', dir: 'down', at: 3 }, 0)
    game.onInput(s, 'a', { kind: 'turn', dir: 'right', at: 4 }, 0)
    game.onInput(s, 'a', { kind: 'turn', dir: 'up', at: 5 }, 0)
    expect(nn(s.riders.get('a')).turns.length).toBe(TRAILS.turnQueue)
    toStep(game, s, 4)
    // right ×2 → (7,5), down on step 3 → (7,6), right on step 4 → (8,6)
    expect(headXY(s, 'a')).toEqual({ x: 8, y: 6 })
    expect(nn(s.riders.get('a')).pts.length).toBe(4)
  })

  test('a turn that arrives late turns on the next step instead', () => {
    const game = new NeonTrails()
    const s = init(['a', 'b'])
    setup(s, { a: { x: 5, y: 5, dir: 'right' }, b: { x: 5, y: 15, dir: 'right' } })
    toStep(game, s, 3)
    game.onInput(s, 'a', { kind: 'turn', dir: 'down', at: 2, seq: 7 }, 0)
    expect(nn(s.riders.get('a')).turns).toEqual([{ dir: 'down', at: 4 }])
    expect(nn(s.riders.get('a')).ack).toBe(7)
  })

  test('riding off the arena knocks you out and clears your trail', () => {
    const game = new NeonTrails()
    const s = init(['a', 'b', 'c'])
    setup(s, {
      a: { x: s.cols - 2, y: 3, dir: 'right' },
      b: { x: 2, y: 9, dir: 'right' },
      c: { x: 2, y: 15, dir: 'right' },
    })
    toStep(game, s, 2)
    const a = nn(s.riders.get('a'))
    expect(a.alive).toBe(false)
    expect(a.outAt).toBe(2)
    expect(s.grid.some((v) => v === a.seat)).toBe(false)
  })

  test("riding into a rival's trail knocks you out; the rival's wall stays", () => {
    const game = new NeonTrails()
    const s = init(['a', 'b', 'c'])
    // b crosses row 5 first; a comes down column 8 and hits b's trail.
    setup(s, {
      a: { x: 8, y: 1, dir: 'down' },
      b: { x: 5, y: 5, dir: 'right' },
      c: { x: 3, y: 20, dir: 'right' },
    })
    toStep(game, s, 6)
    expect(nn(s.riders.get('a')).alive).toBe(false)
    expect(nn(s.riders.get('a')).outAt).toBe(4)
    expect(nn(s.riders.get('b')).alive).toBe(true)
    expect(s.grid[5 * s.cols + 8]).toBe(nn(s.riders.get('b')).seat)
  })

  test('two riders entering the same cell both crash, and tie', () => {
    const game = new NeonTrails()
    const s = init(['a', 'b', 'c'])
    setup(s, {
      a: { x: 4, y: 6, dir: 'right' },
      b: { x: 8, y: 6, dir: 'left' },
      c: { x: 4, y: 20, dir: 'right' },
    })
    toStep(game, s, 2)
    expect(nn(s.riders.get('a')).alive).toBe(false)
    expect(nn(s.riders.get('b')).alive).toBe(false)
    const res = game.getResult(s)
    expect(res.placements[0]).toBe('c')
    expect(nn(res.ranks).a).toBe(1)
    expect(nn(res.ranks).b).toBe(1)
    expect(nn(res.stats).c).toBe('survivor')
    expect(nn(res.stats).a).toBe('2 steps')
  })

  test('the round ends with one rider left; the rest rank by how long they lasted', () => {
    const game = new NeonTrails()
    const s = init(['a', 'b', 'c'])
    setup(s, {
      a: { x: s.cols - 2, y: 3, dir: 'right' },
      b: { x: s.cols - 6, y: 9, dir: 'right' },
      c: { x: 2, y: 15, dir: 'right' },
    })
    toStep(game, s, 10)
    expect(game.isFinished(s, trailStepTime(10))).toBe(true)
    // Settled: no step runs past the deciding one.
    expect(s.stepsTaken).toBe(6)
    const res = game.getResult(s)
    expect(res.placements).toEqual(['c', 'b', 'a'])
    expect(res.ranks).toEqual({ c: 0, b: 1, a: 2 })
  })

  test('alone in the arena you ride until you crash or time runs out', () => {
    const game = new NeonTrails()
    const s = init(['solo'], 20_000)
    expect(game.isFinished(s, 1000)).toBe(false)
    setup(s, { solo: { x: 3, y: 3, dir: 'up' } })
    toStep(game, s, 5)
    expect(game.isFinished(s, trailStepTime(5))).toBe(true)
    expect(game.isFinished(init(['x'], 20_000), 20_000)).toBe(true)
  })

  test('a player who leaves is out on the spot', () => {
    const game = new NeonTrails()
    const s = init(['a', 'b'])
    toStep(game, s, 3)
    game.leave(s, 'b', trailStepTime(3))
    const b = nn(s.riders.get('b'))
    expect(b.alive).toBe(false)
    expect(s.grid.some((v) => v === b.seat)).toBe(false)
    expect(game.isFinished(s, trailStepTime(3))).toBe(true)
    expect(game.getResult(s).placements[0]).toBe('a')
  })

  test('the snapshot carries vertices, not every cell, and the live standings', () => {
    const game = new NeonTrails()
    const s = init(['a', 'b'])
    setup(s, { a: { x: 2, y: 2, dir: 'right' }, b: { x: 2, y: 22, dir: 'right' } })
    toStep(game, s, 9)
    game.onInput(s, 'a', { kind: 'turn', dir: 'down', at: 10 }, 0)
    toStep(game, s, 20)
    const snap = game.snapshot(s, trailStepTime(20))
    const a = nn(snap.riders.a)
    expect(a.pts.length).toBe(3)
    expect(trailCells(a.pts, snap.cols).length).toBe(21)
    expect(snap.step).toBe(20)
    expect(snap.progress).toEqual({ a: 20, b: 20 })
    expect(JSON.stringify(snap).length).toBeLessThan(600)
  })
})
