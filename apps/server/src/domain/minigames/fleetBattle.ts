import type { FleetBattleInput, FleetBattleSnapshot, TeamId } from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 90_000
const GRID = 5
const FLEET_SIZES = [3, 2, 2] // 7 ship cells on a 25-cell board
const FLEET_CELLS = FLEET_SIZES.reduce((a, b) => a + b, 0)
// Longer than the 1v1 duel's turn window — a team has to coordinate on who fires.
const TURN_MS = 6000
// The turn's captain fires alone for the first half of it — time enough to pick a cell (a duel turn
// takes ~2 s) — then the turn opens to the whole team, so a slow or AFK captain costs a moment, not
// the shot.
const CAPTAIN_MS = 3000

export interface FleetBattleState {
  fleets: Map<TeamId, Set<number>> // each team's ship cells
  shots: Map<TeamId, { cell: number; hit: boolean }[]> // shots FIRED BY that team, at the opponent
  hitsTaken: Map<TeamId, Set<number>> // cells hit ON that team's own fleet
  team: Map<PlayerId, TeamId>
  // Each team's captain rotation (seeded order; leavers drop out) and who captains its next turn.
  crews: Map<TeamId, PlayerId[]>
  nextCaptain: Map<TeamId, number>
  turn: TeamId
  // This turn's captain (null = open to the whole team from the start: the captain left, or no crew).
  captain: PlayerId | null
  openAt: number // from here on, any member of the turn team may fire
  turnEndsAt: number
  startedAt: number
  endsAt: number
  done: boolean
  winner: TeamId | null
}

// Team real-time Battleship: red and blue each defend one SHARED fleet. Turn alternates by team, and
// the seed picks who opens. Each team turn has a captain — the team's members take it in turns, in a
// seeded order — who fires alone for CAPTAIN_MS; after that any member may. The first valid `fire`
// consumes the turn and passes it to the other team. A team wins by sinking the enemy fleet;
// unresolved rounds at the timer are decided on damage, then on fewer shots (else a draw). Pure —
// time arrives as `now`, randomness via the injected port.
export class FleetBattle implements MiniGame<FleetBattleState, FleetBattleInput> {
  readonly id = 'fleet-battle'
  readonly format = 'team' as const

  init(ctx: MiniGameInitCtx): FleetBattleState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const team = new Map<PlayerId, TeamId>()
    const crews = new Map<TeamId, PlayerId[]>([
      ['red', []],
      ['blue', []],
    ])
    for (const id of ctx.players) {
      const t = ctx.teams?.[id]
      if (!t) continue
      team.set(id, t)
      crews.get(t)?.push(id)
    }
    for (const crew of crews.values()) shuffle(crew, ctx.random)
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
    const state: FleetBattleState = {
      fleets,
      shots,
      hitsTaken,
      team,
      crews,
      nextCaptain: new Map([
        ['red', 0],
        ['blue', 0],
      ]),
      turn: 'red',
      captain: null,
      openAt: ctx.now,
      turnEndsAt: ctx.now,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      done: false,
      winner: null,
    }
    startTurn(state, ctx.random.next() < 0.5 ? 'red' : 'blue', ctx.now)
    return state
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
    if (now < state.openAt && playerId !== state.captain) return state // the captain's call, for now
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
      passTurn(state, now)
    }
    return state
  }

  tick(state: FleetBattleState, _dt: number, now: number): FleetBattleState {
    // Turn timeout: a stalling team forfeits its turn so the other side keeps progressing.
    if (!state.done && now >= state.turnEndsAt) passTurn(state, now)
    return state
  }

  // A member who left drops out of the captain rotation. If they were captaining this turn, the turn
  // opens to the rest of the team at once; if nobody is left on the team, the turn passes.
  leave(state: FleetBattleState, playerId: PlayerId, now: number): FleetBattleState {
    const team = state.team.get(playerId)
    const crew = team ? state.crews.get(team) : undefined
    const idx = crew ? crew.indexOf(playerId) : -1
    if (!team || !crew || idx < 0) return state
    crew.splice(idx, 1)
    const next = state.nextCaptain.get(team) ?? 0
    state.nextCaptain.set(team, idx < next ? next - 1 : next)
    if (state.captain === playerId) {
      state.captain = null
      state.openAt = now
    }
    if (!state.done && state.turn === team && crew.length === 0) passTurn(state, now)
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
      captainId: state.captain,
      openInMs: done ? 0 : Math.max(0, state.openAt - now),
      teams: { red: teamView('red'), blue: teamView('blue') },
      playerTeams: Object.fromEntries(state.team),
      done,
      winner: done ? winner : null,
    }
  }
}

// The turn goes to the other team — or straight back when everyone on the other team has left.
function passTurn(state: FleetBattleState, now: number): void {
  const other: TeamId = state.turn === 'red' ? 'blue' : 'red'
  startTurn(state, (state.crews.get(other)?.length ?? 0) > 0 ? other : state.turn, now)
}

// A fresh turn for `team`, captained by the next member in its rotation.
function startTurn(state: FleetBattleState, team: TeamId, now: number): void {
  const crew = state.crews.get(team) ?? []
  const idx = (state.nextCaptain.get(team) ?? 0) % Math.max(1, crew.length)
  state.turn = team
  state.captain = crew[idx] ?? null
  state.nextCaptain.set(team, idx + 1)
  state.openAt = state.captain ? now + CAPTAIN_MS : now
  state.turnEndsAt = now + TURN_MS
}

// Seeded in-place Fisher–Yates shuffle (the captain order).
function shuffle(ids: PlayerId[], random: Random): void {
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j] as PlayerId, ids[i] as PlayerId]
  }
}

// Winner: the stored winner once decided by a sink, otherwise (only once the round has ended) the team
// that dealt more damage, then the one that needed fewer shots for it (which also offsets the opening
// team's extra shot); no hits or equal on both is a draw (null). Returns null for an ongoing round
// too; callers gate on `done`/`ended` before reading it as final.
function resolveWinner(state: FleetBattleState, ended: boolean): TeamId | null {
  if (state.done) return state.winner
  if (!ended) return null
  const redHits = (state.hitsTaken.get('blue') as Set<number>).size
  const blueHits = (state.hitsTaken.get('red') as Set<number>).size
  if (redHits !== blueHits) return redHits > blueHits ? 'red' : 'blue'
  const redShots = (state.shots.get('red') as unknown[]).length
  const blueShots = (state.shots.get('blue') as unknown[]).length
  if (redHits === 0 || redShots === blueShots) return null
  return redShots < blueShots ? 'red' : 'blue'
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
