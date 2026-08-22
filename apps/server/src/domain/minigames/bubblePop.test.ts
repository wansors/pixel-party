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
