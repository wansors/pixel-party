import type { StopClockInput, StopClockSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const ATTEMPTS = 3
const DEFAULT_DURATION_MS = 25_000
// Missing an attempt costs the worst possible error, so skipping never beats a real try.
const MISS_PENALTY = 1

// Accumulated error with every unused attempt charged the miss penalty, so skipping (running out of
// time, leaving) ranks below real tries.
function penalisedError(state: StopClockState, id: PlayerId): number {
  const missed = ATTEMPTS - (state.attemptsDone.get(id) ?? 0)
  return (state.totalError.get(id) ?? 0) + missed * MISS_PENALTY
}

export interface StopClockState {
  players: PlayerId[]
  targets: number[]
  startedAt: number
  endsAt: number
  attemptsDone: Map<PlayerId, number>
  totalError: Map<PlayerId, number>
}

// Real-time FFA precision game. The needle sweep is animated + reported by the client (a friendly,
// latency-tolerant timing game); the server owns the seeded targets and scores the absolute error.
// Lowest accumulated error wins. Pure domain logic (targets from the seeded Random port).
export class StopClock implements MiniGame<StopClockState, StopClockInput> {
  readonly id = 'stop-clock'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): StopClockState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    // Targets kept away from the edges so the needle sweep always passes through them.
    const targets = Array.from({ length: ATTEMPTS }, () => 0.2 + ctx.random.next() * 0.6)
    return {
      players: [...ctx.players],
      targets,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      attemptsDone: new Map(ctx.players.map((id) => [id, 0])),
      totalError: new Map(ctx.players.map((id) => [id, 0])),
    }
  }

  onInput(
    state: StopClockState,
    playerId: PlayerId,
    input: StopClockInput,
    now: number,
  ): StopClockState {
    if (input.kind !== 'stop' || typeof input.attempt !== 'number' || typeof input.pos !== 'number')
      return state
    if (now >= state.endsAt) return state
    const done = state.attemptsDone.get(playerId)
    // Only accept the player's current, live attempt (drops stale/duplicate stops).
    if (done === undefined || done >= ATTEMPTS || input.attempt !== done) return state
    const pos = Math.max(0, Math.min(1, input.pos))
    const target = state.targets[done] as number
    state.totalError.set(playerId, (state.totalError.get(playerId) ?? 0) + Math.abs(pos - target))
    state.attemptsDone.set(playerId, done + 1)
    return state
  }

  // A player who left forfeits their remaining tries (charged the miss penalty, as if the clock ran
  // out), so the round can still end as soon as everyone else is done.
  leave(state: StopClockState, playerId: PlayerId, _now: number): StopClockState {
    if (!state.attemptsDone.has(playerId)) return state
    state.totalError.set(playerId, penalisedError(state, playerId))
    state.attemptsDone.set(playerId, ATTEMPTS)
    return state
  }

  isFinished(state: StopClockState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((id) => (state.attemptsDone.get(id) ?? 0) >= ATTEMPTS)
  }

  getResult(state: StopClockState): NormalizedResult {
    const errorOf = (id: PlayerId): number => penalisedError(state, id)
    const sorted = [...state.players].sort((a, b) => errorOf(a) - errorOf(b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: number | undefined
    sorted.forEach((id, idx) => {
      const e = errorOf(id)
      if (idx > 0 && e !== prev) rank = idx
      ranks[id] = rank
      prev = e
    })
    const stats: Record<PlayerId, string> = {}
    // The error the ranking used, penalty included: an idle player shows "3.00 off", not "0.00".
    for (const id of state.players) stats[id] = `${errorOf(id).toFixed(2)} off`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: StopClockState, now: number): StopClockSnapshot {
    // Once the clock has run out the totals include the miss penalty, matching the result screen.
    const ended = now >= state.endsAt
    return {
      targets: state.targets,
      attempts: ATTEMPTS,
      attemptsDone: Object.fromEntries(state.attemptsDone),
      totalError: Object.fromEntries(
        state.players.map((id) => [
          id,
          ended ? penalisedError(state, id) : (state.totalError.get(id) ?? 0),
        ]),
      ),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
