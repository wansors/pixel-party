import { PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import type { Sfx } from './Sfx'
import { headlineStyle, hexToCss } from './pixelStyle'

// Standard in-canvas HUD strip shared by every mini-game scene (art-direction §4): a score chip on the
// left, the seconds left on the right and a segmented, draining pixel time bar underneath. The bar
// changes color as time runs out (lime → amber → red) and the last seconds tick + pulse, so every game
// builds the same end-of-round tension without each scene re-implementing its own timer text.
//
// Scenes lay their own content out below `hud.bottom`.

const SEGMENT_GAP = 2
const URGENT_MS = 5000
const TICK_MS = 3000

export class Hud {
  readonly bottom: number
  private readonly score: Phaser.GameObjects.Text
  private readonly clock: Phaser.GameObjects.Text
  private readonly bar: Phaser.GameObjects.Graphics
  private readonly barX: number
  private readonly barY: number
  private readonly barW: number
  private readonly barH: number
  private readonly segments: number
  private totalMs = 0
  private drawnKey = ''
  private lastWholeSecond = -1

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sfx: Sfx,
  ) {
    const { width, height } = scene.scale
    const compact = Math.min(width, height) < 520
    const font = compact ? 12 : 16
    const pad = compact ? 8 : 12
    const rowY = pad + font / 2 + 2

    this.score = scene.add
      .text(pad, rowY, '', headlineStyle(font, PALETTE.amber))
      .setOrigin(0, 0.5)
      .setDepth(800)
    this.clock = scene.add
      .text(width - pad, rowY, '', headlineStyle(font + 2, PALETTE.lime))
      .setOrigin(1, 0.5)
      .setDepth(800)

    this.barX = pad
    this.barY = rowY + font / 2 + (compact ? 6 : 8)
    this.barW = width - pad * 2
    this.barH = compact ? 6 : 8
    const segW = compact ? 8 : 10
    this.segments = Math.max(8, Math.floor((this.barW + SEGMENT_GAP) / (segW + SEGMENT_GAP)))
    this.bar = scene.add.graphics().setDepth(800)
    this.bottom = this.barY + this.barH + (compact ? 8 : 12)
  }

  // Remaining round time from the latest snapshot (null = this game has no clock; the bar hides).
  setRemaining(ms: number | null): void {
    if (this.drawnKey === 'finish') return
    if (ms === null || !Number.isFinite(ms)) {
      this.clock.setText('')
      this.bar.clear()
      this.drawnKey = ''
      return
    }
    // The first snapshot of a round is ~full time; the largest reading seen is the round's length.
    this.totalMs = Math.max(this.totalMs, ms)
    const frac = this.totalMs > 0 ? Math.max(0, Math.min(1, ms / this.totalMs)) : 0
    const color =
      ms <= URGENT_MS || frac < 0.2 ? PALETTE.red : frac < 0.5 ? PALETTE.amber : PALETTE.lime
    const seconds = Math.ceil(ms / 1000)
    this.clock.setText(`${seconds}s`).setColor(hexToCss(color))

    // Final seconds: a tick + a pulse on each whole-second boundary.
    if (seconds !== this.lastWholeSecond) {
      if (this.lastWholeSecond !== -1 && ms > 0 && ms <= TICK_MS) this.sfx.tick()
      if (ms > 0 && ms <= URGENT_MS) {
        this.scene.tweens.killTweensOf(this.clock)
        this.clock.setScale(1.35)
        this.scene.tweens.add({
          targets: this.clock,
          scale: 1,
          duration: 220,
          ease: 'Quad.easeOut',
        })
      }
      this.lastWholeSecond = seconds
    }

    const lit = Math.ceil(frac * this.segments)
    const key = `${lit}:${color}`
    if (key === this.drawnKey) return
    this.drawnKey = key
    const segW = (this.barW - SEGMENT_GAP * (this.segments - 1)) / this.segments
    this.bar.clear()
    for (let i = 0; i < this.segments; i++) {
      const x = Math.round(this.barX + i * (segW + SEGMENT_GAP))
      this.bar.fillStyle(i < lit ? color : PALETTE.panelAlt, 1)
      this.bar.fillRect(x, this.barY, Math.max(1, Math.round(segW)), this.barH)
    }
  }

  // The round is over (final snapshot): freeze the clock, fill the bar amber and stamp a centered
  // "FINISH!" into the strip — the scene's own content stays fully visible underneath.
  showFinish(text: string): void {
    const { width } = this.scene.scale
    this.clock.setText('')
    this.bar.clear()
    this.bar.fillStyle(PALETTE.amber, 1)
    this.bar.fillRect(this.barX, this.barY, this.barW, this.barH)
    this.drawnKey = 'finish'
    const label = this.scene.add
      .text(
        width / 2,
        this.score.y,
        text,
        headlineStyle(this.clock.height > 20 ? 24 : 16, PALETTE.amber, {
          stroke: '#10121c',
          strokeThickness: 6,
        }),
      )
      .setOrigin(0.5)
      .setDepth(801)
      .setScale(2)
      .setAlpha(0)
    // On narrow screens a long score chip ("Your team: BLUE") would run into the stamp: drop the chip.
    if (this.score.x + this.score.width > width / 2 - label.width / 2 - 8)
      this.score.setVisible(false)
    this.scene.tweens.add({
      targets: label,
      scale: 1,
      alpha: 1,
      duration: 200,
      ease: 'Back.easeOut',
    })
  }

  // Left-hand chip: the player's own score / progress ("12 PTS", "LEVEL 4"). Empty string hides it.
  setScore(text: string): void {
    if (this.score.text !== text) this.score.setText(text)
  }
}
