import type { ClientMsg, ReactionSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'

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
      .text(cx, height * 0.4, 'WAIT…', {
        fontFamily: 'monospace',
        fontSize: '56px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
    this.status = this.add
      .text(cx, height * 0.6, 'Tap when the screen turns green', {
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
      this.title?.setText('TOO EARLY')
      this.status?.setText('False start — you are out this round')
      return
    }
    const mine = snap.reactions[selfId]
    if (typeof mine === 'number') {
      if (!this.resolved) {
        this.resolved = true
        this.sfx.correct()
      }
      this.title?.setText(`${mine} ms`)
      this.status?.setText('Nice reaction!')
      return
    }
    this.title?.setText(green ? 'TAP!' : 'WAIT…')
    this.status?.setText(green ? 'Go go go!' : 'Tap when the screen turns green')
  }
}
