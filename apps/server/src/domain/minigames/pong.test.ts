import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { Pong, type PongState } from './pong'

const half: Random = { next: () => 0.5 }
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const init = (players: string[], now = 0): PongState =>
  new Pong().init({ players, seed: 1, random: half, now, config: { durationMs: 45_000 } })

describe('Pong', () => {
  test('seeded pairing puts two players in one duel', () => {
    const s = init(['a', 'b'])
    expect(s.duels.length).toBe(1)
    const d = nn(s.duels[0])
    expect(d.a).toBe('a')
    expect(d.b).toBe('b')
    expect(d.done).toBe(false)
  })

  test('an odd player out gets a bye = immediate win', () => {
    const s = init(['solo'])
    const d = nn(s.duels[0])
    expect(d.b).toBeNull()
    expect(d.done).toBe(true)
    expect(d.winner).toBe('solo')
  })

  test('a paddle covering the ball bounces it back into play', () => {
    const game = new Pong()
    const s = init(['a', 'b'])
    const d = nn(s.duels[0])
    d.ball = { x: 0.05, y: 0.5, vx: -0.55, vy: 0 }
    d.padY.set('a', 0.5) // aligned with the ball
    game.tick(s, 1000, 1000)
    expect(d.ball.vx).toBeGreaterThan(0) // reflected rightward
    expect(d.score.get('b')).toBe(0) // no point conceded
  })

  test('missing the ball concedes a point to the opponent', () => {
    const game = new Pong()
    const s = init(['a', 'b'])
    const d = nn(s.duels[0])
    d.ball = { x: 0.05, y: 0.9, vx: -0.55, vy: 0 }
    d.padY.set('a', 0.1) // far from the ball → miss
    game.tick(s, 1000, 1000)
    expect(d.score.get('b')).toBe(1)
  })

  test('reaching WIN_SCORE ends the duel with a winner', () => {
    const game = new Pong()
    const s = init(['a', 'b'])
    const d = nn(s.duels[0])
    d.score.set('a', 4)
    d.ball = { x: 0.95, y: 0.5, vx: 0.55, vy: 0 }
    d.padY.set('b', 0.05) // b misses → a scores the 5th
    game.tick(s, 1000, 1000)
    expect(d.done).toBe(true)
    expect(d.winner).toBe('a')
    const result = game.getResult(s)
    expect(result.ranks?.a).toBe(0)
    expect(result.ranks?.b).toBe(1)
    expect(result.placements[0]).toBe('a')
  })

  test('snapshot mirrors the ball for the right-side player and hides nothing sensitive', () => {
    const game = new Pong()
    const s = init(['a', 'b'])
    const d = nn(s.duels[0])
    d.ball = { x: 0.3, y: 0.4, vx: 0.55, vy: 0 }
    const snap = game.snapshot(s, 1000)
    expect(snap.players.a?.ballX).toBeCloseTo(0.3) // left player: unmirrored
    expect(snap.players.b?.ballX).toBeCloseTo(0.7) // right player: mirrored
    expect(snap.players.a?.side).toBe('left')
    expect(snap.players.b?.side).toBe('right')
  })
})
