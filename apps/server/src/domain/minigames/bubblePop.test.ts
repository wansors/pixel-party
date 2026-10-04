import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { BubblePop } from './bubblePop'

const ROWS = 8
const COLS = 7
const CELLS = ROWS * COLS

// randomColor() = floor(next() * 4) + 1, so next() always returning 0 gives color 1 everywhere —
// both for the seeded starting board and the shared shot queue — which keeps the placed-shot color
// predictable while we hand-build the boards these tests actually exercise.
const fixed: Random = { next: () => 0 }

const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}

const init = (players: string[], random: Random = fixed, now = 0) =>
  new BubblePop().init({ players, seed: 1, random, now, config: { durationMs: 60_000 } })

const idx = (row: number, col: number) => row * COLS + col
const emptyBoard = (): number[] => new Array(CELLS).fill(0)

describe('BubblePop', () => {
  test('a freshly-shot bubble joins 2 existing same-color neighbors and all 3 pop', () => {
    const game = new BubblePop()
    const s = init(['p'])
    const board = emptyBoard()
    board[idx(0, 0)] = 1
    board[idx(0, 1)] = 1
    s.boards.set('p', board)
    const next = game.onInput(s, 'p', { kind: 'shoot', col: 2 }, 1)
    const grid = nn(next.boards.get('p'))
    expect(grid[idx(0, 0)]).toBe(0)
    expect(grid[idx(0, 1)]).toBe(0)
    expect(grid[idx(0, 2)]).toBe(0)
    expect(nn(next.score.get('p'))).toBe(3)
  })

  test('a group of only 2 connected cells does not pop', () => {
    const game = new BubblePop()
    const s = init(['p'])
    const board = emptyBoard()
    board[idx(0, 0)] = 1
    s.boards.set('p', board)
    const next = game.onInput(s, 'p', { kind: 'shoot', col: 1 }, 1)
    const grid = nn(next.boards.get('p'))
    expect(grid[idx(0, 0)]).toBe(1)
    expect(grid[idx(0, 1)]).toBe(1)
    expect(nn(next.score.get('p'))).toBe(0)
  })

  test('a shot into a full column is a safe no-op on placement but still advances shotIndex', () => {
    const game = new BubblePop()
    const s = init(['p'])
    const board = emptyBoard()
    for (let row = 0; row < ROWS; row++) board[idx(row, 3)] = 1
    s.boards.set('p', board)
    const before = [...board]
    const shotIndexBefore = nn(s.shotIndex.get('p'))
    const next = game.onInput(s, 'p', { kind: 'shoot', col: 3 }, 1)
    expect(nn(next.boards.get('p'))).toEqual(before)
    expect(nn(next.score.get('p'))).toBe(0)
    expect(nn(next.shotIndex.get('p'))).toBe(shotIndexBefore + 1)
  })

  test('clearing a board entirely sets doneAt, and getResult ranks it above an unfinished board', () => {
    const game = new BubblePop()
    const s = init(['a', 'b'])
    const board = emptyBoard()
    board[idx(0, 0)] = 1
    board[idx(0, 1)] = 1
    s.boards.set('a', board)
    const next = game.onInput(s, 'a', { kind: 'shoot', col: 2 }, 5)
    expect(nn(next.boards.get('a')).every((c) => c === 0)).toBe(true)
    expect(nn(next.doneAt.get('a'))).toBe(5)
    expect(nn(next.doneAt.get('b'))).toBe(0)
    const result = game.getResult(next)
    expect(result.placements[0]).toBe('a')
    expect(result.placements[1]).toBe('b')
    expect(nn(result.stats).a).toBe('cleared!')
  })

  test('popping a support group drops any now-unattached bubbles and scores them too', () => {
    const game = new BubblePop()
    const s = init(['p'])
    const board = emptyBoard()
    board[idx(0, 0)] = 1 // ceiling-attached red pair; (0,1) blocks col 1 so the next red shot
    board[idx(0, 1)] = 1 // sticks right below it at (1,1), completing a group of 3
    board[idx(1, 0)] = 2 // only touches (0,0) and (1,1) — floats once the red group pops
    board[idx(0, 6)] = 3 // unrelated, ceiling-attached on its own — must survive
    s.boards.set('p', board)
    const next = game.onInput(s, 'p', { kind: 'shoot', col: 1 }, 1)
    const grid = nn(next.boards.get('p'))
    expect(grid[idx(0, 0)]).toBe(0)
    expect(grid[idx(0, 1)]).toBe(0)
    expect(grid[idx(1, 1)]).toBe(0)
    expect(grid[idx(1, 0)]).toBe(0) // floated and got cleaned up
    expect(grid[idx(0, 6)]).toBe(3) // stays: it was already ceiling-attached on its own
    expect(nn(next.score.get('p'))).toBe(4) // 3 popped + 1 floating bonus
    expect(nn(next.doneAt.get('p'))).toBe(0) // (0,6) still stands, board isn't clear
  })

  test('a shot sticks under the lowest bubble in its column — it never passes through one', () => {
    const game = new BubblePop()
    const s = init(['p'])
    const board = emptyBoard()
    // Column 0 holds (0,0) and, lower down, (3,0) hanging off a sideways chain along row 3.
    board[idx(0, 0)] = 2
    board[idx(0, 1)] = 3
    board[idx(1, 1)] = 4
    board[idx(2, 1)] = 2
    board[idx(3, 1)] = 3
    board[idx(3, 0)] = 4
    s.boards.set('p', board)
    const next = game.onInput(s, 'p', { kind: 'shoot', col: 0 }, 1)
    const grid = nn(next.boards.get('p'))
    expect(grid[idx(4, 0)]).toBe(1) // under (3,0), the first bubble the shot meets
    expect(grid[idx(1, 0)]).toBe(0) // not in the gap above it
  })

  test('a column filled to the bottom row takes no shot, even with gaps higher up', () => {
    const game = new BubblePop()
    const s = init(['p'])
    const board = emptyBoard()
    board[idx(0, 0)] = 2
    for (let row = 0; row < ROWS; row++) board[idx(row, 1)] = 3
    board[idx(ROWS - 1, 0)] = 4 // hangs off column 1's bottom bubble; rows 1..6 of column 0 are empty
    s.boards.set('p', board)
    const before = [...board]
    const next = game.onInput(s, 'p', { kind: 'shoot', col: 0 }, 1)
    expect(nn(next.boards.get('p'))).toEqual(before)
  })

  test('a board blocked at the bottom of every column is jammed: out of shots, done for the round', () => {
    const game = new BubblePop()
    const s = init(['a', 'b'])
    // Alternating colours, no group of 3 anywhere, every column full except one cell left at the bottom.
    const board = emptyBoard().map((_, i) => ((Math.floor(i / COLS) + (i % COLS)) % 2) + 2)
    board[idx(ROWS - 1, 6)] = 0
    s.boards.set('a', board)
    // The last open slot gets filled with a colour that doesn't pop: jammed.
    let next = game.onInput(s, 'a', { kind: 'shoot', col: 6 }, 5)
    expect(next.jammed.has('a')).toBe(true)
    expect(game.snapshot(next, 5).boards.a?.jammed).toBe(true)
    const shots = next.shotIndex.get('a')
    next = game.onInput(next, 'a', { kind: 'shoot', col: 3 }, 6)
    expect(next.shotIndex.get('a')).toBe(shots) // no more shots
    expect(game.isFinished(next, 6)).toBe(false) // b is still playing
    next.doneAt.set('b', 7)
    expect(game.isFinished(next, 7)).toBe(true)
  })

  test('on equal points a jammed board ranks below a live one', () => {
    const game = new BubblePop()
    const s = init(['jam', 'live'])
    s.score.set('jam', 12)
    s.score.set('live', 12)
    s.jammed.add('jam')
    const result = game.getResult(s)
    expect(result.placements).toEqual(['live', 'jam'])
    expect(nn(result.ranks).jam).toBe(1)
  })

  test('a player who left no longer holds up the early end', () => {
    const game = new BubblePop()
    let s = init(['a', 'b'])
    s.doneAt.set('a', 5)
    expect(game.isFinished(s, 6)).toBe(false)
    s = game.leave(s, 'b', 6)
    expect(game.isFinished(s, 6)).toBe(true)
  })

  test('isFinished: false before endsAt with nobody done, true once everyone is done', () => {
    const game = new BubblePop()
    let s = init(['a', 'b'])
    expect(game.isFinished(s, 0)).toBe(false)
    s = {
      ...s,
      doneAt: new Map([
        ['a', 5],
        ['b', 6],
      ]),
    }
    expect(game.isFinished(s, 6)).toBe(true)
  })

  test('isFinished is true at/after the deadline regardless of progress', () => {
    const game = new BubblePop()
    const s = init(['a', 'b'])
    expect(game.isFinished(s, s.endsAt)).toBe(true)
    expect(game.isFinished(s, s.endsAt - 1)).toBe(false)
  })

  test('snapshot mirrors per-player scores into a top-level scores map', () => {
    const game = new BubblePop()
    const s = init(['p'])
    const board = emptyBoard()
    board[idx(0, 0)] = 1
    board[idx(0, 1)] = 1
    s.boards.set('p', board)
    const next = game.onInput(s, 'p', { kind: 'shoot', col: 2 }, 1)
    const snap = game.snapshot(next, 1)
    expect(snap.scores.p).toBe(3)
    expect(nn(snap.boards.p).score).toBe(3)
    expect(snap.rows).toBe(ROWS)
    expect(snap.cols).toBe(COLS)
  })
})

describe('BubblePop wire (the client predicts from it)', () => {
  test('the snapshot carries the queue, the board as digits, the queue pointer and the shot count', () => {
    const game = new BubblePop()
    const s = init(['p'])
    const board = emptyBoard()
    board[idx(0, 0)] = 2
    s.boards.set('p', board)
    s.shotQueue = [3, 2, 1, 2]
    let next = game.onInput(s, 'p', { kind: 'shoot', col: 6 }, 1)
    // Out-of-range columns are refused outright (not counted as a shot).
    next = game.onInput(next, 'p', { kind: 'shoot', col: 9 }, 1)
    const snap = game.snapshot(next, 1)
    expect(snap.queue).toBe('3212')
    const b = nn(snap.boards.p)
    expect(b.shots).toBe(1)
    // Colour 3 isn't on the board, so the shot skipped to the first 2 (slot 1); the pointer is past it.
    expect(b.shot).toBe(2)
    expect(b.grid[idx(0, 6)]).toBe('2')
    expect(b.grid.length).toBe(CELLS)
  })

  test('a shot after the board is done is still counted, so the client stops replaying it', () => {
    const game = new BubblePop()
    const s = init(['p'])
    s.doneAt.set('p', 5)
    const next = game.onInput(s, 'p', { kind: 'shoot', col: 1 }, 6)
    expect(game.snapshot(next, 6).boards.p?.shots).toBe(1)
  })
})
