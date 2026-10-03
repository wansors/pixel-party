import { COLOR_TRAP_COLOR_COUNT, type ColorTrapInput, type ColorTrapSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_PROMPTS = 12
const DEFAULT_PROMPT_MS = 1800
// An answer to the previous prompt still counts this long after it closed: the client stops taking
// taps the moment its own clock says the prompt is over, so all that's left in flight is a tap made
// just before that, still on its way (the round trip). Without it the client cheered a "+1" the server
// then dropped.
export const COLOR_TRAP_LATE_GRACE_MS = 300

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
  wrong: Map<PlayerId, number>
  // Sum of response times over correct answers — faster resolves ties.
  totalMs: Map<PlayerId, number>
  // Players gone mid-round: the "everyone answered everything" early finish stops waiting for them.
  gone: Set<PlayerId>
}

// Real-time FFA Stroop test. The word/ink sequence is drawn from the injected Random port (seeded per
// round) so it is identical for everyone; time arrives as `now`. Each prompt has a short window and
// takes one answer: the ink color scores +1, a wrong color costs a point (so a blind guess loses on
// average), a timeout scores nothing. Pure domain logic.
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
      wrong: new Map(ctx.players.map((id) => [id, 0])),
      totalMs: new Map(ctx.players.map((id) => [id, 0])),
      gone: new Set(),
    }
  }

  private currentIndex(state: ColorTrapState, now: number): number {
    return Math.floor((now - state.startedAt) / state.promptMs)
  }

  private score(state: ColorTrapState, id: PlayerId): number {
    return (state.correct.get(id) ?? 0) - (state.wrong.get(id) ?? 0)
  }

  onInput(
    state: ColorTrapState,
    playerId: PlayerId,
    input: ColorTrapInput,
    now: number,
  ): ColorTrapState {
    if (input.kind !== 'answer') return state
    if (!Number.isInteger(input.prompt) || typeof input.color !== 'number') return state
    const answered = state.answered.get(playerId)
    if (!answered) return state
    const idx = input.prompt
    if (idx < 0 || idx >= state.prompts.length || answered.has(idx)) return state
    // Only the live prompt takes answers — plus the one before it, for a grace period after it closed
    // (drops stale/duplicate taps, never an answer to a prompt not shown yet).
    const promptStart = state.startedAt + idx * state.promptMs
    const live = idx === this.currentIndex(state, now)
    const late = now >= promptStart + state.promptMs
    if (!live && !(late && now < promptStart + state.promptMs + COLOR_TRAP_LATE_GRACE_MS)) {
      return state
    }
    answered.add(idx)
    if (input.color === state.prompts[idx].ink) {
      state.correct.set(playerId, (state.correct.get(playerId) ?? 0) + 1)
      const ms = Math.min(now - promptStart, state.promptMs)
      state.totalMs.set(playerId, (state.totalMs.get(playerId) ?? 0) + ms)
    } else {
      state.wrong.set(playerId, (state.wrong.get(playerId) ?? 0) + 1)
    }
    return state
  }

  leave(state: ColorTrapState, playerId: PlayerId): ColorTrapState {
    state.gone.add(playerId)
    return state
  }

  isFinished(state: ColorTrapState, now: number): boolean {
    const end = state.startedAt + state.prompts.length * state.promptMs
    if (now >= end + COLOR_TRAP_LATE_GRACE_MS) return true
    // Early out once everyone still here has locked an answer for every prompt.
    for (const [id, set] of state.answered) {
      if (!state.gone.has(id) && set.size < state.prompts.length) return false
    }
    return true
  }

  // Points first; among equals, fewer wrong taps (care over spraying), then the faster right answers.
  getResult(state: ColorTrapState): NormalizedResult {
    const key = (id: PlayerId): [number, number, number] => [
      -this.score(state, id),
      state.wrong.get(id) ?? 0,
      state.totalMs.get(id) ?? 0,
    ]
    const cmp = (a: PlayerId, b: PlayerId): number => {
      const ka = key(a)
      const kb = key(b)
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2]
    }
    const sorted = [...state.players].sort(cmp)
    const ranks: Record<PlayerId, number> = {}
    sorted.forEach((id, idx) => {
      const prev = sorted[idx - 1]
      ranks[id] = prev !== undefined && cmp(prev, id) === 0 ? (ranks[prev] as number) : idx
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) {
      stats[id] = `${state.correct.get(id) ?? 0} right · ${state.wrong.get(id) ?? 0} wrong`
    }
    return { placements: sorted, ranks, stats }
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
      scores: Object.fromEntries(state.players.map((id) => [id, this.score(state, id)])),
      answeredCurrent,
    }
  }
}
