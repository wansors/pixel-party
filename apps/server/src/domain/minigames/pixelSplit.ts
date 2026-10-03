import {
  PIXEL_OBJECTS,
  type PixelObject,
  type PixelSplitInput,
  type PixelSplitSnapshot,
  columnCounts,
} from '@pp/shared'
import type { PixelSplitObject } from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 40_000
const LEVELS = 8
// Points for a cut as balanced as the object allows. Worse cuts earn partial credit in proportion to how
// close they are: the points fall off linearly with the extra imbalance (pixels on the wrong side beyond
// the best cut's), reaching 0 at a 3:1 split — so one column off still scores about half, not nothing.
const MAX_SCORE_PER = 10

interface Puzzle {
  object: PixelSplitObject
  cols: number[]
  total: number
  // Best achievable |left - right| over all cut boundaries (objects with odd counts can't split even).
  minError: number
}

// Seeded per-puzzle placement of a shared object. The art set is fixed (and mostly symmetric), so drawn
// as-is the ideal cut always sat in the same spot. Each puzzle instead takes the object's tight column
// span, mirrors it left-right on a coin flip and drops it at a random offset inside a frame half a span
// wider than the object, so the ideal cut lands somewhere different every time. The frame width depends
// only on the object, so it keeps its on-screen size. Rows are untouched: they can't move a vertical cut.
export function placeObject(src: PixelObject, random: Random): PixelObject {
  const xs = src.cells.map((c) => c.x)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const span = maxX - minX + 1
  const slack = Math.ceil(span / 2)
  const mirror = random.next() < 0.5
  const offset = Math.floor(random.next() * (slack + 1))
  const cells = src.cells
    .map((c) => ({ x: offset + (mirror ? maxX - c.x : c.x - minX), y: c.y }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
  return { name: src.name, cols: span + slack, rows: src.rows, cells, count: cells.length }
}

// Points for a cut `excess` pixels of imbalance worse than the best one, on an object of `total` pixels.
export function splitPoints(excess: number, total: number): number {
  return Math.floor(MAX_SCORE_PER * Math.max(0, 1 - excess / (total / 2)))
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
      const shared = PIXEL_OBJECTS[order[level % order.length] as number]
      if (!shared) continue
      // Everything the scoring compares against is derived from the placed (transformed) object.
      const src = placeObject(shared, ctx.random)
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
    const points = splitPoints(error - puzzle.minError, puzzle.total)
    state.score.set(playerId, (state.score.get(playerId) ?? 0) + points)
    state.pointer.set(playerId, ptr + 1)
    state.lastClearMs.set(playerId, now - state.startedAt)
    return state
  }

  // A player who left is done: skip them to the end so the round can finish once everyone else is.
  leave(state: PixelSplitState, playerId: PlayerId, _now: number): PixelSplitState {
    if (state.pointer.has(playerId)) state.pointer.set(playerId, state.puzzles.length)
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
