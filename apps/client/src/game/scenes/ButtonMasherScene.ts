import type { ButtonMasherSnapshot, ClientMsg } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'

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
    const { width, height } = this.scale
    const cx = width / 2
    this.add
      .text(cx, height * 0.14, this.t('game.buttonMasher.mash'), {
        fontFamily: 'monospace',
        fontSize: '48px',
        color: '#ffd166',
      })
      .setOrigin(0.5)
    this.countText = this.add
      .text(cx, height * 0.42, '0', { fontFamily: 'monospace', fontSize: '96px', color: '#e6edf3' })
      .setOrigin(0.5)
    this.timer = this.add
      .text(cx, height * 0.62, '', { fontFamily: 'monospace', fontSize: '28px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.board = this.add
      .text(cx, height * 0.74, '', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#9fb3c8',
        align: 'center',
      })
      .setOrigin(0.5, 0)
    this.add
      .text(cx, height * 0.9, this.t('game.buttonMasher.hint'), {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#5b6b7b',
      })
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
        .map(([id, n], i) => `${i + 1}. ${id === selfId ? you : id.slice(0, 6)} — ${n}`)
        .join('\n'),
    )
  }
}
