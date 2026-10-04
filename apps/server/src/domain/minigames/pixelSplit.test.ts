import { describe, expect, test } from 'bun:test'
import {
  PIXEL_OBJECTS,
  type PixelCell,
  type PixelSplitObject,
  columnCounts,
  packCells,
  unpackCells,
} from '@pp/shared'
import type { Random } from '../ports/Random'
import { PixelSplit, splitPoints } from './pixelSplit'

// Deterministic seed; the exact object order doesn't matter — the tests read counts off the puzzle.
const zero: Random = { next: () => 0 }
const cellsOf = (o: PixelSplitObject) => unpackCells(o.cols, o.rows, o.bits)
const init = (players: string[], now = 0, random: Random = zero) =>
  new PixelSplit().init({ players, seed: 1, random, now, config: { durationMs: 40_000 } })

// Small seeded generator (mulberry32) so the variety tests walk many real, reproducible seeds.
function seeded(seed: number): Random {
  let a = seed >>> 0
  return {
    next: () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), a | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

const leftOf = (cols: number[], cut: number) => cols.slice(0, cut).reduce((a, b) => a + b, 0)

// First cut boundary with the smallest |left - right| imbalance.
function bestCut(cols: number[]): { cut: number; error: number } {
  const total = leftOf(cols, cols.length)
  let best = { cut: 1, error: Number.POSITIVE_INFINITY }
  for (let cut = 1; cut < cols.length; cut++) {
    const left = leftOf(cols, cut)
    const error = Math.abs(left - (total - left))
    if (error < best.error) best = { cut, error }
  }
  return best
}

// Shape signature with the object shifted flush left (optionally mirrored), to compare placements.
function signature(cells: readonly PixelCell[], mirror = false): string {
  const xs = cells.map((c) => c.x)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  return cells
    .map((c) => ({ x: mirror ? maxX - c.x : c.x - minX, y: c.y }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((c) => `${c.x},${c.y}`)
    .join(' ')
}

describe('PixelSplit', () => {
  test('the optimal cut scores full points', () => {
    const game = new PixelSplit()
    const s0 = init(['a'])
    const puzzle = s0.puzzles[0]
    if (!puzzle) throw new Error('no puzzle')
    let best = { cut: 1, error: Number.POSITIVE_INFINITY }
    for (let cut = 1; cut < puzzle.object.cols; cut++) {
      const left = leftOf(puzzle.cols, cut)
      const error = Math.abs(left - (puzzle.total - left))
      if (error < best.error) best = { cut, error }
    }
    const s = game.onInput(s0, 'a', { kind: 'cut', index: 0, cut: best.cut }, 100)
    expect(s.score.get('a')).toBe(10)
  })

  test('a lopsided cut scores fewer points than the optimal one', () => {
    const game = new PixelSplit()
    let s = init(['a'])
    const puzzle = s.puzzles[0]
    if (!puzzle) throw new Error('no puzzle')
    s = game.onInput(s, 'a', { kind: 'cut', index: 0, cut: 1 }, 100) // extreme left cut
    const left = leftOf(puzzle.cols, 1)
    const error = Math.abs(left - (puzzle.total - left))
    expect(s.score.get('a')).toBe(splitPoints(error - puzzle.minError, puzzle.total))
    expect(s.score.get('a')).toBeLessThan(10)
  })

  test('partial credit falls off in proportion to the extra imbalance, to 0 at a 3:1 split', () => {
    expect(splitPoints(0, 80)).toBe(10)
    expect(splitPoints(1, 80)).toBe(9)
    expect(splitPoints(20, 80)).toBe(5)
    expect(splitPoints(40, 80)).toBe(0)
    expect(splitPoints(70, 80)).toBe(0)
  })

  test('one column off the best cut still earns partial credit (not ≈ 0 as before)', () => {
    const game = new PixelSplit()
    const scores: number[] = []
    for (let seed = 1; seed <= 40; seed++) {
      let s = init(['a'], 0, seeded(seed))
      s.puzzles.forEach((puzzle, index) => {
        const best = bestCut(puzzle.cols).cut
        const off = best + 1 < puzzle.object.cols ? best + 1 : best - 1
        const before = s.score.get('a') ?? 0
        s = game.onInput(s, 'a', { kind: 'cut', index, cut: off }, 100 + index)
        scores.push((s.score.get('a') ?? 0) - before)
      })
    }
    expect(Math.min(...scores)).toBeGreaterThan(0)
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length
    expect(mean).toBeGreaterThan(4)
    expect(mean).toBeLessThan(8)
  })

  test('a leaver is skipped to the end so the round finishes once the rest are done', () => {
    const game = new PixelSplit()
    let s = init(['a', 'gone'])
    s.puzzles.forEach((_, index) => {
      s = game.onInput(s, 'a', { kind: 'cut', index, cut: 1 }, 100 + index)
    })
    expect(game.isFinished(s, 500)).toBe(false)
    s = game.leave(s, 'gone', 500)
    expect(game.isFinished(s, 500)).toBe(true)
    expect(game.snapshot(s, 500).at.gone).toBeNull()
  })

  test('packed cells round-trip exactly, and each object in play goes on the wire once', () => {
    for (const o of PIXEL_OBJECTS) {
      const bits = packCells(o.cols, o.rows, o.cells)
      expect(bits).toHaveLength(Math.ceil(o.cols / 4) * o.rows)
      expect(signature(unpackCells(o.cols, o.rows, bits))).toBe(signature(o.cells))
    }
    const game = new PixelSplit()
    let s = init(['a', 'b', 'c'], 0, seeded(4))
    s = game.onInput(s, 'b', { kind: 'cut', index: 0, cut: 1 }, 100)
    const snap = game.snapshot(s, 100)
    expect(snap.at).toEqual({ a: 0, b: 1, c: 0 })
    expect(snap.objects.map((o) => o.index)).toEqual([0, 1])
  })

  test('stale index is ignored', () => {
    const game = new PixelSplit()
    let s = init(['a'])
    s = game.onInput(s, 'a', { kind: 'cut', index: 2, cut: 5 }, 100)
    expect(s.pointer.get('a')).toBe(0)
    expect(s.score.get('a')).toBe(0)
  })

  test('seeded placement varies where the ideal cut falls between puzzles and rounds', () => {
    // name -> distinct ideal cut positions (as a fraction of the frame) / orientations seen.
    const cuts = new Map<string, Set<number>>()
    const mirrored = new Map<string, Set<boolean>>()
    for (let seed = 1; seed <= 60; seed++) {
      for (const puzzle of init(['a'], 0, seeded(seed)).puzzles) {
        const { name, cols } = puzzle.object
        const pixels = cellsOf(puzzle.object)
        const src = PIXEL_OBJECTS.find((o) => o.name === name)
        if (!src) throw new Error(`unknown object ${name}`)
        const flipped = signature(pixels) !== signature(src.cells)
        cuts.set(name, (cuts.get(name) ?? new Set()).add(bestCut(puzzle.cols).cut / cols))
        mirrored.set(name, (mirrored.get(name) ?? new Set()).add(flipped))
      }
    }
    expect(cuts.size).toBe(PIXEL_OBJECTS.length)
    // Every object shows up with its ideal cut in several different places on screen…
    expect([...cuts].filter(([, seen]) => seen.size < 3).map(([name]) => name)).toEqual([])
    // …and asymmetric ones in both orientations (a mirrored symmetric shape looks the same).
    const asymmetric = PIXEL_OBJECTS.filter((o) => {
      const flipped = signature(o.cells, true)
      return signature(o.cells) !== flipped
    })
    expect(asymmetric.length).toBeGreaterThan(0)
    for (const { name } of asymmetric)
      expect({ name, seen: mirrored.get(name)?.size }).toEqual({ name, seen: 2 })
    // Two different seeds don't just replay the same layout.
    const layout = (seed: number) =>
      init(['a'], 0, seeded(seed)).puzzles.map((p) => `${p.object.name}@${bestCut(p.cols).cut}`)
    expect(layout(7)).not.toEqual(layout(8))
  })

  test('scoring after the transform matches the placed grid exactly', () => {
    const game = new PixelSplit()
    for (let seed = 1; seed <= 25; seed++) {
      let s = init(['a'], 0, seeded(seed))
      let expected = 0
      s.puzzles.forEach((puzzle, index) => {
        const { name, cols, rows } = puzzle.object
        const pixels = cellsOf(puzzle.object)
        const src = PIXEL_OBJECTS.find((o) => o.name === name)
        if (!src) throw new Error(`unknown object ${name}`)
        // Same pixels, same shape (possibly mirrored), all inside the frame.
        expect(pixels.length).toBe(src.count)
        expect(puzzle.total).toBe(src.count)
        expect([signature(src.cells), signature(src.cells, true)]).toContain(signature(pixels))
        for (const c of pixels) {
          expect(c.x).toBeGreaterThanOrEqual(0)
          expect(c.x).toBeLessThan(cols)
          expect(c.y).toBeGreaterThanOrEqual(0)
          expect(c.y).toBeLessThan(rows)
        }
        // The per-column truth the server scores against is the one the client is shown.
        expect(puzzle.cols).toEqual(columnCounts({ name, cols, rows, cells: pixels, count: 0 }))
        // Mirroring/shifting can't change how evenly the object can be split.
        expect(puzzle.minError).toBe(bestCut(columnCounts(src)).error)
        // The best cut on the placed grid scores full points; a far-left cut scores what it should.
        const best = bestCut(puzzle.cols)
        const cut = index % 2 === 0 ? best.cut : 1
        const left = leftOf(puzzle.cols, cut)
        const error = Math.abs(left - (puzzle.total - left))
        expected += index % 2 === 0 ? 10 : splitPoints(error - puzzle.minError, puzzle.total)
        s = game.onInput(s, 'a', { kind: 'cut', index, cut }, 100 + index)
        expect(s.score.get('a')).toBe(expected)
      })
    }
  })

  test('ranks by score, faster finish breaks ties', () => {
    const game = new PixelSplit()
    let s = init(['a', 'b'])
    s = game.onInput(s, 'a', { kind: 'cut', index: 0, cut: 6 }, 100)
    s = game.onInput(s, 'b', { kind: 'cut', index: 0, cut: 6 }, 900)
    const r = game.getResult(s)
    expect(r.placements[0]).toBe('a')
    expect(r.ranks?.a).toBe(0)
    expect(r.ranks?.b).toBe(1)
  })
})
