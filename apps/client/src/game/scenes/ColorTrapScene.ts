import { COLOR_TRAP_COLORS, type ClientMsg, type ColorTrapSnapshot, PALETTE } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { addArcadeBackdrop, bodyStyle, ensurePixelBlock, headlineStyle } from '../pixelStyle'

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`

// Color Trap (Stroop) canvas. A color word is drawn in a mismatched ink; tap the button matching the
// INK color. Scene key === mini-game id. Sends one answer per prompt, tagged with the prompt index so
// the server can drop stale taps.
export class ColorTrapScene extends Phaser.Scene {
  private word?: Phaser.GameObjects.Text
  private progress?: Phaser.GameObjects.Text
  private timer?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private buttons: Phaser.GameObjects.Image[] = []
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
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    const cx = width / 2
    this.progress = this.add.text(cx, height * 0.1, '', bodyStyle(20, PALETTE.dim)).setOrigin(0.5)
    this.word = this.add.text(cx, height * 0.34, '', headlineStyle(72, PALETTE.text)).setOrigin(0.5)
    this.timer = this.add.text(cx, height * 0.5, '', headlineStyle(24, PALETTE.lime)).setOrigin(0.5)
    this.status = this.add
      .text(cx, height * 0.58, this.t('game.colorTrap.instruction'), bodyStyle(16, PALETTE.dim))
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
      const key = ensurePixelBlock(this, `pp-color-trap-btn-${i}`, 32, c.hex)
      const img = this.add
        .image(x, by, key)
        .setDisplaySize(bw, bw * 0.5)
        .setInteractive({ useHandCursor: true })
      img.on('pointerdown', () => this.answer(i))
      this.buttons.push(img)
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
