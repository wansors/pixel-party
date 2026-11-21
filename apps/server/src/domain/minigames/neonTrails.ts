import {
  TRAILS,
  type TrailDir,
  type TrailRider,
  type TrailsInput,
  type TrailsSnapshot,
  type TrailView,
  trailArena,
  trailCanTurn,
  trailCells,
  trailMove,
  trailNext,
  trailStepsAt,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 60_000
const DIRS: readonly TrailDir[] = ['up', 'down', 'left', 'right']

interface RiderState extends TrailRider {
  // 1-based seat on the arena grid (the occupancy value of its trail cells).
  seat: number
  // Step on which it crashed (0 = still riding).
  outAt: number
  ack: number
}

export interface NeonTrailsState {
  players: PlayerId[]
  riders: Map<PlayerId, RiderState>
  cols: number
  rows: number
  // Occupancy: 0 = free, otherwise the seat whose trail holds the cell.
  grid: Uint8Array
  startedAt: number
  endsAt: number
  stepsTaken: number
}

// Neon Trails (D41): a real-time FFA light-trail arena. Riders start on both flanks, interleaved so no
// two face each other on one row, and ride one cell per step; the step clock is time-driven (the shared
// integer pace table, quickening every TRAILS.levelSteps steps) so the simulation is deterministic and
// reconnect-safe. Each step is judged for everyone at once: riding off the arena, into any trail (a
// rider's own included, and the cell a rival is leaving — its head is trail) or into the same cell as
// another rider crashes; crashed trails are cleared the same step. Last rider standing wins; the rest
// rank by how long they lasted (same-step crashes tie). The rider rules live in @pp/shared, so the
// client predicts its own rider; a turn names the step it was meant for, so both turn on the same cell.
export class NeonTrails implements MiniGame<NeonTrailsState, TrailsInput> {
  readonly id = 'neon-trails'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): NeonTrailsState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const { cols, rows } = trailArena(ctx.players.length)
    const grid = new Uint8Array(cols * rows)
    // Seats in a seeded order, so who starts where changes every round.
    const order = ctx.players.map((id) => ({ id, key: ctx.random.next() }))
    order.sort((a, b) => a.key - b.key)
    const n = ctx.players.length
    const riders = new Map<PlayerId, RiderState>()
    order.forEach(({ id }, i) => {
      const y = Math.round(((i + 1) * rows) / (n + 1))
      const left = i % 2 === 0
      const x = left ? 3 : cols - 4
      const cell = Math.min(rows - 1, Math.max(0, y)) * cols + x
      const seat = i + 1
      grid[cell] = seat
      riders.set(id, {
        pts: [cell, cell],
        dir: left ? 'right' : 'left',
        turns: [],
        alive: true,
        seat,
        outAt: 0,
        ack: 0,
      })
    })
    return {
      players: [...ctx.players],
      riders,
      cols,
      rows,
      grid,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      stepsTaken: 0,
    }
  }

  onInput(
    state: NeonTrailsState,
    playerId: PlayerId,
    input: TrailsInput,
    _now: number,
  ): NeonTrailsState {
    if (input?.kind !== 'turn' || !DIRS.includes(input.dir)) return state
    const rider = state.riders.get(playerId)
    if (!rider) return state
    if (Number.isInteger(input.seq) && (input.seq as number) > rider.ack)
      rider.ack = input.seq as number
    if (!trailCanTurn(rider, input.dir)) return state
    // The step it's meant for: never one already taken, never behind a turn already queued, and not
    // booked further ahead than the queue reaches.
    const next = Math.max(state.stepsTaken + 1, (rider.turns.at(-1)?.at ?? 0) + 1)
    const asked = Number.isInteger(input.at) ? (input.at as number) : next
    const at = Math.max(next, Math.min(asked, state.stepsTaken + 1 + TRAILS.turnQueue))
    rider.turns.push({ dir: input.dir, at })
    return state
  }

  // Step k for everyone at once.
  private step(state: NeonTrailsState, k: number): void {
    const moves: { rider: RiderState; cell: number }[] = []
    const claims = new Map<number, number>()
    for (const rider of state.riders.values()) {
      if (!rider.alive) continue
      const cell = trailNext(rider, k, state.cols, state.rows)
      moves.push({ rider, cell })
      if (cell >= 0) claims.set(cell, (claims.get(cell) ?? 0) + 1)
    }
    const crashed: RiderState[] = []
    for (const { rider, cell } of moves) {
      if (cell < 0 || state.grid[cell] !== 0 || (claims.get(cell) ?? 0) > 1) crashed.push(rider)
    }
    for (const { rider, cell } of moves) {
      if (crashed.includes(rider)) continue
      trailMove(rider, cell)
      state.grid[cell] = rider.seat
    }
    for (const rider of crashed) this.knockOut(state, rider, k)
  }

  // Out: the rider stops where it was and its trail is cleared from the arena.
  private knockOut(state: NeonTrailsState, rider: RiderState, k: number): void {
    rider.alive = false
    rider.outAt = Math.max(1, k)
    rider.turns = []
    for (const cell of trailCells(rider.pts, state.cols)) {
      if (state.grid[cell] === rider.seat) state.grid[cell] = 0
    }
  }

  tick(state: NeonTrailsState, _dt: number, now: number): NeonTrailsState {
    const due = trailStepsAt(Math.min(now, state.endsAt) - state.startedAt)
    while (state.stepsTaken < due && !this.settled(state)) {
      const k = state.stepsTaken + 1
      this.step(state, k)
      state.stepsTaken = k
    }
    return state
  }

  // A player who left is out on the spot (their trail fades), so the last-rider end doesn't wait.
  leave(state: NeonTrailsState, playerId: PlayerId, _now: number): NeonTrailsState {
    const rider = state.riders.get(playerId)
    if (rider?.alive) this.knockOut(state, rider, state.stepsTaken)
    return state
  }

  private aliveCount(state: NeonTrailsState): number {
    let n = 0
    for (const r of state.riders.values()) if (r.alive) n++
    return n
  }

  // Nothing left to decide: one rider (or none) still riding — or, alone in the arena, none.
  private settled(state: NeonTrailsState): boolean {
    const alive = this.aliveCount(state)
    return state.players.length > 1 ? alive <= 1 : alive === 0
  }

  isFinished(state: NeonTrailsState, now: number): boolean {
    return now >= state.endsAt || this.settled(state)
  }

  // Still riding beats out; later crashes beat earlier ones; same-step crashes tie.
  private lasted(state: NeonTrailsState, id: PlayerId): number {
    const r = state.riders.get(id)
    if (!r) return 0
    return r.alive ? Number.MAX_SAFE_INTEGER : r.outAt
  }

  getResult(state: NeonTrailsState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => this.lasted(state, b) - this.lasted(state, a))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.lasted(state, sorted[idx - 1] as PlayerId) !== this.lasted(state, id))
        rank = idx
      ranks[id] = rank
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) {
      const r = state.riders.get(id)
      stats[id] = r?.alive ? 'survivor' : `${r?.outAt ?? 0} steps`
    }
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: NeonTrailsState, now: number): TrailsSnapshot {
    const riders: Record<PlayerId, TrailView> = {}
    const progress: Record<PlayerId, number> = {}
    for (const id of state.players) {
      const r = state.riders.get(id) as RiderState
      riders[id] = {
        pts: [...r.pts],
        dir: r.dir,
        alive: r.alive,
        turns: r.turns.map((t) => [t.dir, t.at]),
        outAt: r.outAt,
        ack: r.ack,
      }
      progress[id] = r.alive ? state.stepsTaken : r.outAt
    }
    return {
      riders,
      cols: state.cols,
      rows: state.rows,
      step: state.stepsTaken,
      t: now - state.startedAt,
      progress,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
