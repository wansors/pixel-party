import type { PixelBeatInput, PixelBeatSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 40_000
const FIRST_BEAT_MS = 1200
const BEAT_SPACING_MS = 650
const BEAT_JITTER_MS = 160
const PERFECT_WINDOW_MS = 90
const GOOD_WINDOW_MS = 220
const PERFECT_POINTS = 3
const GOOD_POINTS = 1

export interface PixelBeatState {
  players: PlayerId[]
  startedAt: number
  endsAt: number
  // Beat offsets (ms from startedAt), identical for every player, sorted ascending.
  beatTimes: number[]
  scores: Map<PlayerId, number>
  streaks: Map<PlayerId, number>
  // playerId -> beat indices already scored (a beat can only be scored once per player).
  consumed: Map<PlayerId, Set<number>>
}

// Real-time FFA rhythm game. One seeded beat timeline (metronome with slight jitter) is shared by
// everyone; taps are scored against the nearest not-yet-consumed beat within a tolerance window. Pure
// domain logic: the timeline is drawn from the injected Random port (seeded per round) and time
// arrives as `now`.
export class PixelBeat implements MiniGame<PixelBeatState, PixelBeatInput> {
  readonly id = 'pixel-beat'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): PixelBeatState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const r = ctx.random
    const beatTimes: number[] = []
    let t = FIRST_BEAT_MS
    while (t < durationMs - 500) {
      beatTimes.push(t)
      // Jitter is bounded to ±(BEAT_JITTER_MS / 2); spacing stays well above that, so t always
      // advances even with a degenerate RNG.
      t += BEAT_SPACING_MS + Math.floor((r.next() - 0.5) * BEAT_JITTER_MS)
    }
    return {
      players: [...ctx.players],
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      beatTimes,
      scores: new Map(ctx.players.map((id) => [id, 0])),
      streaks: new Map(ctx.players.map((id) => [id, 0])),
      consumed: new Map(ctx.players.map((id) => [id, new Set<number>()])),
    }
  }

  onInput(
    state: PixelBeatState,
    playerId: PlayerId,
    input: PixelBeatInput,
    now: number,
  ): PixelBeatState {
    if (input.kind !== 'tap') return state
    if (!state.players.includes(playerId)) return state
    if (now < state.startedAt || now >= state.endsAt) return state
    const consumed = state.consumed.get(playerId)
    if (!consumed) return state

    const elapsed = now - state.startedAt
    let bestIdx = -1
    let bestDiff = Number.POSITIVE_INFINITY
    for (let i = 0; i < state.beatTimes.length; i++) {
      if (consumed.has(i)) continue
      const diff = Math.abs(elapsed - (state.beatTimes[i] as number))
      if (diff <= GOOD_WINDOW_MS && diff < bestDiff) {
        bestDiff = diff
        bestIdx = i
      }
    }

    if (bestIdx < 0) {
      state.streaks.set(playerId, 0)
      return state
    }
    consumed.add(bestIdx)
    const points = bestDiff <= PERFECT_WINDOW_MS ? PERFECT_POINTS : GOOD_POINTS
    state.scores.set(playerId, (state.scores.get(playerId) ?? 0) + points)
    state.streaks.set(playerId, (state.streaks.get(playerId) ?? 0) + 1)
    return state
  }

  isFinished(state: PixelBeatState, now: number): boolean {
    return now >= state.endsAt
  }

  getResult(state: PixelBeatState): NormalizedResult {
    const sorted = [...state.players].sort(
      (a, b) => (state.scores.get(b) ?? 0) - (state.scores.get(a) ?? 0),
    )
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: number | undefined
    sorted.forEach((id, idx) => {
      const v = state.scores.get(id) ?? 0
      if (idx > 0 && v !== prev) rank = idx
      ranks[id] = rank
      prev = v
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `${state.scores.get(id) ?? 0} pts`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: PixelBeatState, now: number): PixelBeatSnapshot {
    return {
      beatTimes: state.beatTimes,
      scores: Object.fromEntries(state.scores),
      streaks: Object.fromEntries(state.streaks),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
