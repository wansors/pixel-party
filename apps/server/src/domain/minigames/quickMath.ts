import {
  compound,
  easeIn,
  type QuickMathInput,
  type QuickMathPrompt,
  type QuickMathSnapshot,
} from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 30_000
// Generous pool so even the fastest player never runs dry in the time window.
const POOL_SIZE = 60
// Decoys are near misses: 1..5 off the answer — plus, once answers run into the tens, 10 off (the same
// last digit), so checking the units alone stops giving the sum away.
const NEAR_OFFSETS: readonly number[] = [1, 2, 3, 4, 5]
const TENS_OFFSETS: readonly number[] = [1, 2, 3, 4, 5, 10]
const TENS_FROM_ANSWER = 20

// The difficulty ramp (D40): question `index` of the shared pool is harder than the one before it,
// compounding — operands grow ~10% a question (sums up to 10 at first, 20 by the 8th question, 40s by the
// 15th) and the times table widens from ×5 to ×12, while two-step sums (a × b + c, a + b − c) ease in
// after the 8th question (half of them by the 24th). The first sums are a warm-up; the deep end is where fast players split.
const ADD_BASE = 10
const ADD_GROWTH = 1.1
const ADD_MAX = 99
const MUL_BASE = 5
const MUL_GROWTH = 1.07
const MUL_MAX = 12
const TWO_STEP_SHARE = 0.5
const TWO_STEP_FROM = 8
const TWO_STEP_FULL = 24
// A wrong answer locks that player's answers for this long. Without it, mashing one button (a 1-in-4
// guess per sum, one sum per snapshot) out-scores actually doing the arithmetic.
export const QUICK_MATH_WRONG_COOLDOWN_MS = 1200

interface Question {
  text: string
  choices: number[]
  correct: number
}

export interface QuickMathState {
  players: PlayerId[]
  pool: Question[]
  startedAt: number
  endsAt: number
  // playerId -> index into the shared pool of the question they are on.
  pointer: Map<PlayerId, number>
  correct: Map<PlayerId, number>
  wrong: Map<PlayerId, number>
  // playerId -> time until which that player's answers are ignored (wrong-answer penalty).
  cooldownUntil: Map<PlayerId, number>
}

// `count` distinct entries of `from` (a partial Fisher–Yates on the seeded port).
function pickDistinct(count: number, from: readonly number[], r: Random): number[] {
  const pool = [...from]
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(r.next() * (pool.length - i))
    ;[pool[i], pool[j]] = [pool[j] as number, pool[i] as number]
  }
  return pool.slice(0, count)
}

// The ramp at question `index`: the single-step operand ceilings and the chance of a two-step sum.
export function quickMathLevel(index: number): {
  addMax: number
  mulMax: number
  twoStepShare: number
} {
  return {
    addMax: Math.round(compound(ADD_BASE, ADD_GROWTH, index, ADD_BASE, ADD_MAX)),
    mulMax: Math.round(compound(MUL_BASE, MUL_GROWTH, index, MUL_BASE, MUL_MAX)),
    twoStepShare:
      TWO_STEP_SHARE * easeIn((index - TWO_STEP_FROM) / (TWO_STEP_FULL - TWO_STEP_FROM)),
  }
}

// Uniform integer in lo..hi.
const between = (lo: number, hi: number, r: Random): number =>
  lo + Math.floor(r.next() * (hi - lo + 1))

// One seeded sum for question `index`: +, − (never below 0) or ×, or — further into the pool — a
// two-step a × b + c / a + b − c. Operand ranges come from the ramp above; their floors rise with
// their ceilings, so a late question is never a stray 1 + 1.
function makeSum(index: number, r: Random): { text: string; answer: number } {
  const { addMax, mulMax, twoStepShare } = quickMathLevel(index)
  const addMin = Math.max(1, Math.floor(addMax / 4))
  const mulMin = Math.max(2, Math.floor(mulMax / 2))
  const twoStep = r.next() < twoStepShare
  const op = Math.floor(r.next() * 3) // 0 +, 1 -, 2 ×
  if (twoStep) {
    // Two steps at once: each operand stays within half the single-step range.
    const half = Math.max(addMin, Math.ceil(addMax / 2))
    if (op === 2) {
      const a = between(mulMin, mulMax, r)
      const b = between(2, 9, r)
      const c = between(addMin, half, r)
      return { text: `${a} × ${b} + ${c}`, answer: a * b + c }
    }
    const a = between(addMin, half, r)
    const b = between(addMin, half, r)
    const c = between(1, Math.max(a, b), r) // keeps the result positive
    return { text: `${a} + ${b} − ${c}`, answer: a + b - c }
  }
  if (op === 2) {
    const a = between(mulMin, mulMax, r)
    const b = between(mulMin, mulMax, r)
    return { text: `${a} × ${b}`, answer: a * b }
  }
  if (op === 1) {
    const a = between(Math.max(5, addMin * 2), Math.max(5, addMax), r)
    const b = between(addMin, a, r) // keep the result non-negative
    return { text: `${a} − ${b}`, answer: a - b }
  }
  const a = between(addMin, addMax, r)
  const b = between(addMin, addMax, r)
  return { text: `${a} + ${b}`, answer: a + b }
}

// Question `index` with its answer among three near-miss decoys. How many decoys sit below the answer
// is drawn first, uniformly, so the answer's rank among the sorted choices gives nothing away ("pick a
// middle one" is a plain 1-in-4 guess); a sum too small to fit that many non-negative values under its
// answer is redrawn. Then the four are shuffled, so the correct slot varies too.
function makeQuestion(index: number, r: Random): Question {
  const below = Math.floor(r.next() * 4)
  let sum = makeSum(index, r)
  while (sum.answer < below) sum = makeSum(index, r)
  const { text, answer } = sum
  const offsets = answer >= TENS_FROM_ANSWER ? TENS_OFFSETS : NEAR_OFFSETS
  const choices = [
    answer,
    ...pickDistinct(
      below,
      offsets.filter((d) => d <= answer),
      r,
    ).map((d) => answer - d),
    ...pickDistinct(3 - below, offsets, r).map((d) => answer + d),
  ]
  for (let k = choices.length - 1; k > 0; k--) {
    const j = Math.floor(r.next() * (k + 1))
    ;[choices[k], choices[j]] = [choices[j] as number, choices[k] as number]
  }
  return { text, choices, correct: choices.indexOf(answer) }
}

// Real-time FFA arithmetic sprint. A seeded pool of questions — each a notch harder than the last — is
// shared by everyone; each player answers as many as possible before the timer, advancing at their own
// pace; a wrong answer costs a short answer cooldown. Pure domain logic: questions come from the injected Random port (seeded per
// round) and time arrives as `now`.
export class QuickMath implements MiniGame<QuickMathState, QuickMathInput> {
  readonly id = 'quick-math'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): QuickMathState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const pool = Array.from({ length: POOL_SIZE }, (_, i) => makeQuestion(i, ctx.random))
    return {
      players: [...ctx.players],
      pool,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      pointer: new Map(ctx.players.map((id) => [id, 0])),
      correct: new Map(ctx.players.map((id) => [id, 0])),
      wrong: new Map(ctx.players.map((id) => [id, 0])),
      cooldownUntil: new Map(ctx.players.map((id) => [id, 0])),
    }
  }

  onInput(
    state: QuickMathState,
    playerId: PlayerId,
    input: QuickMathInput,
    now: number,
  ): QuickMathState {
    if (input.kind !== 'answer') return state
    if (typeof input.index !== 'number' || typeof input.choice !== 'number') return state
    if (now >= state.endsAt) return state
    const ptr = state.pointer.get(playerId)
    // Only accept an answer aimed at the player's live question (drops stale/duplicate taps).
    if (ptr === undefined || ptr >= state.pool.length || input.index !== ptr) return state
    // Serving a wrong-answer penalty: every answer is ignored until it runs out.
    if (now < (state.cooldownUntil.get(playerId) ?? 0)) return state
    const q = state.pool[ptr] as Question
    if (input.choice === q.correct) {
      state.correct.set(playerId, (state.correct.get(playerId) ?? 0) + 1)
    } else {
      state.wrong.set(playerId, (state.wrong.get(playerId) ?? 0) + 1)
      state.cooldownUntil.set(playerId, now + QUICK_MATH_WRONG_COOLDOWN_MS)
    }
    state.pointer.set(playerId, ptr + 1)
    return state
  }

  isFinished(state: QuickMathState, now: number): boolean {
    return now >= state.endsAt
  }

  getResult(state: QuickMathState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => {
      const ca = state.correct.get(a) ?? 0
      const cb = state.correct.get(b) ?? 0
      if (cb !== ca) return cb - ca
      // Fewer wrong answers breaks a tie (accuracy over spraying).
      return (state.wrong.get(a) ?? 0) - (state.wrong.get(b) ?? 0)
    })
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: { c: number; w: number } | undefined
    sorted.forEach((id, idx) => {
      const c = state.correct.get(id) ?? 0
      const w = state.wrong.get(id) ?? 0
      if (idx > 0 && prev && (c !== prev.c || w !== prev.w)) rank = idx
      ranks[id] = rank
      prev = { c, w }
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players)
      stats[id] = `${state.correct.get(id) ?? 0} right · ${state.wrong.get(id) ?? 0} wrong`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: QuickMathState, now: number): QuickMathSnapshot {
    const prompts: Record<PlayerId, QuickMathPrompt | null> = {}
    const cooldowns: Record<PlayerId, number> = {}
    for (const id of state.players) {
      const ptr = state.pointer.get(id) ?? 0
      const q = state.pool[ptr]
      prompts[id] = q ? { index: ptr, text: q.text, choices: q.choices } : null
      cooldowns[id] = Math.max(0, (state.cooldownUntil.get(id) ?? 0) - now)
    }
    return {
      prompts,
      scores: Object.fromEntries(state.correct),
      cooldowns,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
