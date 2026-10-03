import {
  QUIZ_LANGS,
  type QuizLang,
  type QuizPhase,
  type QuizText,
  type TriviaInput,
  type TriviaSnapshot,
} from '@pp/shared'
import type { Random } from '../ports/Random'
import type { NormalizedResult, PlayerId } from './MiniGame'

// Shared rules of the quiz games (Lightning Quiz, Weird Trivia): the bilingual bank format, seeded
// question picks and deals, the right-answer score (base + speed bonus), the points ranking and the
// round's phase machine (answer window -> reveal -> next question).

// A bank entry: one question written natively in each language (its own phrasing, sometimes its own
// jokes). `right` is the true answer, `wrong` holds three decoys.
export interface QuizEntryText {
  q: string
  right: string
  wrong: readonly [string, string, string]
}

export interface QuizEntry<T extends QuizEntryText = QuizEntryText> {
  id: string
  text: Record<QuizLang, T>
}

// A question as played: its text per language with the choices in display order.
export interface DealtQuestion {
  id: string
  text: Record<QuizLang, QuizText>
  // Display slot of the right answer (the same in every language).
  correct: number
}

const BASE_POINTS = 1000
const SPEED_BONUS = 1000
export const QUIZ_CHOICES = 4

// Fisher–Yates using the seeded Random port, so every player in a room gets the identical quiz.
export function shuffle<T>(items: readonly T[], random: Random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Shuffles the four options once — one slot order for every language, so the right answer sits in the
// same slot for everybody, whatever language they play in.
export function dealQuestion(entry: QuizEntry, random: Random): DealtQuestion {
  const order = shuffle([0, 1, 2, 3], random) // 0 = the right answer, 1..3 = the decoys
  const text = {} as Record<QuizLang, QuizText>
  for (const lang of QUIZ_LANGS) {
    const t = entry.text[lang]
    const options = [t.right, ...t.wrong]
    text[lang] = { q: t.q, choices: order.map((i) => options[i]) }
  }
  return { id: entry.id, text, correct: order.indexOf(0) }
}

// Points for a right answer: the base plus a speed bonus scaled by the time left in the answer window.
export function rightAnswerPoints(remainingMs: number, windowMs: number): number {
  const left = Math.max(0, Math.min(windowMs, remainingMs))
  return BASE_POINTS + Math.round((left / windowMs) * SPEED_BONUS)
}

// Ranks by total points (equal totals share a rank).
export function rankByPoints(
  players: readonly PlayerId[],
  points: ReadonlyMap<PlayerId, number>,
  stat: (id: PlayerId) => string,
): NormalizedResult {
  const total = (id: PlayerId): number => points.get(id) ?? 0
  const placements = [...players].sort((a, b) => total(b) - total(a))
  const ranks: Record<PlayerId, number> = {}
  let rank = 0
  placements.forEach((id, idx) => {
    if (idx > 0 && total(id) !== total(placements[idx - 1])) rank = idx
    ranks[id] = rank
  })
  const stats: Record<PlayerId, string> = {}
  for (const id of players) stats[id] = stat(id)
  return { placements, ranks, stats }
}

export interface QuizState<Q extends DealtQuestion = DealtQuestion> {
  players: PlayerId[]
  questions: Q[]
  questionMs: number
  revealMs: number
  // When a right answer's points count: the moment it lands (Lightning Quiz: an instant verdict) or at
  // the reveal (Weird Trivia: everybody finds out together, so the scoreboard never tells early).
  bankOnLock: boolean
  index: number
  phase: QuizPhase
  phaseEndsAt: number
  // The question on screen: who locked which slot, and what each right answer earned.
  picks: Map<PlayerId, number>
  gained: Map<PlayerId, number>
  points: Map<PlayerId, number>
  rightAnswers: Map<PlayerId, number>
  // Players gone mid-round: no question waits for their answer.
  gone: Set<PlayerId>
}

export function startQuiz<Q extends DealtQuestion>(opts: {
  players: readonly PlayerId[]
  questions: Q[]
  questionMs: number
  revealMs: number
  bankOnLock: boolean
  now: number
}): QuizState<Q> {
  return {
    players: [...opts.players],
    questions: opts.questions,
    questionMs: opts.questionMs,
    revealMs: opts.revealMs,
    bankOnLock: opts.bankOnLock,
    index: 0,
    phase: opts.questions.length > 0 ? 'question' : 'done',
    phaseEndsAt: opts.now + opts.questionMs,
    picks: new Map(),
    gained: new Map(),
    points: new Map(opts.players.map((id) => [id, 0])),
    rightAnswers: new Map(opts.players.map((id) => [id, 0])),
    gone: new Set(),
  }
}

function bank(state: QuizState, id: PlayerId, pts: number): void {
  state.points.set(id, (state.points.get(id) ?? 0) + pts)
  state.rightAnswers.set(id, (state.rightAnswers.get(id) ?? 0) + 1)
}

function startReveal(state: QuizState, at: number): void {
  if (!state.bankOnLock) for (const [id, pts] of state.gained) bank(state, id, pts)
  state.phase = 'reveal'
  state.phaseEndsAt = at + state.revealMs
}

function nextQuestion(state: QuizState, at: number): void {
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

// Everyone still in the round has locked an answer: no point waiting out the clock.
function revealIfAllIn(state: QuizState, now: number): void {
  if (state.phase !== 'question') return
  if (state.players.every((id) => state.gone.has(id) || state.picks.has(id))) {
    startReveal(state, now)
  }
}

// Catches the phase machine up with `now` (phases end exactly on their deadline, whatever the tick).
export function syncQuiz(state: QuizState, now: number): void {
  for (;;) {
    if (state.phase === 'question' && now >= state.phaseEndsAt) {
      startReveal(state, state.phaseEndsAt)
    } else if (state.phase === 'reveal' && now >= state.phaseEndsAt) {
      nextQuestion(state, state.phaseEndsAt)
    } else {
      return
    }
  }
}

// One locked answer per player per question, aimed at the question on screen (the index drops stale
// taps); answers during a reveal are ignored.
export function answerQuiz(
  state: QuizState,
  playerId: PlayerId,
  input: TriviaInput,
  now: number,
): void {
  syncQuiz(state, now)
  if (input.kind !== 'answer' || state.phase !== 'question') return
  const { question, choice } = input
  if (question !== state.index || !Number.isInteger(choice)) return
  if (choice < 0 || choice >= QUIZ_CHOICES) return
  if (!state.players.includes(playerId) || state.picks.has(playerId)) return
  state.picks.set(playerId, choice)
  if (choice === state.questions[state.index]?.correct) {
    const pts = rightAnswerPoints(state.phaseEndsAt - now, state.questionMs)
    state.gained.set(playerId, pts)
    if (state.bankOnLock) bank(state, playerId, pts)
  }
  revealIfAllIn(state, now)
}

export function leaveQuiz(state: QuizState, playerId: PlayerId, now: number): void {
  syncQuiz(state, now)
  state.gone.add(playerId)
  revealIfAllIn(state, now)
}

// Ranks by points; the stat reads "3/5 · 4210 pts".
export function quizResult(state: QuizState): NormalizedResult {
  const total = state.questions.length
  return rankByPoints(
    state.players,
    state.points,
    (id) => `${state.rightAnswers.get(id) ?? 0}/${total} · ${state.points.get(id) ?? 0} pts`,
  )
}

// The wire view every quiz game shares (a game adds its own extras to the reveal). The right answer
// rides it only during the reveal.
export function quizSnapshot(state: QuizState, now: number): TriviaSnapshot {
  const live = state.phase !== 'done'
  const question = live ? (state.questions[state.index] ?? null) : null
  return {
    phase: state.phase,
    index: Math.min(state.index, state.questions.length),
    total: state.questions.length,
    text: question?.text ?? null,
    phaseRemainingMs: live ? Math.max(0, state.phaseEndsAt - now) : 0,
    scores: Object.fromEntries(state.points),
    answeredCurrent: live ? [...state.picks.keys()] : [],
    players: state.players.filter((id) => !state.gone.has(id)),
    reveal:
      question && state.phase === 'reveal'
        ? {
            correct: question.correct,
            picks: Object.fromEntries(state.picks),
            gained: Object.fromEntries(state.gained),
          }
        : null,
  }
}
