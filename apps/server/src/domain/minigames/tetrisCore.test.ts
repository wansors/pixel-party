import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import {
  COLS,
  type FallingPiece,
  type PlayerBoardState,
  ROWS,
  SHAPES,
  clearFullLines,
  collides,
  createPlayerBoard,
  createQueue,
  hardDrop,
  lockPiece,
  renderBoard,
  restartBoard,
  tryRotate,
} from './tetrisCore'

// The O piece (2x2 square) makes wall/floor math easy to reason about.
const O_SHAPE_INDEX = SHAPES.findIndex(
  (s) => s.cells.length === 4 && s.cells.every((c) => c.x <= 1),
)

describe('tetrisCore', () => {
  test('collides detects a left-wall collision but not an in-bounds move', () => {
    const piece: FallingPiece = { shapeIndex: O_SHAPE_INDEX, x: 0, y: 0, rotation: 0 }
    const board = new Array(COLS * ROWS).fill(0)
    expect(collides(board, COLS, ROWS, piece, -1, 0)).toBe(true)
    expect(collides(board, COLS, ROWS, piece, 0, 0)).toBe(false)
  })

  test('collides detects a right-wall collision', () => {
    const piece: FallingPiece = { shapeIndex: O_SHAPE_INDEX, x: COLS - 2, y: 0, rotation: 0 }
    const board = new Array(COLS * ROWS).fill(0)
    expect(collides(board, COLS, ROWS, piece, 1, 0)).toBe(true)
    expect(collides(board, COLS, ROWS, piece, 0, 0)).toBe(false)
  })

  test('collides detects a floor collision', () => {
    const piece: FallingPiece = { shapeIndex: O_SHAPE_INDEX, x: 0, y: ROWS - 2, rotation: 0 }
    const board = new Array(COLS * ROWS).fill(0)
    expect(collides(board, COLS, ROWS, piece, 0, 1)).toBe(true)
    expect(collides(board, COLS, ROWS, piece, 0, 0)).toBe(false)
  })

  test('collides detects occupied board cells', () => {
    const piece: FallingPiece = { shapeIndex: O_SHAPE_INDEX, x: 0, y: 0, rotation: 0 }
    const board = new Array(COLS * ROWS).fill(0)
    board[1 * COLS + 0] = 3 // directly below the piece's bottom-left cell
    expect(collides(board, COLS, ROWS, piece, 0, 1)).toBe(true)
  })

  test('lockPiece bakes the piece cells into the board with its color', () => {
    const piece: FallingPiece = { shapeIndex: O_SHAPE_INDEX, x: 2, y: 3, rotation: 0 }
    const board = new Array(COLS * ROWS).fill(0)
    const shape = SHAPES[O_SHAPE_INDEX]
    if (!shape) throw new Error('missing shape')
    const after = lockPiece(board, COLS, piece)
    for (const c of shape.cells) {
      expect(after[(piece.y + c.y) * COLS + (piece.x + c.x)]).toBe(shape.color)
    }
    // Cell well outside the piece stays empty.
    expect(after[0]).toBe(0)
  })

  test('clearFullLines clears exactly the full rows and shifts rows above down', () => {
    const board = new Array(COLS * ROWS).fill(0)
    board[3 * COLS] = 5 // a lone marker, row not full
    for (let x = 0; x < COLS; x++) board[6 * COLS + x] = 9 // a fully-occupied row
    board[9 * COLS] = 7 // a lone marker below the cleared row

    const { board: after, cleared } = clearFullLines(board, COLS, ROWS)

    expect(cleared).toBe(1)
    expect(after.length).toBe(COLS * ROWS)
    expect(after[4 * COLS]).toBe(5) // shifted down by one (was above the cleared row)
    expect(after[3 * COLS]).toBe(0) // took the place of the (empty) row above it
    expect(after[9 * COLS]).toBe(7) // unaffected (was below the cleared row)
  })

  test('clearFullLines reports zero cleared and an unchanged board when nothing is full', () => {
    const board = new Array(COLS * ROWS).fill(0)
    board[0] = 1
    const { board: after, cleared } = clearFullLines(board, COLS, ROWS)
    expect(cleared).toBe(0)
    expect(after).toEqual(board)
  })

  test('createQueue produces only values within [0, SHAPES.length)', () => {
    const cycling = (values: number[]): Random => {
      let i = 0
      return { next: () => values[i++ % values.length] as number }
    }
    const r = cycling([0, 0.24, 0.25, 0.49, 0.5, 0.74, 0.75, 0.99])
    const queue = createQueue(r, 200)
    expect(queue.length).toBe(200)
    for (const v of queue) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(SHAPES.length)
    }
  })
})

describe('tetrisCore restartBoard', () => {
  test('empties a topped-out board and respawns the piece that could not spawn', () => {
    const queue = [0, 1, 2, 3]
    const p = createPlayerBoard(queue)
    for (let i = 0; i < ROWS * 2 && !p.toppedOut; i++) hardDrop(p, queue)
    expect(p.toppedOut).toBe(true)
    const lines = p.linesCleared
    const next = p.queueIndex
    restartBoard(p, queue)
    expect(p.toppedOut).toBe(false)
    expect(p.board.every((c) => c === 0)).toBe(true)
    expect(p.current.shapeIndex).toBe(queue[next % queue.length])
    expect(p.current.y).toBe(0)
    // The queue and the score carry on.
    expect(p.queueIndex).toBe(next)
    expect(p.linesCleared).toBe(lines)
  })
})

describe('tetrisCore tryRotate', () => {
  const I_SHAPE_INDEX = SHAPES.findIndex((s) => s.cells.every((c) => c.y === 0))
  const T_SHAPE_INDEX = SHAPES.findIndex(
    (s) => s.cells.length === 4 && s.cells.filter((c) => c.y === 0).length === 3,
  )
  const occupied = (p: PlayerBoardState): string[] =>
    renderBoard(p)
      .map((v, i) => (v !== 0 ? `${i % COLS},${Math.floor(i / COLS)}` : ''))
      .filter(Boolean)
      .sort()
  const withPiece = (piece: FallingPiece, board?: number[]): PlayerBoardState => ({
    ...createPlayerBoard([piece.shapeIndex]),
    current: piece,
    ...(board ? { board } : {}),
  })

  test('rotates a quarter-turn clockwise in open space without moving the piece', () => {
    const p = withPiece({ shapeIndex: T_SHAPE_INDEX, x: 2, y: 4, rotation: 0 })
    tryRotate(p)
    expect(p.current).toEqual({ shapeIndex: T_SHAPE_INDEX, x: 2, y: 4, rotation: 1 })
    // T pointing down → pointing left: a vertical bar at x=3 with the nub at x=2.
    expect(occupied(p)).toEqual(['2,5', '3,4', '3,5', '3,6'])
  })

  test('four rotations come back to the original orientation', () => {
    const p = withPiece({ shapeIndex: T_SHAPE_INDEX, x: 2, y: 4, rotation: 0 })
    const before = occupied(p)
    for (let i = 0; i < 4; i++) tryRotate(p)
    expect(p.current.rotation).toBe(0)
    expect(occupied(p)).toEqual(before)
  })

  test('wall-kicks one column left when the rotated piece would poke through the right wall', () => {
    // Rotation 1 is two columns wide; at x = COLS - 2 it touches the right wall. Rotation 2 is three
    // wide, so rotating in place would overflow and the first successful kick is dx = -1.
    const p = withPiece({ shapeIndex: T_SHAPE_INDEX, x: COLS - 2, y: 4, rotation: 1 })
    tryRotate(p)
    expect(p.current).toEqual({ shapeIndex: T_SHAPE_INDEX, x: COLS - 3, y: 4, rotation: 2 })
    expect(collides(p.board, COLS, ROWS, p.current, 0, 0)).toBe(false)
  })

  test('is a no-op when every kick offset is blocked (vertical I against the right wall)', () => {
    // Horizontal I is four wide: from x = COLS - 1 no offset in [0, -1, 1, -2, 2] fits a 6-wide board.
    const piece: FallingPiece = { shapeIndex: I_SHAPE_INDEX, x: COLS - 1, y: 2, rotation: 1 }
    const p = withPiece(piece)
    tryRotate(p)
    expect(p.current).toEqual(piece)
  })

  test('is a no-op when the rotated piece would overlap settled blocks', () => {
    // Vertical I in column 0; a settled block at (3, 2) sits in every horizontal kick position.
    const board = new Array(COLS * ROWS).fill(0)
    board[2 * COLS + 3] = 4
    const piece: FallingPiece = { shapeIndex: I_SHAPE_INDEX, x: 0, y: 2, rotation: 1 }
    const p = withPiece(piece, board)
    tryRotate(p)
    expect(p.current).toEqual(piece)
  })

  test('does nothing once the board has topped out', () => {
    const piece: FallingPiece = { shapeIndex: T_SHAPE_INDEX, x: 2, y: 4, rotation: 0 }
    const p = { ...withPiece(piece), toppedOut: true }
    tryRotate(p)
    expect(p.current).toEqual(piece)
  })
})
