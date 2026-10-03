import {
  type PixelHoopsInput,
  type PixelHoopsShot,
  type PixelHoopsSnapshot,
  toleranceForShot,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 30_000
const SHOTS = 40
// Extra points per basket while a streak is running (capped).
const MAX_COMBO_BONUS = 4

export interface PixelHoopsState {
  players: PlayerId[]
  // Target power per shot (0..1); further hoop = higher target.
  shots: number[]
  startedAt: number
  endsAt: number
  pointer: Map<PlayerId, number>
  score: Map<PlayerId, number>
  combo: Map<PlayerId, number>
  maxCombo: Map<PlayerId, number>
}

// Real-time FFA free-throw. A seeded sequence of shot targets is shared by everyone; each player
// charges + releases the power meter to match the target, at their own pace. Consecutive baskets build
// a combo bonus. Pure domain logic: targets from the injected Random port, time passed in as `now`.
export class PixelHoops implements MiniGame<PixelHoopsState, PixelHoopsInput> {
  readonly id = 'pixel-hoops'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): PixelHoopsState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    // Targets in [0.2, 0.9] so every shot needs a meaningful, reachable charge.
    const shots = Array.from({ length: SHOTS }, () => 0.2 + ctx.random.next() * 0.7)
    return {
      players: [...ctx.players],
      shots,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      pointer: new Map(ctx.players.map((id) => [id, 0])),
      score: new Map(ctx.players.map((id) => [id, 0])),
      combo: new Map(ctx.players.map((id) => [id, 0])),
      maxCombo: new Map(ctx.players.map((id) => [id, 0])),
    }
  }

  onInput(
    state: PixelHoopsState,
    playerId: PlayerId,
    input: PixelHoopsInput,
    now: number,
  ): PixelHoopsState {
    if (
      input.kind !== 'shoot' ||
      typeof input.index !== 'number' ||
      typeof input.power !== 'number'
    )
      return state
    if (now >= state.endsAt) return state
    const ptr = state.pointer.get(playerId)
    if (ptr === undefined || ptr >= state.shots.length || input.index !== ptr) return state
    const power = Math.max(0, Math.min(1, input.power))
    const target = state.shots[ptr] as number
    if (Math.abs(power - target) < toleranceForShot(ptr)) {
      const combo = state.combo.get(playerId) ?? 0
      const points = 1 + Math.min(combo, MAX_COMBO_BONUS)
      state.score.set(playerId, (state.score.get(playerId) ?? 0) + points)
      const nextCombo = combo + 1
      state.combo.set(playerId, nextCombo)
      state.maxCombo.set(playerId, Math.max(state.maxCombo.get(playerId) ?? 0, nextCombo))
    } else {
      state.combo.set(playerId, 0)
    }
    state.pointer.set(playerId, ptr + 1)
    return state
  }

  // A player who left is done: skip them past the last shot so the round can finish once everyone else
  // is.
  leave(state: PixelHoopsState, playerId: PlayerId, _now: number): PixelHoopsState {
    if (state.pointer.has(playerId)) state.pointer.set(playerId, state.shots.length)
    return state
  }

  isFinished(state: PixelHoopsState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((id) => (state.pointer.get(id) ?? 0) >= state.shots.length)
  }

  getResult(state: PixelHoopsState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => {
      const sa = state.score.get(a) ?? 0
      const sb = state.score.get(b) ?? 0
      if (sb !== sa) return sb - sa
      return (state.maxCombo.get(b) ?? 0) - (state.maxCombo.get(a) ?? 0)
    })
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: { s: number; m: number } | undefined
    sorted.forEach((id, idx) => {
      const s = state.score.get(id) ?? 0
      const m = state.maxCombo.get(id) ?? 0
      if (idx > 0 && prev && (s !== prev.s || m !== prev.m)) rank = idx
      ranks[id] = rank
      prev = { s, m }
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players)
      stats[id] = `${state.score.get(id) ?? 0} pts · x${state.maxCombo.get(id) ?? 0}`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: PixelHoopsState, now: number): PixelHoopsSnapshot {
    const shots: Record<PlayerId, PixelHoopsShot | null> = {}
    for (const id of state.players) {
      const ptr = state.pointer.get(id) ?? 0
      const target = state.shots[ptr]
      shots[id] = target === undefined ? null : { index: ptr, distance: target }
    }
    return {
      shots,
      scores: Object.fromEntries(state.score),
      combos: Object.fromEntries(state.combo),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
