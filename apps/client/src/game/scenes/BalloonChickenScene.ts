import { PALETTE } from '@pp/shared'
import type { BalloonChickenSnapshot, ClientMsg } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import {
  addArcadeBackdrop,
  bodyStyle,
  ensurePixelBlock,
  ensurePixelOrb,
  headlineStyle,
} from '../pixelStyle'

const BALLOON_BASE_DIAMETER = 16
const BALLOON_ALIVE_KEY = 'pp-balloon-red'
const BALLOON_BURST_KEY = 'pp-balloon-burst'
const BALLOON_CASHED_KEY = 'pp-balloon-cashed'

// Balloon Chicken canvas. Tap PUMP to inflate for points; tap CASH OUT to bank before it bursts. Scene
// key === mini-game id. The burst threshold is server-side, so the client just renders the snapshot.
export class BalloonChickenScene extends Phaser.Scene {
  private balloon?: Phaser.GameObjects.Image
  private banked?: Phaser.GameObjects.Text
  private timer?: Phaser.GameObjects.Text
  private board?: Phaser.GameObjects.Text
  private pumpBtn?: Phaser.GameObjects.Image
  private pumpLabel?: Phaser.GameObjects.Text
  private cashBtn?: Phaser.GameObjects.Image
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
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.08, '', headlineStyle(24, PALETTE.lime))
      .setOrigin(0.5)

    ensurePixelOrb(this, BALLOON_ALIVE_KEY, BALLOON_BASE_DIAMETER, PALETTE.red)
    ensurePixelOrb(this, BALLOON_BURST_KEY, BALLOON_BASE_DIAMETER, PALETTE.panelAlt)
    ensurePixelOrb(this, BALLOON_CASHED_KEY, BALLOON_BASE_DIAMETER, PALETTE.lime)
    this.balloon = this.add.image(cx, height * 0.36, BALLOON_ALIVE_KEY).setDisplaySize(40, 40)
    this.banked = this.add.text(cx, height * 0.36, '', headlineStyle(28, PALETTE.bg)).setOrigin(0.5)
    this.board = this.add
      .text(cx, height * 0.56, '', bodyStyle(16, PALETTE.dim, { align: 'center' }))
      .setOrigin(0.5, 0)

    const pumpKey = ensurePixelBlock(this, 'pp-balloon-pump-btn', 16, PALETTE.lime)
    this.pumpBtn = this.add
      .image(cx - width * 0.2, height * 0.88, pumpKey)
      .setDisplaySize(width * 0.34, height * 0.1)
      .setInteractive({ useHandCursor: true })
    this.pumpBtn.on('pointerdown', () => this.act('pump'))
    this.pumpLabel = this.add
      .text(
        cx - width * 0.2,
        height * 0.88,
        this.t('game.balloon.pump'),
        headlineStyle(24, PALETTE.bg),
      )
      .setOrigin(0.5)

    const cashKey = ensurePixelBlock(this, 'pp-balloon-cash-btn', 16, PALETTE.amber)
    this.cashBtn = this.add
      .image(cx + width * 0.2, height * 0.88, cashKey)
      .setDisplaySize(width * 0.34, height * 0.1)
      .setInteractive({ useHandCursor: true })
    this.cashBtn.on('pointerdown', () => this.act('cashout'))
    this.cashLabel = this.add
      .text(
        cx + width * 0.2,
        height * 0.88,
        this.t('game.balloon.cashOut'),
        headlineStyle(20, PALETTE.bg),
      )
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
      const diameter = (20 + self.pumps * 6) * 2
      this.balloon?.setDisplaySize(diameter, diameter)
      if (self.status === 'burst') {
        this.balloon?.setTexture(BALLOON_BURST_KEY)
        this.banked?.setText(this.t('game.balloon.pop'))
      } else {
        this.balloon?.setTexture(alive ? BALLOON_ALIVE_KEY : BALLOON_CASHED_KEY)
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
