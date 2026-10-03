import {
  PIXEL_OBJECTS,
  type PixelWeightInput,
  type PixelWeightObject,
  type PixelWeightSnapshot,
  pixelVariant,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 40_000
const LEVELS = 8
// Points for a perfect guess; each unit of error off the true count costs one point (floored at 0).
const MAX_SCORE_PER = 10

interface Puzzle {
  object: PixelWeightObject
  answer: number
}

export interface PixelWeightState {
  players: PlayerId[]
  puzzles: Puzzle[]
  startedAt: number
  endsAt: number
  pointer: Map<PlayerId, number>
  score: Map<PlayerId, number>
  lastClearMs: Map<PlayerId, number>
}

// Real-time FFA estimation. A seeded sequence of pixel-art objects is shared by everyone; each player
// eyeballs how many pixels an object has and submits a guess, at their own pace. Every puzzle is a
// seeded variant of its object (stretched, nibbled, mirrored — see pixelVariant), so the count shown
// after a guess can't be memorised for the next round. Pure domain logic: the objects come from the
// injected Random port (seeded per round) and time arrives as `now`.
export class PixelWeight implements MiniGame<PixelWeightState, PixelWeightInput> {
  readonly id = 'pixel-weight'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): PixelWeightState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    // Seeded shuffle of the shared object set; take the first LEVELS (no repeats — the set is larger).
    const order = PIXEL_OBJECTS.map((_, i) => i)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random.next() * (i + 1))
      ;[order[i], order[j]] = [order[j] as number, order[i] as number]
    }
    const puzzles: Puzzle[] = []
    for (let level = 0; level < LEVELS; level++) {
      const base = PIXEL_OBJECTS[order[level % order.length] as number]
      if (!base) continue
      const src = pixelVariant(base, ctx.random)
      puzzles.push({
        object: {
          index: level,
          name: src.name,
          cols: src.cols,
          rows: src.rows,
          pixels: src.cells,
          flashMs: Math.max(2200 - level * 120, 900),
          maxGuess: src.cols * src.rows,
        },
        answer: src.count,
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
    state: PixelWeightState,
    playerId: PlayerId,
    input: PixelWeightInput,
    now: number,
  ): PixelWeightState {
    if (
      input.kind !== 'guess' ||
      typeof input.index !== 'number' ||
      typeof input.value !== 'number'
    )
      return state
    if (now >= state.endsAt) return state
    const ptr = state.pointer.get(playerId)
    if (ptr === undefined || ptr >= state.puzzles.length || input.index !== ptr) return state
    const puzzle = state.puzzles[ptr] as Puzzle
    const guess = Math.max(0, Math.min(puzzle.object.maxGuess, Math.round(input.value)))
    const error = Math.abs(guess - puzzle.answer)
    const points = Math.max(0, MAX_SCORE_PER - error)
    state.score.set(playerId, (state.score.get(playerId) ?? 0) + points)
    state.pointer.set(playerId, ptr + 1)
    state.lastClearMs.set(playerId, now - state.startedAt)
    return state
  }

  // A player who left is done: skip them to the end so the round can finish once everyone else is.
  leave(state: PixelWeightState, playerId: PlayerId, _now: number): PixelWeightState {
    if (state.pointer.has(playerId)) state.pointer.set(playerId, state.puzzles.length)
    return state
  }

  isFinished(state: PixelWeightState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((id) => (state.pointer.get(id) ?? 0) >= state.puzzles.length)
  }

  getResult(state: PixelWeightState): NormalizedResult {
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

  snapshot(state: PixelWeightState, now: number): PixelWeightSnapshot {
    const objects: Record<PlayerId, PixelWeightObject | null> = {}
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
