import type { NumberRushInput, NumberRushSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const SIZE = 5
const DEFAULT_DURATION_MS = 40_000

export interface NumberRushState {
  players: PlayerId[]
  grid: number[]
  startedAt: number
  endsAt: number
  // playerId -> next number to tap (1-based); grid.length + 1 once finished.
  progress: Map<PlayerId, number>
  // playerId -> ms taken to clear the whole grid (finishers only), for tie-break ranking.
  finishedMs: Map<PlayerId, number>
  // Players gone mid-round: the "everybody finished" early out stops waiting for them.
  gone: Set<PlayerId>
}

// Real-time FFA Schulte grid. A single seeded number layout is shared by everyone; each player taps
// 1..N in order at their own pace. Pure domain logic: the layout comes from the injected Random port
// (seeded per round) and time arrives as `now`.
export class NumberRush implements MiniGame<NumberRushState, NumberRushInput> {
  readonly id = 'number-rush'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): NumberRushState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    // Fisher–Yates over 1..N using the seeded port so every device gets the identical grid.
    const grid = Array.from({ length: SIZE * SIZE }, (_, i) => i + 1)
    for (let i = grid.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random.next() * (i + 1))
      ;[grid[i], grid[j]] = [grid[j] as number, grid[i] as number]
    }
    return {
      players: [...ctx.players],
      grid,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      progress: new Map(ctx.players.map((id) => [id, 1])),
      finishedMs: new Map(),
      gone: new Set(),
    }
  }

  onInput(
    state: NumberRushState,
    playerId: PlayerId,
    input: NumberRushInput,
    now: number,
  ): NumberRushState {
    if (input.kind !== 'tap' || typeof input.cell !== 'number') return state
    if (now >= state.endsAt) return state
    const next = state.progress.get(playerId)
    if (next === undefined || next > state.grid.length) return state
    // Wrong cell is simply ignored — hunting for the right one is the whole game (classic Schulte).
    if (state.grid[input.cell] !== next) return state
    state.progress.set(playerId, next + 1)
    if (next === state.grid.length) state.finishedMs.set(playerId, now - state.startedAt)
    return state
  }

  leave(state: NumberRushState, playerId: PlayerId): NumberRushState {
    state.gone.add(playerId)
    return state
  }

  isFinished(state: NumberRushState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every(
      (id) => state.gone.has(id) || (state.progress.get(id) ?? 1) > state.grid.length,
    )
  }

  getResult(state: NumberRushState): NormalizedResult {
    const cleared = (id: PlayerId): number => (state.progress.get(id) ?? 1) - 1
    const sorted = [...state.players].sort((a, b) => {
      const ca = cleared(a)
      const cb = cleared(b)
      if (cb !== ca) return cb - ca
      // Among equal progress, finishers rank by speed; unfinished players tie.
      return (
        (state.finishedMs.get(a) ?? Number.POSITIVE_INFINITY) -
        (state.finishedMs.get(b) ?? Number.POSITIVE_INFINITY)
      )
    })
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: { c: number; f: number } | undefined
    sorted.forEach((id, idx) => {
      const c = cleared(id)
      const f = state.finishedMs.get(id) ?? Number.POSITIVE_INFINITY
      if (idx > 0 && prev && (c !== prev.c || f !== prev.f)) rank = idx
      ranks[id] = rank
      prev = { c, f }
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) {
      const f = state.finishedMs.get(id)
      stats[id] =
        f !== undefined ? `${(f / 1000).toFixed(1)}s` : `${cleared(id)}/${state.grid.length}`
    }
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: NumberRushState, now: number): NumberRushSnapshot {
    return {
      grid: state.grid,
      size: SIZE,
      progress: Object.fromEntries(state.progress),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
