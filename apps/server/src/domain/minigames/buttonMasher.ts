import type { ButtonMasherInput, ButtonMasherSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 10_000
// Counted presses per player per rolling second: about the best a human finger manages, so an
// autoclicker or a three-finger drum roll ties with the fastest masher instead of trivially beating them.
export const MASHER_MAX_PRESSES_PER_SEC = 15
const RATE_WINDOW_MS = 1000

export interface ButtonMasherState {
  counts: Map<PlayerId, number>
  // playerId -> times of the presses counted in the last RATE_WINDOW_MS (oldest first).
  recent: Map<PlayerId, number[]>
  startedAt: number
  endsAt: number
}

// Real-time FFA: every player mashes; the server counts presses inside the round window (up to
// MASHER_MAX_PRESSES_PER_SEC each) and ranks by count. Pure — no clock/RNG access; time arrives as
// `now`, randomness (unused here) via the port.
export class ButtonMasher implements MiniGame<ButtonMasherState, ButtonMasherInput> {
  readonly id = 'button-masher'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): ButtonMasherState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    return {
      counts: new Map(ctx.players.map((id) => [id, 0])),
      recent: new Map(ctx.players.map((id) => [id, []])),
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  onInput(
    state: ButtonMasherState,
    playerId: PlayerId,
    input: ButtonMasherInput,
    now: number,
  ): ButtonMasherState {
    // Only count presses inside the window and only for players who are in this round.
    if (input.kind !== 'mash') return state
    if (now < state.startedAt || now >= state.endsAt) return state
    const recent = state.recent.get(playerId)
    if (!recent) return state
    while (recent.length > 0 && (recent[0] as number) <= now - RATE_WINDOW_MS) recent.shift()
    if (recent.length >= MASHER_MAX_PRESSES_PER_SEC) return state
    recent.push(now)
    state.counts.set(playerId, (state.counts.get(playerId) ?? 0) + 1)
    return state
  }

  isFinished(state: ButtonMasherState, now: number): boolean {
    return now >= state.endsAt
  }

  getResult(state: ButtonMasherState): NormalizedResult {
    const sorted = [...state.counts.entries()].sort((a, b) => b[1] - a[1])
    const placements = sorted.map(([id]) => id)
    // Equal counts share a rank (dense ranking by count).
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prevCount: number | undefined
    sorted.forEach(([id, count], idx) => {
      if (idx > 0 && count !== prevCount) rank = idx
      ranks[id] = rank
      prevCount = count
    })
    const stats: Record<PlayerId, string> = {}
    for (const [id, count] of state.counts) stats[id] = `${count} taps`
    return { placements, ranks, stats }
  }

  snapshot(state: ButtonMasherState, now: number): ButtonMasherSnapshot {
    return {
      counts: Object.fromEntries(state.counts),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
