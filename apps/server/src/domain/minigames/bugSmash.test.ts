import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { BugSmash, type BugSmashState } from './bugSmash'

// Small seeded generator (mulberry32) so the timeline is real but reproducible.
function seeded(seed: number): Random {
  let a = seed >>> 0
  return {
    next: () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), a | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

const init = (players: string[], seed = 1): BugSmashState =>
  new BugSmash().init({
    players,
    seed,
    random: seeded(seed),
    now: 0,
    config: { durationMs: 30_000 },
  })

// The first spawn of a kind, and a time at which it is live.
function firstOf(s: BugSmashState, kind: 'bug' | 'bomb'): { hole: number; at: number } {
  const spawn = s.spawns.find((sp) => sp.kind === kind)
  if (!spawn) throw new Error(`no ${kind} in the timeline`)
  return { hole: spawn.hole, at: s.startedAt + spawn.appearAt + 1 }
}

describe('BugSmash', () => {
  test('the spawn timeline is seeded: same seed, same timeline; bugs and bombs both appear', () => {
    expect(init(['a'], 7).spawns).toEqual(init(['a'], 7).spawns)
    expect(init(['a'], 7).spawns).not.toEqual(init(['a'], 8).spawns)
    const kinds = new Set(init(['a']).spawns.map((sp) => sp.kind))
    expect(kinds).toEqual(new Set(['bug', 'bomb']))
  })

  test('smashing a live bug scores once; a second smash or an empty hole scores nothing', () => {
    const game = new BugSmash()
    let s = init(['a'])
    const bug = firstOf(s, 'bug')
    s = game.onInput(s, 'a', { kind: 'smash', hole: bug.hole }, bug.at)
    s = game.onInput(s, 'a', { kind: 'smash', hole: bug.hole }, bug.at + 1)
    expect(s.scores.get('a')).toBe(1)
    const empty = [...Array(9).keys()].find(
      (hole) =>
        !s.spawns.some(
          (sp) => sp.hole === hole && bug.at >= sp.appearAt && bug.at < sp.appearAt + sp.durationMs,
        ),
    )
    s = game.onInput(s, 'a', { kind: 'smash', hole: empty ?? 0 }, bug.at)
    expect(s.scores.get('a')).toBe(1)
  })

  test('every player can smash the same shared bug', () => {
    const game = new BugSmash()
    let s = init(['a', 'b'])
    const bug = firstOf(s, 'bug')
    s = game.onInput(s, 'a', { kind: 'smash', hole: bug.hole }, bug.at)
    s = game.onInput(s, 'b', { kind: 'smash', hole: bug.hole }, bug.at)
    expect(s.scores.get('a')).toBe(1)
    expect(s.scores.get('b')).toBe(1)
  })

  test('a bomb costs a point even at zero: the score goes negative', () => {
    const game = new BugSmash()
    let s = init(['a'])
    const bomb = firstOf(s, 'bomb')
    s = game.onInput(s, 'a', { kind: 'smash', hole: bomb.hole }, bomb.at)
    expect(s.scores.get('a')).toBe(-1)
    expect(game.snapshot(s, bomb.at).scores.a).toBe(-1)
    expect(game.getResult(s).stats?.a).toBe('-1 pts')
  })

  test('a bomb-smasher ranks below a player who left the bombs alone', () => {
    const game = new BugSmash()
    let s = init(['a', 'b'])
    const bomb = firstOf(s, 'bomb')
    const bug = firstOf(s, 'bug')
    s = game.onInput(s, 'a', { kind: 'smash', hole: bomb.hole }, bomb.at)
    s = game.onInput(s, 'b', { kind: 'smash', hole: bug.hole }, bug.at)
    const r = game.getResult(s)
    expect(r.placements).toEqual(['b', 'a'])
    expect(r.ranks).toEqual({ b: 0, a: 1 })
  })

  test('equal scores tie; smashes after the buzzer are ignored', () => {
    const game = new BugSmash()
    let s = init(['a', 'b'])
    expect(game.getResult(s).ranks).toEqual({ a: 0, b: 0 })
    const last = s.spawns.at(-1)
    if (!last) throw new Error('empty timeline')
    s = game.onInput(s, 'a', { kind: 'smash', hole: last.hole }, s.endsAt)
    expect(s.scores.get('a')).toBe(0)
    expect(game.isFinished(s, s.endsAt)).toBe(true)
    expect(game.isFinished(s, s.endsAt - 1)).toBe(false)
  })
})
