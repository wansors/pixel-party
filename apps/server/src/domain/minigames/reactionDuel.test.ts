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

  test("the client's own timing is credited, but only within bounds of the server's", () => {
    const game = new ReactionDuel()
    let s = init(['a', 'b', 'c', 'd', 'e'], 0)
    // Server sees 300 ms; the client timed 220 ms from its own green: the 80 ms gap was latency.
    s = game.onInput(s, 'a', { kind: 'tap', ms: 220 }, 1500 + 300)
    // A claim far below the server's measurement only wins back MAX_LATENCY_CREDIT_MS (150).
    s = game.onInput(s, 'b', { kind: 'tap', ms: 40 }, 1500 + 400)
    // Never below the human floor (100 ms)…
    s = game.onInput(s, 'c', { kind: 'tap', ms: 10 }, 1500 + 180)
    // …and never worse than what the server measured.
    s = game.onInput(s, 'd', { kind: 'tap', ms: 900 }, 1500 + 250)
    // No claim (or a bogus one): the server's own measurement.
    s = game.onInput(s, 'e', { kind: 'tap', ms: Number.NaN }, 1500 + 260)
    expect(Object.fromEntries(s.reactions)).toEqual({ a: 220, b: 250, c: 100, d: 250, e: 260 })
  })

  test('a claimed time never turns a tap before green into a reaction', () => {
    const game = new ReactionDuel()
    let s = init(['a', 'b'], 0)
    s = game.onInput(s, 'a', { kind: 'tap', ms: 150 }, 1400)
    expect(s.falseStarts.has('a')).toBe(true)
    expect(s.reactions.has('a')).toBe(false)
  })

  test('a player gone mid-round no longer holds the round open', () => {
    const game = new ReactionDuel()
    let s = init(['a', 'b'], 0)
    s = game.onInput(s, 'a', { kind: 'tap' }, 1700)
    expect(game.isFinished(s, 1700)).toBe(false)
    s = game.leave(s, 'b')
    expect(game.isFinished(s, 1700)).toBe(true)
    expect(game.getResult(s).placements).toEqual(['a', 'b'])
  })

  test('the snapshot lists every round player for the results board', () => {
    const s = init(['a', 'b', 'c'], 0)
    expect(new ReactionDuel().snapshot(s, 0).players).toEqual(['a', 'b', 'c'])
  })
})
