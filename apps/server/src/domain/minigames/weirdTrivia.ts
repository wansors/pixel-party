import {
  type QuizLang,
  WEIRD_TRIVIA,
  type WeirdTriviaInput,
  type WeirdTriviaSnapshot,
} from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'
import {
  answerQuiz,
  type DealtQuestion,
  dealQuestion,
  leaveQuiz,
  type QuizState,
  quizResult,
  quizSnapshot,
  shuffle,
  startQuiz,
  syncQuiz,
} from './quizCore'
import { WEIRD_TRIVIA_BANK, type WeirdFact } from './weirdTriviaBank'

const DEFAULT_DURATION_MS = 50_000

interface Question extends DealtQuestion {
  fact: Record<QuizLang, string>
}

export type WeirdTriviaState = QuizState<Question>

function toQuestion(fact: WeirdFact, random: Random): Question {
  return { ...dealQuestion(fact, random), fact: { en: fact.text.en.fact, es: fact.text.es.fact } }
}

function configNumber(config: Record<string, unknown> | undefined, key: string): number | null {
  const value = config?.[key]
  return typeof value === 'number' && value > 0 ? value : null
}

// Weird Trivia: the Lightning Quiz phases (quizCore) on a bank of strange-but-true facts. Each question
// has a short answer window (it closes early once everybody still in the round has locked in), then a
// reveal: the right slot, who picked what and the fun fact. Points are banked only at the reveal, so
// locking in gives nothing away. Pure domain logic; phases advance on `now` from tick, inputs and checks.
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
    return startQuiz({
      players: ctx.players,
      questions: picked.map((fact) => toQuestion(fact, ctx.random)),
      questionMs,
      revealMs,
      bankOnLock: false,
      now: ctx.now,
    })
  }

  onInput(
    state: WeirdTriviaState,
    playerId: PlayerId,
    input: WeirdTriviaInput,
    now: number,
  ): WeirdTriviaState {
    answerQuiz(state, playerId, input, now)
    return state
  }

  tick(state: WeirdTriviaState, _dt: number, now: number): WeirdTriviaState {
    syncQuiz(state, now)
    return state
  }

  leave(state: WeirdTriviaState, playerId: PlayerId, now: number): WeirdTriviaState {
    leaveQuiz(state, playerId, now)
    return state
  }

  isFinished(state: WeirdTriviaState, now: number): boolean {
    syncQuiz(state, now)
    return state.phase === 'done'
  }

  getResult(state: WeirdTriviaState): NormalizedResult {
    return quizResult(state)
  }

  snapshot(state: WeirdTriviaState, now: number): WeirdTriviaSnapshot {
    const snap = quizSnapshot(state, now)
    const fact = state.questions[state.index]?.fact
    return { ...snap, reveal: snap.reveal && fact ? { ...snap.reveal, fact } : null }
  }
}
