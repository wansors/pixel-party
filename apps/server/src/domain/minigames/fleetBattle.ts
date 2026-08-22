import type { FleetBattleInput, FleetBattleSnapshot, TeamId } from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 90_000
const GRID = 5
const FLEET_SIZES = [3, 2, 2] // 7 ship cells on a 25-cell board
const FLEET_CELLS = FLEET_SIZES.reduce((a, b) => a + b, 0)
// Longer than the 1v1 duel's turn window — a team has to coordinate on who fires.
const TURN_MS = 6000

export interface FleetBattleState {
  fleets: Map<TeamId, Set<number>> // each team's ship cells
  shots: Map<TeamId, { cell: number; hit: boolean }[]> // shots FIRED BY that team, at the opponent
  hitsTaken: Map<TeamId, Set<number>> // cells hit ON that team's own fleet
  team: Map<PlayerId, TeamId>
  turn: TeamId
  turnEndsAt: number
  startedAt: number
  endsAt: number
  done: boolean
  winner: TeamId | null
}

// Team real-time Battleship: red and blue each defend one SHARED fleet. Turn alternates by team —
// during a team's turn, the first valid `fire` from ANY of its members consumes the turn slot and
// passes it to the other team; later shots from teammates for that same turn are no-ops. A team wins
// by sinking the enemy fleet; unresolved rounds at the timer are decided on damage (tie = draw). Pure
// — time arrives as `now`, randomness via the injected port.
export class FleetBattle implements MiniGame<FleetBattleState, FleetBattleInput> {
  readonly id = 'fleet-battle'
  readonly format = 'team' as const

  init(ctx: MiniGameInitCtx): FleetBattleState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const team = new Map<PlayerId, TeamId>()
    for (const id of ctx.players) {
      const t = ctx.teams?.[id]
      if (t) team.set(id, t)
    }
    const fleets = new Map<TeamId, Set<number>>([
      ['red', placeFleet(ctx.random)],
      ['blue', placeFleet(ctx.random)],
    ])
    const shots = new Map<TeamId, { cell: number; hit: boolean }[]>([
      ['red', []],
      ['blue', []],
    ])
    const hitsTaken = new Map<TeamId, Set<number>>([
      ['red', new Set()],
      ['blue', new Set()],
    ])
    return {
      fleets,
      shots,
      hitsTaken,
      team,
      turn: 'red',
      turnEndsAt: ctx.now + TURN_MS,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      done: false,
      winner: null,
    }
  }

  onInput(
    state: FleetBattleState,
    playerId: PlayerId,
    input: FleetBattleInput,
    now: number,
  ): FleetBattleState {
    if (input.kind !== 'fire') return state
    if (now < state.startedAt || now >= state.endsAt) return state
    if (state.done) return state
    const firingTeam = state.team.get(playerId)
    if (!firingTeam || firingTeam !== state.turn) return state
    const cell = input.cell
    if (!Number.isInteger(cell) || cell < 0 || cell >= GRID * GRID) return state
    const myShots = state.shots.get(firingTeam) as { cell: number; hit: boolean }[]
    if (myShots.some((s) => s.cell === cell)) return state // already fired here

    const opponent: TeamId = firingTeam === 'red' ? 'blue' : 'red'
    const hit = (state.fleets.get(opponent) as Set<number>).has(cell)
    myShots.push({ cell, hit })
    if (hit) (state.hitsTaken.get(opponent) as Set<number>).add(cell)
    if (hit && (state.hitsTaken.get(opponent) as Set<number>).size === FLEET_CELLS) {
      state.done = true
      state.winner = firingTeam
    } else {
      state.turn = opponent
      state.turnEndsAt = now + TURN_MS
    }
    return state
  }

  tick(state: FleetBattleState, _dt: number, now: number): FleetBattleState {
    // Turn timeout: a stalling team forfeits its turn so the other side keeps progressing.
    if (!state.done && now >= state.turnEndsAt) {
      state.turn = state.turn === 'red' ? 'blue' : 'red'
      state.turnEndsAt = now + TURN_MS
    }
    return state
  }

  isFinished(state: FleetBattleState, now: number): boolean {
    return now >= state.endsAt || state.done
  }

  getResult(state: FleetBattleState): NormalizedResult {
    const winner = resolveWinner(state, true)
    const placements: TeamId[] = winner === 'blue' ? ['blue', 'red'] : ['red', 'blue']
    const ranks: Record<string, number> =
      winner === null
        ? { red: 0, blue: 0 }
        : winner === 'red'
          ? { red: 0, blue: 1 }
          : { red: 1, blue: 0 }
    const stats: Record<PlayerId, string> = {}
    for (const [id, t] of state.team) {
      const opp: TeamId = t === 'red' ? 'blue' : 'red'
      const sunk = (state.hitsTaken.get(opp) as Set<number>).size
      stats[id] = `${sunk}/${FLEET_CELLS} sunk`
    }
    return { placements, ranks, stats }
  }

  snapshot(state: FleetBattleState, now: number): FleetBattleSnapshot {
    const ended = now >= state.endsAt
    const done = state.done || ended
    const winner = resolveWinner(state, ended)
    const teamView = (t: TeamId): FleetBattleSnapshot['teams'][TeamId] => ({
      shots: state.shots.get(t) as { cell: number; hit: boolean }[],
      damage: [...(state.hitsTaken.get(t) as Set<number>)],
      fleetCells: FLEET_CELLS,
    })
    return {
      grid: GRID,
      roundRemainingMs: Math.max(0, state.endsAt - now),
      turn: state.turn,
      turnRemainingMs: done ? 0 : Math.max(0, state.turnEndsAt - now),
      teams: { red: teamView('red'), blue: teamView('blue') },
      playerTeams: Object.fromEntries(state.team),
      done,
      winner: done ? winner : null,
    }
  }
}

// Winner: the stored winner once decided by a sink, otherwise (only once the round has ended) the team
// that dealt more damage — equal damage is a draw (null). Returns null for an ongoing round too;
// callers gate on `done`/`ended` before reading it as final.
function resolveWinner(state: FleetBattleState, ended: boolean): TeamId | null {
  if (state.done) return state.winner
  if (!ended) return null
  const redHits = (state.hitsTaken.get('blue') as Set<number>).size
  const blueHits = (state.hitsTaken.get('red') as Set<number>).size
  return redHits > blueHits ? 'red' : blueHits > redHits ? 'blue' : null
}

// Seeded fleet placement: drop each ship horizontally/vertically without overlap. The guard bounds the
// retries so a pathological RNG run can never spin forever (25-cell board, 7 ship cells — ample room).
// Copied verbatim from sinkTheFleet.ts (kept private there) to avoid coupling the two modules.
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
