import type { TriviaInput, TriviaSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'
import {
  type QuizState,
  answerQuiz,
  dealQuestion,
  leaveQuiz,
  quizResult,
  quizSnapshot,
  shuffle,
  startQuiz,
  syncQuiz,
} from './quizCore'
import { TRIVIA_BANK } from './triviaBank'

// 4 x (7 s window + 2 s reveal) = 36 s at most; a question closes early once everybody has answered.
// The question count follows the round duration the catalog passes in.
const QUESTION_MS = 7000
const REVEAL_MS = 2000
const DEFAULT_DURATION_MS = 36_000

function configNumber(config: Record<string, unknown> | undefined, key: string): number | null {
  const value = config?.[key]
  return typeof value === 'number' && value > 0 ? value : null
}

// Real-time FFA quiz on the shared quiz phases (quizCore). A right answer scores base points plus a
// speed bonus the moment it lands (the "lightning" verdict), and every question ends with a short
// reveal of the right answer. Pure domain logic — the correct index never leaves the server while a
// question is live (see quizSnapshot).
export class Trivia implements MiniGame<QuizState, TriviaInput> {
  readonly id = 'trivia'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): QuizState {
    const questionMs = configNumber(ctx.config, 'questionMs') ?? QUESTION_MS
    const revealMs = configNumber(ctx.config, 'revealMs') ?? REVEAL_MS
    const durationMs = configNumber(ctx.config, 'durationMs') ?? DEFAULT_DURATION_MS
    const count =
      configNumber(ctx.config, 'questions') ??
      Math.max(1, Math.floor(durationMs / (questionMs + revealMs)))
    // A seeded shuffle picks the subset and deals each question, so every player in a room gets the
    // identical quiz (in their own language: the bank is bilingual, see triviaBank).
    const questions = shuffle(TRIVIA_BANK, ctx.random)
      .slice(0, Math.min(count, TRIVIA_BANK.length))
      .map((entry) => dealQuestion(entry, ctx.random))
    return startQuiz({
      players: ctx.players,
      questions,
      questionMs,
      revealMs,
      bankOnLock: true,
      now: ctx.now,
    })
  }

  onInput(state: QuizState, playerId: PlayerId, input: TriviaInput, now: number): QuizState {
    answerQuiz(state, playerId, input, now)
    return state
  }

  tick(state: QuizState, _dt: number, now: number): QuizState {
    syncQuiz(state, now)
    return state
  }

  leave(state: QuizState, playerId: PlayerId, now: number): QuizState {
    leaveQuiz(state, playerId, now)
    return state
  }

  isFinished(state: QuizState, now: number): boolean {
    syncQuiz(state, now)
    return state.phase === 'done'
  }

  getResult(state: QuizState): NormalizedResult {
    return quizResult(state)
  }

  snapshot(state: QuizState, now: number): TriviaSnapshot {
    return quizSnapshot(state, now)
  }
}
