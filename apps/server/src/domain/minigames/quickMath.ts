import type { QuickMathInput, QuickMathPrompt, QuickMathSnapshot } from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 30_000
// Generous pool so even the fastest player never runs dry in the time window.
const POOL_SIZE = 60
// Decoys are near misses: within this distance of the answer.
const DECOY_SPREAD = 5
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

// `count` distinct values from 1..max (a partial Fisher–Yates on the seeded port).
function pickDistinct(count: number, max: number, r: Random): number[] {
  const pool = Array.from({ length: max }, (_, i) => i + 1)
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(r.next() * (max - i))
    ;[pool[i], pool[j]] = [pool[j] as number, pool[i] as number]
  }
  return pool.slice(0, count)
}

// One seeded sum: +, − (never below 0) or ×.
function makeSum(r: Random): { text: string; answer: number } {
  const op = Math.floor(r.next() * 3) // 0 +, 1 -, 2 ×
  if (op === 2) {
    const a = 2 + Math.floor(r.next() * 8)
    const b = 2 + Math.floor(r.next() * 8)
    return { text: `${a} × ${b}`, answer: a * b }
  }
  if (op === 1) {
    const a = 5 + Math.floor(r.next() * 15)
    const b = 1 + Math.floor(r.next() * a) // keep the result non-negative
    return { text: `${a} − ${b}`, answer: a - b }
  }
  const a = 1 + Math.floor(r.next() * 20)
  const b = 1 + Math.floor(r.next() * 20)
  return { text: `${a} + ${b}`, answer: a + b }
}

// A sum with its answer among three near-miss decoys. How many decoys sit below the answer is drawn
// first, uniformly, so the answer's rank among the sorted choices gives nothing away ("pick a middle
// one" is a plain 1-in-4 guess); a sum too small to fit that many non-negative values under its answer
// is redrawn. Then the four are shuffled, so the correct slot varies too.
function makeQuestion(r: Random): Question {
  const below = Math.floor(r.next() * 4)
  let sum = makeSum(r)
  while (sum.answer < below) sum = makeSum(r)
  const { text, answer } = sum
  const choices = [
    answer,
    ...pickDistinct(below, Math.min(DECOY_SPREAD, answer), r).map((d) => answer - d),
    ...pickDistinct(3 - below, DECOY_SPREAD, r).map((d) => answer + d),
  ]
  for (let k = choices.length - 1; k > 0; k--) {
    const j = Math.floor(r.next() * (k + 1))
    ;[choices[k], choices[j]] = [choices[j] as number, choices[k] as number]
  }
  return { text, choices, correct: choices.indexOf(answer) }
}

// Real-time FFA arithmetic sprint. A seeded pool of questions is shared by everyone; each player
// answers as many as possible before the timer, advancing at their own pace; a wrong answer costs a
// short answer cooldown. Pure domain logic: questions come from the injected Random port (seeded per
// round) and time arrives as `now`.
export class QuickMath implements MiniGame<QuickMathState, QuickMathInput> {
  readonly id = 'quick-math'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): QuickMathState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const pool = Array.from({ length: POOL_SIZE }, () => makeQuestion(ctx.random))
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
