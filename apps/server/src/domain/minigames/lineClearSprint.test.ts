import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { LineClearSprint } from './lineClearSprint'
import { FALL_INTERVAL_MS } from './tetrisCore'

// Always draws the "I" piece (shapeIndex 0, width 4) so the piece sequence is fully predictable.
const zero: Random = { next: () => 0 }

const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}

const init = (players: string[], durationMs = 60_000) =>
  new LineClearSprint().init({ players, seed: 1, random: zero, now: 0, config: { durationMs } })

describe('LineClearSprint', () => {
  test('a piece falls over successive tick calls, and locks once it cannot fall further', () => {
    const game = new LineClearSprint()
    let state = init(['p'])
    for (let i = 0; i < 11; i++) state = game.tick(state, FALL_INTERVAL_MS, i * FALL_INTERVAL_MS)
    expect(nn(state.boards.get('p')).current.y).toBe(11) // fell all the way to the floor

    // One more fall step: it can't move further, so it locks and a fresh piece spawns at the top.
    state = game.tick(state, FALL_INTERVAL_MS, 11 * FALL_INTERVAL_MS)
    const after = nn(state.boards.get('p'))
    expect(after.current.y).toBe(0)
    expect(after.board.some((c) => c !== 0)).toBe(true)
    expect(after.toppedOut).toBe(false)
  })

  test('onInput move shifts the piece when not blocked, and no-ops at the walls', () => {
    const game = new LineClearSprint()
    let state = init(['p'])
    const startX = nn(state.boards.get('p')).current.x

    state = game.onInput(state, 'p', { kind: 'move', dir: 'left' }, 0)
    expect(nn(state.boards.get('p')).current.x).toBe(startX - 1)

    // Now against the left wall: further left is a no-op.
    state = game.onInput(state, 'p', { kind: 'move', dir: 'left' }, 0)
    expect(nn(state.boards.get('p')).current.x).toBe(startX - 1)

    state = game.onInput(state, 'p', { kind: 'move', dir: 'right' }, 0)
    state = game.onInput(state, 'p', { kind: 'move', dir: 'right' }, 0)
    const rightmost = nn(state.boards.get('p')).current.x
    state = game.onInput(state, 'p', { kind: 'move', dir: 'right' }, 0)
    expect(nn(state.boards.get('p')).current.x).toBe(rightmost) // blocked at the right wall
  })

  test('onInput drop locks the piece immediately', () => {
    const game = new LineClearSprint()
    let state = init(['p'])
    state = game.onInput(state, 'p', { kind: 'drop' }, 0)
    const after = nn(state.boards.get('p'))
    expect(after.current.y).toBe(0) // a fresh piece has already spawned
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

  test('a tie in linesCleared is broken in favor of the player who did not top out', () => {
    const game = new LineClearSprint()
    const state = init(['a', 'b'])
    nn(state.boards.get('a')).linesCleared = 2
    nn(state.boards.get('b')).linesCleared = 2
    nn(state.boards.get('b')).toppedOut = true
    const result = game.getResult(state)
    expect(result.placements[0]).toBe('a')
    expect(nn(result.ranks).a).toBeLessThan(nn(result.ranks).b)
  })

  test('isFinished is false before endsAt and true at/after it', () => {
    const game = new LineClearSprint()
    const state = init(['a'], 1000)
    expect(game.isFinished(state, 999)).toBe(false)
    expect(game.isFinished(state, 1000)).toBe(true)
    expect(game.isFinished(state, 1001)).toBe(true)
  })
})
