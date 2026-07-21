import type { ClientMsg, StopClockSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'

const PERIOD_MS = 1500

// Stop the Clock (timing) canvas. A needle sweeps the bar (triangle wave, animated locally); tap STOP
// to lock it near the highlighted target. The reported position is sent to the server, which scores
// the error. Scene key === mini-game id.
export class StopClockScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private info?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private bar?: Phaser.GameObjects.Rectangle
  private targetMark?: Phaser.GameObjects.Rectangle
  private needle?: Phaser.GameObjects.Rectangle
  private button?: Phaser.GameObjects.Rectangle
  private buttonLabel?: Phaser.GameObjects.Text
  private barLeft = 0
  private barWidth = 0

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
  ) {
    super('stop-clock')
  }

  create(): void {
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.08, '', { fontFamily: 'monospace', fontSize: '24px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.info = this.add
      .text(cx, height * 0.15, '', { fontFamily: 'monospace', fontSize: '18px', color: '#9fb3c8' })
      .setOrigin(0.5)

    this.barWidth = width * 0.8
    this.barLeft = cx - this.barWidth / 2
    const barY = height * 0.45
    const barH = height * 0.12
    this.bar = this.add
      .rectangle(cx, barY, this.barWidth, barH, 0x1d2740)
      .setStrokeStyle(3, 0x3a4668)
    this.targetMark = this.add.rectangle(this.barLeft, barY, 6, barH, 0x2a9d3f)
    this.needle = this.add.rectangle(this.barLeft, barY, 5, barH * 1.35, 0xffd166)
    this.status = this.add
      .text(cx, height * 0.6, '', { fontFamily: 'monospace', fontSize: '18px', color: '#5b6b7b' })
      .setOrigin(0.5)

    this.button = this.add
      .rectangle(cx, height * 0.82, width * 0.5, height * 0.12, 0xf4c20d)
      .setStrokeStyle(3, 0x11181f)
      .setInteractive({ useHandCursor: true })
    this.button.on('pointerdown', () => this.stop())
    this.buttonLabel = this.add
      .text(cx, height * 0.82, 'STOP', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#0b0f14',
      })
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
      `Try ${Math.min(attempt + 1, snap.attempts)}/${snap.attempts}   err ${(snap.totalError[selfId] ?? 0).toFixed(2)}`,
    )

    const target = snap.targets[Math.min(attempt, snap.targets.length - 1)] ?? 0.5
    this.targetMark?.setX(this.barLeft + target * this.barWidth)
    if (!done) this.needle?.setX(this.barLeft + this.needlePos() * this.barWidth)
    this.status?.setText(done ? 'All tries used — hang tight' : 'Stop on the green target!')
    this.button?.setAlpha(done ? 0.3 : 1)
    this.buttonLabel?.setText(done ? 'DONE' : 'STOP')
  }
}
