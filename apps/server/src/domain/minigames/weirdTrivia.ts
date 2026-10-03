import {
  WEIRD_TRIVIA,
  type WeirdTriviaInput,
  type WeirdTriviaLang,
  type WeirdTriviaPhase,
  type WeirdTriviaSnapshot,
  type WeirdTriviaText,
} from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'
import { rankByPoints, rightAnswerPoints, shuffle } from './quizCore'
import { WEIRD_TRIVIA_BANK, type WeirdFact } from './weirdTriviaBank'

const DEFAULT_DURATION_MS = 50_000
const LANGS: readonly WeirdTriviaLang[] = ['en', 'es']

interface Question {
  id: string
  text: Record<WeirdTriviaLang, WeirdTriviaText>
  fact: Record<WeirdTriviaLang, string>
  // Display slot of the right answer (the same in every language).
  correct: number
}

export interface WeirdTriviaState {
  players: PlayerId[]
  questions: Question[]
  questionMs: number
  revealMs: number
  index: number
  phase: WeirdTriviaPhase
  phaseEndsAt: number
  // The question on screen: who locked which slot, and what each right answer earned. Gains are banked
  // into `points` at the reveal, so the scoreboard never gives a verdict away early.
  picks: Map<PlayerId, number>
  gained: Map<PlayerId, number>
  points: Map<PlayerId, number>
  rightAnswers: Map<PlayerId, number>
}

// One seeded slot order shared by both languages, so the right answer sits in the same slot for
// everybody whatever language they play in.
function toQuestion(fact: WeirdFact, random: Random): Question {
  const order = shuffle([0, 1, 2, 3], random) // 0 = the right answer, 1..3 = the decoys
  const text = {} as Record<WeirdTriviaLang, WeirdTriviaText>
  const facts = {} as Record<WeirdTriviaLang, string>
  for (const lang of LANGS) {
    const t = fact.text[lang]
    const options = [t.right, ...t.wrong]
    text[lang] = { q: t.q, choices: order.map((i) => options[i]) }
    facts[lang] = t.fact
  }
  return { id: fact.id, text, fact: facts, correct: order.indexOf(0) }
}

function configNumber(config: Record<string, unknown> | undefined, key: string): number | null {
  const value = config?.[key]
  return typeof value === 'number' && value > 0 ? value : null
}

// Weird Trivia: the Lightning Quiz rules on a bank of strange-but-true facts. Each question has a short
// answer window (it closes early once everybody has locked in), then a reveal: the right slot, who
// picked what and the fun fact. Pure domain logic; phases advance on `now` from tick, inputs and checks.
export class WeirdTrivia implements MiniGame<WeirdTriviaState, WeirdTriviaInput> {
  readonly id = 'weird-trivia'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): WeirdTriviaState {
    const questionMs = configNumber(ctx.config, 'questionMs') ?? WEIRD_TRIVIA.questionMs
    const revealMs = configNumber(ctx.config, 'revealMs') ?? WEIRD_TRIVIA.revealMs
    const durationMs = configNumber(ctx.config, 'durationMs') ?? DEFAULT_DURATION_MS
    const count =
      configNumber(ctx.config, 'questions') ??
      Math.max(1, Math.floor(durationMs / (questionMs + revealMs)))
    const picked = shuffle(WEIRD_TRIVIA_BANK, ctx.random).slice(
      0,
      Math.min(count, WEIRD_TRIVIA_BANK.length),
    )
    return {
      players: [...ctx.players],
      questions: picked.map((fact) => toQuestion(fact, ctx.random)),
      questionMs,
      revealMs,
      index: 0,
      phase: 'question',
      phaseEndsAt: ctx.now + questionMs,
      picks: new Map(),
      gained: new Map(),
      points: new Map(ctx.players.map((id) => [id, 0])),
      rightAnswers: new Map(ctx.players.map((id) => [id, 0])),
    }
  }

  // Catches the phase machine up with `now` (phases end exactly on their deadline, whatever the tick).
  private sync(state: WeirdTriviaState, now: number): void {
    for (;;) {
      if (state.phase === 'question' && now >= state.phaseEndsAt) {
        this.startReveal(state, state.phaseEndsAt)
      } else if (state.phase === 'reveal' && now >= state.phaseEndsAt) {
        this.nextQuestion(state, state.phaseEndsAt)
      } else {
        return
      }
    }
  }

  private startReveal(state: WeirdTriviaState, at: number): void {
    for (const [id, pts] of state.gained) {
      state.points.set(id, (state.points.get(id) ?? 0) + pts)
      state.rightAnswers.set(id, (state.rightAnswers.get(id) ?? 0) + 1)
    }
    state.phase = 'reveal'
    state.phaseEndsAt = at + state.revealMs
  }

  private nextQuestion(state: WeirdTriviaState, at: number): void {
    state.index++
    state.picks = new Map()
    state.gained = new Map()
    if (state.index >= state.questions.length) {
      state.phase = 'done'
      state.phaseEndsAt = at
      return
    }
    state.phase = 'question'
    state.phaseEndsAt = at + state.questionMs
  }

  onInput(
    state: WeirdTriviaState,
    playerId: PlayerId,
    input: WeirdTriviaInput,
    now: number,
  ): WeirdTriviaState {
    this.sync(state, now)
    if (input.kind !== 'answer' || state.phase !== 'question') return state
    const { question, choice } = input
    if (question !== state.index || !Number.isInteger(choice)) return state
    if (choice < 0 || choice >= WEIRD_TRIVIA.choices) return state
    if (!state.players.includes(playerId) || state.picks.has(playerId)) return state
    state.picks.set(playerId, choice)
    if (choice === state.questions[state.index].correct) {
      state.gained.set(playerId, rightAnswerPoints(state.phaseEndsAt - now, state.questionMs))
    }
    // Everybody locked in: no point waiting out the clock.
    if (state.picks.size >= state.players.length) this.startReveal(state, now)
    return state
  }

  tick(state: WeirdTriviaState, _dt: number, now: number): WeirdTriviaState {
    this.sync(state, now)
    return state
  }

  isFinished(state: WeirdTriviaState, now: number): boolean {
    this.sync(state, now)
    return state.phase === 'done'
  }

  getResult(state: WeirdTriviaState): NormalizedResult {
    const total = state.questions.length
    return rankByPoints(
      state.players,
      state.points,
      (id) => `${state.rightAnswers.get(id) ?? 0}/${total} · ${state.points.get(id) ?? 0} pts`,
    )
  }

  snapshot(state: WeirdTriviaState, now: number): WeirdTriviaSnapshot {
    const live = state.phase !== 'done'
    const question = live ? state.questions[state.index] : null
    return {
      phase: state.phase,
      index: Math.min(state.index, state.questions.length),
      total: state.questions.length,
      text: question?.text ?? null,
      phaseRemainingMs: live ? Math.max(0, state.phaseEndsAt - now) : 0,
      scores: Object.fromEntries(state.points),
      answeredCurrent: live ? [...state.picks.keys()] : [],
      reveal:
        question && state.phase === 'reveal'
          ? {
              correct: question.correct,
              fact: question.fact,
              picks: Object.fromEntries(state.picks),
              gained: Object.fromEntries(state.gained),
            }
          : null,
    }
  }
}
