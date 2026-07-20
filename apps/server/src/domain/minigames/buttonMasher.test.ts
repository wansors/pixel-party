import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { ButtonMasher } from './buttonMasher'

const noRandom: Random = { next: () => 0 }
const init = (players: string[], now = 0, durationMs = 1000) =>
  new ButtonMasher().init({ players, seed: 1, random: noRandom, now, config: { durationMs } })

describe('ButtonMasher', () => {
  test('counts presses inside the window only', () => {
    const game = new ButtonMasher()
    let s = init(['a', 'b'], 0, 1000)
    s = game.onInput(s, 'a', { kind: 'mash' }, 100)
    s = game.onInput(s, 'a', { kind: 'mash' }, 200)
    s = game.onInput(s, 'a', { kind: 'mash' }, 5000) // after window — ignored
    s = game.onInput(s, 'b', { kind: 'mash' }, 300)
    expect(s.counts.get('a')).toBe(2)
    expect(s.counts.get('b')).toBe(1)
  })

  test('ignores presses from players not in the round', () => {
    const game = new ButtonMasher()
    let s = init(['a'], 0, 1000)
    s = game.onInput(s, 'ghost', { kind: 'mash' }, 100)
    expect(s.counts.has('ghost')).toBe(false)
  })

  test('isFinished once now reaches the deadline', () => {
    const game = new ButtonMasher()
    const s = init(['a'], 0, 1000)
    expect(game.isFinished(s, 999)).toBe(false)
    expect(game.isFinished(s, 1000)).toBe(true)
  })

  test('ranks by count with ties sharing a rank', () => {
    const game = new ButtonMasher()
    let s = init(['a', 'b', 'c'], 0, 1000)
    s = game.onInput(s, 'a', { kind: 'mash' }, 10)
    s = game.onInput(s, 'a', { kind: 'mash' }, 20)
    s = game.onInput(s, 'b', { kind: 'mash' }, 30)
    s = game.onInput(s, 'c', { kind: 'mash' }, 40)
    const result = game.getResult(s)
    expect(result.placements[0]).toBe('a')
    // b and c tie for 2nd (rank index 1)
    expect(result.ranks?.b).toBe(1)
    expect(result.ranks?.c).toBe(1)
  })
})
