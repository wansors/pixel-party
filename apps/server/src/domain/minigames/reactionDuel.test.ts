import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { ReactionDuel } from './reactionDuel'

// random.next() = 0 -> delay = MIN_DELAY_MS (1500), so greenAt = now + 1500.
const zero: Random = { next: () => 0 }
const init = (players: string[], now = 0) =>
  new ReactionDuel().init({ players, seed: 1, random: zero, now })

describe('ReactionDuel', () => {
  test('green light delay comes from the Random port (deterministic)', () => {
    const s = init(['a'], 0)
    expect(s.greenAt).toBe(1500)
    expect(new ReactionDuel().snapshot(s, 0).light).toBe('red')
    expect(new ReactionDuel().snapshot(s, 1500).light).toBe('green')
  })

  test('a tap before green is a false start', () => {
    const game = new ReactionDuel()
    let s = init(['a', 'b'], 0)
    s = game.onInput(s, 'a', { kind: 'tap' }, 1000) // early
    s = game.onInput(s, 'b', { kind: 'tap' }, 1600) // valid, 100ms
    expect(s.falseStarts.has('a')).toBe(true)
    expect(s.reactions.get('b')).toBe(100)
  })

  test('fastest valid reaction wins; false starts rank last', () => {
    const game = new ReactionDuel()
    let s = init(['a', 'b', 'c'], 0)
    s = game.onInput(s, 'a', { kind: 'tap' }, 1500 + 250)
    s = game.onInput(s, 'b', { kind: 'tap' }, 1500 + 120)
    s = game.onInput(s, 'c', { kind: 'tap' }, 100) // false start
    const result = game.getResult(s)
    expect(result.placements[0]).toBe('b')
    expect(result.placements[1]).toBe('a')
    expect(result.placements[2]).toBe('c')
    expect(result.ranks?.c).toBe(2)
  })

  test('finishes once every player has resolved', () => {
    const game = new ReactionDuel()
    let s = init(['a'], 0)
    expect(game.isFinished(s, 1600)).toBe(false)
    s = game.onInput(s, 'a', { kind: 'tap' }, 1600)
    expect(game.isFinished(s, 1600)).toBe(true)
  })

  test('finishes at the deadline even if nobody taps', () => {
    const game = new ReactionDuel()
    const s = init(['a', 'b'], 0)
    expect(game.isFinished(s, s.deadline)).toBe(true)
  })
})
