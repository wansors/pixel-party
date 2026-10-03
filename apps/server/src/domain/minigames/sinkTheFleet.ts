import type { SinkTheFleetInput, SinkTheFleetSnapshot } from '@pp/shared'
import type { Random } from '../ports/Random'
import { type DuelOutcome, rankDuels } from '../services/duelRanking'
import { pairPlayers } from '../services/pairing'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 60_000
const GRID = 5
const FLEET_SIZES = [3, 2, 2] // 7 ship cells on a 25-cell board
const FLEET_CELLS = FLEET_SIZES.reduce((a, b) => a + b, 0)
const TURN_MS = 5000

interface Duel {
  a: PlayerId
  b: PlayerId | null // null = bye
  ships: Map<PlayerId, Set<number>> // each player's own occupied cells
  shots: Map<PlayerId, { cell: number; hit: boolean }[]> // shots fired BY a player at the opponent
  hitsTaken: Map<PlayerId, Set<number>> // a player's own cells that have been hit
  turn: PlayerId
  turnEndsAt: number
  done: boolean
  winner: PlayerId | null // set once done (null = a bye)
  forfeit: boolean // decided by a player leaving
}

export interface SinkTheFleetState {
  duels: Duel[]
  playerDuel: Map<PlayerId, number>
  startedAt: number
  endsAt: number
}

// Duel format: simultaneous 1v1 Battleship. Players are seeded-paired; each auto-placed fleet is hidden
// (never on the wire — only shot results are), and players fire in turns — a hit shoots again. A duel
// ends when one fleet is sunk; unresolved duels at the timer go to more hits, then fewer shots fired
// (equal on both = draw). Duels rank across the room in tiers (rankDuels): wins, then draws and the
// bye, then losses — each by hits landed minus taken. Pure — time arrives as `now`, randomness via the injected port.
export class SinkTheFleet implements MiniGame<SinkTheFleetState, SinkTheFleetInput> {
  readonly id = 'sink-the-fleet'
  readonly format = 'duel' as const

  init(ctx: MiniGameInitCtx): SinkTheFleetState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const pairs = pairPlayers(ctx.players, ctx.random, ctx.byeCounts)
    const duels: Duel[] = []
    const playerDuel = new Map<PlayerId, number>()
    for (const { a, b } of pairs) {
      const ships = new Map<PlayerId, Set<number>>()
      const shots = new Map<PlayerId, { cell: number; hit: boolean }[]>()
      const hitsTaken = new Map<PlayerId, Set<number>>()
      ships.set(a, placeFleet(ctx.random))
      shots.set(a, [])
      hitsTaken.set(a, new Set())
      if (b) {
        ships.set(b, placeFleet(ctx.random))
        shots.set(b, [])
        hitsTaken.set(b, new Set())
      }
      const idx = duels.length
      playerDuel.set(a, idx)
      if (b) playerDuel.set(b, idx)
      duels.push({
        a,
        b,
        ships,
        shots,
        hitsTaken,
        turn: a,
        turnEndsAt: ctx.now + TURN_MS,
        done: b === null, // a bye is resolved immediately
        winner: null,
        forfeit: false,
      })
    }
    return { duels, playerDuel, startedAt: ctx.now, endsAt: ctx.now + durationMs }
  }

  onInput(
    state: SinkTheFleetState,
    playerId: PlayerId,
    input: SinkTheFleetInput,
    now: number,
  ): SinkTheFleetState {
    if (input.kind !== 'fire') return state
    if (now < state.startedAt || now >= state.endsAt) return state
    const idx = state.playerDuel.get(playerId)
    if (idx === undefined) return state
    const duel = state.duels[idx] as Duel
    if (duel.done || duel.turn !== playerId) return state
    const opponent = playerId === duel.a ? duel.b : duel.a
    if (!opponent) return state
    const cell = input.cell
    if (!Number.isInteger(cell) || cell < 0 || cell >= GRID * GRID) return state
    const myShots = duel.shots.get(playerId) as { cell: number; hit: boolean }[]
    if (myShots.some((s) => s.cell === cell)) return state // already fired here

    const hit = (duel.ships.get(opponent) as Set<number>).has(cell)
    myShots.push({ cell, hit })
    if (hit) (duel.hitsTaken.get(opponent) as Set<number>).add(cell)
    if (hit && (duel.hitsTaken.get(opponent) as Set<number>).size === FLEET_CELLS) {
      duel.done = true
      duel.winner = playerId
      return state
    }
    // A hit shoots again (more duels sink a fleet before the bell); a miss hands the turn over.
    if (!hit) duel.turn = opponent
    duel.turnEndsAt = now + TURN_MS
    return state
  }

  tick(state: SinkTheFleetState, _dt: number, now: number): SinkTheFleetState {
    // Turn timeout: a stalling player forfeits their turn so their opponent keeps progressing.
    for (const duel of state.duels) {
      if (duel.done || duel.b === null) continue
      if (now >= duel.turnEndsAt) {
        duel.turn = duel.turn === duel.a ? duel.b : duel.a
        duel.turnEndsAt = now + TURN_MS
      }
    }
    return state
  }

  // A player who leaves forfeits: their opponent wins on the spot.
  leave(state: SinkTheFleetState, playerId: PlayerId, _now: number): SinkTheFleetState {
    const duel = state.duels[state.playerDuel.get(playerId) ?? -1]
    if (!duel?.b || duel.done) return state
    duel.done = true
    duel.winner = playerId === duel.a ? duel.b : duel.a
    duel.forfeit = true
    return state
  }

  isFinished(state: SinkTheFleetState, now: number): boolean {
    return now >= state.endsAt || state.duels.every((d) => d.done)
  }

  getResult(state: SinkTheFleetState): NormalizedResult {
    const outcomes: DuelOutcome[] = []
    const stats: Record<PlayerId, string> = {}
    for (const duel of state.duels) {
      if (!duel.b) {
        outcomes.push({ id: duel.a, tier: 'bye' })
        stats[duel.a] = '—'
        continue
      }
      const winner = resolveWinner(duel, true)
      for (const pid of [duel.a, duel.b]) {
        const opp = pid === duel.a ? duel.b : duel.a
        const landed = hitsOn(duel, opp)
        const tier = winner === null ? 'draw' : winner === pid ? 'win' : 'loss'
        // Hits landed minus taken; more hits landed breaks an equal difference.
        const margin = (landed - hitsOn(duel, pid)) * (FLEET_CELLS + 1) + landed
        outcomes.push({ id: pid, tier, margin })
        stats[pid] = `${landed}/${FLEET_CELLS} sunk`
      }
    }
    return rankDuels(outcomes, stats)
  }

  snapshot(state: SinkTheFleetState, now: number): SinkTheFleetSnapshot {
    const ended = now >= state.endsAt
    const players: SinkTheFleetSnapshot['players'] = {}
    for (const duel of state.duels) {
      for (const pid of [duel.a, duel.b]) {
        if (!pid) continue
        const opp = pid === duel.a ? duel.b : duel.a
        const done = duel.done || ended
        const winner = resolveWinner(duel, ended)
        players[pid] = {
          opponentId: opp,
          yourTurn: !done && duel.turn === pid,
          turnRemainingMs: done ? 0 : Math.max(0, duel.turnEndsAt - now),
          shots: duel.shots.get(pid) as { cell: number; hit: boolean }[],
          damage: [...(duel.hitsTaken.get(pid) as Set<number>)],
          hitsOnOpponent: opp ? hitsOn(duel, opp) : 0,
          hitsOnYou: hitsOn(duel, pid),
          fleetCells: FLEET_CELLS,
          done,
          won: done && opp !== null && winner !== null ? winner === pid : null,
          oppLeft: duel.forfeit && winner === pid,
        }
      }
    }
    return { grid: GRID, roundRemainingMs: Math.max(0, state.endsAt - now), players }
  }
}

// Hits taken by a player's own fleet.
function hitsOn(duel: Duel, pid: PlayerId): number {
  return (duel.hitsTaken.get(pid) as Set<number>).size
}

// Winner of a duel: the stored winner once decided; otherwise (only when the round has ended) the player
// with more hits, then the one who needed fewer shots — equal on both is a draw (null), as is a bye.
// Returns null for an ongoing duel too; callers gate on `done`/`ended` before reading it as final.
function resolveWinner(duel: Duel, ended: boolean): PlayerId | null {
  if (duel.b === null) return null
  if (duel.done) return duel.winner
  if (!ended) return null
  const { a, b } = duel
  const shotsBy = (pid: PlayerId): number => (duel.shots.get(pid) as unknown[]).length
  const edge = hitsOn(duel, b) - hitsOn(duel, a) || shotsBy(b) - shotsBy(a)
  return edge > 0 ? a : edge < 0 ? b : null
}

// Seeded fleet placement: drop each ship horizontally/vertically without overlap. The guard bounds the
// retries so a pathological RNG run can never spin forever (25-cell board, 7 ship cells — ample room).
function placeFleet(random: Random): Set<number> {
  const occupied = new Set<number>()
  for (const size of FLEET_SIZES) {
    for (let guard = 0; guard < 500; guard++) {
      const horizontal = random.next() < 0.5
      const maxRow = horizontal ? GRID : GRID - size + 1
      const maxCol = horizontal ? GRID - size + 1 : GRID
      const row = Math.floor(random.next() * maxRow)
      const col = Math.floor(random.next() * maxCol)
      const cells: number[] = []
      for (let k = 0; k < size; k++) {
        const r = horizontal ? row : row + k
        const c = horizontal ? col + k : col
        cells.push(r * GRID + c)
      }
      if (cells.some((x) => occupied.has(x))) continue
      for (const x of cells) occupied.add(x)
      break
    }
  }
  return occupied
}
