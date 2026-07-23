import { describe, expect, test } from 'bun:test'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import type { MiniGameInitCtx } from './MiniGame'
import { SinkTheFleet } from './sinkTheFleet'

const ctx = (players: string[], now = 0): MiniGameInitCtx => ({
  players,
  seed: 7,
  random: new SeededRandom(7),
  now,
  config: { durationMs: 60_000 },
})

describe('SinkTheFleet', () => {
  test('the starting player fires; the other cannot fire out of turn', () => {
    const game = new SinkTheFleet()
    let state = game.init(ctx(['a', 'b']))
    const first = game.snapshot(state, 1)
    const starter = first.players.a?.yourTurn ? 'a' : 'b'
    const other = starter === 'a' ? 'b' : 'a'
    // Out-of-turn fire is ignored.
    state = game.onInput(state, other, { kind: 'fire', cell: 0 }, 1)
    expect(game.snapshot(state, 1).players[other]?.shots.length).toBe(0)
    // The starter's fire is recorded and passes the turn.
    state = game.onInput(state, starter, { kind: 'fire', cell: 0 }, 1)
    const snap = game.snapshot(state, 1)
    expect(snap.players[starter]?.shots.length).toBe(1)
    expect(snap.players[other]?.yourTurn).toBe(true)
  })

  test('a turn timeout hands the turn to the opponent', () => {
    const game = new SinkTheFleet()
    let state = game.init(ctx(['a', 'b']))
    const starter = game.snapshot(state, 1).players.a?.yourTurn ? 'a' : 'b'
    const other = starter === 'a' ? 'b' : 'a'
    state = game.tick(state, 0, 6000) // past the 5s turn window
    expect(game.snapshot(state, 6000).players[other]?.yourTurn).toBe(true)
  })

  test('a duel is decided when one fleet is fully sunk', () => {
    const game = new SinkTheFleet()
    let state = game.init(ctx(['a', 'b']))
    const nextCell = { a: 0, b: 0 }
    // Both fire on their turn (each fire flips the turn), sweeping the board until a fleet sinks.
    for (let i = 0; i < 200 && !game.isFinished(state, 1); i++) {
      const snap = game.snapshot(state, 1)
      const shooter = snap.players.a?.yourTurn ? 'a' : 'b'
      state = game.onInput(state, shooter, { kind: 'fire', cell: nextCell[shooter]++ }, 1)
    }
    expect(game.isFinished(state, 1)).toBe(true)
    const result = game.getResult(state)
    const ranks = result.ranks ?? {}
    expect(new Set([ranks.a, ranks.b])).toEqual(new Set([0, 1])) // one winner, one loser
    expect(result.stats?.a).toContain('sunk')
  })

  test('an odd roster gives the bye player a free win', () => {
    const game = new SinkTheFleet()
    const state = game.init(ctx(['a', 'b', 'c']))
    const snap = game.snapshot(state, 1)
    const bye = ['a', 'b', 'c'].find((p) => snap.players[p]?.opponentId === null) as string
    expect(snap.players[bye]?.won).toBe(true)
    expect(game.getResult(state).ranks?.[bye]).toBe(0)
  })
})
