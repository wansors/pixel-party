import { describe, expect, test } from 'bun:test'
import {
  MAX_ROOM_PLAYERS,
  MINIGAMES,
  fitsPlayers,
  idealForPlayers,
  playableGames,
} from './minigames'

describe('catalog player fit (D27)', () => {
  test.each(MINIGAMES.map((g) => [g.id, g] as const))('%s has a sane player range', (_id, g) => {
    const { min, max, best } = g.players
    expect(min).toBeGreaterThanOrEqual(1)
    expect(min).toBeLessThanOrEqual(best[0])
    expect(best[0]).toBeLessThanOrEqual(best[1])
    expect(best[1]).toBeLessThanOrEqual(max)
    expect(max).toBeLessThanOrEqual(MAX_ROOM_PLAYERS)
    // Duels pair players up and team games split the room in two: both need a second player.
    if (g.format !== 'ffa') expect(min).toBeGreaterThanOrEqual(2)
  })

  test('every headcount up to the room ceiling has games to play', () => {
    for (let n = 1; n <= MAX_ROOM_PLAYERS; n++) {
      expect(MINIGAMES.filter((g) => fitsPlayers(g.id, n)).length).toBeGreaterThan(0)
    }
  })

  test('Button Masher, the engine fallback, fits any room', () => {
    for (let n = 1; n <= MAX_ROOM_PLAYERS; n++) expect(fitsPlayers('button-masher', n)).toBe(true)
  })

  test('fitsPlayers / idealForPlayers read the hard and the recommended ranges', () => {
    const duel = MINIGAMES.find((g) => g.id === 'sink-the-fleet')
    expect(duel).toBeDefined()
    const { min, max, best } = duel?.players ?? { min: 0, max: 0, best: [0, 0] }
    expect(fitsPlayers('sink-the-fleet', min - 1)).toBe(false)
    expect(fitsPlayers('sink-the-fleet', min)).toBe(true)
    expect(fitsPlayers('sink-the-fleet', max)).toBe(true)
    expect(fitsPlayers('sink-the-fleet', max + 1)).toBe(false)
    expect(idealForPlayers('sink-the-fleet', best[0])).toBe(true)
    expect(fitsPlayers('no-such-game', 4)).toBe(false)
    expect(idealForPlayers('no-such-game', 4)).toBe(false)
  })

  test('playableGames keeps the fitting picks, distinct and in order', () => {
    expect(playableGames(['sink-the-fleet', 'button-masher', 'button-masher'], 1)).toEqual([
      'button-masher',
    ])
    expect(playableGames(['button-masher', 'sink-the-fleet'], 2)).toEqual([
      'button-masher',
      'sink-the-fleet',
    ])
    expect(playableGames(['no-such-game'], 4)).toEqual([])
  })
})
