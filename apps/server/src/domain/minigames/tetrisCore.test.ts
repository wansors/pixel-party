import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import {
  COLS,
  type FallingPiece,
  ROWS,
  SHAPES,
  clearFullLines,
  collides,
  createQueue,
  lockPiece,
} from './tetrisCore'

// The O piece (2x2 square) makes wall/floor math easy to reason about.
const O_SHAPE_INDEX = SHAPES.findIndex(
  (s) => s.cells.length === 4 && s.cells.every((c) => c.x <= 1),
)

describe('tetrisCore', () => {
  test('collides detects a left-wall collision but not an in-bounds move', () => {
    const piece: FallingPiece = { shapeIndex: O_SHAPE_INDEX, x: 0, y: 0 }
    const board = new Array(COLS * ROWS).fill(0)
    expect(collides(board, COLS, ROWS, piece, -1, 0)).toBe(true)
    expect(collides(board, COLS, ROWS, piece, 0, 0)).toBe(false)
  })

  test('collides detects a right-wall collision', () => {
    const piece: FallingPiece = { shapeIndex: O_SHAPE_INDEX, x: COLS - 2, y: 0 }
    const board = new Array(COLS * ROWS).fill(0)
    expect(collides(board, COLS, ROWS, piece, 1, 0)).toBe(true)
    expect(collides(board, COLS, ROWS, piece, 0, 0)).toBe(false)
  })

  test('collides detects a floor collision', () => {
    const piece: FallingPiece = { shapeIndex: O_SHAPE_INDEX, x: 0, y: ROWS - 2 }
    const board = new Array(COLS * ROWS).fill(0)
    expect(collides(board, COLS, ROWS, piece, 0, 1)).toBe(true)
    expect(collides(board, COLS, ROWS, piece, 0, 0)).toBe(false)
  })

  test('collides detects occupied board cells', () => {
    const piece: FallingPiece = { shapeIndex: O_SHAPE_INDEX, x: 0, y: 0 }
    const board = new Array(COLS * ROWS).fill(0)
    board[1 * COLS + 0] = 3 // directly below the piece's bottom-left cell
    expect(collides(board, COLS, ROWS, piece, 0, 1)).toBe(true)
  })

  test('lockPiece bakes the piece cells into the board with its color', () => {
    const piece: FallingPiece = { shapeIndex: O_SHAPE_INDEX, x: 2, y: 3 }
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
