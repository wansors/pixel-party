import { describe, expect, test } from 'bun:test'
import { decodeShot, encodeShot } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import type { MiniGameInitCtx } from './MiniGame'
import { SinkTheFleet, type SinkTheFleetState } from './sinkTheFleet'

const ctx = (players: string[], now = 0): MiniGameInitCtx => ({
  players,
  seed: 7,
  random: new SeededRandom(7),
  now,
  config: { durationMs: 60_000 },
})

// A cell of `owner`'s fleet (hit = true) or open water (hit = false).
const cellOf = (state: SinkTheFleetState, owner: string, hit: boolean): number => {
  const duel = state.duels[state.playerDuel.get(owner) ?? -1]
  const ships = duel?.ships.get(owner) as Set<number>
  const cell = Array.from({ length: 25 }, (_, i) => i).find((i) => ships.has(i) === hit)
  if (cell === undefined) throw new Error('no such cell')
  return cell
}

describe('SinkTheFleet', () => {
  test('the starting player fires; the other cannot fire out of turn; a miss passes the turn', () => {
    const game = new SinkTheFleet()
    let state = game.init(ctx(['a', 'b']))
    const first = game.snapshot(state, 1)
    const starter = first.players.a?.yourTurn ? 'a' : 'b'
    const other = starter === 'a' ? 'b' : 'a'
    // Out-of-turn fire is ignored.
    state = game.onInput(state, other, { kind: 'fire', cell: 0 }, 1)
    expect(game.snapshot(state, 1).players[other]?.shots.length).toBe(0)
    // The starter's miss is recorded and passes the turn.
    const water = cellOf(state, other, false)
    state = game.onInput(state, starter, { kind: 'fire', cell: water }, 1)
    const snap = game.snapshot(state, 1)
    expect(snap.players[starter]?.shots.map(decodeShot)).toEqual([{ cell: water, hit: false }])
    expect(snap.players[other]?.yourTurn).toBe(true)
  })

  test('shots travel packed as one number each; ship positions never do', () => {
    const game = new SinkTheFleet()
    let state = game.init(ctx(['a', 'b']))
    const starter = game.snapshot(state, 1).players.a?.yourTurn ? 'a' : 'b'
    const other = starter === 'a' ? 'b' : 'a'
    const hit = cellOf(state, other, true)
    state = game.onInput(state, starter, { kind: 'fire', cell: hit }, 1)
    const view = game.snapshot(state, 1).players[starter]
    expect(view?.shots).toEqual([encodeShot(hit, true)])
    expect(decodeShot(encodeShot(hit, true))).toEqual({ cell: hit, hit: true })
    expect(Object.keys(view ?? {}).sort()).toEqual(
      [
        'done',
        'fleetCells',
        'hitsOnOpponent',
        'hitsOnYou',
        'oppLeft',
        'opponentId',
        'shots',
        'turnRemainingMs',
        'won',
        'yourTurn',
      ].sort(),
    )
  })

  test('a hit shoots again', () => {
    const game = new SinkTheFleet()
    let state = game.init(ctx(['a', 'b']))
    const starter = game.snapshot(state, 1).players.a?.yourTurn ? 'a' : 'b'
    const other = starter === 'a' ? 'b' : 'a'
    state = game.onInput(state, starter, { kind: 'fire', cell: cellOf(state, other, true) }, 1)
    const snap = game.snapshot(state, 1)
    expect(snap.players[starter]?.yourTurn).toBe(true)
    expect(snap.players[starter]?.turnRemainingMs).toBe(5000) // a fresh turn clock
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

  test('an odd roster gives the bye player a middle-tier bye, not a win', () => {
    const game = new SinkTheFleet()
    const state = game.init(ctx(['a', 'b', 'c']))
    const snap = game.snapshot(state, 1)
    const bye = ['a', 'b', 'c'].find((p) => snap.players[p]?.opponentId === null) as string
    expect(snap.players[bye]?.won).toBeNull()
    const result = game.getResult(state)
    expect(result.byes).toEqual([bye])
    // The other two drew 0-0 at the bell: the same middle tier as the bye.
    expect(new Set(Object.values(result.ranks ?? {}))).toEqual(new Set([0]))
  })

  test('at the bell: more hits wins, then fewer shots; equal on both is a draw', () => {
    const game = new SinkTheFleet()
    const state = game.init(ctx(['a', 'b']))
    const duel = state.duels[0]
    if (!duel) throw new Error('no duel')
    const shots = (pid: string, hits: number, misses: number): void => {
      const opp = pid === 'a' ? 'b' : 'a'
      const fleet = [...(duel.ships.get(opp) as Set<number>)].slice(0, hits)
      const water = Array.from({ length: 25 }, (_, i) => i).filter(
        (i) => !duel.ships.get(opp)?.has(i),
      )
      duel.shots.set(pid, [
        ...fleet.map((cell) => ({ cell, hit: true })),
        ...water.slice(0, misses).map((cell) => ({ cell, hit: false })),
      ])
      duel.hitsTaken.set(opp, new Set(fleet))
    }
    shots('a', 3, 2)
    shots('b', 2, 1)
    expect(game.getResult(state).placements).toEqual(['a', 'b']) // more hits
    shots('b', 3, 1)
    expect(game.getResult(state).placements).toEqual(['b', 'a']) // equal hits, fewer shots
    expect(game.snapshot(state, 60_000).players.b?.won).toBe(true)
    shots('b', 3, 2)
    expect(game.getResult(state).ranks).toEqual({ a: 0, b: 0 }) // a draw
  })

  test('wins rank by hits landed minus taken', () => {
    const game = new SinkTheFleet()
    const state = game.init(ctx(['a', 'b', 'c', 'd']))
    const [d1, d2] = state.duels
    if (!d1?.b || !d2?.b) throw new Error('two duels expected')
    // Both winners sank a fleet; d2's winner took fewer hits doing it.
    d1.hitsTaken.set(d1.a, new Set([1, 2, 3]))
    d2.hitsTaken.set(d2.a, new Set([1]))
    Object.assign(d1, { done: true, winner: d1.a })
    Object.assign(d2, { done: true, winner: d2.a })
    d1.hitsTaken.set(d1.b, new Set(d1.ships.get(d1.b)))
    d2.hitsTaken.set(d2.b, new Set(d2.ships.get(d2.b)))
    expect(game.getResult(state).placements).toEqual([d2.a, d1.a, d1.b, d2.b])
  })

  test('a player who leaves forfeits the duel', () => {
    const game = new SinkTheFleet()
    let state = game.init(ctx(['a', 'b']))
    state = game.leave(state, 'b', 3000)
    expect(game.isFinished(state, 3000)).toBe(true)
    expect(game.snapshot(state, 3000).players.a).toMatchObject({ won: true, oppLeft: true })
    expect(game.getResult(state).placements).toEqual(['a', 'b'])
  })
})
