import { describe, expect, test } from 'bun:test'
import {
  TETRIS_SHAPES,
  type TetrisPiece,
  type TetrisState,
  tetrisApply,
  tetrisCells,
  tetrisClearLines,
  tetrisCollides,
  tetrisDecodeBoard,
  tetrisEmptyBoard,
  tetrisFall,
  tetrisHardDrop,
  tetrisLandingY,
  tetrisRotate,
  tetrisSoftDrop,
  tetrisSpawn,
} from '@pp/shared'
import type { Random } from '../ports/Random'
import {
  applyInput,
  boardView,
  COLS,
  createPlayerBoard,
  createQueue,
  FALL_INTERVAL_MS,
  isTetrisInput,
  ROWS,
  restartBoard,
  shapeAtOf,
} from './tetrisCore'

const I = 0
const O = 1
const T = 2
const S = 3

const occupied = (piece: TetrisPiece): string[] =>
  tetrisCells(piece)
    .map((c) => `${piece.x + c.x},${piece.y + c.y}`)
    .sort()

const stateWith = (piece: TetrisPiece | null, board = tetrisEmptyBoard()): TetrisState => ({
  board,
  current: piece,
  queueIndex: 0,
  fallAccum: 0,
  linesCleared: 0,
  toppedOut: false,
})

const always =
  (shape: number) =>
  (_i: number): number =>
    shape

describe('tetris engine (shared)', () => {
  test('pieces spawn centred with their top row on the first board row', () => {
    for (let s = 0; s < TETRIS_SHAPES; s++) {
      const piece = tetrisSpawn(s)
      const cells = tetrisCells(piece).map((c) => ({ x: piece.x + c.x, y: piece.y + c.y }))
      expect(Math.min(...cells.map((c) => c.y))).toBe(0)
      const left = Math.min(...cells.map((c) => c.x))
      const right = COLS - 1 - Math.max(...cells.map((c) => c.x))
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1)
    }
  })

  test('walls, floor and the stack collide; open space does not', () => {
    const board = tetrisEmptyBoard()
    const o: TetrisPiece = { shape: O, x: 0, y: ROWS - 2, rot: 0 }
    expect(tetrisCollides(board, o)).toBe(false)
    expect(tetrisCollides(board, o, -1, 0)).toBe(true)
    expect(tetrisCollides(board, o, 0, 1)).toBe(true)
    board[0 * COLS + 2] = 3
    expect(tetrisCollides(board, { shape: O, x: 1, y: 0, rot: 0 })).toBe(true)
  })

  test('a T turns about its centre and four turns come back home', () => {
    const s = stateWith({ shape: T, x: 2, y: 4, rot: 0 })
    tetrisRotate(s, 1)
    expect(s.current).toEqual({ shape: T, x: 2, y: 4, rot: 1 })
    expect(occupied(s.current as TetrisPiece)).toEqual(['3,4', '3,5', '3,6', '4,5'])
    tetrisRotate(s, 1)
    tetrisRotate(s, 1)
    tetrisRotate(s, 1)
    expect(s.current).toEqual({ shape: T, x: 2, y: 4, rot: 0 })
    tetrisRotate(s, -1)
    expect(s.current?.rot).toBe(3)
  })

  test('rotation kicks off a wall, and is a no-op when nothing fits', () => {
    // Vertical I hugging the right wall: turning flat needs to slide two columns left.
    const s = stateWith({ shape: I, x: COLS - 3, y: 4, rot: 1 })
    expect(occupied(s.current as TetrisPiece).every((c) => c.startsWith(`${COLS - 1},`))).toBe(true)
    tetrisRotate(s, 1)
    expect(tetrisCollides(s.board, s.current as TetrisPiece)).toBe(false)
    expect(s.current?.rot).toBe(2)
    // Boxed in by a full column on each side: the I can't turn at all.
    const board = tetrisEmptyBoard()
    for (let y = 0; y < ROWS; y++) {
      for (const x of [1, 3]) board[y * COLS + x] = 4
    }
    const stuck: TetrisPiece = { shape: I, x: 0, y: 3, rot: 1 } // column 2
    const boxed = stateWith(stuck, board)
    tetrisRotate(boxed, 1)
    expect(boxed.current).toEqual(stuck)
  })

  test('clearing lines drops the rows above and reports which rows went', () => {
    const board = tetrisEmptyBoard()
    board[3 * COLS] = 5
    for (let x = 0; x < COLS; x++) board[6 * COLS + x] = 2
    board[9 * COLS] = 7
    expect(tetrisClearLines(board)).toEqual([6])
    expect(board[4 * COLS]).toBe(5)
    expect(board[3 * COLS]).toBe(0)
    expect(board[9 * COLS]).toBe(7)
  })

  test('hard drop lands on the ghost row, locks, clears and spawns the next piece', () => {
    const board = tetrisEmptyBoard()
    // Bottom row full except the four middle columns an I fills.
    board[(ROWS - 1) * COLS] = 3
    board[(ROWS - 1) * COLS + COLS - 1] = 3
    const s = stateWith(tetrisSpawn(I), board)
    expect(tetrisLandingY(s.board, s.current as TetrisPiece)).toBe(ROWS - 2)
    const lock = tetrisHardDrop(s, always(O))
    expect(lock?.rows).toEqual([ROWS - 1])
    expect(s.linesCleared).toBe(1)
    expect(s.board.every((c) => c === 0)).toBe(true)
    expect(s.current).toEqual(tetrisSpawn(O))
    expect(s.queueIndex).toBe(1)
  })

  test('soft drop moves one row and restarts gravity; on the stack it locks', () => {
    const s = stateWith({ shape: O, x: 2, y: ROWS - 3, rot: 0 })
    s.fallAccum = 400
    expect(tetrisSoftDrop(s, always(T))).toBeNull()
    expect(s.current?.y).toBe(ROWS - 2)
    expect(s.fallAccum).toBe(0)
    const lock = tetrisSoftDrop(s, always(T))
    expect(lock).not.toBeNull()
    expect(s.board[(ROWS - 1) * COLS + 2]).toBe(O + 1)
    expect(s.current?.shape).toBe(T)
  })

  test('gravity drops a row per fallMs and locks a piece that cannot fall', () => {
    const s = stateWith({ shape: O, x: 0, y: ROWS - 3, rot: 0 })
    expect(tetrisFall(s, FALL_INTERVAL_MS - 1, always(O))).toEqual([])
    expect(s.current?.y).toBe(ROWS - 3)
    tetrisFall(s, 1, always(O))
    expect(s.current?.y).toBe(ROWS - 2)
    const locks = tetrisFall(s, FALL_INTERVAL_MS, always(O))
    expect(locks.length).toBe(1)
    expect(s.current).toEqual(tetrisSpawn(O))
  })

  test('a piece that cannot spawn tops the board out and every input becomes a no-op', () => {
    const board = tetrisEmptyBoard()
    for (let x = 0; x < COLS - 1; x++) board[2 * COLS + x] = 2
    const s = stateWith({ shape: O, x: 1, y: 0, rot: 0 }, board)
    tetrisHardDrop(s, always(T))
    expect(s.toppedOut).toBe(true)
    expect(s.current).toBeNull()
    expect(tetrisApply(s, { kind: 'drop' }, always(T))).toBeNull()
  })

  test('the client prediction stops at an unknown next piece instead of inventing one', () => {
    const s = stateWith(tetrisSpawn(O))
    tetrisHardDrop(s, () => undefined)
    expect(s.current).toBeNull()
    expect(s.toppedOut).toBe(false)
    expect(tetrisApply(s, { kind: 'move', dir: 'left' }, () => undefined)).toBeNull()
  })
})

describe('tetrisCore (server)', () => {
  const cycling = (values: number[]): Random => {
    let i = 0
    return { next: () => values[i++ % values.length] as number }
  }

  test('the queue deals every piece once per bag of seven', () => {
    const queue = createQueue(cycling([0.13, 0.91, 0.42, 0.66, 0.05, 0.78]), 70)
    expect(queue.length).toBe(70)
    for (let b = 0; b < 10; b++) {
      expect([...queue.slice(b * 7, b * 7 + 7)].sort()).toEqual([0, 1, 2, 3, 4, 5, 6])
    }
  })

  test('inputs are applied and acknowledged by sequence number, even when they do nothing', () => {
    const queue = [O, O, O]
    const p = createPlayerBoard(queue)
    applyInput(p, { kind: 'move', dir: 'left', seq: 3 }, queue)
    expect(p.current?.x).toBe(1)
    expect(p.ack).toBe(3)
    p.toppedOut = true
    applyInput(p, { kind: 'move', dir: 'left', seq: 4 }, queue)
    expect(p.current?.x).toBe(1)
    expect(p.ack).toBe(4)
    // A stale (lower) seq never rolls the ack back.
    applyInput(p, { kind: 'drop', seq: 2 }, queue)
    expect(p.ack).toBe(4)
  })

  test('only well-formed inputs pass', () => {
    expect(isTetrisInput({ kind: 'move', dir: 'left' })).toBe(true)
    expect(isTetrisInput({ kind: 'rotate' })).toBe(true)
    expect(isTetrisInput({ kind: 'rotate', dir: 'ccw' })).toBe(true)
    expect(isTetrisInput({ kind: 'soft' })).toBe(true)
    expect(isTetrisInput({ kind: 'drop', seq: 9 })).toBe(true)
    expect(isTetrisInput({ kind: 'move', dir: 'up' })).toBe(false)
    expect(isTetrisInput({ kind: 'rotate', dir: 'sideways' })).toBe(false)
    expect(isTetrisInput(null)).toBe(false)
  })

  test('restartBoard empties a topped-out board and respawns the piece that could not spawn', () => {
    const queue = [I, O, T, O]
    const p = createPlayerBoard(queue)
    for (let i = 0; i < ROWS * 2 && !p.toppedOut; i++) applyInput(p, { kind: 'drop' }, queue)
    expect(p.toppedOut).toBe(true)
    const lines = p.linesCleared
    const next = p.queueIndex
    restartBoard(p, queue)
    expect(p.toppedOut).toBe(false)
    expect(p.board.every((c) => c === 0)).toBe(true)
    expect(p.current).toEqual(tetrisSpawn(queue[next % queue.length] as number))
    expect(p.queueIndex).toBe(next)
    expect(p.linesCleared).toBe(lines)
  })

  test('the wire view round-trips into the same state for the client to predict from', () => {
    const queue = [T, S, O, I, T, O]
    const p = createPlayerBoard(queue)
    applyInput(p, { kind: 'drop', seq: 1 }, queue)
    applyInput(p, { kind: 'move', dir: 'right', seq: 2 }, queue)
    p.fallAccum = 250
    const view = boardView(p, queue)
    expect(view.ack).toBe(2)
    expect(view.next).toBe('1021')
    const { state, shapeAt } = tetrisDecodeBoard(view)
    expect(state.board).toEqual(p.board)
    expect(state.current).toEqual(p.current)
    expect(state.fallAccum).toBe(250)
    // Both sides run the same engine: the same hard drop gives the same board.
    applyInput(p, { kind: 'drop' }, queue)
    tetrisHardDrop(state, shapeAt)
    expect(state.board).toEqual(p.board)
    expect(state.current).toEqual(p.current)
    expect(shapeAtOf(queue)(7)).toBe(queue[1])
  })
})
