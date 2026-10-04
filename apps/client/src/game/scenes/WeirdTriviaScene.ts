import { PALETTE, type WeirdTriviaReveal, type WeirdTriviaSnapshot } from '@pp/shared'
import { floatText } from '../fx'
import { hexToCss } from '../pixelStyle'
import type { SceneDeps } from './MiniGameScene'
import { QuizSceneBase, type QuizView } from './QuizSceneBase'

// Weird Trivia canvas on the shared quiz-show board (QuizSceneBase), in the player's language. Locking
// an answer gives no verdict; the reveal does it for everybody at once (the base lights the right tile
// and perches each player's avatar on their pick), the board turns into the fun fact and the crowd gets
// a quip ("NOBODY KNEW!", "3 FELL FOR IT!").
export class WeirdTriviaScene extends QuizSceneBase<WeirdTriviaSnapshot> {
  protected override hintKey = 'game.weirdTrivia.hint'

  constructor(...deps: SceneDeps) {
    super('weird-trivia', ...deps)
  }

  protected override showReveal(reveal: WeirdTriviaReveal, v: QuizView): void {
    super.showReveal(reveal, v)
    this.progress?.setText(this.t('game.weirdTrivia.trueStory')).setColor(hexToCss(PALETTE.lime))
    this.question?.setColor(hexToCss(PALETTE.amber))
    this.fitBoardText(reveal.fact[this.lang()])
    if (!this.firstSnapshot) this.crowdQuip(reveal, v.players)
  }

  // One line for the room: nobody knew, everybody (still playing) knew, or how many fell for the same
  // decoy.
  private crowdQuip(reveal: WeirdTriviaReveal, players: readonly string[]): void {
    const picks = players.map((id) => reveal.picks[id]).filter((p) => p !== undefined)
    const rightCount = picks.filter((p) => p === reveal.correct).length
    const decoys = new Map<number, number>()
    for (const p of picks) if (p !== reveal.correct) decoys.set(p, (decoys.get(p) ?? 0) + 1)
    const fooled = Math.max(0, ...decoys.values())
    let line = ''
    if (rightCount === 0) line = this.t('game.weirdTrivia.nobody')
    else if (players.length > 1 && rightCount === players.length) {
      line = this.t('game.weirdTrivia.everybody')
      // The whole room knew it: the studio audience roars.
      this.sfx.cheer()
    } else if (fooled >= 2) line = this.t('game.weirdTrivia.fooled', { n: fooled })
    if (!line) return
    const { x, y, w } = this.panelBox
    floatText(this, x + w / 2, y + 4, line, PALETTE.amber, this.compact ? 16 : 20)
  }
}
