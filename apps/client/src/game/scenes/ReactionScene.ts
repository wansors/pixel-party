import { PALETTE, type ReactionSnapshot } from '@pp/shared'
import type Phaser from 'phaser'
import { avatarPx, ensureAvatarTexture } from '../avatars'
import { burst, flash, floatText, punch, ring, shake } from '../fx'
import {
  bodyStyle,
  ensureBevelPanel,
  ensurePixelOrb,
  fitText,
  headlineStyle,
  hexToCss,
} from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const WAIT_BG = 0x5c1422
const GO_BG = 0x14683e
const OUT_BG = 0x2a1a24
const MAX_ROWS = 8
// Cosmetic rating of the player's own time (never scoring — the server ranks the raw ms).
const RATINGS: readonly [number, string, number][] = [
  [220, 'game.common.perfect', PALETTE.amber],
  [320, 'game.common.great', PALETTE.lime],
  [450, 'game.common.good', PALETTE.cyan],
]

interface Row {
  swatch: Phaser.GameObjects.Image
  name: Phaser.GameObjects.Text
  value: Phaser.GameObjects.Text
  frame: Phaser.GameObjects.Rectangle
  key: string
}

// Reaction Duel canvas: the whole screen is the signal. A red field with a pixel traffic light
// waits for green; tap (or Space) after it turns. The green moment is scheduled locally from the
// snapshot's `greenInMs`, so the switch lands on time instead of up to one snapshot late — never
// early, because the estimate only ever carries extra delay. Everyone's times / false starts fill a
// board below as they arrive, in each player's color.
export class ReactionScene extends MiniGameScene<ReactionSnapshot> {
  private bg?: Phaser.GameObjects.Rectangle
  private redLamp?: Phaser.GameObjects.Image
  private greenLamp?: Phaser.GameObjects.Image
  private title?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private rows: Row[] = []
  // Players whose result is already on the board (a newly arrived one gets a pop).
  private readonly shown = new Set<string>()
  private keys = { redOn: '', redOff: '', greenOn: '', greenOff: '' }
  private titleSize = 56
  private titleMaxW = 0
  private greenAtLocal = Number.POSITIVE_INFINITY
  private lastTick = -1
  private wasGreen = false
  private resolved = false

  constructor(...deps: SceneDeps) {
    super('reaction-duel', ...deps)
  }

  override create(): void {
    super.create({ hud: false })
    this.rows = []
    this.shown.clear()
    this.greenAtLocal = Number.POSITIVE_INFINITY
    this.lastTick = -1
    this.wasGreen = false
    this.resolved = false
    const { width, height } = this.scale
    const cx = width / 2
    const compact = Math.min(width, height) < 520
    this.bg = this.add.rectangle(0, 0, width, height, WAIT_BG).setOrigin(0, 0)

    this.titleSize = compact ? 32 : 48
    this.titleMaxW = width * 0.9
    this.title = this.add
      .text(
        cx,
        height * 0.1,
        '',
        headlineStyle(this.titleSize, PALETTE.text, { stroke: '#10121c', strokeThickness: 6 }),
      )
      .setOrigin(0.5)
      .setDepth(10)

    // Traffic-light housing with a red lamp over a green one.
    const lamp = Math.min(width * 0.26, height * 0.13, 150)
    const lightY = height * 0.34
    const hw = Math.round(lamp * 1.5)
    const hh = Math.round(lamp * 2.55)
    const housingKey = ensureBevelPanel(this, hw, hh, 0x23263a, 5)
    this.add.image(cx, lightY, housingKey).setDepth(1)
    this.add
      .rectangle(cx, lightY + lamp * 1.28, lamp * 0.28, height, 0x1a1c2b)
      .setOrigin(0.5, 0)
      .setDepth(0)
    this.keys = {
      redOn: ensurePixelOrb(this, 'pp-reaction-red-on', 16, PALETTE.red),
      redOff: ensurePixelOrb(this, 'pp-reaction-red-off', 16, 0x4a1a22),
      greenOn: ensurePixelOrb(this, 'pp-reaction-green-on', 16, PALETTE.lime),
      greenOff: ensurePixelOrb(this, 'pp-reaction-green-off', 16, 0x1d3a24),
    }
    this.redLamp = this.add
      .image(cx, lightY - lamp * 0.58, this.keys.redOn)
      .setDisplaySize(lamp, lamp)
      .setDepth(2)
    this.greenLamp = this.add
      .image(cx, lightY + lamp * 0.58, this.keys.greenOff)
      .setDisplaySize(lamp, lamp)
      .setDepth(2)

    this.status = this.add
      .text(
        cx,
        lightY + lamp * 1.55,
        '',
        bodyStyle(compact ? 15 : 20, PALETTE.text, {
          align: 'center',
          stroke: '#10121c',
          strokeThickness: 4,
          wordWrap: { width: width * 0.9 },
        }),
      )
      .setOrigin(0.5, 0)
      .setDepth(10)

    // Everyone's result board along the bottom.
    const boardTop = lightY + lamp * 1.55 + (compact ? 56 : 70)
    const rowH = Math.max(18, Math.min(compact ? 24 : 30, (height - boardTop - 10) / MAX_ROWS))
    const boardW = Math.min(width * 0.92, 520)
    const left = cx - boardW / 2
    for (let i = 0; i < MAX_ROWS; i++) {
      const y = boardTop + i * rowH + rowH / 2
      if (y + rowH / 2 > height - 4) break
      const frame = this.add
        .rectangle(cx, y, boardW, rowH - 3, PALETTE.bg, 0.72)
        .setStrokeStyle(2, PALETTE.text)
        .setDepth(5)
      // Each row leads with the player's avatar (texture set per player in renderBoard).
      const icon = avatarPx(rowH - 4)
      const swatch = this.add
        .image(left + 8, y, ensureAvatarTexture(this, 'cat', PALETTE.dim, 1))
        .setOrigin(0, 0.5)
        .setDisplaySize(icon, icon)
        .setDepth(6)
      const name = this.add
        .text(left + 14 + icon, y, '', bodyStyle(compact ? 13 : 16, PALETTE.text))
        .setOrigin(0, 0.5)
        .setDepth(6)
      const value = this.add
        .text(left + boardW - 10, y, '', headlineStyle(compact ? 8 : 16, PALETTE.text))
        .setOrigin(1, 0.5)
        .setDepth(6)
      this.rows.push({ swatch, name, value, frame, key: '' })
      for (const o of [frame, swatch, name, value]) o.setVisible(false)
    }

    this.input.on('pointerdown', () => this.tap())
    this.onKey('SPACE', () => this.tap())
    this.showTitle(this.t('game.reaction.wait'), PALETTE.text)
    this.status.setText(this.t('game.reaction.instruction'))
  }

  private tap(): void {
    const snap = this.snap
    if (!snap || this.resolved) return
    if (snap.falseStarts.includes(this.selfId) || this.selfId in snap.reactions) return
    this.sendInput({ kind: 'tap' })
    // Instant "got it" on a post-green tap; the time itself arrives with the next snapshot.
    if (this.wasGreen && this.greenLamp) {
      punch(this, this.greenLamp, -0.12, 70)
      ring(
        this,
        this.greenLamp.x,
        this.greenLamp.y,
        PALETTE.text,
        this.greenLamp.displayWidth * 0.8,
      )
    }
  }

  private showTitle(text: string, color: number): void {
    if (!this.title) return
    if (this.title.text === text) return
    this.title.setText(text).setColor(hexToCss(color))
    fitText(this.title, this.titleMaxW, this.titleSize)
    punch(this, this.title, 0.2, 110)
  }

  protected frame(snap: ReactionSnapshot | null, time: number): void {
    if (!snap) return
    const now = this.time.now
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      if (snap.light === 'red')
        this.greenAtLocal = Math.min(this.greenAtLocal, now + snap.greenInMs)
    }
    const green = snap.light === 'green' || now >= this.greenAtLocal
    const falseStart = snap.falseStarts.includes(this.selfId)
    const mine = snap.reactions[this.selfId]

    // A relayout restart mid-round restores the state as it is: no GO flash / buzzer / rating replay.
    const quiet = this.firstSnapshot
    if (green && !this.wasGreen) this.goMoment(quiet)
    if (!this.resolved && falseStart) this.onFalseStart(quiet)
    else if (!this.resolved && typeof mine === 'number') this.onReacted(mine, quiet)

    if (!green && !falseStart) {
      // Constant breathing pulse on the red lamp: pure tension, never a hint of when green comes.
      this.redLamp?.setAlpha(0.8 + 0.2 * Math.sin(time / 180))
    }
    if (!this.resolved) {
      this.showTitle(this.t(green ? 'game.reaction.tap' : 'game.reaction.wait'), PALETTE.text)
      this.status?.setText(this.t(green ? 'game.reaction.go' : 'game.reaction.instruction'))
    }
    this.renderBoard(snap)
  }

  private goMoment(quiet: boolean): void {
    this.wasGreen = true
    this.bg?.setFillStyle(this.resolved ? OUT_BG : GO_BG)
    this.redLamp?.setTexture(this.keys.redOff).setAlpha(1)
    this.greenLamp?.setTexture(this.keys.greenOn)
    if (this.resolved || quiet) return
    this.sfx.go()
    flash(this, PALETTE.lime, 120)
    shake(this, 0.006, 140)
    if (this.greenLamp) {
      punch(this, this.greenLamp, 0.25, 120)
      ring(this, this.greenLamp.x, this.greenLamp.y, PALETTE.lime, this.greenLamp.displayWidth)
    }
  }

  private onFalseStart(quiet: boolean): void {
    this.resolved = true
    if (!quiet) {
      this.sfx.wrong()
      shake(this, 0.014, 260)
      flash(this, PALETTE.red, 160)
    }
    this.bg?.setFillStyle(OUT_BG)
    this.redLamp?.setAlpha(1)
    this.showTitle(this.t('game.reaction.tooEarly'), PALETTE.red)
    this.status?.setText(this.t('game.reaction.falseStart'))
  }

  private onReacted(ms: number, quiet: boolean): void {
    this.resolved = true
    this.showTitle(this.t('game.reaction.ms', { ms }), PALETTE.lime)
    this.status?.setText(`${this.t('game.reaction.nice')}\n${this.t('game.common.waiting')}`)
    if (!this.title || quiet) return
    this.sfx.correct()
    const { x, y } = this.title
    burst(this, x, y, PALETTE.lime, 22, 280)
    const rating = RATINGS.find(([limit]) => ms < limit)
    if (rating) floatText(this, x, y + this.title.height, this.t(rating[1]), rating[2], 24)
  }

  // Every known player: fastest first, then those still waiting, then false starts.
  private renderBoard(snap: ReactionSnapshot): void {
    const ids = new Set([
      ...Object.keys(this.state.names),
      ...Object.keys(snap.reactions),
      ...snap.falseStarts,
    ])
    const order = (id: string): number => {
      const ms = snap.reactions[id]
      if (typeof ms === 'number') return ms
      return snap.falseStarts.includes(id) ? 2e9 : 1e9
    }
    const ranked = [...ids].sort((a, b) => order(a) - order(b))
    this.rows.forEach((row, i) => {
      const id = ranked[i]
      const visible = id !== undefined
      for (const o of [row.frame, row.swatch, row.name, row.value]) o.setVisible(visible)
      if (!id) return
      const ms = snap.reactions[id]
      const out = snap.falseStarts.includes(id)
      const key = `${id}:${ms ?? ''}:${out}`
      if (key === row.key) return
      row.key = key
      const arrived = (typeof ms === 'number' || out) && !this.shown.has(id)
      if (arrived) this.shown.add(id)
      const color = this.state.colorOf(id, PALETTE.dim)
      const face = i === 0 && typeof ms === 'number' ? 'happy' : out ? 'hurt' : 'idle'
      row.swatch.setTexture(
        ensureAvatarTexture(this, this.state.avatarOf(id), color, 1, 'front', face),
      )
      row.name.setText(this.label(id)).setColor(hexToCss(color))
      row.frame.setStrokeStyle(id === this.selfId ? 2 : 0, PALETTE.text)
      if (typeof ms === 'number') {
        const first = i === 0
        row.value
          .setText(`${first ? '★ ' : ''}${this.t('game.reaction.ms', { ms })}`)
          .setColor(hexToCss(first ? PALETTE.amber : PALETTE.text))
      } else if (out) {
        row.value.setText(this.t('game.reaction.falseStartTag')).setColor(hexToCss(PALETTE.red))
      } else {
        row.value.setText('...').setColor(hexToCss(PALETTE.dim))
      }
      if (arrived) punch(this, row.value, 0.3, 100)
    })
  }
}
