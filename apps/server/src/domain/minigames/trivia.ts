import type { TriviaInput, TriviaSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'
import { rankByPoints, rightAnswerPoints, shuffle } from './quizCore'

// 4 x 7.5s = 30s total, matching the catalog's 30s cap (SessionEngine only ever forwards `durationMs`,
// never `questions`/`questionMs`, so these defaults are trivia's real round length in production).
const DEFAULT_QUESTIONS = 4
const DEFAULT_QUESTION_MS = 7500

interface Question {
  q: string
  choices: string[]
  answer: number
}

// Small in-repo bank (English; i18n is a later phase). A seeded shuffle picks and orders the subset so
// every player in a room gets the identical quiz.
const QUESTION_BANK: readonly Question[] = [
  {
    q: 'Which planet is closest to the Sun?',
    choices: ['Venus', 'Mercury', 'Mars', 'Earth'],
    answer: 1,
  },
  { q: 'How many continents are there?', choices: ['5', '6', '7', '8'], answer: 2 },
  {
    q: 'What is the largest ocean?',
    choices: ['Atlantic', 'Indian', 'Arctic', 'Pacific'],
    answer: 3,
  },
  { q: 'What gas do plants absorb?', choices: ['Oxygen', 'Nitrogen', 'CO2', 'Helium'], answer: 2 },
  { q: 'How many sides does a hexagon have?', choices: ['5', '6', '7', '8'], answer: 1 },
  { q: 'Which is a primary color?', choices: ['Green', 'Orange', 'Blue', 'Purple'], answer: 2 },
  { q: 'What is H2O commonly known as?', choices: ['Salt', 'Water', 'Sugar', 'Acid'], answer: 1 },
  { q: 'How many legs does a spider have?', choices: ['6', '8', '10', '12'], answer: 1 },
  {
    q: 'Which animal is the fastest on land?',
    choices: ['Lion', 'Cheetah', 'Horse', 'Gazelle'],
    answer: 1,
  },
  {
    q: 'What is the capital of Japan?',
    choices: ['Seoul', 'Beijing', 'Tokyo', 'Bangkok'],
    answer: 2,
  },
  { q: 'How many minutes in an hour?', choices: ['30', '60', '90', '100'], answer: 1 },
  { q: 'Which is not a mammal?', choices: ['Whale', 'Bat', 'Shark', 'Dog'], answer: 2 },
]

export interface TriviaState {
  players: PlayerId[]
  questions: Question[]
  startedAt: number
  questionMs: number
  answered: Map<PlayerId, Set<number>>
  points: Map<PlayerId, number>
}

// Real-time FFA quiz. Questions advance on a fixed per-question window (time arrives as `now`); a
// correct answer scores base points plus a speed bonus scaled by time left. Pure domain logic — the
// correct index never leaves the server while a question is live (see snapshot).
export class Trivia implements MiniGame<TriviaState, TriviaInput> {
  readonly id = 'trivia'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): TriviaState {
    const count =
      typeof ctx.config?.questions === 'number' ? ctx.config.questions : DEFAULT_QUESTIONS
    const questionMs =
      typeof ctx.config?.questionMs === 'number' ? ctx.config.questionMs : DEFAULT_QUESTION_MS
    const questions = shuffle(QUESTION_BANK, ctx.random).slice(
      0,
      Math.min(count, QUESTION_BANK.length),
    )
    return {
      players: [...ctx.players],
      questions,
      startedAt: ctx.now,
      questionMs,
      answered: new Map(ctx.players.map((id) => [id, new Set()])),
      points: new Map(ctx.players.map((id) => [id, 0])),
    }
  }

  private currentIndex(state: TriviaState, now: number): number {
    return Math.floor((now - state.startedAt) / state.questionMs)
  }

  onInput(state: TriviaState, playerId: PlayerId, input: TriviaInput, now: number): TriviaState {
    if (input.kind !== 'answer') return state
    if (typeof input.question !== 'number' || typeof input.choice !== 'number') return state
    const answered = state.answered.get(playerId)
    if (!answered) return state
    const idx = this.currentIndex(state, now)
    if (idx < 0 || idx >= state.questions.length) return state
    if (input.question !== idx || answered.has(idx)) return state
    answered.add(idx)
    if (input.choice === state.questions[idx].answer) {
      const questionStart = state.startedAt + idx * state.questionMs
      const earned = rightAnswerPoints(questionStart + state.questionMs - now, state.questionMs)
      state.points.set(playerId, (state.points.get(playerId) ?? 0) + earned)
    }
    return state
  }

  isFinished(state: TriviaState, now: number): boolean {
    if (now >= state.startedAt + state.questions.length * state.questionMs) return true
    for (const set of state.answered.values()) {
      if (set.size < state.questions.length) return false
    }
    return true
  }

  getResult(state: TriviaState): NormalizedResult {
    return rankByPoints(state.players, state.points, (id) => `${state.points.get(id) ?? 0} pts`)
  }

  snapshot(state: TriviaState, now: number): TriviaSnapshot {
    const idx = this.currentIndex(state, now)
    const live = idx >= 0 && idx < state.questions.length
    const question = live ? state.questions[idx] : null
    const questionStart = state.startedAt + idx * state.questionMs
    const answeredCurrent = live
      ? state.players.filter((id) => state.answered.get(id)?.has(idx))
      : []
    return {
      index: Math.min(idx, state.questions.length),
      total: state.questions.length,
      question: question?.q ?? null,
      choices: question?.choices ?? [],
      questionRemainingMs: live ? Math.max(0, questionStart + state.questionMs - now) : 0,
      scores: Object.fromEntries(state.points),
      answeredCurrent,
    }
  }
}
