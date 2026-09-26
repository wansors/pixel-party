import { type ButtonMasherSnapshot, PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { burst, floatText, punch } from '../fx'
import { bodyStyle, ensurePixelOrb, headlineStyle, hexToCss, shade } from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const MAX_LANES = 6

interface Lane {
  name: Phaser.GameObjects.Text
  count: Phaser.GameObjects.Text
  bar: Phaser.GameObjects.Rectangle
  track: Phaser.GameObjects.Rectangle
}

// Button Masher canvas: a giant arcade button to hammer (tap / Space) plus a live "race" of every
// player's press count, drawn as lanes in their own colors. One MINIGAME_INPUT per press.
export class ButtonMasherScene extends MiniGameScene<ButtonMasherSnapshot> {
  private countText?: Phaser.GameObjects.Text
  private button?: Phaser.GameObjects.Image
  private buttonKey = ''
  private buttonDownKey = ''
  private lanes: Lane[] = []
  private laneLeft = 0
  private laneWidth = 0
  private lastCount = 0

  constructor(...deps: SceneDeps) {
    super('button-masher', ...deps)
  }

  override create(): void {
    super.create()
    this.lanes = []
    this.lastCount = 0
    const { width, height } = this.scale
    const cx = width / 2
    const top = this.top
    const compact = Math.min(width, height) < 520

    this.add
      .text(
        cx,
        top + 18,
        this.t('game.buttonMasher.mash'),
        headlineStyle(compact ? 26 : 40, PALETTE.amber),
      )
      .setOrigin(0.5, 0)

    // The button: a big chunky orb with a darker "pressed" twin swapped in on each hit.
    const d = Math.min(width * 0.42, (height - top) * 0.34)
    this.buttonKey = ensurePixelOrb(this, 'pp-masher-button', 22, PALETTE.red)
    this.buttonDownKey = ensurePixelOrb(this, 'pp-masher-button-down', 22, shade(PALETTE.red, -0.3))
    const buttonY = top + (height - top) * 0.36
    this.add
      .ellipse(cx, buttonY + d * 0.42, d * 0.95, d * 0.26, shade(PALETTE.bg, -0.4))
      .setAlpha(0.8)
    this.button = this.add.image(cx, buttonY, this.buttonKey).setDisplaySize(d, d)
    this.countText = this.add
      .text(
        cx,
        buttonY,
        '0',
        headlineStyle(compact ? 34 : 48, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 6,
        }),
      )
      .setOrigin(0.5)
      .setDepth(5)

    // Race lanes: one row per player (top 6), bar length relative to the current leader.
    const lanesTop = buttonY + d / 2 + (compact ? 18 : 28)
    const laneH = Math.min(compact ? 20 : 26, (height - lanesTop - 30) / MAX_LANES)
    this.laneLeft = width * 0.12 + (compact ? 70 : 110)
    this.laneWidth = width * 0.76 - (compact ? 110 : 160)
    for (let i = 0; i < MAX_LANES; i++) {
      const y = lanesTop + i * laneH + laneH / 2
      const name = this.add
        .text(this.laneLeft - 10, y, '', bodyStyle(compact ? 11 : 14, PALETTE.text))
        .setOrigin(1, 0.5)
      const track = this.add
        .rectangle(this.laneLeft, y, this.laneWidth, laneH * 0.6, PALETTE.panelAlt)
        .setOrigin(0, 0.5)
      const bar = this.add
        .rectangle(this.laneLeft, y, 0, laneH * 0.6, PALETTE.lime)
        .setOrigin(0, 0.5)
      const count = this.add
        .text(this.laneLeft + this.laneWidth + 10, y, '', headlineStyle(compact ? 10 : 13))
        .setOrigin(0, 0.5)
      this.lanes.push({ name, count, bar, track })
    }

    this.add
      .text(cx, height - 16, this.t('game.buttonMasher.hint'), bodyStyle(compact ? 12 : 15))
      .setOrigin(0.5, 1)

    this.input.on('pointerdown', () => this.mash())
    this.onKey('SPACE', () => this.mash())
  }

  private mash(): void {
    if (!this.snap || this.snap.remainingMs <= 0) return
    this.sfx.click()
    this.sendInput({ kind: 'mash' })
    if (!this.button) return
    this.button.setTexture(this.buttonDownKey)
    punch(this, this.button, -0.08, 60)
    this.time.delayedCall(70, () => this.button?.setTexture(this.buttonKey))
  }

  protected frame(snap: ButtonMasherSnapshot | null): void {
    if (!snap) return
    const mine = snap.counts[this.selfId] ?? 0
    this.hud?.setScore(this.t('game.common.pts', { n: mine }))
    // A relayout restart mid-round adopts the count silently (no "+37" for every press so far).
    if (this.firstSnapshot) {
      this.lastCount = mine
      this.countText?.setText(String(mine))
    }
    if (mine !== this.lastCount && this.countText && this.button) {
      this.countText.setText(String(mine))
      if (mine > this.lastCount) {
        punch(this, this.countText, 0.25)
        const { x, y, displayWidth } = this.button
        const gained = mine - this.lastCount
        floatText(
          this,
          x + displayWidth * 0.35,
          y - displayWidth * 0.35,
          `+${gained}`,
          PALETTE.amber,
          16,
        )
        if (mine % 10 === 0) burst(this, x, y, PALETTE.amber, 16)
      }
      this.lastCount = mine
    }

    const ranked = Object.entries(snap.counts).sort((a, b) => b[1] - a[1])
    const lead = Math.max(1, ranked[0]?.[1] ?? 0)
    this.lanes.forEach((lane, i) => {
      const entry = ranked[i]
      const visible = entry !== undefined
      lane.name.setVisible(visible)
      lane.count.setVisible(visible)
      lane.bar.setVisible(visible)
      lane.track.setVisible(visible)
      if (!entry) return
      const [id, n] = entry
      const color = this.state.colorOf(id, PALETTE.lime)
      lane.name.setText(this.label(id)).setColor(hexToCss(color))
      lane.count.setText(String(n))
      lane.bar
        .setFillStyle(color)
        .setSize(Math.max(2, (n / lead) * this.laneWidth), lane.bar.height)
      lane.track.setStrokeStyle(id === this.selfId ? 2 : 0, PALETTE.text)
    })
  }
}
