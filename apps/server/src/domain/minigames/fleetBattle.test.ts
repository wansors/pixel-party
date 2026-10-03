import { describe, expect, test } from 'bun:test'
import type { TeamId } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import type { MiniGameInitCtx } from './MiniGame'
import { FleetBattle, type FleetBattleState } from './fleetBattle'

const baseCtx = (seed = 7): MiniGameInitCtx => ({
  players: ['a', 'b', 'c', 'd'],
  seed,
  random: new SeededRandom(seed),
  now: 0,
  teams: { a: 'red', b: 'red', c: 'blue', d: 'blue' },
  config: { durationMs: 60_000 },
})
const other = (t: TeamId): TeamId => (t === 'red' ? 'blue' : 'red')
const captainOf = (s: FleetBattleState): string => {
  if (!s.captain) throw new Error('no captain this turn')
  return s.captain
}
// A member of `team` who isn't this turn's captain.
const mateOf = (s: FleetBattleState, team: TeamId): string =>
  [...s.team].find(([id, t]) => t === team && id !== s.captain)?.[0] as string

describe('FleetBattle', () => {
  test('each team gets a valid non-overlapping fleet of FLEET_CELLS cells', () => {
    const game = new FleetBattle()
    const state = game.init(baseCtx())
    const red = state.fleets.get('red') as Set<number>
    const blue = state.fleets.get('blue') as Set<number>
    expect(red.size).toBe(7)
    expect(blue.size).toBe(7)
    for (const cell of [...red, ...blue]) {
      expect(cell).toBeGreaterThanOrEqual(0)
      expect(cell).toBeLessThan(25)
    }
  })

  test('the seed picks which team fires first', () => {
    const game = new FleetBattle()
    const starters = new Set(Array.from({ length: 20 }, (_, i) => game.init(baseCtx(i + 1)).turn))
    expect(starters).toEqual(new Set<TeamId>(['red', 'blue']))
  })

  test("the captain's shot passes the turn; the other team can't fire out of turn", () => {
    const game = new FleetBattle()
    let state = game.init(baseCtx())
    const first = state.turn
    const enemy = [...state.team].find(([, t]) => t !== first)?.[0] as string
    state = game.onInput(state, enemy, { kind: 'fire', cell: 0 }, 1)
    expect(state.turn).toBe(first)
    expect(state.shots.get(other(first))).toHaveLength(0)
    state = game.onInput(state, captainOf(state), { kind: 'fire', cell: 0 }, 1)
    expect(state.turn).toBe(other(first))
    expect(state.shots.get(first)).toHaveLength(1)
  })

  test('only the captain fires at first; then the turn opens to the whole team', () => {
    const game = new FleetBattle()
    let state = game.init(baseCtx())
    const team = state.turn
    const mate = mateOf(state, team)
    expect(game.snapshot(state, 0).captainId).toBe(captainOf(state))
    expect(game.snapshot(state, 0).openInMs).toBe(3000)
    state = game.onInput(state, mate, { kind: 'fire', cell: 3 }, 2999)
    expect(state.shots.get(team)).toHaveLength(0)
    expect(game.snapshot(state, 3000).openInMs).toBe(0)
    state = game.onInput(state, mate, { kind: 'fire', cell: 3 }, 3000)
    expect(state.shots.get(team)).toHaveLength(1)
    expect(state.turn).toBe(other(team))
  })

  test('the captaincy rotates through every member of the team', () => {
    const game = new FleetBattle()
    const ctx = baseCtx()
    ctx.players = ['a', 'b', 'e', 'c', 'd']
    ctx.teams = { ...ctx.teams, e: 'red' }
    let state = game.init(ctx)
    const captains: string[] = []
    let t = 0
    while (captains.length < 6) {
      if (state.turn === 'red') captains.push(captainOf(state))
      t = state.turnEndsAt
      state = game.tick(state, 0, t) // every turn times out
    }
    expect(new Set(captains.slice(0, 3))).toEqual(new Set(['a', 'b', 'e']))
    expect(captains.slice(3)).toEqual(captains.slice(0, 3))
  })

  test('a captain who leaves opens the turn; leavers drop out of the rotation', () => {
    const game = new FleetBattle()
    let state = game.init(baseCtx())
    const team = state.turn
    const captain = captainOf(state)
    const mate = mateOf(state, team)
    state = game.leave(state, captain, 1000)
    expect(game.snapshot(state, 1000).openInMs).toBe(0)
    expect(game.snapshot(state, 1000).captainId).toBeNull()
    state = game.onInput(state, mate, { kind: 'fire', cell: 0 }, 1000)
    expect(state.turn).toBe(other(team))
    // From now on the lone mate captains every one of the team's turns.
    for (let i = 0; i < 4; i++) {
      state = game.tick(state, 0, state.turnEndsAt)
      if (state.turn === team) expect(state.captain).toBe(mate)
    }
  })

  test('a team everyone left hands its turns straight back', () => {
    const game = new FleetBattle()
    let state = game.init(baseCtx())
    const gone = state.turn
    for (const [id, t] of [...state.team]) if (t === gone) state = game.leave(state, id, 10)
    expect(state.turn).toBe(other(gone))
    state = game.tick(state, 0, state.turnEndsAt)
    expect(state.turn).toBe(other(gone))
  })

  test('sinking the whole enemy fleet ends the round with the sinking team ranked 0', () => {
    const game = new FleetBattle()
    let state = game.init({ ...baseCtx(), config: { durationMs: 600_000 } })
    const sweeper = state.turn
    const sweeperMember = [...state.team].find(([, t]) => t === sweeper)?.[0] as string
    // The starting team's captains sweep the enemy grid cell by cell; the enemy never fires, so each
    // of its turns times out and hands the turn straight back.
    let cell = 0
    for (let i = 0; i < 100 && !state.done; i++) {
      if (state.turn === sweeper) {
        state = game.onInput(
          state,
          captainOf(state),
          { kind: 'fire', cell: cell++ },
          state.openAt - 1,
        )
      } else {
        state = game.tick(state, 0, state.turnEndsAt)
      }
    }
    expect(state.done).toBe(true)
    const result = game.getResult(state)
    expect(result.ranks?.[sweeper]).toBe(0)
    expect(result.ranks?.[other(sweeper)]).toBe(1)
    expect(result.placements[0]).toBe(sweeper)
    expect(result.stats?.[sweeperMember]).toContain('7/7 sunk')
    expect(result.stats?.a).toContain('sunk')
    expect(result.stats?.b).toBe(result.stats?.a) // teammates share the same team stat line
  })

  test('at the timer, equal damage goes to the team that needed fewer shots', () => {
    const game = new FleetBattle()
    const state = game.init(baseCtx())
    const blueShip = [...(state.fleets.get('blue') as Set<number>)][0] as number
    const redShip = [...(state.fleets.get('red') as Set<number>)][0] as number
    const miss = (fleet: TeamId): number =>
      [...Array(25).keys()].find((c) => !(state.fleets.get(fleet) as Set<number>).has(c)) as number
    // One hit each; red also wasted a shot.
    state.shots.set('red', [
      { cell: miss('blue'), hit: false },
      { cell: blueShip, hit: true },
    ])
    state.hitsTaken.set('blue', new Set([blueShip]))
    state.shots.set('blue', [{ cell: redShip, hit: true }])
    state.hitsTaken.set('red', new Set([redShip]))
    expect(game.getResult(state).ranks).toEqual({ red: 1, blue: 0 })
    expect(game.snapshot(state, 60_000).winner).toBe('blue')
    // No hits at all is a draw, however many shots missed.
    const blank = game.init(baseCtx())
    blank.shots.set('red', [{ cell: miss('blue'), hit: false }])
    expect(game.getResult(blank).ranks).toEqual({ red: 0, blue: 0 })
  })

  test('a turn timeout in tick() forfeits to the other team', () => {
    const game = new FleetBattle()
    let state = game.init(baseCtx())
    const first = state.turn
    state = game.tick(state, 0, 5999)
    expect(state.turn).toBe(first)
    state = game.tick(state, 0, 6000) // past the 6s turn window
    expect(state.turn).toBe(other(first))
  })

  test('a player with no team cannot fire', () => {
    const game = new FleetBattle()
    const ctx = baseCtx()
    ctx.players = ['a', 'b', 'c', 'd', 'ghost']
    let state = game.init(ctx)
    const first = state.turn
    state = game.onInput(state, 'ghost', { kind: 'fire', cell: 0 }, 5000)
    expect(state.turn).toBe(first)
    expect(state.shots.get('red')).toHaveLength(0)
    expect(state.shots.get('blue')).toHaveLength(0)
  })
})
