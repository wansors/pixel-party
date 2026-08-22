import { PALETTE } from '@pp/shared'
import type { ClientMsg, StopClockSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { addArcadeBackdrop, bodyStyle, ensurePixelBlock, headlineStyle } from '../pixelStyle'

const PERIOD_MS = 1500

// Stop the Clock (timing) canvas. A needle sweeps the bar (triangle wave, animated locally); tap STOP
// to lock it near the highlighted target. The reported position is sent to the server, which scores
// the error. Scene key === mini-game id.
export class StopClockScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private info?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private bar?: Phaser.GameObjects.Rectangle
  private targetMark?: Phaser.GameObjects.Image
  private needle?: Phaser.GameObjects.Image
  private button?: Phaser.GameObjects.Image
  private buttonLabel?: Phaser.GameObjects.Text
  private barLeft = 0
  private barWidth = 0

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('stop-clock')
  }

  create(): void {
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.08, '', headlineStyle(24, PALETTE.lime))
      .setOrigin(0.5)
    this.info = this.add.text(cx, height * 0.15, '', bodyStyle(18)).setOrigin(0.5)

    this.barWidth = width * 0.8
    this.barLeft = cx - this.barWidth / 2
    const barY = height * 0.45
    const barH = height * 0.12
    this.bar = this.add
      .rectangle(cx, barY, this.barWidth, barH, PALETTE.panelAlt)
      .setStrokeStyle(3, PALETTE.frame)

    const markKey = ensurePixelBlock(this, 'pp-stopclock-mark', 6, 0x2a9d3f)
    this.targetMark = this.add.image(this.barLeft, barY, markKey).setDisplaySize(6, barH)
    const needleKey = ensurePixelBlock(this, 'pp-stopclock-needle', 6, PALETTE.amber)
    this.needle = this.add.image(this.barLeft, barY, needleKey).setDisplaySize(5, barH * 1.35)

    this.status = this.add.text(cx, height * 0.6, '', bodyStyle(18, PALETTE.dim)).setOrigin(0.5)

    const buttonKey = ensurePixelBlock(this, 'pp-stopclock-button', 12, PALETTE.amber)
    this.button = this.add
      .image(cx, height * 0.82, buttonKey)
      .setDisplaySize(width * 0.5, height * 0.12)
      .setInteractive({ useHandCursor: true })
    this.button.on('pointerdown', () => this.stop())
    this.buttonLabel = this.add
      .text(cx, height * 0.82, this.t('game.stopClock.stop'), headlineStyle(28, PALETTE.bg))
      .setOrigin(0.5)
    this.input.keyboard?.on('keydown-SPACE', () => this.stop())
  }

  // Triangle sweep 0..1..0 over PERIOD_MS, driven by the scene clock.
  private needlePos(): number {
    const phase = (this.time.now % PERIOD_MS) / PERIOD_MS
    return phase < 0.5 ? phase * 2 : 2 - phase * 2
  }

  private stop(): void {
    const snap = this.state.state as StopClockSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const attempt = snap.attemptsDone[selfId] ?? 0
    if (attempt >= snap.attempts) return
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'stop', attempt, pos: this.needlePos() } })
  }

  override update(): void {
    const snap = this.state.state as StopClockSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const attempt = snap.attemptsDone[selfId] ?? 0
    const done = attempt >= snap.attempts
    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    this.info?.setText(
      this.t('game.stopClock.info', {
        n: Math.min(attempt + 1, snap.attempts),
        total: snap.attempts,
        err: (snap.totalError[selfId] ?? 0).toFixed(2),
      }),
    )

    const target = snap.targets[Math.min(attempt, snap.targets.length - 1)] ?? 0.5
    this.targetMark?.setX(this.barLeft + target * this.barWidth)
    if (!done) this.needle?.setX(this.barLeft + this.needlePos() * this.barWidth)
    this.status?.setText(this.t(done ? 'game.stopClock.done' : 'game.stopClock.prompt'))
    this.button?.setAlpha(done ? 0.3 : 1)
    this.buttonLabel?.setText(this.t(done ? 'game.stopClock.doneBtn' : 'game.stopClock.stop'))
  }
}
