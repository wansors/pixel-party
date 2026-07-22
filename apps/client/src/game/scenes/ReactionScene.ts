import type { ClientMsg, ReactionSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'

// Reaction Duel canvas. Red screen -> green screen; tap after green. Scene key === mini-game id.
export class ReactionScene extends Phaser.Scene {
  private bg?: Phaser.GameObjects.Rectangle
  private title?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private wasGreen = false
  private resolved = false

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('reaction-duel')
  }

  create(): void {
    // Scene instances survive stop/start across rounds — reset per-round SFX trackers here.
    this.wasGreen = false
    this.resolved = false
    const { width, height } = this.scale
    const cx = width / 2
    this.bg = this.add.rectangle(cx, height / 2, width, height, 0x8b1e2d).setOrigin(0.5)
    this.title = this.add
      .text(cx, height * 0.4, this.t('game.reaction.wait'), {
        fontFamily: 'monospace',
        fontSize: '56px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
    this.status = this.add
      .text(cx, height * 0.6, this.t('game.reaction.instruction'), {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffe0e0',
        align: 'center',
      })
      .setOrigin(0.5)

    this.input.on('pointerdown', () => this.tap())
    this.input.keyboard?.on('keydown-SPACE', () => this.tap())
  }

  private tap(): void {
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'tap' } })
  }

  override update(): void {
    const snap = this.state.state as ReactionSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const green = snap.light === 'green'
    this.bg?.setFillStyle(green ? 0x1a7f4b : 0x8b1e2d)
    if (green && !this.wasGreen) {
      this.wasGreen = true
      this.sfx.go()
    }

    if (snap.falseStarts.includes(selfId)) {
      if (!this.resolved) {
        this.resolved = true
        this.sfx.wrong()
      }
      this.title?.setText(this.t('game.reaction.tooEarly'))
      this.status?.setText(this.t('game.reaction.falseStart'))
      return
    }
    const mine = snap.reactions[selfId]
    if (typeof mine === 'number') {
      if (!this.resolved) {
        this.resolved = true
        this.sfx.correct()
      }
      this.title?.setText(this.t('game.reaction.ms', { ms: mine }))
      this.status?.setText(this.t('game.reaction.nice'))
      return
    }
    this.title?.setText(this.t(green ? 'game.reaction.tap' : 'game.reaction.wait'))
    this.status?.setText(this.t(green ? 'game.reaction.go' : 'game.reaction.instruction'))
  }
}
