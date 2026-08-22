import type { ClientMsg, PixelBeatSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'

const UPCOMING_BEATS = 3
const HORIZON_MS = 1500
const FLASH_MS = 150
const BEAT_HIT_TOLERANCE_MS = 120

// Pixel Beat canvas. A pulsing ring at the hit line flashes on each beat instant; a few upcoming
// beats approach it from the right. The snapshot gives beat offsets relative to round start but no
// wall-clock start time, so elapsed time is tracked locally off this.time.now from the first snapshot
// — cosmetic only, the server is still sole authority on scoring. Tap anywhere or hit space.
export class PixelBeatScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private scoreText?: Phaser.GameObjects.Text
  private streakText?: Phaser.GameObjects.Text
  private ring?: Phaser.GameObjects.Arc
  private beatDots: Phaser.GameObjects.Arc[] = []
  private roundStartLocal = 0
  private started = false
  private prevScore = 0
  private lastBeatIndex = -1
  private flashUntil = 0
  private justTapped = false

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('pixel-beat')
  }

  create(): void {
    this.started = false
    this.prevScore = 0
    this.lastBeatIndex = -1
    this.flashUntil = 0
    this.justTapped = false
    const { width, height } = this.scale
    const cx = width / 2
    const laneY = height * 0.55
    this.timer = this.add
      .text(cx, height * 0.06, '', { fontFamily: 'monospace', fontSize: '24px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.scoreText = this.add
      .text(cx, height * 0.14, '', { fontFamily: 'monospace', fontSize: '20px', color: '#e6edf3' })
      .setOrigin(0.5)
    this.streakText = this.add
      .text(cx, height * 0.2, '', { fontFamily: 'monospace', fontSize: '16px', color: '#ffd166' })
      .setOrigin(0.5)
    this.add
      .text(cx, height * 0.9, this.t('game.pixelBeat.tapHint'), {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#5b6b7b',
      })
      .setOrigin(0.5)
    this.add.rectangle(cx, laneY, 4, height * 0.3, 0x3a4668)
    this.ring = this.add.circle(cx, laneY, 30, 0x223257).setStrokeStyle(4, 0x06d6a0)
    this.beatDots = []
    for (let i = 0; i < UPCOMING_BEATS; i++) {
      this.beatDots.push(this.add.circle(cx, laneY, 14, 0xffcf4b).setVisible(false))
    }
    this.input.on('pointerdown', () => this.tap())
    this.input.keyboard?.on('keydown-SPACE', () => this.tap())
  }

  private tap(): void {
    this.justTapped = true
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'tap' } })
  }

  override update(): void {
    const snap = this.state.state as PixelBeatSnapshot | null
    if (!snap) return
    if (!this.started) {
      this.roundStartLocal = this.time.now
      this.started = true
    }
    const selfId = this.state.selfId ?? ''
    const score = snap.scores[selfId] ?? 0
    const streak = snap.streaks[selfId] ?? 0

    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    this.scoreText?.setText(this.t('game.common.pts', { n: score }))
    this.streakText?.setText(streak > 0 ? this.t('game.pixelBeat.streak', { n: streak }) : '')

    if (this.justTapped) {
      this.sfx[score > this.prevScore ? 'correct' : 'wrong']()
      this.justTapped = false
    }
    this.prevScore = score

    const elapsedMs = this.time.now - this.roundStartLocal
    const upcoming = snap.beatTimes.filter((bt) => bt >= elapsedMs).slice(0, UPCOMING_BEATS)
    const { width, height } = this.scale
    const laneStart = width * 0.95
    const laneEnd = width / 2
    for (let i = 0; i < this.beatDots.length; i++) {
      const dot = this.beatDots[i]
      const bt = upcoming[i]
      if (!dot) continue
      if (bt === undefined) {
        dot.setVisible(false)
        continue
      }
      const progress = Phaser.Math.Clamp(1 - (bt - elapsedMs) / HORIZON_MS, 0, 1)
      dot.setVisible(bt - elapsedMs <= HORIZON_MS)
      dot.x = Phaser.Math.Linear(laneStart, laneEnd, progress)
      dot.y = height * 0.55
    }

    const nextIndex = snap.beatTimes.findIndex((bt) => bt >= elapsedMs)
    if (nextIndex !== this.lastBeatIndex && nextIndex > 0) {
      const justPassed = snap.beatTimes[nextIndex - 1] as number
      if (elapsedMs - justPassed < BEAT_HIT_TOLERANCE_MS) this.flashUntil = this.time.now + FLASH_MS
      this.lastBeatIndex = nextIndex
    }
    const flashing = this.time.now < this.flashUntil
    this.ring?.setStrokeStyle(4, flashing ? 0xffd166 : 0x06d6a0)
    this.ring?.setScale(flashing ? 1.3 : 1)
  }
}
