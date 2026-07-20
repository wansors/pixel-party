import type { ButtonMasherInput, ButtonMasherSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 10_000

export interface ButtonMasherState {
  counts: Map<PlayerId, number>
  startedAt: number
  endsAt: number
}

// Real-time FFA: every player mashes; the server counts presses inside the round window and ranks by
// count. Pure — no clock/RNG access; time arrives as `now`, randomness (unused here) via the port.
export class ButtonMasher implements MiniGame<ButtonMasherState, ButtonMasherInput> {
  readonly id = 'button-masher'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): ButtonMasherState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    return {
      counts: new Map(ctx.players.map((id) => [id, 0])),
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
    if (!state.counts.has(playerId)) return state
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
    return { placements, ranks }
  }

  snapshot(state: ButtonMasherState, now: number): ButtonMasherSnapshot {
    return {
      counts: Object.fromEntries(state.counts),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
