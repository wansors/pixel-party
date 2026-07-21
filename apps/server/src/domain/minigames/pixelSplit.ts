import {
  PIXEL_OBJECTS,
  type PixelSplitInput,
  type PixelSplitSnapshot,
  columnCounts,
} from '@pp/shared'
import type { PixelSplitObject } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 40_000
const LEVELS = 8
// Points for a cut as balanced as the object allows; each pixel worse than optimal costs one point.
const MAX_SCORE_PER = 10

interface Puzzle {
  object: PixelSplitObject
  cols: number[]
  total: number
  // Best achievable |left - right| over all cut boundaries (objects with odd counts can't split even).
  minError: number
}

export interface PixelSplitState {
  players: PlayerId[]
  puzzles: Puzzle[]
  startedAt: number
  endsAt: number
  pointer: Map<PlayerId, number>
  score: Map<PlayerId, number>
  lastClearMs: Map<PlayerId, number>
}

// Real-time FFA spatial estimation. A seeded sequence of pixel-art objects is shared by everyone; each
// player drags a vertical cut to balance the pixel count on both sides, at their own pace. Pure domain
// logic: object order comes from the injected Random port (seeded per round) and time arrives as `now`.
export class PixelSplit implements MiniGame<PixelSplitState, PixelSplitInput> {
  readonly id = 'pixel-split'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): PixelSplitState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const order = PIXEL_OBJECTS.map((_, i) => i)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random.next() * (i + 1))
      ;[order[i], order[j]] = [order[j] as number, order[i] as number]
    }
    const puzzles: Puzzle[] = []
    for (let level = 0; level < LEVELS; level++) {
      const src = PIXEL_OBJECTS[order[level % order.length] as number]
      if (!src) continue
      const cols = columnCounts(src)
      const total = src.count
      let minError = total
      let left = 0
      for (let cut = 1; cut < src.cols; cut++) {
        left += cols[cut - 1] ?? 0
        minError = Math.min(minError, Math.abs(left - (total - left)))
      }
      puzzles.push({
        object: {
          index: level,
          name: src.name,
          cols: src.cols,
          rows: src.rows,
          pixels: src.cells,
        },
        cols,
        total,
        minError,
      })
    }
    return {
      players: [...ctx.players],
      puzzles,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      pointer: new Map(ctx.players.map((id) => [id, 0])),
      score: new Map(ctx.players.map((id) => [id, 0])),
      lastClearMs: new Map(ctx.players.map((id) => [id, 0])),
    }
  }

  onInput(
    state: PixelSplitState,
    playerId: PlayerId,
    input: PixelSplitInput,
    now: number,
  ): PixelSplitState {
    if (input.kind !== 'cut' || typeof input.index !== 'number' || typeof input.cut !== 'number')
      return state
    if (now >= state.endsAt) return state
    const ptr = state.pointer.get(playerId)
    if (ptr === undefined || ptr >= state.puzzles.length || input.index !== ptr) return state
    const puzzle = state.puzzles[ptr] as Puzzle
    const cut = Math.max(1, Math.min(puzzle.object.cols - 1, Math.round(input.cut)))
    let left = 0
    for (let x = 0; x < cut; x++) left += puzzle.cols[x] ?? 0
    const error = Math.abs(left - (puzzle.total - left))
    // Reward closeness to the best possible split, not to a perfect (often unreachable) even split.
    const points = Math.max(0, MAX_SCORE_PER - (error - puzzle.minError))
    state.score.set(playerId, (state.score.get(playerId) ?? 0) + points)
    state.pointer.set(playerId, ptr + 1)
    state.lastClearMs.set(playerId, now - state.startedAt)
    return state
  }

  isFinished(state: PixelSplitState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((id) => (state.pointer.get(id) ?? 0) >= state.puzzles.length)
  }

  getResult(state: PixelSplitState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => {
      const sa = state.score.get(a) ?? 0
      const sb = state.score.get(b) ?? 0
      if (sb !== sa) return sb - sa
      return (state.lastClearMs.get(a) ?? 0) - (state.lastClearMs.get(b) ?? 0)
    })
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: { s: number; t: number } | undefined
    sorted.forEach((id, idx) => {
      const s = state.score.get(id) ?? 0
      const t = state.lastClearMs.get(id) ?? 0
      if (idx > 0 && prev && (s !== prev.s || t !== prev.t)) rank = idx
      ranks[id] = rank
      prev = { s, t }
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `${state.score.get(id) ?? 0} pts`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: PixelSplitState, now: number): PixelSplitSnapshot {
    const objects: Record<PlayerId, PixelSplitObject | null> = {}
    for (const id of state.players) {
      const ptr = state.pointer.get(id) ?? 0
      objects[id] = state.puzzles[ptr]?.object ?? null
    }
    return {
      objects,
      scores: Object.fromEntries(state.score),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
