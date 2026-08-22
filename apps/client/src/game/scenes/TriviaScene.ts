import { type ClientMsg, PALETTE, type TriviaSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { addArcadeBackdrop, bodyStyle, headlineStyle } from '../pixelStyle'

const CHOICE_COLORS = [PALETTE.red, PALETTE.cyan, PALETTE.lime, PALETTE.amber]

// Lightning Quiz canvas. Multiple-choice; tap an option before the timer runs out. Scene key ===
// mini-game id. Answers are tagged with the question index so the server drops stale taps.
export class TriviaScene extends Phaser.Scene {
  private progress?: Phaser.GameObjects.Text
  private timer?: Phaser.GameObjects.Text
  private question?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private choiceBtns: Phaser.GameObjects.Rectangle[] = []
  private choiceLabels: Phaser.GameObjects.Text[] = []
  private lastScore = 0
  private lastIndex = -1
  private answeredIndex = -1

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('trivia')
  }

  create(): void {
    // Scene instances survive stop/start across rounds — reset per-round SFX trackers here.
    this.lastScore = 0
    this.lastIndex = -1
    this.answeredIndex = -1
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    const cx = width / 2
    this.progress = this.add.text(cx, height * 0.08, '', bodyStyle(20, PALETTE.dim)).setOrigin(0.5)
    this.timer = this.add
      .text(cx, height * 0.14, '', headlineStyle(22, PALETTE.lime))
      .setOrigin(0.5)
    this.question = this.add
      .text(
        cx,
        height * 0.3,
        '',
        bodyStyle(28, PALETTE.text, { align: 'center', wordWrap: { width: width * 0.85 } }),
      )
      .setOrigin(0.5)
    this.status = this.add.text(cx, height * 0.92, '', bodyStyle(15, PALETTE.dim)).setOrigin(0.5)

    const bw = width * 0.8
    const bh = height * 0.09
    const top = height * 0.48
    for (let i = 0; i < 4; i++) {
      const y = top + i * (bh + height * 0.02)
      const rect = this.add
        .rectangle(cx, y, bw, bh, CHOICE_COLORS[i])
        .setStrokeStyle(3, 0x11181f)
        .setInteractive({ useHandCursor: true })
      rect.on('pointerdown', () => this.answer(i))
      const label = this.add
        .text(cx, y, '', bodyStyle(20, PALETTE.bg, { align: 'center' }))
        .setOrigin(0.5)
      this.choiceBtns.push(rect)
      this.choiceLabels.push(label)
    }
  }

  private answer(choice: number): void {
    const snap = this.state.state as TriviaSnapshot | null
    if (!snap || snap.question === null || choice >= snap.choices.length) return
    const selfId = this.state.selfId ?? ''
    if (snap.answeredCurrent.includes(selfId)) return
    this.sfx.click()
    this.answeredIndex = snap.index
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'answer', question: snap.index, choice } })
  }

  override update(): void {
    const snap = this.state.state as TriviaSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''

    // The correct answer never rides the live snapshot, so right/wrong is inferred at reveal: a score
    // bump means correct; the question advancing with our answer locked and no bump means wrong.
    const myScore = snap.scores[selfId] ?? 0
    if (myScore > this.lastScore) this.sfx.correct()
    if (snap.index !== this.lastIndex) {
      if (
        this.lastIndex >= 0 &&
        this.answeredIndex === this.lastIndex &&
        myScore === this.lastScore
      )
        this.sfx.wrong()
      this.lastIndex = snap.index
    }
    this.lastScore = myScore

    this.progress?.setText(
      this.t('game.trivia.progress', {
        index: Math.min(snap.index + 1, snap.total),
        total: snap.total,
      }),
    )
    this.timer?.setText(`${Math.ceil(snap.questionRemainingMs / 1000)}s`)
    this.question?.setText(snap.question ?? this.t('game.trivia.getReady'))

    const locked = snap.answeredCurrent.includes(selfId)
    this.status?.setText(
      locked
        ? this.t('game.trivia.locked')
        : this.t('game.common.pts', { n: snap.scores[selfId] ?? 0 }),
    )
    this.choiceBtns.forEach((rect, i) => {
      const has = i < snap.choices.length && snap.question !== null
      rect.setVisible(has).setAlpha(locked ? 0.4 : 1)
      this.choiceLabels[i].setVisible(has).setText(has ? snap.choices[i] : '')
    })
  }
}
