import {
  TETRIS,
  TETRIS_SHAPES,
  type TetrisBoard,
  type TetrisShapeAt,
  type TetrisSprintInput,
  type TetrisState,
  tetrisApply,
  tetrisEmptyBoard,
  tetrisEncodeBoard,
  tetrisSpawn,
} from '@pp/shared'
import type { Random } from '../ports/Random'

// Server side of the Tetris engine shared by `line-clear-sprint` and `quick-tetris`. The rules
// themselves (pieces, rotation, gravity, locks) live in @pp/shared so the client predicts its own board
// with the very same code; this adds what only the server does: the seeded queue, per-board input
// acknowledgement and the wire view.

export const COLS = TETRIS.cols
export const ROWS = TETRIS.rows
export const FALL_INTERVAL_MS = TETRIS.fallMs

// A seeded queue shared by every player in the round, dealt in shuffled bags of all seven pieces (no
// drought of I pieces, no flood of S), long enough to outlast any round.
export function createQueue(random: Random, length: number): number[] {
  const queue: number[] = []
  while (queue.length < length) {
    const bag = Array.from({ length: TETRIS_SHAPES }, (_, i) => i)
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(random.next() * (i + 1)))
      ;[bag[i], bag[j]] = [bag[j] as number, bag[i] as number]
    }
    queue.push(...bag)
  }
  return queue.slice(0, length)
}

export const shapeAtOf =
  (queue: readonly number[]): TetrisShapeAt =>
  (i) =>
    queue[i % queue.length]

// A board plus the last input sequence number applied to it (echoed so the client drops what's done).
export interface PlayerBoardState extends TetrisState {
  ack: number
}

export function createPlayerBoard(queue: readonly number[]): PlayerBoardState {
  return {
    board: tetrisEmptyBoard(),
    current: tetrisSpawn(queue[0] ?? 0),
    queueIndex: 0,
    fallAccum: 0,
    linesCleared: 0,
    toppedOut: false,
    ack: 0,
  }
}

// Records an input's sequence number — also for one the board can't take (topped out, finished), so
// the client stops replaying it.
export function acknowledge(p: PlayerBoardState, input: TetrisSprintInput): void {
  if (Number.isInteger(input.seq) && (input.seq as number) > p.ack) p.ack = input.seq as number
}

export function applyInput(
  p: PlayerBoardState,
  input: TetrisSprintInput,
  queue: readonly number[],
): void {
  acknowledge(p, input)
  if (!p.toppedOut) tetrisApply(p, input, shapeAtOf(queue))
}

// Only well-formed inputs reach the engine.
export function isTetrisInput(input: unknown): input is TetrisSprintInput {
  if (typeof input !== 'object' || input === null) return false
  const { kind, dir } = input as { kind?: unknown; dir?: unknown }
  if (kind === 'move') return dir === 'left' || dir === 'right'
  if (kind === 'rotate') return dir === undefined || dir === 'cw' || dir === 'ccw'
  return kind === 'soft' || kind === 'drop'
}

// A topped-out board starts over: emptied, with the piece that couldn't spawn back at the top (the
// queue carries on where it was). Line Clear Sprint uses it so one top-out doesn't bench you for the
// rest of the round.
export function restartBoard(p: PlayerBoardState, queue: readonly number[]): void {
  p.board = tetrisEmptyBoard()
  p.current = tetrisSpawn(queue[p.queueIndex % queue.length] ?? 0)
  p.fallAccum = 0
  p.toppedOut = false
}

export function boardView(p: PlayerBoardState, queue: readonly number[]): TetrisBoard {
  return tetrisEncodeBoard(p, shapeAtOf(queue), p.ack)
}
