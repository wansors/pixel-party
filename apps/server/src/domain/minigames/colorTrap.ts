import { COLOR_TRAP_COLOR_COUNT, type ColorTrapInput, type ColorTrapSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_PROMPTS = 12
const DEFAULT_PROMPT_MS = 1800

interface Prompt {
  // color index spelled by the text vs. the ink color it is drawn in (always mismatched).
  word: number
  ink: number
}

export interface ColorTrapState {
  players: PlayerId[]
  prompts: Prompt[]
  startedAt: number
  promptMs: number
  answered: Map<PlayerId, Set<number>>
  correct: Map<PlayerId, number>
  // Sum of response times over correct answers — faster resolves ties.
  totalMs: Map<PlayerId, number>
}

// Real-time FFA Stroop test. The word/ink sequence is drawn from the injected Random port (seeded per
// round) so it is identical for everyone; time arrives as `now`. Each prompt has a short window; a
// correct tap on the ink color scores, a wrong tap or timeout scores nothing. Pure domain logic.
export class ColorTrap implements MiniGame<ColorTrapState, ColorTrapInput> {
  readonly id = 'color-trap'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): ColorTrapState {
    const count = typeof ctx.config?.prompts === 'number' ? ctx.config.prompts : DEFAULT_PROMPTS
    const promptMs =
      typeof ctx.config?.promptMs === 'number' ? ctx.config.promptMs : DEFAULT_PROMPT_MS
    const n = COLOR_TRAP_COLOR_COUNT
    const prompts: Prompt[] = []
    for (let i = 0; i < count; i++) {
      const word = Math.floor(ctx.random.next() * n)
      // Force a mismatch: pick an ink among the other n-1 colors — that is the whole trap.
      const ink = (word + 1 + Math.floor(ctx.random.next() * (n - 1))) % n
      prompts.push({ word, ink })
    }
    return {
      players: [...ctx.players],
      prompts,
      startedAt: ctx.now,
      promptMs,
      answered: new Map(ctx.players.map((id) => [id, new Set()])),
      correct: new Map(ctx.players.map((id) => [id, 0])),
      totalMs: new Map(ctx.players.map((id) => [id, 0])),
    }
  }

  private currentIndex(state: ColorTrapState, now: number): number {
    return Math.floor((now - state.startedAt) / state.promptMs)
  }

  onInput(
    state: ColorTrapState,
    playerId: PlayerId,
    input: ColorTrapInput,
    now: number,
  ): ColorTrapState {
    if (input.kind !== 'answer') return state
    if (typeof input.prompt !== 'number' || typeof input.color !== 'number') return state
    const answered = state.answered.get(playerId)
    if (!answered) return state
    const idx = this.currentIndex(state, now)
    if (idx < 0 || idx >= state.prompts.length) return state
    // Only accept an answer aimed at the prompt that is actually live (drops stale/duplicate taps).
    if (input.prompt !== idx || answered.has(idx)) return state
    answered.add(idx)
    if (input.color === state.prompts[idx].ink) {
      state.correct.set(playerId, (state.correct.get(playerId) ?? 0) + 1)
      const promptStart = state.startedAt + idx * state.promptMs
      state.totalMs.set(playerId, (state.totalMs.get(playerId) ?? 0) + (now - promptStart))
    }
    return state
  }

  isFinished(state: ColorTrapState, now: number): boolean {
    if (now >= state.startedAt + state.prompts.length * state.promptMs) return true
    // Early out once everyone has locked an answer for every prompt.
    for (const set of state.answered.values()) {
      if (set.size < state.prompts.length) return false
    }
    return true
  }

  getResult(state: ColorTrapState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => {
      const ca = state.correct.get(a) ?? 0
      const cb = state.correct.get(b) ?? 0
      if (cb !== ca) return cb - ca
      return (state.totalMs.get(a) ?? 0) - (state.totalMs.get(b) ?? 0)
    })
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: { c: number; t: number } | undefined
    sorted.forEach((id, idx) => {
      const c = state.correct.get(id) ?? 0
      const t = state.totalMs.get(id) ?? 0
      if (idx > 0 && prev && (c !== prev.c || t !== prev.t)) rank = idx
      ranks[id] = rank
      prev = { c, t }
    })
    return { placements: sorted, ranks }
  }

  snapshot(state: ColorTrapState, now: number): ColorTrapSnapshot {
    const idx = this.currentIndex(state, now)
    const live = idx >= 0 && idx < state.prompts.length
    const prompt = live ? state.prompts[idx] : null
    const promptStart = state.startedAt + idx * state.promptMs
    const answeredCurrent = live
      ? state.players.filter((id) => state.answered.get(id)?.has(idx))
      : []
    return {
      index: Math.min(idx, state.prompts.length),
      total: state.prompts.length,
      word: prompt?.word ?? null,
      ink: prompt?.ink ?? null,
      promptRemainingMs: live ? Math.max(0, promptStart + state.promptMs - now) : 0,
      scores: Object.fromEntries(state.correct),
      answeredCurrent,
    }
  }
}
