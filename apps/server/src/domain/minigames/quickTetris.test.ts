import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { QuickTetris, TARGET_LINES } from './quickTetris'

// The exact shapes don't matter for these tests, which drive `doneAt`/`linesCleared` directly rather
// than simulating a full clear sequence.
const zero: Random = { next: () => 0 }

const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}

const init = (players: string[], durationMs = 45_000) =>
  new QuickTetris().init({ players, seed: 1, random: zero, now: 0, config: { durationMs } })

describe('QuickTetris', () => {
  test('reaching TARGET_LINES sets doneAt, and a finisher ranks above one who has not finished', () => {
    const game = new QuickTetris()
    let state = init(['a', 'b'])
    nn(state.boards.get('a')).linesCleared = TARGET_LINES
    nn(state.boards.get('b')).linesCleared = 3

    state = game.tick(state, 0, 500)
    expect(state.doneAt.get('a')).toBe(500)
    expect(state.doneAt.get('b')).toBe(0)

    const result = game.getResult(state)
    expect(result.placements[0]).toBe('a')
    expect(result.placements[1]).toBe('b')
    expect(nn(result.stats).b).toBe(`3/${TARGET_LINES}`)
  })

  test('isFinished becomes true once every player has a doneAt, even before endsAt', () => {
    const game = new QuickTetris()
    const state = init(['a', 'b'])
    expect(game.isFinished(state, 100)).toBe(false)

    state.doneAt.set('a', 100)
    expect(game.isFinished(state, 100)).toBe(false)

    state.doneAt.set('b', 150)
    expect(game.isFinished(state, 150)).toBe(true)
  })

  test('a topped-out player counts as finished for the early end', () => {
    const game = new QuickTetris()
    const state = init(['a', 'b'])
    state.doneAt.set('a', 100)
    expect(game.isFinished(state, 200)).toBe(false)
    nn(state.boards.get('b')).toppedOut = true
    expect(game.isFinished(state, 200)).toBe(true)
    // Both topped out: nobody is left racing either.
    const both = init(['a', 'b'])
    for (const id of ['a', 'b']) nn(both.boards.get(id)).toppedOut = true
    expect(game.isFinished(both, 200)).toBe(true)
  })

  test('a player who left no longer holds up the early end', () => {
    const game = new QuickTetris()
    let state = init(['a', 'b'])
    state.doneAt.set('a', 100)
    state = game.leave(state, 'b', 150)
    expect(game.isFinished(state, 200)).toBe(true)
  })

  test('isFinished is also true once the timer runs out, regardless of doneAt', () => {
    const game = new QuickTetris()
    const state = init(['a', 'b'], 1000)
    expect(game.isFinished(state, 999)).toBe(false)
    expect(game.isFinished(state, 1000)).toBe(true)
  })

  test('onInput no-ops once a player has finished', () => {
    const game = new QuickTetris()
    let state = init(['p'])
    nn(state.boards.get('p')).linesCleared = TARGET_LINES
    state = game.tick(state, 0, 200)
    expect(state.doneAt.get('p')).toBe(200)

    const before = nn(state.boards.get('p')).current?.x
    state = game.onInput(state, 'p', { kind: 'move', dir: 'left', seq: 7 }, 300)
    expect(nn(state.boards.get('p')).current?.x).toBe(before)
    // ...but the input is still acknowledged, so the client stops replaying it.
    expect(game.snapshot(state, 300).boards.p?.ack).toBe(7)
  })

  test('two finishers rank by finish time ascending; two non-finishers by linesCleared descending', () => {
    const game = new QuickTetris()
    let state = init(['a', 'b', 'c', 'd'])
    nn(state.boards.get('a')).linesCleared = TARGET_LINES
    nn(state.boards.get('b')).linesCleared = TARGET_LINES
    nn(state.boards.get('c')).linesCleared = 5
    nn(state.boards.get('d')).linesCleared = 2

    state = game.tick(state, 0, 300) // a and b both finish now, but b finished "earlier"
    state.doneAt.set('a', 300)
    state.doneAt.set('b', 100)

    const result = game.getResult(state)
    expect(result.placements).toEqual(['b', 'a', 'c', 'd'])
  })
})
