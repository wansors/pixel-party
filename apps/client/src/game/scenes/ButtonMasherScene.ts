import { type ButtonMasherSnapshot, type ClientMsg, PALETTE } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { addArcadeBackdrop, bodyStyle, headlineStyle } from '../pixelStyle'

// Button Masher canvas. Scene key === the mini-game id so GameClient can start it by id. Reads
// authoritative snapshots from RoundState and sends one MINIGAME_INPUT per press.
export class ButtonMasherScene extends Phaser.Scene {
  private countText?: Phaser.GameObjects.Text
  private timer?: Phaser.GameObjects.Text
  private board?: Phaser.GameObjects.Text

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('button-masher')
  }

  create(): void {
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    const cx = width / 2
    this.add
      .text(cx, height * 0.14, this.t('game.buttonMasher.mash'), headlineStyle(48, PALETTE.amber))
      .setOrigin(0.5)
    this.countText = this.add
      .text(cx, height * 0.42, '0', headlineStyle(96, PALETTE.text))
      .setOrigin(0.5)
    this.timer = this.add
      .text(cx, height * 0.62, '', headlineStyle(28, PALETTE.lime))
      .setOrigin(0.5)
    this.board = this.add
      .text(cx, height * 0.74, '', bodyStyle(18, PALETTE.dim, { align: 'center' }))
      .setOrigin(0.5, 0)
    this.add
      .text(cx, height * 0.9, this.t('game.buttonMasher.hint'), bodyStyle(16, PALETTE.dim))
      .setOrigin(0.5)

    this.input.on('pointerdown', () => this.mash())
    this.input.keyboard?.on('keydown-SPACE', () => this.mash())
  }

  private mash(): void {
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'mash' } })
  }

  override update(): void {
    const snap = this.state.state as ButtonMasherSnapshot | null
    if (!snap || typeof snap.remainingMs !== 'number') return
    const selfId = this.state.selfId ?? ''
    const you = this.t('game.common.you')
    this.countText?.setText(String(snap.counts[selfId] ?? 0))
    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    this.board?.setText(
      Object.entries(snap.counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, n], i) => `${i + 1}. ${id === selfId ? you : this.state.nameOf(id)} — ${n}`)
        .join('\n'),
    )
  }
}
