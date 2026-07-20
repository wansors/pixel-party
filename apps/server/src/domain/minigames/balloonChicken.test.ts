import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { BalloonChicken } from './balloonChicken'

// next() = 0 -> threshold = MIN_THRESHOLD (5) for every player.
const zero: Random = { next: () => 0 }
const init = (players: string[], now = 0) =>
  new BalloonChicken().init({ players, seed: 1, random: zero, now, config: { durationMs: 20_000 } })

describe('BalloonChicken', () => {
  test('threshold is seeded per player and hidden from the snapshot', () => {
    const game = new BalloonChicken()
    const s = init(['a'])
    expect(s.players.get('a')?.threshold).toBe(5)
    const snap = game.snapshot(s, 0)
    expect((snap.players.a as unknown as Record<string, unknown>).threshold).toBeUndefined()
  })

  test('cashing out banks pumps * pointsPerPump and locks the balloon', () => {
    const game = new BalloonChicken()
    let s = init(['a'])
    for (let i = 0; i < 4; i++) s = game.onInput(s, 'a', { kind: 'pump' }, 1000)
    s = game.onInput(s, 'a', { kind: 'cashout' }, 1000)
    const p = s.players.get('a')
    expect(p?.status).toBe('cashed')
    expect(p?.banked).toBe(40)
    // Further input after cashing is ignored.
    s = game.onInput(s, 'a', { kind: 'pump' }, 1000)
    expect(s.players.get('a')?.pumps).toBe(4)
  })

  test('reaching the threshold bursts the balloon to zero', () => {
    const game = new BalloonChicken()
    let s = init(['a'])
    for (let i = 0; i < 5; i++) s = game.onInput(s, 'a', { kind: 'pump' }, 1000)
    const p = s.players.get('a')
    expect(p?.status).toBe('burst')
    expect(p?.banked).toBe(0)
  })

  test('a burst player ranks below anyone who banked points', () => {
    const game = new BalloonChicken()
    let s = init(['a', 'b'])
    for (let i = 0; i < 3; i++) s = game.onInput(s, 'a', { kind: 'pump' }, 1000)
    s = game.onInput(s, 'a', { kind: 'cashout' }, 1000) // banks 30
    for (let i = 0; i < 5; i++) s = game.onInput(s, 'b', { kind: 'pump' }, 1000) // burst
    const r = game.getResult(s)
    expect(r.placements[0]).toBe('a')
    expect(r.ranks?.a).toBe(0)
    expect(r.ranks?.b).toBe(1)
  })

  test('still-inflating survivors auto-bank at the buzzer', () => {
    const game = new BalloonChicken()
    let s = init(['a'])
    for (let i = 0; i < 3; i++) s = game.onInput(s, 'a', { kind: 'pump' }, 1000)
    const r = game.getResult(s)
    expect(r.placements[0]).toBe('a') // 3 pumps -> 30 pts, never cashed but survived
  })

  test('input outside the round window is ignored', () => {
    const game = new BalloonChicken()
    let s = init(['a'], 0)
    s = game.onInput(s, 'a', { kind: 'pump' }, 20_000) // at endsAt
    expect(s.players.get('a')?.pumps).toBe(0)
  })
})
