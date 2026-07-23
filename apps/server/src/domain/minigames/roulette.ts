import type { RouletteInput, RouletteSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 15_000
const MAX_VALUE = 100

export interface RouletteState {
  players: PlayerId[]
  values: Map<PlayerId, number>
  spun: Set<PlayerId>
  startedAt: number
  endsAt: number
}

// Pure-luck FFA. Each player's value is seeded at init and hidden until they spin; highest value wins.
// Deterministic: values come from the injected Random port; spinning only reveals a pre-decided value,
// so the outcome cannot be manipulated by tap timing. Use sparingly (scoring/healthy-competition note).
export class Roulette implements MiniGame<RouletteState, RouletteInput> {
  readonly id = 'pixel-roulette'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): RouletteState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const values = new Map<PlayerId, number>()
    for (const pid of ctx.players) values.set(pid, 1 + Math.floor(ctx.random.next() * MAX_VALUE))
    return {
      players: [...ctx.players],
      values,
      spun: new Set(),
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  onInput(
    state: RouletteState,
    playerId: PlayerId,
    input: RouletteInput,
    now: number,
  ): RouletteState {
    if (input.kind !== 'spin' || now >= state.endsAt) return state
    if (state.values.has(playerId)) state.spun.add(playerId)
    return state
  }

  isFinished(state: RouletteState, now: number): boolean {
    return now >= state.endsAt || state.players.every((p) => state.spun.has(p))
  }

  getResult(state: RouletteState): NormalizedResult {
    const sorted = [...state.players].sort(
      (a, b) => (state.values.get(b) ?? 0) - (state.values.get(a) ?? 0),
    )
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: number | undefined
    sorted.forEach((id, idx) => {
      const v = state.values.get(id) ?? 0
      if (idx > 0 && v !== prev) rank = idx
      ranks[id] = rank
      prev = v
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `${state.values.get(id) ?? 0}`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: RouletteState, now: number): RouletteSnapshot {
    const ended = now >= state.endsAt
    const spun: Record<string, boolean> = {}
    const values: Record<string, number> = {}
    for (const pid of state.players) {
      const has = state.spun.has(pid)
      spun[pid] = has
      // A value is public once its owner has spun (or the round has ended).
      if (has || ended) values[pid] = state.values.get(pid) ?? 0
    }
    return { spun, values, remainingMs: Math.max(0, state.endsAt - now) }
  }
}
