import { describe, expect, test } from 'bun:test'
import {
  SPOOK,
  SPOOK_ITEMS,
  type SpookFigure,
  spookAnswer,
  spookAward,
  spookWindowMs,
} from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { SpookSnatch, type SpookState } from './spookSnatch'

const game = new SpookSnatch()
const init = (players: string[], seed = 5): SpookState =>
  game.init({
    players,
    seed,
    random: new SeededRandom(seed),
    now: 0,
    config: { durationMs: 45_000 },
  })
const fig = (shape: number, color: number): SpookFigure => ({ shape, color, rot: 0, scale: 1 })
// Opens the first card.
const open = (s: SpookState): number => {
  game.tick(s, 0, SPOOK.startDelayMs)
  return SPOOK.startDelayMs
}
const answer = (s: SpookState): number => spookAnswer(game.snapshot(s, 0).figures)
const wrong = (s: SpookState): number => (answer(s) + 1) % SPOOK_ITEMS

describe('Spook Snatch rules (shared)', () => {
  test('an object shown exactly is the one', () => {
    // A red ball (1/1) next to a yellow star (2/3).
    expect(spookAnswer([fig(1, 1), fig(2, 3)])).toBe(1)
  })

  test('otherwise, the one whose shape and colour appear nowhere', () => {
    // Cube in green (0/2), ball in yellow (1/3): no star, no triangle, no heart shape; no blue,
    // red or purple colour... only the heart (4) shares neither.
    expect(spookAnswer([fig(0, 2), fig(1, 3)])).toBe(4)
  })

  test('a card with no single answer is flagged', () => {
    expect(spookAnswer([fig(0, 0), fig(1, 1)])).toBe(-1)
    // Cube in red + ball in blue: three objects share nothing (star, triangle, heart).
    expect(spookAnswer([fig(0, 1), fig(1, 0)])).toBe(-1)
  })

  test('the window shrinks each card, to a floor; places award 3, 2, 1, then 1', () => {
    expect(spookWindowMs(1)).toBe(SPOOK.windowMs)
    expect(spookWindowMs(5)).toBeLessThan(spookWindowMs(4))
    expect(spookWindowMs(50)).toBe(SPOOK.windowMinMs)
    expect([1, 2, 3, 4, 7].map(spookAward)).toEqual([3, 2, 1, 1, 1])
  })
})

describe('SpookSnatch', () => {
  test('every dealt card has exactly one answer, both kinds show up, later cards twist', () => {
    const s = init(['a'])
    let exact = 0
    for (const [i, card] of s.deck.entries()) {
      expect(card.length).toBe(2)
      expect(spookAnswer(card)).toBeGreaterThanOrEqual(0)
      if (card.some((f) => f.shape === f.color)) exact++
      if (i + 1 < SPOOK.twistFrom)
        expect(card.every((f) => f.rot === 0 && f.scale === 1)).toBe(true)
    }
    expect(exact).toBeGreaterThan(10)
    expect(exact).toBeLessThan(s.deck.length - 10)
    expect(s.deck.slice(SPOOK.twistFrom).some((c) => c.some((f) => f.rot !== 0))).toBe(true)
    expect(init(['b']).deck).toEqual(s.deck)
  })

  test('the first right answers score 3, 2, 1 in arrival order', () => {
    const s = init(['a', 'b', 'c', 'd', 'e', 'f'])
    const t = open(s)
    for (const [i, id] of ['c', 'a', 'f', 'b'].entries())
      game.onInput(s, id, { kind: 'grab', item: answer(s), card: 1 }, t + 100 + i)
    const snap = game.snapshot(s, t + 200)
    expect(snap.scores).toEqual({ a: 2, b: 0, c: 3, d: 0, e: 0, f: 1 })
    // Half the room (three of six) got it: the card closed.
    expect(snap.phase).toBe('reveal')
    expect(snap.answer).toBe(spookAnswer(snap.figures))
  })

  test('a wrong grab locks you out, into the next card too', () => {
    const s = init(['a', 'b', 'c', 'd'])
    const t = open(s)
    game.onInput(s, 'a', { kind: 'grab', item: wrong(s), card: 1 }, t + 100)
    // A second try on the same card is ignored.
    game.onInput(s, 'a', { kind: 'grab', item: answer(s), card: 1 }, t + 200)
    expect(game.snapshot(s, t + 200).players.a).toMatchObject({ points: 0, answered: true })
    expect(game.snapshot(s, t + 200).players.a?.lockedMs).toBe(SPOOK.lockMs - 100)
    // Window runs out → reveal → next card, opened while a is still locked.
    game.tick(s, 0, t + spookWindowMs(1))
    const next = t + spookWindowMs(1) + SPOOK.revealMs
    game.tick(s, 0, next)
    expect(game.snapshot(s, next).cardNo).toBe(2)
    if (next < t + 100 + SPOOK.lockMs) {
      game.onInput(s, 'a', { kind: 'grab', item: answer(s), card: 2 }, next)
      expect(game.snapshot(s, next).players.a?.answered).toBe(false)
    }
  })

  test('the card closes once everyone has answered; stale or junk grabs are ignored', () => {
    const s = init(['a', 'b'])
    const t = open(s)
    game.onInput(s, 'a', { kind: 'grab', item: answer(s), card: 9 }, t + 50)
    game.onInput(s, 'a', { kind: 'grab', item: 7, card: 1 }, t + 60)
    expect(game.snapshot(s, t + 70).players.a?.answered).toBe(false)
    game.onInput(s, 'a', { kind: 'grab', item: answer(s), card: 1 }, t + 100)
    game.onInput(s, 'b', { kind: 'grab', item: wrong(s), card: 1 }, t + 120)
    expect(game.snapshot(s, t + 130).phase).toBe('reveal')
  })

  test('nothing to grab before the first card', () => {
    const s = init(['a', 'b'])
    game.onInput(s, 'a', { kind: 'grab', item: 0, card: 0 }, 100)
    expect(game.snapshot(s, 100).phase).toBe('ready')
    expect(game.snapshot(s, 100).figures).toEqual([])
  })

  test('a player who leaves no longer holds a card open', () => {
    const s = init(['a', 'b'])
    const t = open(s)
    game.onInput(s, 'a', { kind: 'grab', item: answer(s), card: 1 }, t + 100)
    game.leave(s, 'b', t + 200)
    expect(game.snapshot(s, t + 200).phase).toBe('reveal')
  })

  test('most points wins; first places, then fewer wrong grabs, break ties', () => {
    const s = init(['a', 'b', 'c'])
    let t = open(s)
    game.onInput(s, 'a', { kind: 'grab', item: answer(s), card: 1 }, t + 100)
    game.onInput(s, 'b', { kind: 'grab', item: answer(s), card: 1 }, t + 110)
    game.onInput(s, 'c', { kind: 'grab', item: wrong(s), card: 1 }, t + 120)
    t = t + 120 + SPOOK.revealMs
    game.tick(s, 0, t)
    game.onInput(s, 'b', { kind: 'grab', item: answer(s), card: 2 }, t + 100)
    game.onInput(s, 'a', { kind: 'grab', item: answer(s), card: 2 }, t + 110)
    expect(game.isFinished(s, 45_000)).toBe(true)
    const res = game.getResult(s)
    // a and b: 3 + 2 points each, one first place each → tie; c last.
    expect(res.ranks).toEqual({ a: 0, b: 0, c: 2 })
    expect(res.stats?.a).toBe('5 pts')
  })
})
