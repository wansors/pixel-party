import type { BalloonChickenSnapshot, ClientMsg } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'

// Balloon Chicken canvas. Tap PUMP to inflate for points; tap CASH OUT to bank before it bursts. Scene
// key === mini-game id. The burst threshold is server-side, so the client just renders the snapshot.
export class BalloonChickenScene extends Phaser.Scene {
  private balloon?: Phaser.GameObjects.Arc
  private banked?: Phaser.GameObjects.Text
  private timer?: Phaser.GameObjects.Text
  private board?: Phaser.GameObjects.Text
  private pumpBtn?: Phaser.GameObjects.Rectangle
  private pumpLabel?: Phaser.GameObjects.Text
  private cashBtn?: Phaser.GameObjects.Rectangle
  private cashLabel?: Phaser.GameObjects.Text
  private lastStatus = 'pumping'

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('balloon-chicken')
  }

  create(): void {
    // Scene instances survive stop/start across rounds — reset per-round SFX trackers here.
    this.lastStatus = 'pumping'
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.08, '', { fontFamily: 'monospace', fontSize: '24px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.balloon = this.add.circle(cx, height * 0.36, 20, 0xe63946).setStrokeStyle(3, 0xffffff)
    this.banked = this.add
      .text(cx, height * 0.36, '', { fontFamily: 'monospace', fontSize: '28px', color: '#0b0f14' })
      .setOrigin(0.5)
    this.board = this.add
      .text(cx, height * 0.56, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#9fb3c8',
        align: 'center',
      })
      .setOrigin(0.5, 0)

    this.pumpBtn = this.add
      .rectangle(cx - width * 0.2, height * 0.88, width * 0.34, height * 0.1, 0x2a9d3f)
      .setStrokeStyle(3, 0x11181f)
      .setInteractive({ useHandCursor: true })
    this.pumpBtn.on('pointerdown', () => this.act('pump'))
    this.pumpLabel = this.add
      .text(cx - width * 0.2, height * 0.88, this.t('game.balloon.pump'), {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#0b0f14',
      })
      .setOrigin(0.5)

    this.cashBtn = this.add
      .rectangle(cx + width * 0.2, height * 0.88, width * 0.34, height * 0.1, 0xf4c20d)
      .setStrokeStyle(3, 0x11181f)
      .setInteractive({ useHandCursor: true })
    this.cashBtn.on('pointerdown', () => this.act('cashout'))
    this.cashLabel = this.add
      .text(cx + width * 0.2, height * 0.88, this.t('game.balloon.cashOut'), {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#0b0f14',
      })
      .setOrigin(0.5)

    this.input.keyboard?.on('keydown-SPACE', () => this.act('pump'))
  }

  private act(kind: 'pump' | 'cashout'): void {
    const snap = this.state.state as BalloonChickenSnapshot | null
    const self = snap?.players[this.state.selfId ?? '']
    if (!self || self.status !== 'pumping') return
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind } })
  }

  override update(): void {
    const snap = this.state.state as BalloonChickenSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const self = snap.players[selfId]
    const you = this.t('game.common.you')
    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)

    if (self) {
      if (self.status !== this.lastStatus) {
        if (self.status === 'burst') this.sfx.pop()
        if (self.status === 'cashed') this.sfx.coin()
        this.lastStatus = self.status
      }
      const alive = self.status === 'pumping'
      const radius = 20 + self.pumps * 6
      this.balloon?.setRadius(radius)
      if (self.status === 'burst') {
        this.balloon?.setFillStyle(0x3a3a3a)
        this.banked?.setText(this.t('game.balloon.pop'))
      } else {
        this.balloon?.setFillStyle(alive ? 0xe63946 : 0x2a9d3f)
        this.banked?.setText(
          String((alive ? self.pumps : self.banked / snap.pointsPerPump) * snap.pointsPerPump),
        )
      }
      this.pumpBtn?.setAlpha(alive ? 1 : 0.3)
      this.cashBtn?.setAlpha(alive ? 1 : 0.3)
      this.pumpLabel?.setText(
        this.t(
          self.status === 'cashed'
            ? 'game.balloon.cashed'
            : self.status === 'burst'
              ? 'game.balloon.bust'
              : 'game.balloon.pump',
        ),
      )
    }

    this.board?.setText(
      Object.entries(snap.players)
        .map(([id, p]): [string, number] => [
          id,
          p.status === 'burst'
            ? 0
            : p.status === 'cashed'
              ? p.banked
              : p.pumps * snap.pointsPerPump,
        ])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([id, v], i) => {
          const p = snap.players[id]
          const tag =
            p.status === 'burst'
              ? ` ${this.t('game.balloon.bust')}`
              : p.status === 'cashed'
                ? ' $'
                : ''
          return `${i + 1}. ${id === selfId ? you : this.state.nameOf(id)} — ${v}${tag}`
        })
        .join('\n'),
    )
  }
}
