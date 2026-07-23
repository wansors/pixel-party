import type { ClientMsg, RouletteSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'

// Pixel Roulette canvas (D3). Tap SPIN to reveal your seeded value; highest wins. The server owns the
// values (a spin only reveals a pre-decided one). Scene key === mini-game id.
export class RouletteScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private value?: Phaser.GameObjects.Text
  private hint?: Phaser.GameObjects.Text
  private spinBtn?: Phaser.GameObjects.Rectangle
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
    const { width, height } = this.scale
    const cx = width / 2

    this.timer = this.add
      .text(cx, height * 0.08, '', { fontFamily: 'monospace', fontSize: '22px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.value = this.add
      .text(cx, height * 0.4, '?', { fontFamily: 'monospace', fontSize: '72px', color: '#ffd166' })
      .setOrigin(0.5)
    this.hint = this.add
      .text(cx, height * 0.55, '', { fontFamily: 'monospace', fontSize: '18px', color: '#9fb3c8' })
      .setOrigin(0.5)

    this.spinBtn = this.add
      .rectangle(cx, height * 0.78, width * 0.5, height * 0.12, 0x2a9d3f)
      .setStrokeStyle(3, 0x11181f)
      .setInteractive({ useHandCursor: true })
    this.spinBtn.on('pointerdown', () => this.spin())
    this.spinLabel = this.add
      .text(cx, height * 0.78, 'SPIN', {
        fontFamily: 'monospace',
        fontSize: '30px',
        color: '#e6edf3',
      })
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
