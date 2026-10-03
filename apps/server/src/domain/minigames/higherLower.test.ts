import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { HigherLower, type HigherLowerState } from './higherLower'

// Small deterministic LCG: varied cards (a constant Random would deal the same card forever).
const lcg = (seed: number): Random => {
  let x = seed >>> 0
  return {
    next: () => {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0
      return x / 2 ** 32
    },
  }
}
const game = new HigherLower()
const init = (players: string[], seed = 7) =>
  game.init({ players, seed, random: lcg(seed), now: 0, config: { durationMs: 22_000 } })
const run = (s: HigherLowerState, id: string) =>
  s.runs.get(id) as NonNullable<ReturnType<typeof s.runs.get>>
// The right (or wrong) call on `id`'s next card.
const call = (s: HigherLowerState, id: string, right: boolean): 'higher' | 'lower' => {
  const r = run(s, id)
  const up = (r.deck[r.index + 1] as number) > (r.deck[r.index] as number)
  return up === right ? 'higher' : 'lower'
}
const guess = (s: HigherLowerState, id: string, right: boolean, now = 1000) =>
  game.onInput(s, id, { kind: 'guess', index: run(s, id).index, dir: call(s, id, right) }, now)

describe('HigherLower', () => {
  test('every player gets their own seeded deck, no two consecutive cards equal', () => {
    const s = init(['a', 'b'])
    expect(run(s, 'a').deck).not.toEqual(run(s, 'b').deck)
    expect(init(['a', 'b']).runs.get('b')?.deck).toEqual(run(s, 'b').deck)
    for (const id of ['a', 'b']) {
      const deck = run(s, id).deck
      for (let i = 1; i < deck.length; i++) expect(deck[i]).not.toBe(deck[i - 1])
    }
  })

  test('a right guess extends the streak; a miss ends the run and halves it', () => {
    let s = init(['a'])
    for (let i = 0; i < 5; i++) s = guess(s, 'a', true)
    expect(run(s, 'a').score).toBe(5)
    s = guess(s, 'a', false)
    expect(run(s, 'a')).toMatchObject({ status: 'bust', score: 2, index: 5 })
    // Over: further guesses are ignored.
    s = guess(s, 'a', true)
    expect(run(s, 'a').index).toBe(5)
  })

  test('BANK stops the run and keeps the whole streak', () => {
    let s = init(['a', 'b'])
    for (let i = 0; i < 3; i++) s = guess(s, 'a', true)
    s = game.onInput(s, 'a', { kind: 'bank' }, 1000)
    expect(run(s, 'a')).toMatchObject({ status: 'banked', score: 3 })
    s = guess(s, 'a', true)
    expect(run(s, 'a').score).toBe(3)
  })

  test('stale indices are ignored', () => {
    let s = init(['a'])
    s = game.onInput(s, 'a', { kind: 'guess', index: 3, dir: call(s, 'a', true) }, 1000)
    expect(run(s, 'a').index).toBe(0)
  })

  test("the snapshot never shows anyone's next card while they play", () => {
    let s = init(['a', 'b'])
    s = guess(s, 'a', true)
    s = guess(s, 'b', false)
    const snap = game.snapshot(s, 1000)
    expect(snap.cards.a).toEqual({
      current: run(s, 'a').deck[1] as number,
      index: 1,
      status: 'playing',
      next: null,
    })
    // Once a run is over its next card turns over (here: the one that beat b's guess).
    expect(snap.cards.b?.next).toBe(run(s, 'b').deck[1] as number)
    expect(snap.scores).toEqual({ a: 1, b: 0 })
  })

  test('ranks by score alone: a bold run halved can tie a cautious bank', () => {
    let s = init(['bold', 'safe', 'idle'])
    for (let i = 0; i < 4; i++) s = guess(s, 'bold', true, 500)
    s = guess(s, 'bold', false, 600) // 4 -> 2
    for (let i = 0; i < 2; i++) s = guess(s, 'safe', true, 5000)
    s = game.onInput(s, 'safe', { kind: 'bank' }, 5000)
    const r = game.getResult(s)
    expect(r.ranks).toEqual({ bold: 0, safe: 0, idle: 2 })
    expect(r.stats?.bold).toBe('streak 2')
  })

  test('the round ends once every run is over; a player gone mid-round is out', () => {
    let s = init(['a', 'b'])
    s = game.onInput(s, 'a', { kind: 'bank' }, 1000)
    expect(game.isFinished(s, 1000)).toBe(false)
    s = game.leave(s, 'b')
    expect(game.isFinished(s, 1000)).toBe(true)
  })

  test('still playing at the buzzer keeps the streak', () => {
    let s = init(['a'])
    s = guess(s, 'a', true)
    expect(game.isFinished(s, 22_000)).toBe(true)
    expect(game.getResult(s).stats?.a).toBe('streak 1')
  })
})
