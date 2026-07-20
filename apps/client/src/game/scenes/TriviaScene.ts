import type { ClientMsg, TriviaSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'

const CHOICE_COLORS = [0xe63946, 0x3a7bd5, 0x2a9d3f, 0xf4c20d]

// Lightning Quiz canvas. Multiple-choice; tap an option before the timer runs out. Scene key ===
// mini-game id. Answers are tagged with the question index so the server drops stale taps.
export class TriviaScene extends Phaser.Scene {
  private progress?: Phaser.GameObjects.Text
  private timer?: Phaser.GameObjects.Text
  private question?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private choiceBtns: Phaser.GameObjects.Rectangle[] = []
  private choiceLabels: Phaser.GameObjects.Text[] = []

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
  ) {
    super('trivia')
  }

  create(): void {
    const { width, height } = this.scale
    const cx = width / 2
    this.progress = this.add
      .text(cx, height * 0.08, '', { fontFamily: 'monospace', fontSize: '20px', color: '#9fb3c8' })
      .setOrigin(0.5)
    this.timer = this.add
      .text(cx, height * 0.14, '', { fontFamily: 'monospace', fontSize: '22px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.question = this.add
      .text(cx, height * 0.3, '', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#e6edf3',
        align: 'center',
        wordWrap: { width: width * 0.85 },
      })
      .setOrigin(0.5)
    this.status = this.add
      .text(cx, height * 0.92, '', { fontFamily: 'monospace', fontSize: '15px', color: '#5b6b7b' })
      .setOrigin(0.5)

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
        .text(cx, y, '', {
          fontFamily: 'monospace',
          fontSize: '20px',
          color: '#0b0f14',
          align: 'center',
        })
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
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'answer', question: snap.index, choice } })
  }

  override update(): void {
    const snap = this.state.state as TriviaSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    this.progress?.setText(`Q ${Math.min(snap.index + 1, snap.total)} / ${snap.total}`)
    this.timer?.setText(`${Math.ceil(snap.questionRemainingMs / 1000)}s`)
    this.question?.setText(snap.question ?? 'Get ready…')

    const locked = snap.answeredCurrent.includes(selfId)
    this.status?.setText(locked ? 'Answer locked — hang tight' : `${snap.scores[selfId] ?? 0} pts`)
    this.choiceBtns.forEach((rect, i) => {
      const has = i < snap.choices.length && snap.question !== null
      rect.setVisible(has).setAlpha(locked ? 0.4 : 1)
      this.choiceLabels[i].setVisible(has).setText(has ? snap.choices[i] : '')
    })
  }
}
