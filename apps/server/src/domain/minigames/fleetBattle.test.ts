import { describe, expect, test } from 'bun:test'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import type { MiniGameInitCtx } from './MiniGame'
import { FleetBattle } from './fleetBattle'

const baseCtx = (): MiniGameInitCtx => ({
  players: ['a', 'b', 'c', 'd'],
  seed: 7,
  random: new SeededRandom(7),
  now: 0,
  teams: { a: 'red', b: 'red', c: 'blue', d: 'blue' },
  config: { durationMs: 60_000 },
})

describe('FleetBattle', () => {
  test('each team gets a valid non-overlapping fleet of FLEET_CELLS cells', () => {
    const game = new FleetBattle()
    const state = game.init(baseCtx())
    const red = state.fleets.get('red') as Set<number>
    const blue = state.fleets.get('blue') as Set<number>
    expect(red.size).toBe(7)
    expect(blue.size).toBe(7)
    for (const cell of red) {
      expect(cell).toBeGreaterThanOrEqual(0)
      expect(cell).toBeLessThan(25)
    }
    for (const cell of blue) {
      expect(cell).toBeGreaterThanOrEqual(0)
      expect(cell).toBeLessThan(25)
    }
  })

  test("a hit-registering shot on red's turn passes the turn to blue", () => {
    const game = new FleetBattle()
    let state = game.init(baseCtx())
    expect(state.turn).toBe('red')
    // Fire at every cell until one registers (hit or miss both flip the turn unless it sinks the fleet).
    let cell = 0
    while (state.turn === 'red') {
      state = game.onInput(state, 'a', { kind: 'fire', cell }, 1)
      cell++
      if (cell >= 25) break
    }
    expect(state.turn).toBe('blue')
    expect((state.shots.get('red') as unknown[]).length).toBeGreaterThan(0)
  })

  test("a blue player's fire during red's turn is a no-op", () => {
    const game = new FleetBattle()
    let state = game.init(baseCtx())
    state = game.onInput(state, 'c', { kind: 'fire', cell: 0 }, 1)
    expect(state.turn).toBe('red')
    expect((state.shots.get('blue') as unknown[]).length).toBe(0)
  })

  test('sinking the whole enemy fleet ends the round with the sinking team ranked 0', () => {
    const game = new FleetBattle()
    let state = game.init(baseCtx())
    // Red keeps firing: after every shot, if the turn passed to blue, blue fires back at an
    // already-shot cell (a no-op — blue never has a team member try a fresh cell) so the turn returns
    // to red immediately. This sweeps red through the whole 25-cell board against blue's fleet.
    let redCell = 0
    for (let i = 0; i < 500 && !game.isFinished(state, 1); i++) {
      if (state.turn === 'red') {
        state = game.onInput(state, 'a', { kind: 'fire', cell: redCell }, 1)
        redCell++
      } else {
        // Blue forfeits by timing out rather than actually shooting, keeping this test focused on red.
        state = game.tick(state, 0, state.turnEndsAt)
      }
      if (redCell >= 25) break
    }
    expect(game.isFinished(state, 1)).toBe(true)
    const result = game.getResult(state)
    expect(result.ranks?.red).toBe(0)
    expect(result.ranks?.blue).toBe(1)
    expect(result.placements[0]).toBe('red')
    expect(result.stats?.a).toContain('sunk')
    expect(result.stats?.b).toBe(result.stats?.a) // teammates share the same team stat line
  })

  test('a turn timeout in tick() forfeits to the other team', () => {
    const game = new FleetBattle()
    let state = game.init(baseCtx())
    expect(state.turn).toBe('red')
    state = game.tick(state, 0, 6000) // past the 6s turn window
    expect(state.turn).toBe('blue')
  })

  test('a player with no team cannot fire', () => {
    const game = new FleetBattle()
    const ctx = baseCtx()
    ctx.players = ['a', 'b', 'c', 'd', 'ghost']
    let state = game.init(ctx)
    state = game.onInput(state, 'ghost', { kind: 'fire', cell: 0 }, 1)
    expect(state.turn).toBe('red')
    expect((state.shots.get('red') as unknown[]).length).toBe(0)
    expect((state.shots.get('blue') as unknown[]).length).toBe(0)
  })
})
