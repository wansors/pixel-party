import { COLOR_TRAP_COLORS, type ClientMsg, type ColorTrapSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`

// Color Trap (Stroop) canvas. A color word is drawn in a mismatched ink; tap the button matching the
// INK color. Scene key === mini-game id. Sends one answer per prompt, tagged with the prompt index so
// the server can drop stale taps.
export class ColorTrapScene extends Phaser.Scene {
  private word?: Phaser.GameObjects.Text
  private progress?: Phaser.GameObjects.Text
  private timer?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private buttons: Phaser.GameObjects.Rectangle[] = []
  private lastAnswered = -1

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('color-trap')
  }

  create(): void {
    const { width, height } = this.scale
    const cx = width / 2
    this.progress = this.add
      .text(cx, height * 0.1, '', { fontFamily: 'monospace', fontSize: '20px', color: '#9fb3c8' })
      .setOrigin(0.5)
    this.word = this.add
      .text(cx, height * 0.34, '', { fontFamily: 'monospace', fontSize: '72px', color: '#ffffff' })
      .setOrigin(0.5)
    this.timer = this.add
      .text(cx, height * 0.5, '', { fontFamily: 'monospace', fontSize: '24px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.status = this.add
      .text(cx, height * 0.58, this.t('game.colorTrap.instruction'), {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#5b6b7b',
      })
      .setOrigin(0.5)

    // One button per palette color along the bottom.
    const n = COLOR_TRAP_COLORS.length
    const bw = Math.min(140, (width * 0.9) / n)
    const gap = bw * 0.15
    const totalW = n * bw + (n - 1) * gap
    const startX = cx - totalW / 2 + bw / 2
    const by = height * 0.8
    COLOR_TRAP_COLORS.forEach((c, i) => {
      const x = startX + i * (bw + gap)
      const rect = this.add
        .rectangle(x, by, bw, bw * 0.5, c.hex)
        .setStrokeStyle(3, 0x11181f)
        .setInteractive({ useHandCursor: true })
      rect.on('pointerdown', () => this.answer(i))
      this.buttons.push(rect)
    })
  }

  private answer(color: number): void {
    const snap = this.state.state as ColorTrapSnapshot | null
    if (!snap || snap.ink === null) return
    const selfId = this.state.selfId ?? ''
    if (snap.answeredCurrent.includes(selfId)) return
    // The ink index is already in the snapshot, so right/wrong feedback can be instant and local.
    if (color === snap.ink) this.sfx.correct()
    else this.sfx.wrong()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'answer', prompt: snap.index, color } })
  }

  override update(): void {
    const snap = this.state.state as ColorTrapSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    this.progress?.setText(`${Math.min(snap.index + 1, snap.total)} / ${snap.total}`)

    if (snap.word === null || snap.ink === null) {
      this.word?.setText('—')
      this.timer?.setText('')
      return
    }
    this.word?.setText(COLOR_TRAP_COLORS[snap.word].name)
    this.word?.setColor(css(COLOR_TRAP_COLORS[snap.ink].hex))
    this.timer?.setText(`${(snap.promptRemainingMs / 1000).toFixed(1)}s`)

    const locked = snap.answeredCurrent.includes(selfId)
    if (snap.index !== this.lastAnswered) this.lastAnswered = locked ? snap.index : -1
    this.status?.setText(this.t(locked ? 'game.colorTrap.locked' : 'game.colorTrap.instruction'))
    for (const b of this.buttons) b.setAlpha(locked ? 0.4 : 1)
  }
}
