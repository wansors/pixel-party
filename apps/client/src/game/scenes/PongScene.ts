import type { ClientMsg, PongSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { SnapshotInterpolator, lerp } from '../netcode/SnapshotInterpolator'

// Pixel Pong canvas (Phase 5). Your paddle is always drawn on the LEFT (the server mirrors the ball for
// the right-side player), controlled locally for zero-lag feel; the ball + opponent paddle come from the
// snapshot, smoothed by the interpolator. Scene key === mini-game id.
export class PongScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private scoreText?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private myPaddle?: Phaser.GameObjects.Rectangle
  private oppPaddle?: Phaser.GameObjects.Rectangle
  private ball?: Phaser.GameObjects.Arc
  private readonly interp = new SnapshotInterpolator<PongSnapshot>(100)
  private lastTick = -1
  private padY = 0.5
  private lastSentY = -1
  private lastSentAt = 0
  private lastScoreYou = 0
  private lastScoreOpp = 0
  private readonly padHalf = 0.13

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('pixel-pong')
  }

  create(): void {
    this.interp.reset()
    this.lastTick = -1
    this.padY = 0.5
    this.lastSentY = -1
    this.lastScoreYou = 0
    this.lastScoreOpp = 0
    const { width, height } = this.scale

    this.timer = this.add
      .text(width / 2, height * 0.05, '', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#06d6a0',
      })
      .setOrigin(0.5)
    this.scoreText = this.add
      .text(width / 2, height * 0.11, '', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#e6edf3',
      })
      .setOrigin(0.5)
    this.status = this.add
      .text(width / 2, height * 0.5, '', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#ffd166',
      })
      .setOrigin(0.5)
      .setDepth(10)

    const padW = width * 0.02
    const padH = height * this.padHalf * 2
    this.myPaddle = this.add.rectangle(width * 0.05, height * 0.5, padW, padH, 0x06d6a0)
    this.oppPaddle = this.add.rectangle(width * 0.95, height * 0.5, padW, padH, 0xe63946)
    this.ball = this.add.circle(width / 2, height / 2, Math.min(width, height) * 0.02, 0xffd166)

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.aim(p.y))
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.aim(p.y)
    })
  }

  private aim(py: number): void {
    this.padY = Phaser.Math.Clamp(py / this.scale.height, 0, 1)
  }

  private maybeSend(now: number): void {
    if (now - this.lastSentAt < 60 || Math.abs(this.padY - this.lastSentY) < 0.01) return
    this.lastSentAt = now
    this.lastSentY = this.padY
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'move', y: this.padY } })
  }

  override update(): void {
    const now = this.time.now
    const snap = this.state.state as PongSnapshot | null
    if (snap && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.interp.push(snap, now)
    }
    this.maybeSend(now)

    const { width, height } = this.scale
    this.myPaddle?.setPosition(width * 0.05, this.padY * height)

    const latest = this.interp.latest()
    const me = latest?.players[this.state.selfId ?? '']
    if (latest) this.timer?.setText(`${Math.ceil(latest.roundRemainingMs / 1000)}s`)
    if (!me) return

    if (me.scoreYou > this.lastScoreYou) this.sfx.correct()
    if (me.scoreOpp > this.lastScoreOpp) this.sfx.wrong()
    this.lastScoreYou = me.scoreYou
    this.lastScoreOpp = me.scoreOpp
    this.scoreText?.setText(`${me.scoreYou} : ${me.scoreOpp}`)

    if (me.done) {
      this.status
        ?.setText(me.won === null ? 'DRAW' : me.won ? 'YOU WIN!' : 'YOU LOSE')
        .setColor(me.won ? '#06d6a0' : me.won === null ? '#ffd166' : '#e63946')
    } else {
      this.status?.setText('')
    }

    // Interpolate ball + opponent paddle from the snapshot pair.
    const sample = this.interp.sample(now)
    let ballX = me.ballX
    let ballY = me.ballY
    let oppY = me.oppY
    if (sample) {
      const selfId = this.state.selfId ?? ''
      const from = sample.from.players[selfId]
      const to = sample.to.players[selfId]
      if (from && to) {
        ballX = lerp(from.ballX, to.ballX, sample.t)
        ballY = lerp(from.ballY, to.ballY, sample.t)
        oppY = lerp(from.oppY, to.oppY, sample.t)
      }
    }
    this.ball?.setPosition(ballX * width, ballY * height)
    this.oppPaddle?.setPosition(width * 0.95, oppY * height)
  }
}
