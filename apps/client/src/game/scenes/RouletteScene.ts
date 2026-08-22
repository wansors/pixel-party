import { PALETTE } from '@pp/shared'
import type { ClientMsg, RouletteSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { addArcadeBackdrop, bodyStyle, ensurePixelBlock, headlineStyle } from '../pixelStyle'

// Pixel Roulette canvas (D3). Tap SPIN to reveal your seeded value; highest wins. The server owns the
// values (a spin only reveals a pre-decided one). Scene key === mini-game id.
export class RouletteScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private value?: Phaser.GameObjects.Text
  private hint?: Phaser.GameObjects.Text
  private spinBtn?: Phaser.GameObjects.Image
  private spinLabel?: Phaser.GameObjects.Text
  private spun = false

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('pixel-roulette')
  }

  create(): void {
    this.spun = false
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    const cx = width / 2

    this.timer = this.add
      .text(cx, height * 0.08, '', headlineStyle(22, PALETTE.lime))
      .setOrigin(0.5)
    this.value = this.add
      .text(cx, height * 0.4, '?', headlineStyle(72, PALETTE.amber))
      .setOrigin(0.5)
    this.hint = this.add.text(cx, height * 0.55, '', bodyStyle(18)).setOrigin(0.5)

    const spinKey = ensurePixelBlock(this, 'pp-roulette-spin-btn', 16, PALETTE.lime)
    this.spinBtn = this.add
      .image(cx, height * 0.78, spinKey)
      .setDisplaySize(width * 0.5, height * 0.12)
      .setInteractive({ useHandCursor: true })
    this.spinBtn.on('pointerdown', () => this.spin())
    this.spinLabel = this.add
      .text(cx, height * 0.78, 'SPIN', headlineStyle(30, PALETTE.bg))
      .setOrigin(0.5)
  }

  private spin(): void {
    if (this.spun) return
    this.spun = true
    this.sfx.coin()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'spin' } })
  }

  override update(): void {
    const snap = this.state.state as RouletteSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)

    const myValue = snap.values[selfId]
    if (myValue !== undefined) {
      this.value?.setText(`${myValue}`)
      const spunCount = Object.values(snap.spun).filter(Boolean).length
      const total = Object.keys(snap.spun).length
      this.hint?.setText(`${spunCount}/${total} spun`)
      this.spinBtn?.setVisible(false)
      this.spinLabel?.setVisible(false)
    } else {
      this.value?.setText('?')
      this.hint?.setText(this.t('game.common.you'))
    }
  }
}
