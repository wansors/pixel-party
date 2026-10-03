import { describe, expect, test } from 'bun:test'
import { BOMBER } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { BomberExpress, type BomberState } from './bomberExpress'

const game = new BomberExpress()
const W = BOMBER.w
const init = (players: string[], seed = 12): BomberState =>
  game.init({
    players,
    seed,
    random: new SeededRandom(seed),
    now: 0,
    config: { durationMs: 60_000 },
  })
const player = (s: BomberState, id: string) => {
  const p = s.players.find((x) => x.id === id)
  if (!p) throw new Error(`no player ${id}`)
  return p
}
const cell = (s: BomberState, x: number, y: number): string => s.cells[y * W + x] ?? '?'
const setCell = (s: BomberState, x: number, y: number, c: string): void => {
  s.cells[y * W + x] = c
}
// Clears every crate (a bare arena of walls and pillars) for controlled checks.
const bare = (s: BomberState): void => {
  s.cells = s.cells.map((c) => (c === '#' ? '#' : '.'))
  s.drops.clear()
}
const run = (s: BomberState, from: number, to: number): number => {
  let t = from
  while (t + 50 <= to) {
    t += 50
    game.tick(s, 50, t)
  }
  return t
}
const place = (s: BomberState, id: string, x: number, y: number): void => {
  Object.assign(player(s, id), { x, y, tx: x, ty: y, stepStart: 0, stepEnd: 0 })
}

describe('BomberExpress', () => {
  test('walls on the border and every even/even cell, seeded crates, clear spawn corners', () => {
    const s = init(['a', 'b', 'c', 'd'])
    expect(cell(s, 0, 0)).toBe('#')
    expect(cell(s, 2, 2)).toBe('#')
    expect(cell(s, 1, 1)).toBe('.')
    expect(cell(s, 2, 1)).toBe('.')
    expect(cell(s, 1, 2)).toBe('.')
    const crates = s.cells.filter((c) => c === 'c').length
    expect(crates).toBeGreaterThan(40)
    expect(init(['a', 'b', 'c', 'd']).cells).toEqual(s.cells)
    // Everyone starts fully powered.
    for (const p of s.players) {
      expect(p.range).toBe(BOMBER.startRange)
      expect(p.maxBombs).toBe(BOMBER.startBombs)
    }
  })

  test('walks tile by tile at its stride while a direction is held; walls and crates block', () => {
    const s = init(['a'])
    bare(s)
    place(s, 'a', 1, 1)
    game.onInput(s, 'a', { kind: 'move', dir: 'right' }, 0)
    run(s, 0, 1000) // 150 ms per tile at the starting speed
    const a = player(s, 'a')
    expect(a.x).toBeGreaterThanOrEqual(6)
    game.onInput(s, 'a', { kind: 'move', dir: null }, 1000)
    run(s, 1000, 1400)
    const stopped = a.x
    run(s, 1400, 1800)
    expect(a.x).toBe(stopped)
    // Up from an odd row into a pillar row: (x, 0) is the border wall, blocked.
    place(s, 'a', 1, 1)
    game.onInput(s, 'a', { kind: 'move', dir: 'up' }, 2000)
    run(s, 2000, 2500)
    expect([a.x, a.y]).toEqual([1, 1])
    setCell(s, 2, 1, 'c')
    game.onInput(s, 'a', { kind: 'move', dir: 'right' }, 2500)
    run(s, 2500, 3000)
    expect([a.x, a.y]).toEqual([1, 1])
  })

  test('a bomb blasts a cross that stops at walls and at the first crate, revealing its drop', () => {
    const s = init(['a', 'b'])
    bare(s)
    place(s, 'a', 5, 5)
    place(s, 'b', 15, 11)
    setCell(s, 7, 5, 'c')
    s.drops.set(5 * W + 7, 'r')
    setCell(s, 8, 5, 'c') // behind the first crate: untouched
    game.onInput(s, 'a', { kind: 'bomb' }, 0)
    expect(s.bombs).toHaveLength(1)
    // Walk away down the column first (out of the blast's row).
    game.onInput(s, 'a', { kind: 'move', dir: 'down' }, 0)
    run(s, 0, BOMBER.fuseMs + 50)
    expect(s.bombs).toHaveLength(0)
    expect(cell(s, 7, 5)).toBe('r')
    expect(cell(s, 8, 5)).toBe('c')
    expect(s.flames.has(5 * W + 6)).toBe(true)
    expect(s.flames.has(5 * W + 8)).toBe(false)
    expect(s.flames.has(4 * W + 5)).toBe(true) // up the column (5, 4) is open
  })

  test('chain reaction: a bomb caught in a blast goes off at once', () => {
    const s = init(['a', 'b'])
    bare(s)
    place(s, 'a', 1, 11)
    place(s, 'b', 15, 11)
    s.bombs.push({ x: 5, y: 5, explodeAt: 1000, owner: 0, range: 3 })
    s.bombs.push({ x: 7, y: 5, explodeAt: 9000, owner: 1, range: 3 })
    run(s, 950, 1050)
    expect(s.bombs).toHaveLength(0)
    expect(s.flames.has(5 * W + 10)).toBe(true) // reached through the second bomb's range
  })

  test('caught in the flames you are out; the bomber scores the knock-out (not for themselves)', () => {
    const s = init(['a', 'b', 'c'])
    bare(s)
    place(s, 'a', 3, 5)
    place(s, 'b', 5, 5)
    place(s, 'c', 15, 11)
    game.onInput(s, 'a', { kind: 'bomb' }, 0)
    run(s, 0, BOMBER.fuseMs + 50)
    expect(player(s, 'b').alive).toBe(false)
    expect(player(s, 'a').alive).toBe(false) // stood on it
    expect(player(s, 'a').kos).toBe(1)
    expect(game.isFinished(s, BOMBER.fuseMs + 50)).toBe(true) // only c is left
    const result = game.getResult(s)
    expect(result.placements[0]).toBe('c')
    expect(result.ranks?.a).toBeLessThan(result.ranks?.b ?? 0) // a scored a KO
  })

  test('power-ups are picked up by walking over them', () => {
    const s = init(['a'])
    bare(s)
    place(s, 'a', 1, 1)
    setCell(s, 2, 1, 'r')
    setCell(s, 3, 1, 'b')
    setCell(s, 4, 1, 's')
    game.onInput(s, 'a', { kind: 'move', dir: 'right' }, 0)
    run(s, 0, 700)
    const a = player(s, 'a')
    expect(a.range).toBe(BOMBER.startRange + 1)
    expect(a.maxBombs).toBe(BOMBER.startBombs + 1)
    expect(a.speed).toBe(2)
    expect(cell(s, 2, 1)).toBe('.')
  })

  test('bombs are capped per player and block the way; junk is ignored', () => {
    const s = init(['a'])
    bare(s)
    place(s, 'a', 1, 1)
    game.onInput(s, 'a', { kind: 'bomb' }, 0)
    game.onInput(s, 'a', { kind: 'bomb' }, 0) // same tile: only one
    expect(s.bombs).toHaveLength(1)
    s.bombs.push({ x: 2, y: 1, explodeAt: 99_999, owner: 0, range: 1 })
    game.onInput(s, 'a', { kind: 'move', dir: 'right' }, 0)
    run(s, 0, 400)
    expect(player(s, 'a').x).toBe(1)
    game.onInput(s, 'a', { kind: 'move', dir: 'sideways' as 'up' }, 400)
    expect(player(s, 'a').dir).toBe('right')
  })
})
