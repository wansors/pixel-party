import { STOP_CLOCK, type StopClockInput, type StopClockSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const ATTEMPTS = STOP_CLOCK.attempts
const DEFAULT_DURATION_MS = 45_000

export interface StopClockState {
  players: PlayerId[]
  // Seconds per try.
  targets: number[]
  startedAt: number
  endsAt: number
  attemptsDone: Map<PlayerId, number>
  times: Map<PlayerId, number[]>
  // Seconds of error so far.
  totalError: Map<PlayerId, number>
}

// Accumulated error with every unused try charged the miss penalty, so skipping (running out of time,
// leaving) ranks below real tries.
function penalisedError(state: StopClockState, id: PlayerId): number {
  const missed = ATTEMPTS - (state.attemptsDone.get(id) ?? 0)
  return (state.totalError.get(id) ?? 0) + missed * STOP_CLOCK.missPenaltySec
}

// Stop the Clock (D55): a real-time FFA blind-stopwatch game. Each try asks for a seeded whole number of
// seconds (longer try by try); the stopwatch runs hidden on the player's device, which reports the time
// it was stopped at; the server scores the absolute error in seconds. Lowest accumulated error wins.
// Pure domain logic (targets from the seeded Random port).
export class StopClock implements MiniGame<StopClockState, StopClockInput> {
  readonly id = 'stop-clock'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): StopClockState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const targets = STOP_CLOCK.ranges.map(
      ([lo, hi]) => lo + Math.min(hi - lo, Math.floor(ctx.random.next() * (hi - lo + 1))),
    )
    return {
      players: [...ctx.players],
      targets,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      attemptsDone: new Map(ctx.players.map((id) => [id, 0])),
      times: new Map(ctx.players.map((id) => [id, []])),
      totalError: new Map(ctx.players.map((id) => [id, 0])),
    }
  }

  onInput(
    state: StopClockState,
    playerId: PlayerId,
    input: StopClockInput,
    now: number,
  ): StopClockState {
    if (input?.kind !== 'stop' || !Number.isInteger(input.attempt)) return state
    if (typeof input.ms !== 'number' || !Number.isFinite(input.ms)) return state
    if (now >= state.endsAt) return state
    const done = state.attemptsDone.get(playerId)
    // Only accept the player's current, live try (drops stale/duplicate stops).
    if (done === undefined || done >= ATTEMPTS || input.attempt !== done) return state
    const ms = Math.round(Math.max(0, Math.min(STOP_CLOCK.maxMs, input.ms)))
    const target = state.targets[done] as number
    const err = Math.abs(ms / 1000 - target)
    state.totalError.set(playerId, (state.totalError.get(playerId) ?? 0) + err)
    state.times.get(playerId)?.push(ms)
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
    // The error the ranking used (seconds), penalty included: an idle player shows "15.00 off".
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
      times: Object.fromEntries(state.players.map((id) => [id, [...(state.times.get(id) ?? [])]])),
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
