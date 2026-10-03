import { type ButtonMasherSnapshot, PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { avatarPx, ensureAvatarTexture } from '../avatars'
import { burst, floatText, punch } from '../fx'
import { bodyStyle, ensurePixelOrb, headlineStyle, hexToCss, shade } from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Lanes shorter than this go into two columns (a full room on a short landscape screen).
const MIN_LANE_H = 16

interface Lane {
  name: Phaser.GameObjects.Text
  count: Phaser.GameObjects.Text
  bar: Phaser.GameObjects.Rectangle
  track: Phaser.GameObjects.Rectangle
  // The player's avatar running at the head of their bar.
  runner: Phaser.GameObjects.Image
  left: number
  width: number
  // Name characters that fit left of the track (two columns leave no margin to spill into).
  nameChars: number
}

// Button Masher canvas: a giant arcade button to hammer (tap / Space) plus a live "race" of every
// player's press count, drawn as lanes in their own colors (one per player, leader on top). One
// MINIGAME_INPUT per press; the server caps how many presses a second count.
export class ButtonMasherScene extends MiniGameScene<ButtonMasherSnapshot> {
  private countText?: Phaser.GameObjects.Text
  private button?: Phaser.GameObjects.Image
  private buttonKey = ''
  private buttonDownKey = ''
  private lanes: Lane[] = []
  private lanesTop = 0
  private lanesBottom = 0
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

    // Race lanes: built on the first snapshot, which names the round's players.
    this.lanesTop = buttonY + d / 2 + (compact ? 18 : 28)
    this.lanesBottom = height - 30

    this.add
      .text(cx, height - 16, this.t('game.buttonMasher.hint'), bodyStyle(compact ? 12 : 15))
      .setOrigin(0.5, 1)

    this.input.on('pointerdown', () => this.mash())
    this.onKey('SPACE', () => this.mash())
  }

  // One lane per player, bar length relative to the current leader. They stack in one column while
  // lanes stay at least MIN_LANE_H tall, else they split into two side by side.
  private buildLanes(n: number): void {
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const avail = this.lanesBottom - this.lanesTop
    const cols = avail / n < MIN_LANE_H && width >= 640 ? 2 : 1
    const perCol = Math.ceil(n / cols)
    const laneH = Math.min(compact ? 20 : 26, avail / perCol)
    const colW = (width * (cols === 1 ? 0.76 : 0.94)) / cols
    const nameW = compact ? 70 : 110
    const countW = compact ? 40 : 50
    const font = compact || laneH < 20 ? 11 : 14
    const margin = cols === 1 ? (width - colW) / 2 : 0
    const nameChars = Math.floor((nameW - 10 + margin) / (font * 0.62))
    for (let i = 0; i < n; i++) {
      const left = (width - cols * colW) / 2 + Math.floor(i / perCol) * colW + nameW
      const laneWidth = colW - nameW - countW
      const y = this.lanesTop + (i % perCol) * laneH + laneH / 2
      const name = this.add.text(left - 10, y, '', bodyStyle(font, PALETTE.text)).setOrigin(1, 0.5)
      const track = this.add
        .rectangle(left, y, laneWidth, laneH * 0.6, PALETTE.panelAlt)
        .setOrigin(0, 0.5)
      const bar = this.add.rectangle(left, y, 0, laneH * 0.6, PALETTE.lime).setOrigin(0, 0.5)
      const count = this.add
        .text(left + laneWidth + 12, y, '', headlineStyle(compact || laneH < 20 ? 8 : 13))
        .setOrigin(0, 0.5)
      const runner = this.add
        .image(left, y + laneH * 0.3, ensureAvatarTexture(this, 'cat', PALETTE.dim, 1))
        .setOrigin(0.5, 1)
        .setDisplaySize(avatarPx(laneH), avatarPx(laneH))
        .setDepth(2)
      this.lanes.push({ name, count, bar, track, runner, left, width: laneWidth, nameChars })
    }
  }

  private mash(): void {
    if (!this.snap || this.snap.remainingMs <= 0 || !(this.selfId in this.snap.counts)) return
    this.sfx.click()
    this.sendInput({ kind: 'mash' })
    if (!this.button) return
    this.button.setTexture(this.buttonDownKey)
    punch(this, this.button, -0.08, 60)
    this.time.delayedCall(70, () => this.button?.setTexture(this.buttonKey))
  }

  protected frame(snap: ButtonMasherSnapshot | null): void {
    if (!snap) return
    if (this.lanes.length === 0) this.buildLanes(Object.keys(snap.counts).length)
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
      lane.runner.setVisible(visible)
      lane.count.setVisible(visible)
      lane.bar.setVisible(visible)
      lane.track.setVisible(visible)
      if (!entry) return
      const [id, n] = entry
      const color = this.state.colorOf(id, PALETTE.lime)
      lane.name.setText(this.label(id).slice(0, lane.nameChars)).setColor(hexToCss(color))
      lane.count.setText(String(n))
      const barW = Math.max(2, (n / lead) * lane.width)
      lane.bar.setFillStyle(color).setSize(barW, lane.bar.height)
      // Strides while mashing; the leader grins.
      const step = n > 0 ? Math.floor(this.time.now / 110) % 2 : 0
      lane.runner
        .setTexture(
          ensureAvatarTexture(
            this,
            this.state.avatarOf(id),
            color,
            1,
            'side',
            i === 0 && n > 0 ? 'happy' : 'idle',
            step as 0 | 1,
          ),
        )
        .setX(Math.round(lane.left + barW))
      lane.track.setStrokeStyle(id === this.selfId ? 2 : 0, PALETTE.text)
    })
  }
}
