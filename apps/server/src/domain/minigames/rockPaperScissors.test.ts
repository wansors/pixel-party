import { describe, expect, test } from 'bun:test'
import { RPS, type RpsHand, rpsBeats, rpsChooseMs, rpsOutcome } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { RockPaperScissors, type RpsState } from './rockPaperScissors'

const game = new RockPaperScissors()
const init = (players: string[], seed = 3): RpsState =>
  game.init({
    players,
    seed,
    random: new SeededRandom(seed),
    now: 0,
    config: { durationMs: 45_000 },
  })
const duelOf = (s: RpsState, id: string) => {
  const d = s.duels[s.playerDuel.get(id) ?? -1]
  if (!d?.b) throw new Error(`no duel for ${id}`)
  return d
}
// One throw: both pick (resolved at once), then the reveal runs out.
function play(s: RpsState, a: string, ha: RpsHand, b: string, hb: RpsHand, now: number): number {
  game.onInput(s, a, { kind: 'throw', hand: ha }, now)
  game.onInput(s, b, { kind: 'throw', hand: hb }, now)
  game.tick(s, 0, now + RPS.revealMs)
  return now + RPS.revealMs
}

describe('rock paper scissors rules (shared)', () => {
  test('rock blunts scissors, scissors cut paper, paper wraps rock', () => {
    expect(rpsBeats('rock', 'scissors')).toBe(true)
    expect(rpsBeats('scissors', 'paper')).toBe(true)
    expect(rpsBeats('paper', 'rock')).toBe(true)
    expect(rpsBeats('rock', 'paper')).toBe(false)
    expect(rpsBeats('rock', 'rock')).toBe(false)
  })

  test('not picking loses the throw; two idles draw', () => {
    expect(rpsOutcome('rock', null)).toBe('win')
    expect(rpsOutcome(null, 'paper')).toBe('loss')
    expect(rpsOutcome(null, null)).toBe('draw')
    expect(rpsOutcome('paper', 'paper')).toBe('draw')
  })

  test('the pick window shrinks every throw, down to a floor (D40)', () => {
    expect(rpsChooseMs(1)).toBe(RPS.chooseMs)
    expect(rpsChooseMs(2)).toBe(Math.round(RPS.chooseMs * RPS.chooseFactor))
    expect(rpsChooseMs(4)).toBeLessThan(rpsChooseMs(3))
    expect(rpsChooseMs(40)).toBe(RPS.chooseMinMs)
  })
})

describe('RockPaperScissors', () => {
  test('pairs everyone; an odd player out gets a bye, ranked with the draws', () => {
    const s = init(['a', 'b', 'c'])
    const bye = s.duels.find((d) => d.b === null)
    expect(bye).toBeDefined()
    expect(s.duels.filter((d) => d.b !== null).length).toBe(1)
    const res = game.getResult(s)
    expect(res.stats?.[bye?.a as string]).toBe('—')
  })

  test('a throw resolves as soon as both have picked; first to 3 wins the duel', () => {
    const s = init(['a', 'b'])
    let now = 100
    now = play(s, 'a', 'rock', 'b', 'scissors', now)
    now = play(s, 'a', 'paper', 'b', 'paper', now)
    expect(duelOf(s, 'a').throwNo).toBe(3)
    now = play(s, 'a', 'scissors', 'b', 'paper', now)
    expect(game.isFinished(s, now)).toBe(false)
    now = play(s, 'a', 'paper', 'b', 'rock', now)
    expect(game.isFinished(s, now)).toBe(true)
    const res = game.getResult(s)
    expect(res.placements[0]).toBe('a')
    expect(res.stats).toEqual({ a: '3-0', b: '0-3' })
  })

  test("the rival's hand stays off the wire until the reveal", () => {
    const s = init(['a', 'b'])
    game.onInput(s, 'a', { kind: 'throw', hand: 'paper' }, 50)
    const snap = game.snapshot(s, 60)
    expect(snap.players.b?.theyChose).toBe(true)
    expect(snap.players.b?.youChose).toBe(false)
    expect(JSON.stringify(snap)).not.toContain('paper')
    game.onInput(s, 'b', { kind: 'throw', hand: 'rock' }, 70)
    const reveal = game.snapshot(s, 80).players.b
    expect(reveal?.phase).toBe('reveal')
    expect(reveal?.history.at(-1)).toEqual({ mine: 'rock', theirs: 'paper', outcome: 'loss' })
  })

  test('a pick is final, and junk is ignored', () => {
    const s = init(['a', 'b'])
    game.onInput(s, 'a', { kind: 'throw', hand: 'rock' }, 10)
    game.onInput(s, 'a', { kind: 'throw', hand: 'paper' }, 20)
    game.onInput(s, 'b', { kind: 'throw', hand: 'lizard' as RpsHand }, 30)
    expect(duelOf(s, 'a').picks.get('a')).toBe('rock')
    expect(duelOf(s, 'a').picks.has('b')).toBe(false)
  })

  test('the window closing resolves the throw: the idle player loses it', () => {
    const s = init(['a', 'b'])
    game.onInput(s, 'a', { kind: 'throw', hand: 'scissors' }, 10)
    game.tick(s, 0, rpsChooseMs(1))
    const v = game.snapshot(s, rpsChooseMs(1)).players.a
    expect(v?.mine).toBe(1)
    expect(v?.history.at(-1)).toEqual({ mine: 'scissors', theirs: null, outcome: 'win' })
  })

  test('each throw gets a shorter window', () => {
    const s = init(['a', 'b'])
    const now = play(s, 'a', 'rock', 'b', 'rock', 10)
    const v = game.snapshot(s, now).players.a
    expect(v?.throwNo).toBe(2)
    expect(v?.chooseMs).toBe(rpsChooseMs(2))
    expect(v?.msLeft).toBe(rpsChooseMs(2))
  })

  test('at the bell, more throws won wins; level is a draw', () => {
    const s = init(['a', 'b', 'c', 'd'])
    const [d1, d2] = s.duels
    if (!d1?.b || !d2?.b) throw new Error('two duels expected')
    play(s, d1.a, 'rock', d1.b, 'scissors', 10)
    play(s, d2.a, 'rock', d2.b, 'rock', 10)
    expect(game.isFinished(s, 45_000)).toBe(true)
    const res = game.getResult(s)
    expect(res.ranks?.[d1.a]).toBe(0)
    expect(res.ranks?.[d2.a]).toBe(res.ranks?.[d2.b])
    expect(res.ranks?.[d1.b]).toBeGreaterThan(res.ranks?.[d2.a] ?? 0)
  })

  test('a player who leaves forfeits the duel', () => {
    const s = init(['a', 'b'])
    game.leave(s, 'b', 100)
    expect(game.isFinished(s, 100)).toBe(true)
    expect(game.snapshot(s, 100).players.a?.oppLeft).toBe(true)
    expect(game.getResult(s).placements[0]).toBe('a')
  })
})
