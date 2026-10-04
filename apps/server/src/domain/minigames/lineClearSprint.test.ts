import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { LineClearSprint } from './lineClearSprint'
import { createPlayerBoard, FALL_INTERVAL_MS, ROWS } from './tetrisCore'

const zero: Random = { next: () => 0 }

const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}

// Every piece is an I (four wide, one tall), so the sequence is fully predictable.
const init = (players: string[], durationMs = 60_000) => {
  const state = new LineClearSprint().init({
    players,
    seed: 1,
    random: zero,
    now: 0,
    config: { durationMs },
  })
  state.queue = new Array(300).fill(0)
  for (const id of players) state.boards.set(id, createPlayerBoard(state.queue))
  return state
}

describe('LineClearSprint', () => {
  test('a piece falls over successive tick calls, and locks once it cannot fall further', () => {
    const game = new LineClearSprint()
    let state = init(['p'])
    // The I's one row sits at y + 1: it spawns at y = -1 and rests on the floor at y = ROWS - 2.
    for (let i = 0; i < 11; i++) state = game.tick(state, FALL_INTERVAL_MS, i * FALL_INTERVAL_MS)
    expect(nn(state.boards.get('p')).current?.y).toBe(ROWS - 2) // fell all the way to the floor

    // One more fall step: it can't move further, so it locks and a fresh piece spawns at the top.
    state = game.tick(state, FALL_INTERVAL_MS, 11 * FALL_INTERVAL_MS)
    const after = nn(state.boards.get('p'))
    expect(after.current?.y).toBe(-1)
    expect(after.board.some((c) => c !== 0)).toBe(true)
    expect(after.toppedOut).toBe(false)
  })

  test('onInput move shifts the piece when not blocked, and no-ops at the walls', () => {
    const game = new LineClearSprint()
    let state = init(['p'])
    const startX = nn(state.boards.get('p')).current?.x ?? -1

    state = game.onInput(state, 'p', { kind: 'move', dir: 'left' }, 0)
    expect(nn(state.boards.get('p')).current?.x).toBe(startX - 1)

    // Now against the left wall: further left is a no-op.
    state = game.onInput(state, 'p', { kind: 'move', dir: 'left' }, 0)
    expect(nn(state.boards.get('p')).current?.x).toBe(startX - 1)

    state = game.onInput(state, 'p', { kind: 'move', dir: 'right' }, 0)
    state = game.onInput(state, 'p', { kind: 'move', dir: 'right' }, 0)
    const rightmost = nn(state.boards.get('p')).current?.x
    state = game.onInput(state, 'p', { kind: 'move', dir: 'right' }, 0)
    expect(nn(state.boards.get('p')).current?.x).toBe(rightmost) // blocked at the right wall
  })

  test('onInput drop locks the piece immediately', () => {
    const game = new LineClearSprint()
    let state = init(['p'])
    state = game.onInput(state, 'p', { kind: 'drop' }, 0)
    const after = nn(state.boards.get('p'))
    expect(after.current?.y).toBe(-1) // a fresh piece has already spawned
    expect(after.board.some((c) => c !== 0)).toBe(true) // the dropped piece got baked in
  })

  test('getResult ranks more linesCleared above fewer', () => {
    const game = new LineClearSprint()
    const state = init(['a', 'b'])
    nn(state.boards.get('a')).linesCleared = 3
    nn(state.boards.get('b')).linesCleared = 1
    const result = game.getResult(state)
    expect(result.placements[0]).toBe('a')
    expect(result.placements[1]).toBe('b')
    expect(nn(result.stats).a).toBe('3 lines')
    expect(nn(result.stats).b).toBe('1 lines')
  })

  test('a tie in linesCleared is broken in favor of the player who topped out less', () => {
    const game = new LineClearSprint()
    const state = init(['a', 'b'])
    nn(state.boards.get('a')).linesCleared = 2
    nn(state.boards.get('b')).linesCleared = 2
    state.topOuts.set('b', 1)
    const result = game.getResult(state)
    expect(result.placements[0]).toBe('a')
    expect(nn(result.ranks).a).toBeLessThan(nn(result.ranks).b)
  })

  test('topping out costs lines and a short freeze, then the board starts over empty', () => {
    const game = new LineClearSprint()
    let state = init(['p'])
    const p = nn(state.boards.get('p'))
    p.linesCleared = 5
    // Hard-dropping I pieces in the middle stacks one row each until the next one can't spawn.
    for (let i = 0; i < ROWS && !p.toppedOut; i++) {
      state = game.onInput(state, 'p', { kind: 'drop' }, 1000)
    }
    expect(p.toppedOut).toBe(true)
    expect(p.linesCleared).toBe(3)
    expect(state.topOuts.get('p')).toBe(1)
    // Frozen for a moment (inputs are ignored)...
    state = game.tick(state, 50, 2400)
    state = game.onInput(state, 'p', { kind: 'move', dir: 'left' }, 2400)
    expect(p.toppedOut).toBe(true)
    // ...then back in the game with an empty board, the penalty paid once.
    state = game.tick(state, 50, 2500)
    expect(p.toppedOut).toBe(false)
    expect(p.board.every((c) => c === 0)).toBe(true)
    expect(p.linesCleared).toBe(3)
    expect(game.snapshot(state, 2500).boards.p?.toppedOut).toBe(false)
    expect(game.isFinished(state, 2500)).toBe(false)
  })

  test('the lines penalty never goes below zero', () => {
    const game = new LineClearSprint()
    let state = init(['p'])
    const p = nn(state.boards.get('p'))
    p.linesCleared = 1
    for (let i = 0; i < ROWS && !p.toppedOut; i++) {
      state = game.onInput(state, 'p', { kind: 'drop' }, 1000)
    }
    expect(p.linesCleared).toBe(0)
  })

  test('the round ends early once every player has left', () => {
    const game = new LineClearSprint()
    let state = init(['a', 'b'])
    state = game.leave(state, 'a', 1000)
    expect(game.isFinished(state, 1000)).toBe(false)
    state = game.leave(state, 'b', 2000)
    expect(game.isFinished(state, 2000)).toBe(true)
  })

  test('isFinished is false before endsAt and true at/after it', () => {
    const game = new LineClearSprint()
    const state = init(['a'], 1000)
    expect(game.isFinished(state, 999)).toBe(false)
    expect(game.isFinished(state, 1000)).toBe(true)
    expect(game.isFinished(state, 1001)).toBe(true)
  })
})

describe('LineClearSprint wire + soft drop', () => {
  test('soft drop moves one row, and the snapshot carries the stack, the piece and the ack', () => {
    const game = new LineClearSprint()
    let state = init(['p'])
    state = game.onInput(state, 'p', { kind: 'soft', seq: 1 }, 0)
    state = game.onInput(state, 'p', { kind: 'rotate', dir: 'ccw', seq: 2 }, 0)
    const board = nn(game.snapshot(state, 0).boards.p)
    expect(board.ack).toBe(2)
    expect(board.piece).toEqual([0, 1, 0, 3])
    expect(board.cells).toBe('0'.repeat(72))
    expect(board.next).toBe('0000')
  })

  test('malformed inputs are ignored', () => {
    const game = new LineClearSprint()
    let state = init(['p'])
    const before = JSON.stringify(game.snapshot(state, 0))
    state = game.onInput(state, 'p', { kind: 'warp' } as never, 0)
    state = game.onInput(state, 'p', { kind: 'move', dir: 'up' } as never, 0)
    expect(JSON.stringify(game.snapshot(state, 0))).toBe(before)
  })
})
