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

  test('an odd player out gets a bye: ranked with the draws, between wins and losses', () => {
    const game = new Pong()
    const s = init(['a', 'b', 'c'])
    const bye = nn(s.duels.find((d) => d.b === null))
    expect(bye.done).toBe(true)
    const duel = nn(s.duels.find((d) => d.b !== null))
    duel.score.set(duel.a, 3)
    game.tick(s, 50, 45_000) // the bell: the leader wins
    const result = game.getResult(s)
    expect(result.placements).toEqual([duel.a, bye.a, duel.b as string])
    expect(result.byes).toEqual([bye.a])
    expect(game.snapshot(s, 45_000).players[bye.a]?.won).toBeNull()
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
    // The velocity is mirrored the same way: toward b's paddle is "toward me" on b's screen.
    expect(snap.players.a?.vx).toBeCloseTo(0.55)
    expect(snap.players.b?.vx).toBeCloseTo(-0.55)
  })

  test('wins rank by point difference across duels', () => {
    const game = new Pong()
    const s = init(['a', 'b', 'c', 'd'])
    const [d1, d2] = s.duels.map(nn)
    if (!d1?.b || !d2?.b) throw new Error('two duels expected')
    d1.score.set(d1.a, 5).set(d1.b, 3)
    d2.score.set(d2.a, 5).set(d2.b, 1)
    Object.assign(d1, { done: true, winner: d1.a })
    Object.assign(d2, { done: true, winner: d2.a })
    expect(game.getResult(s).placements).toEqual([d2.a, d1.a, d1.b, d2.b])
  })

  test('a tie at the bell plays a golden point: the next point wins', () => {
    const game = new Pong()
    const s = init(['a', 'b'])
    const d = nn(s.duels[0])
    d.score.set('a', 2).set('b', 2)
    game.tick(s, 50, 45_000)
    expect(d.golden).toBe(true)
    expect(game.isFinished(s, 45_000)).toBe(false)
    const snap = game.snapshot(s, 46_000)
    expect(snap.players.a?.golden).toBe(true)
    expect(snap.roundRemainingMs).toBe(9000) // the overtime clock
    // Paddles still move in overtime; b misses and a takes the golden point.
    game.onInput(s, 'b', { kind: 'move', y: 0.05 }, 46_000)
    d.ball = { x: 0.95, y: 0.6, vx: 0.55, vy: 0 }
    game.tick(s, 1000, 47_000)
    expect(d.done).toBe(true)
    expect(d.winner).toBe('a')
    expect(game.isFinished(s, 47_000)).toBe(true)
    expect(game.getResult(s).ranks).toEqual({ a: 0, b: 1 })
  })

  test('a golden point that never comes is a draw', () => {
    const game = new Pong()
    const s = init(['a', 'b'])
    nn(s.duels[0]).ball = { x: 0.5, y: 0.5, vx: 0, vy: 0 } // nobody can score
    game.tick(s, 50, 45_000)
    game.tick(s, 50, 55_000)
    expect(game.isFinished(s, 55_000)).toBe(true)
    expect(game.snapshot(s, 55_000).players.a).toMatchObject({ done: true, won: null })
    expect(game.getResult(s).ranks).toEqual({ a: 0, b: 0 })
  })

  test('a player who leaves forfeits the duel', () => {
    const game = new Pong()
    const s = init(['a', 'b'])
    nn(s.duels[0]).score.set('b', 3)
    game.leave(s, 'b', 5000)
    expect(game.isFinished(s, 5000)).toBe(true)
    expect(game.snapshot(s, 5000).players.a).toMatchObject({ won: true, oppLeft: true })
    expect(game.getResult(s).placements).toEqual(['a', 'b'])
  })
})
