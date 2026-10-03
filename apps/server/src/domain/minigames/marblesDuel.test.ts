import { describe, expect, test } from 'bun:test'
import { MARBLES } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { MarblesDuel, type MarblesState } from './marblesDuel'

const game = new MarblesDuel()
const init = (players: string[], seed = 4): MarblesState =>
  game.init({
    players,
    seed,
    random: new SeededRandom(seed),
    now: 0,
    config: { durationMs: 50_000 },
  })
const duelOf = (s: MarblesState, id: string) => {
  const d = s.duels[s.playerDuel.get(id) ?? -1]
  if (!d?.b) throw new Error(`no duel for ${id}`)
  return d
}
const roles = (s: MarblesState, id: string) => {
  const v = game.snapshot(s, 0).players[id]
  const d = duelOf(s, id)
  const other = d.a === id ? (d.b as string) : d.a
  return v?.role === 'hide' ? { hider: id, guesser: other } : { hider: other, guesser: id }
}

describe('MarblesDuel', () => {
  test('pairs players with ten marbles each; an odd player out gets a bye win', () => {
    const s = init(['a', 'b', 'c'])
    const bye = s.duels.find((d) => d.b === null)
    expect(bye?.phase).toBe('done')
    const d = s.duels.find((x) => x.b !== null)
    expect(d?.marbles.get(d.a)).toBe(MARBLES.start)
  })

  test('a right call takes the bet from the hider; a wrong one pays it; roles swap', () => {
    const s = init(['a', 'b'])
    const { hider, guesser } = roles(s, 'a')
    game.onInput(s, hider, { kind: 'hide', count: 3 }, 100)
    // The hidden count is not on the wire before the reveal.
    expect(JSON.stringify(game.snapshot(s, 150))).not.toContain('"hidden":3')
    game.onInput(s, guesser, { kind: 'guess', bet: 4, odd: true }, 200)
    const d = duelOf(s, 'a')
    expect(d.phase).toBe('reveal')
    expect(d.marbles.get(guesser)).toBe(14)
    expect(d.marbles.get(hider)).toBe(6)
    expect(game.snapshot(s, 300).players[guesser]?.last?.correct).toBe(true)
    // Next turn: the roles swap; a wrong call pays the hider (capped by what the guesser has).
    game.tick(s, 50, 200 + MARBLES.revealMs)
    expect(game.snapshot(s, 200 + MARBLES.revealMs).players[hider]?.role).toBe('guess')
    game.onInput(s, guesser, { kind: 'hide', count: 2 }, 3000)
    game.onInput(s, hider, { kind: 'guess', bet: 6, odd: true }, 3000)
    expect(d.marbles.get(hider)).toBe(0)
    expect(d.winner).toBe(guesser)
    game.tick(s, 50, 3000 + MARBLES.revealMs)
    expect(d.phase).toBe('done')
    expect(game.isFinished(s, 3000 + MARBLES.revealMs)).toBe(true)
    const result = game.getResult(s)
    expect(result.ranks?.[guesser]).toBe(0)
    expect(result.ranks?.[hider]).toBe(1)
    expect(result.stats?.[guesser]).toBe('20')
  })

  test('a turn left to the timer resolves with seeded picks', () => {
    const s = init(['a', 'b'])
    game.tick(s, 50, MARBLES.chooseMs)
    const d = duelOf(s, 'a')
    expect(d.phase).toBe('reveal')
    expect(d.last?.bet).toBe(1)
    expect(d.last?.hidden ?? 0).toBeGreaterThanOrEqual(1)
    const total = (d.marbles.get(d.a) ?? 0) + (d.marbles.get(d.b as string) ?? 0)
    expect(total).toBe(MARBLES.start * 2)
  })

  test('at the bell, more marbles wins; equal is a draw; bad moves are ignored', () => {
    const s = init(['a', 'b'])
    const d = duelOf(s, 'a')
    const { hider, guesser } = roles(s, 'a')
    game.onInput(s, hider, { kind: 'hide', count: 11 }, 100) // more than they have
    game.onInput(s, hider, { kind: 'guess', bet: 1, odd: true }, 100) // not their role
    game.onInput(s, guesser, { kind: 'guess', bet: 0, odd: true }, 100)
    expect(d.hidden).toBeNull()
    expect(d.bet).toBeNull()
    expect(game.getResult(s).ranks?.a).toBe(0) // 10 v 10 at the bell: a draw
    d.marbles.set('a', 12)
    d.marbles.set('b', 8)
    expect(game.getResult(s).ranks?.b).toBe(1)
  })
})
