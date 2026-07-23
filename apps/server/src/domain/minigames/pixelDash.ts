import type { PixelDashInput, PixelDashSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 40_000
// A jump within ±TOL of an obstacle's arrival clears it.
const TOL_MS = 220
// How long before arrival an obstacle is visible/approaching (the snapshot lead window).
const LEAD_MS = 1200
const FIRST_MS = 1500
const GAP_MIN_MS = 700
const GAP_JITTER_MS = 600
const END_PAD_MS = 800

interface Obstacle {
  id: number
  arriveAt: number // ms offset from start
}

export interface PixelDashState {
  players: PlayerId[]
  obstacles: Obstacle[]
  startedAt: number
  endsAt: number
  // playerId → obstacle ids cleared with a well-timed jump.
  cleared: Map<PlayerId, Set<number>>
  stumbles: Map<PlayerId, number>
  // playerId → obstacle ids that passed un-cleared (counted as a stumble exactly once).
  resolvedMiss: Map<PlayerId, Set<number>>
}

// Real-time FFA endless-runner reflex game. One seeded track of obstacles (each with a fixed arrival
// time) is shared by everyone; each player taps JUMP to clear the obstacle arriving at them. Timing-based
// (no continuous physics): the track comes from the injected Random port and time arrives as `now`. Most
// obstacles cleared wins; fewer stumbles breaks ties.
export class PixelDash implements MiniGame<PixelDashState, PixelDashInput> {
  readonly id = 'pixel-dash'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): PixelDashState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const r = ctx.random
    const obstacles: Obstacle[] = []
    let t = FIRST_MS
    let id = 0
    while (t < durationMs - END_PAD_MS) {
      obstacles.push({ id: id++, arriveAt: t })
      t += GAP_MIN_MS + Math.floor(r.next() * GAP_JITTER_MS)
    }
    return {
      players: [...ctx.players],
      obstacles,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      cleared: new Map(ctx.players.map((pid) => [pid, new Set<number>()])),
      stumbles: new Map(ctx.players.map((pid) => [pid, 0])),
      resolvedMiss: new Map(ctx.players.map((pid) => [pid, new Set<number>()])),
    }
  }

  onInput(
    state: PixelDashState,
    playerId: PlayerId,
    input: PixelDashInput,
    now: number,
  ): PixelDashState {
    if (input.kind !== 'jump') return state
    const cleared = state.cleared.get(playerId)
    const missed = state.resolvedMiss.get(playerId)
    if (!cleared || !missed) return state

    let nearest: Obstacle | undefined
    let bestDelta = Number.POSITIVE_INFINITY
    for (const o of state.obstacles) {
      if (cleared.has(o.id) || missed.has(o.id)) continue
      const delta = Math.abs(state.startedAt + o.arriveAt - now)
      if (delta < bestDelta) {
        bestDelta = delta
        nearest = o
      }
    }
    if (nearest && bestDelta <= TOL_MS) cleared.add(nearest.id)
    else state.stumbles.set(playerId, (state.stumbles.get(playerId) ?? 0) + 1)
    return state
  }

  tick(state: PixelDashState, _dt: number, now: number): PixelDashState {
    for (const pid of state.players) {
      const cleared = state.cleared.get(pid)
      const missed = state.resolvedMiss.get(pid)
      if (!cleared || !missed) continue
      for (const o of state.obstacles) {
        if (cleared.has(o.id) || missed.has(o.id)) continue
        if (state.startedAt + o.arriveAt + TOL_MS < now) {
          missed.add(o.id)
          state.stumbles.set(pid, (state.stumbles.get(pid) ?? 0) + 1)
        }
      }
    }
    return state
  }

  isFinished(state: PixelDashState, now: number): boolean {
    return now >= state.endsAt
  }

  getResult(state: PixelDashState): NormalizedResult {
    const clearsOf = (id: PlayerId) => state.cleared.get(id)?.size ?? 0
    const stumblesOf = (id: PlayerId) => state.stumbles.get(id) ?? 0
    const sorted = [...state.players].sort((a, b) => {
      const byClears = clearsOf(b) - clearsOf(a)
      return byClears !== 0 ? byClears : stumblesOf(a) - stumblesOf(b)
    })
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: PlayerId | undefined
    sorted.forEach((id, idx) => {
      if (
        idx > 0 &&
        prev !== undefined &&
        !(clearsOf(id) === clearsOf(prev) && stumblesOf(id) === stumblesOf(prev))
      ) {
        rank = idx
      }
      ranks[id] = rank
      prev = id
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `${clearsOf(id)} cleared`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: PixelDashState, now: number): PixelDashSnapshot {
    const obstacles = state.obstacles.flatMap((o) => {
      const ahead = state.startedAt + o.arriveAt - now
      const t = ahead / LEAD_MS
      return t >= -TOL_MS / LEAD_MS && t <= 1 ? [{ id: o.id, t }] : []
    })
    const scores: Record<string, number> = {}
    for (const pid of state.players) scores[pid] = state.cleared.get(pid)?.size ?? 0
    return { obstacles, scores, remainingMs: Math.max(0, state.endsAt - now) }
  }
}
