import type { PixelDashInput, PixelDashSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 40_000
// A jump keeps the runner airborne for AIR_MS: an obstacle arriving meanwhile is cleared (with LATE_MS of
// grace for the tap's trip to the server). The ideal jump puts the apex over the obstacle.
export const AIR_MS = 380
const LATE_MS = 60
// Back on the ground the runner needs LAND_MS before jumping again — and WASTED_MS more after a jump
// that cleared nothing (an awkward landing), so mashing leaves you grounded when the next one comes.
// The client waits the full time; the server forgives SLACK_MS of network jitter.
const LAND_MS = 150
const WASTED_MS = 400
const SLACK_MS = 40
// How long before arrival an obstacle is visible/approaching (the snapshot lead window), and how far
// past the runner (in `t` units) obstacles stay in the snapshot so they scroll off-screen; obstacles
// also show a little before they enter, so the client's extrapolation never pops them in late.
const LEAD_MS = 1200
const SHOW_FROM_T = 1.15
const SHOW_UNTIL_T = -0.35
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
  // playerId → summed |jump − ideal| over their clears (ms): the tiebreak, lower is better.
  timingError: Map<PlayerId, number>
  stumbles: Map<PlayerId, number>
  // playerId → obstacle ids that passed un-cleared (counted as a stumble exactly once).
  resolvedMiss: Map<PlayerId, Set<number>>
  // playerId → when they may jump again (server time; 0 = any time).
  readyAt: Map<PlayerId, number>
}

// Real-time FFA endless-runner reflex game. One seeded track of obstacles (each with a fixed arrival
// time) is shared by everyone; each player taps JUMP to be in the air when the obstacle reaches them.
// Timing-based (no continuous physics): the track comes from the injected Random port and time arrives as
// `now`. Jumps aren't free — airtime plus a landing (longer after a wasted jump) — so mashing loses to
// timing. Most obstacles cleared wins; the more accurate jumper breaks ties.
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
      timingError: new Map(ctx.players.map((pid) => [pid, 0])),
      stumbles: new Map(ctx.players.map((pid) => [pid, 0])),
      resolvedMiss: new Map(ctx.players.map((pid) => [pid, new Set<number>()])),
      readyAt: new Map(ctx.players.map((pid) => [pid, 0])),
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
    // Still in the air, or still finding their feet.
    if (now < (state.readyAt.get(playerId) ?? 0)) return state

    // Airborne until now + AIR_MS: clears the obstacle arriving in that span (gaps are wider than it, so
    // at most one), judged against the ideal take-off, the apex right over it.
    const hit = state.obstacles.find((o) => {
      if (cleared.has(o.id) || missed.has(o.id)) return false
      const arrive = state.startedAt + o.arriveAt
      return now >= arrive - AIR_MS && now <= arrive + LATE_MS
    })
    if (hit) {
      cleared.add(hit.id)
      const ideal = state.startedAt + hit.arriveAt - AIR_MS / 2
      state.timingError.set(
        playerId,
        (state.timingError.get(playerId) ?? 0) + Math.abs(now - ideal),
      )
    }
    state.readyAt.set(playerId, now + AIR_MS + LAND_MS + (hit ? 0 : WASTED_MS) - SLACK_MS)
    return state
  }

  tick(state: PixelDashState, _dt: number, now: number): PixelDashState {
    for (const pid of state.players) {
      const cleared = state.cleared.get(pid)
      const missed = state.resolvedMiss.get(pid)
      if (!cleared || !missed) continue
      for (const o of state.obstacles) {
        if (cleared.has(o.id) || missed.has(o.id)) continue
        if (state.startedAt + o.arriveAt + LATE_MS < now) {
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

  // Most clears; equal clears go to the more accurate jumper (smaller summed timing error).
  private cmp(state: PixelDashState, a: PlayerId, b: PlayerId): number {
    const clearsOf = (id: PlayerId): number => state.cleared.get(id)?.size ?? 0
    const errorOf = (id: PlayerId): number => state.timingError.get(id) ?? 0
    return clearsOf(b) - clearsOf(a) || errorOf(a) - errorOf(b)
  }

  getResult(state: PixelDashState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => this.cmp(state, a, b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.cmp(state, sorted[idx - 1] as PlayerId, id) !== 0) rank = idx
      ranks[id] = rank
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `${state.cleared.get(id)?.size ?? 0} cleared`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: PixelDashState, now: number): PixelDashSnapshot {
    const obstacles = state.obstacles.flatMap((o) => {
      const t = (state.startedAt + o.arriveAt - now) / LEAD_MS
      return t >= SHOW_UNTIL_T && t <= SHOW_FROM_T ? [{ id: o.id, t }] : []
    })
    const scores: Record<string, number> = {}
    for (const pid of state.players) scores[pid] = state.cleared.get(pid)?.size ?? 0
    return {
      obstacles,
      scores,
      stumbles: Object.fromEntries(state.stumbles),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
