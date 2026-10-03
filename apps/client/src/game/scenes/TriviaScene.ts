import type { TriviaSnapshot } from '@pp/shared'
import type { SceneDeps } from './MiniGameScene'
import { QuizSceneBase, type QuizView } from './QuizSceneBase'

// Suspense beat between locking an answer and revealing it (the verdict is already in the snapshot).
const REVEAL_DELAY_MS = 450

// Lightning Quiz canvas on the shared quiz-show board (QuizSceneBase), in the player's language (the
// bank is bilingual). The correct answer never rides the live snapshot, but the server scores an answer
// the moment it lands — so after a short suspense beat the locked tile reveals right (score went up) or
// wrong (it didn't).
export class TriviaScene extends QuizSceneBase<TriviaSnapshot> {
  constructor(...deps: SceneDeps) {
    super('trivia', ...deps)
  }

  protected view(snap: TriviaSnapshot): QuizView {
    const text = snap.text?.[this.lang()] ?? null
    return {
      index: snap.index,
      total: snap.total,
      question: text?.q ?? null,
      choices: text?.choices ?? [],
      open: text !== null,
      answered: snap.answeredCurrent,
      scores: snap.scores,
    }
  }

  // The HUD bar drains per question (it refills each time a new one lands).
  protected override remainingMs(snap: TriviaSnapshot): number | null {
    return snap.text === null ? 0 : snap.questionRemainingMs
  }

  protected judge(_snap: TriviaSnapshot, v: QuizView): void {
    const pick = this.pick
    if (!pick || pick.judged || pick.index !== v.index || !v.answered.includes(this.selfId)) return
    pick.judged = true
    const gained = (v.scores[this.selfId] ?? 0) - pick.scoreBefore
    const wait = Math.max(0, REVEAL_DELAY_MS - (this.time.now - pick.at))
    this.time.delayedCall(wait, () => this.revealPick(pick.index, pick.choice, gained))
  }
}
