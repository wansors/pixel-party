import { describe, expect, test } from 'bun:test'
import { toleranceForShot } from '@pp/shared'
import type { Random } from '../ports/Random'
import { PixelHoops, type PixelHoopsState } from './pixelHoops'

// next() = 0.5 → every target sits at 0.2 + 0.5 * 0.7 = 0.55.
const half: Random = { next: () => 0.5 }
const TARGET = 0.55
const init = (players: string[]): PixelHoopsState =>
  new PixelHoops().init({ players, seed: 1, random: half, now: 0, config: { durationMs: 30_000 } })
const shoot = (index: number, power: number) => ({ kind: 'shoot' as const, index, power })

// Shoots `id`'s next shots, one per entry: true = a basket, false = a clear miss.
function play(game: PixelHoops, s: PixelHoopsState, id: string, shots: boolean[], t = 100) {
  for (const [i, hit] of shots.entries()) {
    const index = s.pointer.get(id) ?? 0
    game.onInput(s, id, shoot(index, hit ? TARGET : 0), t + i)
  }
}

describe('PixelHoops', () => {
  test('a basket needs the power inside the shot tolerance, which tightens with every shot', () => {
    const game = new PixelHoops()
    const s = init(['a', 'b'])
    expect(s.shots[0]).toBeCloseTo(TARGET)
    const tol = toleranceForShot(0)
    game.onInput(s, 'a', shoot(0, TARGET + tol * 0.9), 100)
    game.onInput(s, 'b', shoot(0, TARGET + tol * 1.1), 100)
    expect(s.score.get('a')).toBe(1)
    expect(s.score.get('b')).toBe(0)
    expect(toleranceForShot(30)).toBeLessThan(tol)
  })

  test('a streak adds a capped combo bonus; a miss resets it', () => {
    const game = new PixelHoops()
    const s = init(['a'])
    // Baskets score 1, 2, 3, 4, 5, 5 (bonus capped at +4), then a miss, then 1 again.
    play(game, s, 'a', [true, true, true, true, true, true, false, true])
    expect(s.score.get('a')).toBe(1 + 2 + 3 + 4 + 5 + 5 + 1)
    expect(s.maxCombo.get('a')).toBe(6)
    expect(s.combo.get('a')).toBe(1)
  })

  test('stale shot indices and shots after the buzzer are ignored', () => {
    const game = new PixelHoops()
    const s = init(['a'])
    game.onInput(s, 'a', shoot(3, TARGET), 100)
    game.onInput(s, 'a', shoot(0, TARGET), s.endsAt)
    expect(s.pointer.get('a')).toBe(0)
    expect(s.score.get('a')).toBe(0)
  })

  test('ranks by points, then by the longest streak', () => {
    const game = new PixelHoops()
    const s = init(['streak', 'spread', 'low'])
    play(game, s, 'streak', [true, true, false]) // 1 + 2 = 3, best streak 2
    play(game, s, 'spread', [true, false, true, false, true]) // 3, best streak 1
    play(game, s, 'low', [true]) // 1
    const r = game.getResult(s)
    expect(r.placements).toEqual(['streak', 'spread', 'low'])
    expect(r.ranks).toEqual({ streak: 0, spread: 1, low: 2 })
    expect(r.stats?.streak).toBe('3 pts · x2')
  })

  test('the round ends early when every shot is taken — a leaver is skipped to the end', () => {
    const game = new PixelHoops()
    let s = init(['a', 'gone'])
    play(
      game,
      s,
      'a',
      Array.from({ length: s.shots.length }, () => false),
    )
    expect(game.isFinished(s, 500)).toBe(false)
    s = game.leave(s, 'gone', 500)
    expect(game.isFinished(s, 500)).toBe(true)
    expect(game.snapshot(s, 500).shots.gone).toBeNull()
  })
})
