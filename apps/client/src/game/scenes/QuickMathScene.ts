import { PALETTE } from '@pp/shared'
import type { ClientMsg, QuickMathSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { addArcadeBackdrop, bodyStyle, headlineStyle } from '../pixelStyle'

const CHOICE_COLORS = [PALETTE.red, 0x3a7bd5, 0x2a9d3f, PALETTE.amber]

// Quick Math canvas. Shows this player's current question + four answer buttons; answering advances to
// the next question immediately. Scene key === mini-game id.
export class QuickMathScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private score?: Phaser.GameObjects.Text
  private question?: Phaser.GameObjects.Text
  private choiceBtns: Phaser.GameObjects.Rectangle[] = []
  private choiceLabels: Phaser.GameObjects.Text[] = []
  private lastScore = 0
  private lastIndex = -1

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('quick-math')
  }

  create(): void {
    // Scene instances survive stop/start across rounds — reset per-round SFX trackers here.
    this.choiceBtns = []
    this.choiceLabels = []
    this.lastScore = 0
    this.lastIndex = -1
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add.text(cx, height * 0.1, '', headlineStyle(24, PALETTE.lime)).setOrigin(0.5)
    this.score = this.add.text(cx, height * 0.16, '', bodyStyle(16, PALETTE.dim)).setOrigin(0.5)
    this.question = this.add
      .text(cx, height * 0.34, '', headlineStyle(56, PALETTE.text))
      .setOrigin(0.5)

    const cols = 2
    const bw = width * 0.4
    const bh = height * 0.12
    const gap = width * 0.04
    const top = height * 0.56
    for (let i = 0; i < 4; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = cx + (col === 0 ? -1 : 1) * (bw / 2 + gap / 2)
      const y = top + row * (bh + height * 0.03)
      const rect = this.add
        .rectangle(x, y, bw, bh, CHOICE_COLORS[i])
        .setStrokeStyle(3, PALETTE.bg)
        .setInteractive({ useHandCursor: true })
      rect.on('pointerdown', () => this.answer(i))
      const label = this.add.text(x, y, '', headlineStyle(30, PALETTE.bg)).setOrigin(0.5)
      this.choiceBtns.push(rect)
      this.choiceLabels.push(label)
    }
  }

  private answer(choice: number): void {
    const snap = this.state.state as QuickMathSnapshot | null
    const prompt = snap?.prompts[this.state.selfId ?? '']
    if (!prompt || choice >= prompt.choices.length) return
    // Right/wrong feedback stays local: score deltas from the server confirm it on the next snapshot.
    this.sfx.click()
    this.send({
      type: 'MINIGAME_INPUT',
      input: { kind: 'answer', index: prompt.index, choice },
    })
  }

  override update(): void {
    const snap = this.state.state as QuickMathSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const prompt = snap.prompts[selfId] ?? null

    // Right/wrong inferred from deltas: a score bump = correct; the question advancing without a bump
    // = wrong. The correct answer never rides the live snapshot.
    const myScore = snap.scores[selfId] ?? 0
    const idx = prompt?.index ?? -1
    if (myScore > this.lastScore) this.sfx.correct()
    else if (this.lastIndex >= 0 && idx > this.lastIndex) this.sfx.wrong()
    this.lastScore = myScore
    this.lastIndex = idx

    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    this.score?.setText(this.t('game.common.correct', { n: snap.scores[selfId] ?? 0 }))
    this.question?.setText(prompt ? prompt.text : this.t('game.common.done'))
    this.choiceBtns.forEach((rect, i) => {
      const has = prompt !== null && i < prompt.choices.length
      rect.setVisible(has)
      this.choiceLabels[i]?.setVisible(has).setText(has ? String(prompt?.choices[i]) : '')
    })
  }
}
