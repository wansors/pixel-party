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
  new QuickDraw().init({ players, seed: 1, random: zero, now, config: { durationMs: 20_000 } })

describe('QuickDraw', () => {
  test('seeds a single duel for two players; an odd player out gets a bye, not a win', () => {
    const a = init(['p1', 'p2'])
    const b = init(['p1', 'p2'])
    expect(a.duels.length).toBe(1)
    expect(nn(a.duels[0]).b).not.toBeNull()
    // Deterministic pairing from the seeded Random port.
    expect(a.duels.map((d) => [d.a, d.b])).toEqual(b.duels.map((d) => [d.a, d.b]))

    const game = new QuickDraw()
    const trio = init(['p1', 'p2', 'p3'])
    const duel = nn(trio.duels.find((d) => d.b !== null))
    const bye = nn(trio.duels.find((d) => d.b === null)).a
    game.onInput(trio, duel.a, { kind: 'draw' }, duel.fireAt + 250)
    const result = game.getResult(trio)
    // Win > bye > loss: the bye scores like a draw, never like a win.
    expect(result.placements).toEqual([duel.a, bye, nn(duel.b)])
    expect(result.byes).toEqual([bye])
    expect(game.snapshot(trio, 0).players[bye]?.won).toBeNull()
  })

  test('the bye goes to whoever has had the fewest', () => {
    const game = new QuickDraw()
    const s1 = game.init({
      players: ['p1', 'p2', 'p3'],
      seed: 1,
      random: zero,
      now: 0,
      byeCounts: { p1: 1, p3: 1 },
    })
    expect(nn(s1.duels.find((d) => d.b === null)).a).toBe('p2')
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

  test('nobody drawing is a loss for both, below a bye', () => {
    const game = new QuickDraw()
    let st = init(['p1', 'p2', 'p3'])
    const duel = nn(st.duels.find((d) => d.b !== null))
    const bye = nn(st.duels.find((d) => d.b === null)).a
    st = game.tick(st, 50, 20_000)
    expect(game.isFinished(st, 20_000)).toBe(true)
    const snap = game.snapshot(st, 20_000)
    expect(snap.players[duel.a]?.won).toBe(false)
    expect(snap.players[nn(duel.b)]?.won).toBe(false)
    const result = game.getResult(st)
    expect(result.placements[0]).toBe(bye)
    expect(result.ranks?.[duel.a]).toBe(1)
    expect(result.ranks?.[nn(duel.b)]).toBe(1)
    expect(result.stats?.[duel.a]).toBe('no tap')
  })

  test('winners rank by reaction time; losers by the draw that beat them; false starts last', () => {
    const game = new QuickDraw()
    let st = init(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'])
    const [d1, d2, d3] = st.duels.map(nn)
    if (!d1 || !d2 || !d3) throw new Error('three duels expected')
    st = game.onInput(st, d1.a, { kind: 'draw' }, d1.fireAt + 400) // slow winner
    st = game.onInput(st, d2.a, { kind: 'draw' }, d2.fireAt + 180) // fast winner
    st = game.onInput(st, d3.a, { kind: 'draw' }, d3.fireAt - 100) // false start
    const result = game.getResult(st)
    expect(result.placements).toEqual([d2.a, d1.a, nn(d3.b), nn(d2.b), nn(d1.b), d3.a])
    // The winner by a false start never got to draw: excused from the engine's idle demotion.
    expect(result.waiting).toEqual([nn(d3.b)])
  })

  test('a player who leaves forfeits the standoff', () => {
    const game = new QuickDraw()
    let st = init(['p1', 'p2'])
    const duel = nn(st.duels[0])
    st = game.leave(st, nn(duel.b), 1000)
    expect(game.isFinished(st, 1000)).toBe(true)
    expect(game.snapshot(st, 1000).players[duel.a]).toMatchObject({ won: true, oppLeft: true })
    expect(game.getResult(st).placements).toEqual([duel.a, nn(duel.b)])
  })
})
