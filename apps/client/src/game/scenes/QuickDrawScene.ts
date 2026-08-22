import { PALETTE } from '@pp/shared'
import type { ClientMsg, QuickDrawSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { addArcadeBackdrop, bodyStyle, headlineStyle } from '../pixelStyle'

const WAIT_BG = 0x8b1e2d
const FIRE_BG = 0x1a7f4b

// Quick Draw Duel canvas. Full-screen reaction shootout for the local player: red "Wait..." until the
// signal fires, then green "FIRE!"; tap anywhere to draw. A tap before the signal is a false start.
// Server-authoritative — the snapshot never carries the raw fire time. Scene key === mini-game id.
export class QuickDrawScene extends Phaser.Scene {
  private bg?: Phaser.GameObjects.Rectangle
  private title?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private wasFired = false
  private resolved = false

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('quick-draw')
  }

  create(): void {
    // Scene instances survive stop/start across rounds — reset per-round trackers here.
    this.wasFired = false
    this.resolved = false
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    const cx = width / 2
    this.bg = this.add.rectangle(cx, height / 2, width, height, WAIT_BG).setOrigin(0.5)
    this.title = this.add
      .text(cx, height * 0.4, 'Wait...', headlineStyle(56, PALETTE.text))
      .setOrigin(0.5)
    this.status = this.add
      .text(cx, height * 0.6, '', bodyStyle(18, PALETTE.text, { align: 'center' }))
      .setOrigin(0.5)

    this.input.on('pointerdown', () => this.draw())
    this.input.keyboard?.on('keydown-SPACE', () => this.draw())
  }

  private draw(): void {
    const snap = this.state.state as QuickDrawSnapshot | null
    if (!snap) return
    const me = snap.players[this.state.selfId ?? '']
    if (!me || me.done || me.youDrew || me.opponentId === null) return
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'draw' } })
  }

  override update(): void {
    const snap = this.state.state as QuickDrawSnapshot | null
    if (!snap) return
    const me = snap.players[this.state.selfId ?? '']
    if (!me) return

    if (me.opponentId === null) {
      this.bg?.setFillStyle(FIRE_BG)
      this.title?.setText('YOU WIN')
      this.status?.setText('')
      return
    }

    const fired = me.fired
    this.bg?.setFillStyle(fired ? FIRE_BG : WAIT_BG)
    if (fired && !this.wasFired) {
      this.wasFired = true
      this.sfx.go()
    }

    if (me.done) {
      if (!this.resolved) {
        this.resolved = true
        if (me.won === true) this.sfx.correct()
        else if (me.won === false) this.sfx.wrong()
      }
      if (me.won === true) {
        this.title?.setText('YOU WIN')
        this.status?.setText(me.reactionMs !== null ? `${me.reactionMs} ms` : '')
      } else if (me.won === false) {
        // A loss with no valid reaction of your own means you jumped the signal.
        const tooEarly = me.youDrew && me.reactionMs === null
        this.title?.setText('YOU LOSE')
        this.status?.setText(tooEarly ? 'Too early!' : '')
      } else {
        this.title?.setText('DRAW')
        this.status?.setText('')
      }
      return
    }

    this.title?.setText(fired ? 'FIRE!' : 'Wait...')
    this.status?.setText('')
  }
}
