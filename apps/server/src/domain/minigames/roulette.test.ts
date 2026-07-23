import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { Roulette, type RouletteState } from './roulette'

const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
// Ascending values so players get distinct, predictable rolls: 1, 51 for next()=0 then 0.5…
const seq = (...vals: number[]): Random => {
  let i = 0
  return { next: () => vals[i++ % vals.length] ?? 0 }
}
const init = (players: string[], random: Random, now = 0): RouletteState =>
  new Roulette().init({ players, seed: 1, random, now, config: { durationMs: 15_000 } })

describe('Roulette', () => {
  test('deals a seeded value per player, deterministic', () => {
    const a = init(['p', 'q'], seq(0, 0.5))
    expect(a.values.get('p')).toBe(1) // 1 + floor(0*100)
    expect(a.values.get('q')).toBe(51) // 1 + floor(0.5*100)
  })

  test('a value stays hidden until that player spins', () => {
    const game = new Roulette()
    let s = init(['p', 'q'], seq(0, 0.5))
    let snap = game.snapshot(s, 0)
    expect(snap.values.p).toBeUndefined()
    expect(snap.spun.p).toBe(false)
    s = game.onInput(s, 'p', { kind: 'spin' }, 100)
    snap = game.snapshot(s, 100)
    expect(snap.spun.p).toBe(true)
    expect(snap.values.p).toBe(1)
    expect(snap.values.q).toBeUndefined() // q has not spun
  })

  test('all values become public once the round ends', () => {
    const game = new Roulette()
    const s = init(['p', 'q'], seq(0, 0.5))
    const snap = game.snapshot(s, 15_000)
    expect(snap.values.p).toBe(1)
    expect(snap.values.q).toBe(51)
  })

  test('finishes early once everyone has spun', () => {
    const game = new Roulette()
    let s = init(['p', 'q'], seq(0, 0.5))
    s = game.onInput(s, 'p', { kind: 'spin' }, 10)
    expect(game.isFinished(s, 20)).toBe(false)
    s = game.onInput(s, 'q', { kind: 'spin' }, 20)
    expect(game.isFinished(s, 30)).toBe(true)
  })

  test('ranks by value descending', () => {
    const game = new Roulette()
    const s = init(['p', 'q'], seq(0, 0.5))
    const result = game.getResult(s)
    expect(result.placements[0]).toBe('q') // 51 > 1
    expect(result.ranks?.q).toBe(0)
    expect(result.ranks?.p).toBe(1)
    expect(nn(result.stats).q).toBe('51')
  })
})
