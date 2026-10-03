import {
  HONEYCOMB,
  type HoneycombPlayer,
  type HoneycombSnapshot,
  PALETTE,
  honeycombOutline,
} from '@pp/shared'
import Phaser from 'phaser'
import { addBanner, burst, eliminate, flash, floatText, shake, showBanner } from '../fx'
import { bodyStyle, fitFontSize, headlineStyle, hexToCss, shade } from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Honeycomb Cut (the dalgona candy): a round tin with a honey-coloured candy, the round's shape pressed
// into it. Hold the mouse button (or a finger) and trace the outline with the needle: your own trail
// shows at once, the server's cut stretches become dark grooves. A gauge under the candy shows how hard
// you're pushing (rush it and it cracks); cracks stay drawn on the candy, the third breaks it.

const SEND_EVERY_MS = 30
const CANDY = 0xd9963a

export class HoneycombCutScene extends MiniGameScene<HoneycombSnapshot> {
  private compact = false
  private box = { x: 0, y: 0, size: 0 }
  private candy?: Phaser.GameObjects.Graphics
  private grooves?: Phaser.GameObjects.Graphics
  private cracksG?: Phaser.GameObjects.Graphics
  private trail?: Phaser.GameObjects.Graphics
  private gauge?: Phaser.GameObjects.Graphics
  private gaugeBox = { x: 0, y: 0, w: 0, h: 0 }
  private needle?: Phaser.GameObjects.Text
  private prompt?: Phaser.GameObjects.Text
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private outline: { x: number; y: number }[] = []
  private drawnCut = ''
  private trailPts: { x: number; y: number; t: number }[] = []
  private down = false
  private pointerId = -1
  private lastSent = { t: 0, x: 0, y: 0 }
  private speed = 0
  private prev?: HoneycombPlayer
  private shapeKey = ''

  constructor(...deps: SceneDeps) {
    super('honeycomb-cut', ...deps)
  }

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.outline = []
    this.drawnCut = ''
    this.trailPts = []
    this.down = false
    this.pointerId = -1
    this.lastSent = { t: 0, x: 0, y: 0 }
    this.speed = 0
    this.prev = undefined
    this.shapeKey = ''

    const stripSize = this.compact ? 11 : 13
    this.strip = new PlayerStrip(this, width / 2, this.top + 8, width - 24, stripSize, 2)
    const areaTop = this.top + 8 + PlayerStrip.rowH(stripSize) * 2
    const promptSize = this.compact ? 12 : 16
    this.prompt = this.add
      .text(
        width / 2,
        height - (this.compact ? 14 : 18),
        '',
        headlineStyle(promptSize, PALETTE.amber),
      )
      .setOrigin(0.5, 1)
      .setDepth(600)
    const gaugeH = 10
    const areaBottom = this.prompt.y - promptSize - gaugeH - 24
    const size = Math.floor(Math.min(width - 24, areaBottom - areaTop))
    this.box = {
      x: Math.round((width - size) / 2),
      y: Math.round(areaTop + (areaBottom - areaTop - size) / 2),
      size,
    }
    const gw = Math.min(260, size * 0.7)
    this.gaugeBox = { x: width / 2 - gw / 2, y: this.box.y + size + 10, w: gw, h: gaugeH }

    this.candy = this.add.graphics().setDepth(10)
    this.grooves = this.add.graphics().setDepth(20)
    this.cracksG = this.add.graphics().setDepth(25)
    this.trail = this.add.graphics().setDepth(30)
    this.gauge = this.add.graphics().setDepth(40)
    this.add
      .text(
        this.gaugeBox.x - 8,
        this.gaugeBox.y + gaugeH / 2,
        this.t('game.honeycomb.pressure'),
        bodyStyle(this.compact ? 10 : 12, PALETTE.dim),
      )
      .setOrigin(1, 0.5)
      .setDepth(40)
    this.needle = this.add
      .text(
        0,
        0,
        '↓',
        headlineStyle(this.compact ? 16 : 24, 0xd8dce8, { stroke: '#10121c', strokeThickness: 4 }),
      )
      .setOrigin(0.5, 1)
      .setDepth(60)
      .setVisible(false)
    this.banner = addBanner(this)

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.pointerId !== -1) return
      this.pointerId = p.id
      this.down = true
      this.trailPts = []
      this.needleAt(p, true)
    })
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.id === this.pointerId || (this.pointerId === -1 && !p.wasTouch)) this.needleAt(p, false)
    })
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.id !== this.pointerId) return
      this.pointerId = -1
      this.down = false
      this.sendNeedle(p.x, p.y, false, this.time.now)
    })
  }

  private toCandy(x: number, y: number): { x: number; y: number } {
    return {
      x: Phaser.Math.Clamp((x - this.box.x) / this.box.size, 0, 1),
      y: Phaser.Math.Clamp((y - this.box.y) / this.box.size, 0, 1),
    }
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.box.x + x * this.box.size, y: this.box.y + y * this.box.size }
  }

  private needleAt(p: Phaser.Input.Pointer, force: boolean): void {
    this.needle?.setPosition(p.x, p.y).setVisible(true)
    if (!this.down) return
    const now = this.time.now
    this.trailPts.push({ x: p.x, y: p.y, t: now })
    if (force || now - this.lastSent.t >= SEND_EVERY_MS) this.sendNeedle(p.x, p.y, true, now)
  }

  private sendNeedle(x: number, y: number, down: boolean, now: number): void {
    const me = this.snap?.players.find((q) => q.id === this.selfId)
    if (!me || me.broken || me.doneMs !== null || this.state.final) return
    const c = this.toCandy(x, y)
    // Local pressure gauge: the same speed rule the server applies.
    const dt = Math.max(16, now - this.lastSent.t) / 1000
    if (down && this.lastSent.t > 0)
      this.speed = Math.hypot(c.x - this.lastSent.x, c.y - this.lastSent.y) / dt
    this.lastSent = { t: now, x: c.x, y: c.y }
    this.sendInput({ kind: 'needle', x: c.x, y: c.y, down })
  }

  protected frame(snap: HoneycombSnapshot | null, time: number, delta: number): void {
    if (!snap) return
    if (snap.shape !== this.shapeKey) {
      this.shapeKey = snap.shape
      this.outline = honeycombOutline(snap.shape)
      this.paintCandy()
      this.drawnCut = ''
    }
    const me = snap.players.find((p) => p.id === this.selfId)
    if (me) {
      this.paintGrooves(me)
      this.react(me)
    }
    this.paintTrail(time)
    this.paintGauge(delta)
    this.paintChrome(snap, me)
  }

  // The tin, the candy (speckled honeycomb, a highlight) and the shape pressed into it.
  private paintCandy(): void {
    const g = this.candy as Phaser.GameObjects.Graphics
    const { x, y, size } = this.box
    const cx = x + size / 2
    const cy = y + size / 2
    const r = size * HONEYCOMB.candyR
    g.clear()
    g.fillStyle(0x6f7686, 1).fillCircle(cx, cy, size * 0.5)
    g.fillStyle(0x9aa3b8, 1).fillCircle(cx, cy, size * 0.485)
    g.fillStyle(0x4d5262, 1).fillCircle(cx, cy, size * 0.47)
    g.fillStyle(CANDY, 1).fillCircle(cx, cy, r)
    for (let i = 0; i < 260; i++) {
      const a = ((i * 137.5) % 360) * (Math.PI / 180)
      const d = Math.sqrt(((i * 7919) % 1000) / 1000) * r * 0.95
      g.fillStyle(i % 3 === 0 ? shade(CANDY, -0.25) : shade(CANDY, 0.18), 1)
      g.fillRect(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), 3, 3)
    }
    g.fillStyle(0xffffff, 0.12).fillCircle(cx - r * 0.35, cy - r * 0.35, r * 0.35)
    // The pressed shape.
    g.lineStyle(Math.max(3, size / 120), shade(CANDY, -0.3), 1)
    g.beginPath()
    this.outline.forEach((p, i) => {
      const s = this.toScreen(p.x, p.y)
      if (i === 0) g.moveTo(s.x, s.y)
      else g.lineTo(s.x, s.y)
    })
    g.closePath()
    g.strokePath()
  }

  private paintGrooves(me: HoneycombPlayer): void {
    if (me.cut === this.drawnCut) return
    this.drawnCut = me.cut
    const g = this.grooves as Phaser.GameObjects.Graphics
    g.clear()
    g.lineStyle(Math.max(4, this.box.size / 90), 0x2b1b0c, 1)
    const n = this.outline.length
    for (let i = 0; i < n; i++) {
      if (me.cut[i] !== '1') continue
      const a = this.toScreen(
        (this.outline[i] as { x: number }).x,
        (this.outline[i] as { y: number }).y,
      )
      const b = this.outline[(i + 1) % n] as { x: number; y: number }
      const bs = this.toScreen(b.x, b.y)
      g.lineBetween(a.x, a.y, bs.x, bs.y)
    }
    if (me.doneMs !== null) {
      // The shape pops out: fill it light.
      g.fillStyle(shade(CANDY, 0.35), 1)
      g.fillPoints(
        this.outline.map((p) => this.toScreen(p.x, p.y)),
        true,
      )
    }
  }

  private react(me: HoneycombPlayer): void {
    const prev = this.prev
    this.prev = me
    if (!prev || this.firstSnapshot) return
    const at = this.needle?.visible
      ? { x: this.needle.x, y: this.needle.y }
      : this.toScreen(0.5, 0.5)
    if (me.cracks > prev.cracks) {
      this.drawCrack(at, me.cracks)
      shake(this, 0.008, 160)
      flash(this, PALETTE.red, 160, 0.2)
      if (me.broken) {
        eliminate(
          this,
          at.x,
          at.y,
          this.state.colorOf(me.id),
          this.t('game.common.eliminated'),
          this.compact ? 12 : 16,
        )
        this.sfx.eliminated()
      } else {
        floatText(
          this,
          at.x,
          at.y - 20,
          this.t('game.honeycomb.crack'),
          PALETTE.red,
          this.compact ? 12 : 16,
        )
        this.sfx.wrong()
      }
    }
    if (
      me.progress > prev.progress &&
      Math.floor(me.progress * 10) > Math.floor(prev.progress * 10)
    )
      this.sfx.tick()
    if (me.doneMs !== null && prev.doneMs === null) {
      const c = this.toScreen(0.5, 0.5)
      burst(this, c.x, c.y, PALETTE.amber, 30, 280)
      this.sfx.win()
      showBanner(
        this,
        this.banner as Phaser.GameObjects.Text,
        this.t('game.honeycomb.done', { s: (me.doneMs / 1000).toFixed(1) }),
        PALETTE.lime,
      )
    }
  }

  // A jagged crack from where the needle slipped toward the candy's rim (they stay drawn).
  private drawCrack(from: { x: number; y: number }, n: number): void {
    const g = this.cracksG as Phaser.GameObjects.Graphics
    const c = this.toScreen(0.5, 0.5)
    const r = this.box.size * HONEYCOMB.candyR
    let ang = Math.atan2(from.y - c.y, from.x - c.x)
    let x = from.x
    let y = from.y
    g.lineStyle(n >= HONEYCOMB.cracks ? 4 : 3, 0x2b1b0c, 1)
    g.beginPath()
    g.moveTo(x, y)
    for (let k = 0; k < 12; k++) {
      ang += (k % 2 === 0 ? 1 : -1) * (0.3 + ((k * 37 + n * 13) % 10) / 25)
      const nx = x + Math.cos(ang) * r * 0.1
      const ny = y + Math.sin(ang) * r * 0.1
      // Stop at the rim: the crack runs through the candy, not the tin.
      if (Math.hypot(nx - c.x, ny - c.y) >= r) break
      x = nx
      y = ny
      g.lineTo(x, y)
    }
    g.strokePath()
  }

  private paintTrail(time: number): void {
    const g = this.trail as Phaser.GameObjects.Graphics
    g.clear()
    this.trailPts = this.trailPts.filter((p) => time - p.t < 900)
    g.lineStyle(2, 0xfff3c4, 0.8)
    for (let i = 1; i < this.trailPts.length; i++) {
      const a = this.trailPts[i - 1] as { x: number; y: number }
      const b = this.trailPts[i] as { x: number; y: number }
      g.lineBetween(a.x, a.y, b.x, b.y)
    }
  }

  // Pressure gauge: your needle speed against the cracking limit.
  private paintGauge(delta: number): void {
    if (!this.down) this.speed = Math.max(0, this.speed - (delta / 1000) * 2)
    const g = this.gauge as Phaser.GameObjects.Graphics
    const { x, y, w, h } = this.gaugeBox
    const frac = Math.min(1, this.speed / (HONEYCOMB.maxSpeed * 2))
    const color =
      this.speed > HONEYCOMB.maxSpeed
        ? PALETTE.red
        : this.speed > HONEYCOMB.maxSpeed * 0.7
          ? PALETTE.amber
          : PALETTE.lime
    g.clear()
    g.fillStyle(PALETTE.panelAlt, 1).fillRect(x, y, w, h)
    g.fillStyle(color, 1).fillRect(x, y, Math.round(w * frac), h)
    g.fillStyle(PALETTE.text, 1).fillRect(Math.round(x + w * 0.5) - 1, y - 2, 2, h + 4)
  }

  private paintChrome(snap: HoneycombSnapshot, me: HoneycombPlayer | undefined): void {
    if (me) {
      this.hud?.setScore(`${Math.floor(me.progress * 100)}%`)
      this.hud?.setCenter(
        this.t('game.honeycomb.cracks', { n: me.cracks, max: HONEYCOMB.cracks }),
        me.cracks >= HONEYCOMB.cracks - 1 ? PALETTE.red : PALETTE.text,
      )
    }
    this.strip?.set(
      snap.players.map((p) => ({
        text: `${this.label(p.id)} ${p.doneMs !== null ? '✓' : p.broken ? '✗' : `${Math.floor(p.progress * 100)}%`}`,
        avatar: this.state.avatarOf(p.id),
        color: this.state.colorOf(p.id),
        dim: p.broken,
      })),
    )
    const text = !me
      ? ''
      : me.broken
        ? this.t('game.common.spectating')
        : me.doneMs !== null
          ? this.t('game.common.waiting')
          : this.speed > HONEYCOMB.maxSpeed && this.down
            ? this.t('game.honeycomb.slow')
            : this.t('game.honeycomb.hint')
    if (this.prompt && this.prompt.text !== text) {
      this.prompt.setText(text)
      this.prompt.setFontSize(fitFontSize(text, this.scale.width - 24, this.compact ? 12 : 16))
      this.prompt.setColor(
        hexToCss(text === this.t('game.honeycomb.slow') ? PALETTE.red : PALETTE.amber),
      )
    }
    if (this.state.final && me && this.banner && !this.banner.visible) {
      showBanner(
        this,
        this.banner,
        me.doneMs !== null
          ? this.t('game.honeycomb.done', { s: (me.doneMs / 1000).toFixed(1) })
          : me.broken
            ? this.t('game.common.out')
            : `${Math.floor(me.progress * 100)}%`,
        me.doneMs !== null ? PALETTE.lime : PALETTE.amber,
      )
    }
  }
}
