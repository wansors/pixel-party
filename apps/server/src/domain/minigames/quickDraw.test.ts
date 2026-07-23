import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { QuickDraw } from './quickDraw'

// Deterministic RNG: next()=0 → a fixed shuffle and the minimum fire delay (2000ms) per duel.
const zero: Random = { next: () => 0 }
const nn = <T>(x: T | null | undefined): T => {
  if (x === null || x === undefined) throw new Error('unexpected nullish')
  return x
}
const init = (players: string[], now = 0) =>
  new QuickDraw().init({ players, seed: 1, random: zero, now })

describe('QuickDraw', () => {
  test('seeds a single duel for two players and a bye win for a solo player', () => {
    const a = init(['p1', 'p2'])
    const b = init(['p1', 'p2'])
    expect(a.duels.length).toBe(1)
    expect(nn(a.duels[0]).b).not.toBeNull()
    // Deterministic pairing from the seeded Random port.
    expect(a.duels.map((d) => [d.a, d.b])).toEqual(b.duels.map((d) => [d.a, d.b]))

    const solo = init(['solo'])
    const duel = nn(solo.duels[0])
    expect(duel.b).toBeNull()
    expect(duel.done).toBe(true)
    expect(duel.winner).toBe('solo')
    const result = new QuickDraw().getResult(solo)
    expect(result.ranks?.solo).toBe(0)
  })

  test('a valid draw after the signal wins the duel', () => {
    const game = new QuickDraw()
    let s = init(['p1', 'p2'])
    const duel = nn(s.duels[0])
    const drawer = duel.a
    const opponent = nn(duel.b)
    s = game.onInput(s, drawer, { kind: 'draw' }, duel.fireAt + 300)
    const after = nn(s.duels[0])
    expect(after.done).toBe(true)
    expect(after.winner).toBe(drawer)
    const result = game.getResult(s)
    expect(result.ranks?.[drawer]).toBe(0)
    expect(result.ranks?.[opponent]).toBe(1)
    expect(result.stats?.[drawer]).toBe('300 ms')
  })

  test('a draw before the signal is a false start and loses', () => {
    const game = new QuickDraw()
    let s = init(['p1', 'p2'])
    const duel = nn(s.duels[0])
    const jumper = duel.a
    const opponent = nn(duel.b)
    s = game.onInput(s, jumper, { kind: 'draw' }, duel.fireAt - 500)
    const after = nn(s.duels[0])
    expect(after.done).toBe(true)
    expect(after.falseStart.has(jumper)).toBe(true)
    expect(after.winner).toBe(opponent)
    const result = game.getResult(s)
    expect(result.ranks?.[jumper]).toBe(1)
    expect(result.ranks?.[opponent]).toBe(0)
    expect(result.stats?.[jumper]).toBe('false start')
  })

  test('snapshot exposes `fired` before/after the signal without leaking the raw fireAt', () => {
    const game = new QuickDraw()
    const s = init(['p1', 'p2'])
    const duel = nn(s.duels[0])
    const before = game.snapshot(s, duel.fireAt - 1).players[duel.a]
    const after = game.snapshot(s, duel.fireAt).players[duel.a]
    expect(nn(before).fired).toBe(false)
    expect(nn(after).fired).toBe(true)
    expect(Object.keys(nn(before))).not.toContain('fireAt')
  })
})
