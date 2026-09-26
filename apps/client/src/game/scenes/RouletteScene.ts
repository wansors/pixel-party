import { PALETTE, type RouletteSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import { addBanner, burst, flash, punch, ring, showBanner } from '../fx'
import {
  bodyStyle,
  ensureBevelPanel,
  ensurePixelGrid,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Mirrors roulette.ts: values are 1..MAX_VALUE, drawn as SEGMENTS equal wedges of 10 numbers each.
const MAX_VALUE = 100
const SEGMENTS = 10
const SEG_DEG = 360 / SEGMENTS
const SEG_COLORS = [
  PALETTE.red,
  PALETTE.amber,
  PALETTE.cyan,
  PALETTE.lime,
  PALETTE.magenta,
  PALETTE.orange,
  0xb06bff,
  0x4be3c3,
  0x5b8cff,
  0xf062d0,
]
const WHEEL_CELLS = 56
const BULBS = 20
const RUSH_MS = 900
const SPIN_DEG_PER_S = 900
// Minimum settle time once the value is known; the actual time stretches so the wheel keeps its speed.
const SETTLE_MS = 2000
const MAX_ROWS = 8
// Pointer pixel art (drawn at 1.5x the wheel's cell size).
const POINTER_ART = [
  '_ooooooooo_',
  'oRRRRRRRRRo',
  'oRhhRRRRRRo',
  '_oRRRRRRRo_',
  '__oRRRRRo__',
  '___oRRRo___',
  '____oRo____',
  '_____o_____',
]

// Wheel-local angle (degrees clockwise from 12 o'clock) at which a value sits: the middle of its slot
// inside its segment, so the pointer lands exactly on the number that was dealt.
function valueAngle(value: number): number {
  const v = Phaser.Math.Clamp(Math.round(value), 1, MAX_VALUE) - 1
  return ((v + 0.5) / MAX_VALUE) * 360
}

type Phase = 'idle' | 'spinning' | 'settling' | 'landed'

// Pixel Roulette canvas (D3). A pixel-art prize wheel of ten numbered wedges (1–10 … 91–100) under a
// pointer, ringed with blinking bulbs. Tap SPIN (or the wheel / Space) to spin: it free-spins until
// the server reveals the pre-dealt value, then decelerates to land the pointer on exactly that number
// (ticking past each wedge), and the number slams in. Purely visual — the server owns the values;
// highest wins. A side list shows everyone's revealed numbers in their colours.
export class RouletteScene extends MiniGameScene<RouletteSnapshot> {
  private wheel?: Phaser.GameObjects.Container
  private pointer?: Phaser.GameObjects.Image
  private bulbs: Phaser.GameObjects.Rectangle[] = []
  private valueText?: Phaser.GameObjects.Text
  private spinImg?: Phaser.GameObjects.Image
  private spinText?: Phaser.GameObjects.Text
  private spunText?: Phaser.GameObjects.Text
  private rows: Phaser.GameObjects.Text[] = []
  private waitText?: Phaser.GameObjects.Text
  private banner?: Phaser.GameObjects.Text
  private cellPx = 4
  private wheelR = 0
  private phase: Phase = 'idle'
  private rot = 0
  private settle?: { from: number; to: number; start: number; ms: number; rushed?: boolean }
  private primed = false
  private lastSeg = 0
  private lastTickAt = 0
  private landedAt = 0
  private myValue = 0

  constructor(...deps: SceneDeps) {
    super('pixel-roulette', ...deps)
  }

  override create(): void {
    super.create()
    this.bulbs = []
    this.rows = []
    this.phase = 'idle'
    this.rot = 0
    this.settle = undefined
    this.lastSeg = 0
    this.lastTickAt = 0
    this.landedAt = 0
    this.myValue = 0
    this.primed = false

    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const top = this.top
    // Any landscape canvas (phones on their side too) gets the two-column layout.
    const wide = width > height * 1.15

    // Landscape: wheel on the left, hint + number + SPIN + standings on the right. Portrait: stacked.
    const size = wide
      ? Math.min(width * 0.5, height - top - 90, 460)
      : Math.min(width - 56, (height - top) * 0.44, 420)
    this.cellPx = Math.max(2, Math.floor(size / WHEEL_CELLS))
    this.wheelR = (WHEEL_CELLS * this.cellPx) / 2
    // The pointer pokes out above the rim (see buildWheel).
    const pointerAbove = POINTER_ART.length * this.pointerPx() - this.cellPx * 3
    const colX = wide ? width * 0.77 : width / 2
    const hintY = wide ? top + 40 : top + (compact ? 18 : 24)
    this.add
      .text(colX, hintY, this.t('game.roulette.hint'), bodyStyle(compact ? 14 : 18, PALETTE.dim))
      .setOrigin(0.5)
    const wheelX = wide ? width * 0.34 : width / 2
    const wheelY = wide
      ? Math.max(top + 12 + pointerAbove + this.wheelR, (top + height) / 2 + pointerAbove / 2)
      : hintY + 14 + pointerAbove + this.wheelR
    this.buildWheel(wheelX, wheelY)

    let y = wide ? hintY + 50 : wheelY + this.wheelR + (compact ? 24 : 34)
    this.add
      .text(colX, y, this.t('game.roulette.yours'), bodyStyle(compact ? 13 : 16, PALETTE.dim))
      .setOrigin(0.5)
    y += compact ? 32 : 44
    this.valueText = this.add
      .text(
        colX,
        y,
        '?',
        headlineStyle(compact ? 40 : 56, PALETTE.amber, { stroke: '#10121c', strokeThickness: 8 }),
      )
      .setOrigin(0.5)
    y += compact ? 56 : 80
    const btnW = Math.round(Math.min(wide ? width * 0.3 : width * 0.6, 280))
    const btnH = compact ? 56 : 64
    const up = ensureBevelPanel(this, btnW, btnH, PALETTE.lime)
    this.spinImg = this.add.image(colX, y, up).setInteractive({ useHandCursor: true })
    this.spinText = this.add
      .text(colX, y, this.t('game.roulette.spin'), headlineStyle(24, PALETTE.bg))
      .setOrigin(0.5)
    this.spinImg.on('pointerdown', () => {
      this.spinImg?.setTexture(ensureBevelPanel(this, btnW, btnH, shade(PALETTE.lime, -0.25)))
      this.spin()
    })
    this.spinImg.on('pointerup', () => this.spinImg?.setTexture(up))
    this.onKey('SPACE', () => this.spin())
    this.onKey('ENTER', () => this.spin())

    // Standings: everyone's revealed number (unspun = "?"), best first.
    y += btnH / 2 + (compact ? 20 : 34)
    this.spunText = this.add
      .text(colX, y, '', bodyStyle(compact ? 13 : 15, PALETTE.dim))
      .setOrigin(0.5)
    const rowH = compact ? 22 : 28
    const rowsFit = Math.max(0, Math.min(MAX_ROWS, Math.floor((height - 12 - (y + rowH)) / rowH)))
    for (let i = 0; i < rowsFit; i++) {
      this.rows.push(
        this.add
          .text(colX, y + rowH * (i + 1), '', bodyStyle(compact ? 14 : 17, PALETTE.text))
          .setOrigin(0.5),
      )
    }
    this.waitText = this.add
      .text(width / 2, height - (compact ? 14 : 20), '', bodyStyle(compact ? 13 : 16, PALETTE.text))
      .setOrigin(0.5, 1)
    this.banner = addBanner(this)
  }

  // --- Wheel art ------------------------------------------------------------------------------------

  private pointerPx(): number {
    return Math.round(this.cellPx * 1.5)
  }

  private buildWheel(x: number, y: number): void {
    const key = `pp-roulette-wheel-${this.cellPx}`
    if (!this.textures.exists(key)) {
      const n = WHEEL_CELLS
      const r = n / 2
      const g = this.make.graphics({ x: 0, y: 0 })
      for (let cy = 0; cy < n; cy++) {
        for (let cx = 0; cx < n; cx++) {
          const dx = cx + 0.5 - r
          const dy = cy + 0.5 - r
          const d = Math.hypot(dx, dy)
          if (d > r) continue
          // Clockwise from 12 o'clock, like valueAngle().
          const a = (Math.atan2(dy, dx) * 180) / Math.PI + 90
          const deg = (a + 360) % 360
          const seg = Math.floor(deg / SEG_DEG) % SEGMENTS
          const within = deg - seg * SEG_DEG
          const base = SEG_COLORS[seg] ?? PALETTE.dim
          let color = seg % 2 === 0 ? base : shade(base, -0.12)
          if (d > r - 2.2) color = d > r - 1.1 ? shade(PALETTE.frame, -0.5) : PALETTE.amber
          else if (d < r * 0.2) color = d > r * 0.2 - 1.1 ? PALETTE.amber : PALETTE.panel
          else if (within < 1.6 * (24 / d) || within > SEG_DEG - 0.8 * (24 / d))
            color = shade(base, -0.6)
          else if (d > r - 4.4) color = shade(base, 0.35)
          g.fillStyle(color, 1)
          g.fillRect(cx * this.cellPx, cy * this.cellPx, this.cellPx, this.cellPx)
        }
      }
      g.generateTexture(key, n * this.cellPx, n * this.cellPx)
      g.destroy()
    }
    this.add.circle(x + 6, y + 8, this.wheelR, shade(PALETTE.bg, -0.5), 0.8)
    const wheel = this.add.container(x, y)
    wheel.add(this.add.image(0, 0, key))
    const labelR = this.wheelR * 0.66
    for (let i = 0; i < SEGMENTS; i++) {
      const a = Phaser.Math.DegToRad((i + 0.5) * SEG_DEG)
      const label = this.add
        .text(
          Math.sin(a) * labelR,
          -Math.cos(a) * labelR,
          String((i + 1) * 10),
          headlineStyle(16, PALETTE.text, { stroke: '#10121c', strokeThickness: 4 }),
        )
        .setOrigin(0.5)
        .setRotation(a)
      wheel.add(label)
    }
    this.wheel = wheel
    wheel.setSize(this.wheelR * 2, this.wheelR * 2).setInteractive({ useHandCursor: true })
    wheel.on('pointerdown', () => this.spin())

    // Marquee bulbs around the rim (they don't rotate) and the pointer on top.
    for (let i = 0; i < BULBS; i++) {
      const a = (i / BULBS) * Math.PI * 2
      const s = Math.max(4, this.cellPx * 1.5)
      this.bulbs.push(
        this.add
          .rectangle(
            x + Math.sin(a) * (this.wheelR + s),
            y - Math.cos(a) * (this.wheelR + s),
            s,
            s,
            PALETTE.amber,
          )
          .setStrokeStyle(1, shade(PALETTE.amber, -0.5)),
      )
    }
    const pKey = ensurePixelGrid(this, {
      key: `pp-roulette-pointer-${this.cellPx}`,
      rows: POINTER_ART,
      legend: { o: 0x3a1010, R: PALETTE.red, h: 0xffb0b0 },
      pixelSize: this.pointerPx(),
    })
    this.pointer = this.add
      .image(x, y - this.wheelR + this.cellPx * 3, pKey)
      .setOrigin(0.5, 1)
      .setDepth(5)
  }

  // --- Spin -----------------------------------------------------------------------------------------

  private spin(): void {
    if (this.phase !== 'idle' || !this.snap || this.snap.values[this.selfId] !== undefined) return
    this.phase = 'spinning'
    this.sfx.go()
    this.sendInput({ kind: 'spin' })
    this.spinImg?.disableInteractive()
    for (const o of [this.spinImg, this.spinText]) {
      if (o) this.tweens.add({ targets: o, alpha: 0, duration: 150 })
    }
  }

  // Plans a smooth ease-out from the current angle/speed to the angle that puts `value` under the
  // pointer, at least one more full turn away.
  private planSettle(value: number): void {
    const target = (360 - valueAngle(value)) % 360
    const base = (SPIN_DEG_PER_S * SETTLE_MS) / 3000
    const ahead = (((target - (this.rot + base)) % 360) + 360) % 360
    const dist = base + ahead
    // Cubic ease-out starts at 3·dist/ms — matching the free-spin speed keeps the hand-off seamless.
    const ms = (3 * dist * 1000) / SPIN_DEG_PER_S
    this.settle = { from: this.rot, to: this.rot + dist, start: this.time.now, ms }
    this.phase = 'settling'
    if (this.state.final) this.rushSettle()
  }

  // The round is over (final snapshot) and the results arrive in ~1.5 s: a full ease-out takes 2 s+,
  // so land within RUSH_MS instead of being cut off mid-spin.
  private rushSettle(): void {
    const s = this.settle
    if (!s || s.rushed || s.ms - (this.time.now - s.start) <= RUSH_MS) return
    this.settle = { from: this.rot, to: s.to, start: this.time.now, ms: RUSH_MS, rushed: true }
  }

  // Scene restarted (viewport change) after this player's wheel already landed: show the landed
  // state directly, without replaying the spin, sound and banner.
  private restoreLanded(value: number): void {
    this.myValue = value
    this.rot = (360 - valueAngle(value)) % 360
    this.lastSeg = Math.floor(this.rot / SEG_DEG)
    this.phase = 'landed'
    this.spinImg?.setVisible(false)
    this.spinText?.setVisible(false)
    const seg = Math.min(SEGMENTS - 1, Math.floor((value - 1) / 10))
    this.valueText
      ?.setText(String(value))
      .setColor(hexToCss(shade(SEG_COLORS[seg] ?? PALETTE.amber, 0.2)))
    this.waitText?.setText(this.t('game.common.waiting'))
  }

  protected frame(snap: RouletteSnapshot | null, _time: number, delta: number): void {
    if (!snap) return
    const now = this.time.now
    const value = snap.values[this.selfId]
    if (!this.primed) {
      this.primed = true
      if (value !== undefined) this.restoreLanded(value)
    }

    // Round ended without a spin: the value is public now, so spin it in anyway.
    if (value !== undefined && this.phase === 'idle') {
      this.phase = 'spinning'
      this.spinImg?.setVisible(false)
      this.spinText?.setVisible(false)
    }
    if (this.phase === 'spinning') {
      this.rot += (SPIN_DEG_PER_S * delta) / 1000
      if (value !== undefined) {
        this.myValue = value
        this.planSettle(value)
      }
    } else if (this.phase === 'settling' && this.settle) {
      if (this.state.final) this.rushSettle()
      const t = Math.min(1, (now - this.settle.start) / this.settle.ms)
      this.rot = this.settle.from + (this.settle.to - this.settle.from) * (1 - (1 - t) ** 3)
      if (t >= 1) this.land()
    }
    this.wheel?.setAngle(this.rot)
    this.tickPointer(now)
    this.blinkBulbs(now)
    this.renderStandings(snap)
  }

  // A tick + pointer flick every time a wedge boundary passes under the pointer.
  private tickPointer(now: number): void {
    const seg = Math.floor(this.rot / SEG_DEG)
    if (seg === this.lastSeg) return
    this.lastSeg = seg
    if (now - this.lastTickAt < 45) return
    this.lastTickAt = now
    this.sfx.tick()
    if (!this.pointer) return
    this.tweens.killTweensOf(this.pointer)
    this.pointer.setAngle(-18)
    this.tweens.add({ targets: this.pointer, angle: 0, duration: 90, ease: 'Back.easeOut' })
  }

  // Idle: slow chase; spinning: fast chase; landed: all bulbs flash together for a moment.
  private blinkBulbs(now: number): void {
    const landedFlash = this.phase === 'landed' && now - this.landedAt < 1200
    const speed = this.phase === 'idle' || this.phase === 'landed' ? 260 : 70
    const step = Math.floor(now / speed)
    this.bulbs.forEach((b, i) => {
      const on = landedFlash ? Math.floor(now / 120) % 2 === 0 : (i + step) % 3 === 0
      b.setFillStyle(on ? PALETTE.amber : shade(PALETTE.amber, -0.6))
    })
  }

  private land(): void {
    this.phase = 'landed'
    this.landedAt = this.time.now
    this.settle = undefined
    const value = this.myValue
    const seg = Math.min(SEGMENTS - 1, Math.floor((value - 1) / 10))
    const color = SEG_COLORS[seg] ?? PALETTE.amber
    this.sfx.coin()
    if (this.valueText) {
      this.valueText.setText(String(value)).setColor(hexToCss(shade(color, 0.2)))
      punch(this, this.valueText, 0.5, 140)
      burst(this, this.valueText.x, this.valueText.y, color, 22, 260)
    }
    const px = this.pointer?.x ?? 0
    const py = this.pointer?.y ?? 0
    ring(this, px, py + this.wheelR * 0.3, color, 60)
    burst(this, px, py + 10, color, 16, 220)
    const [label, tone] =
      value >= 90
        ? [this.t('game.roulette.jackpot'), PALETTE.amber]
        : value >= 60
          ? [this.t('game.common.great'), PALETTE.lime]
          : value >= 30
            ? [this.t('game.common.good'), PALETTE.text]
            : [this.t('game.roulette.ouch'), PALETTE.red]
    if (value >= 90) {
      this.sfx.correct()
      flash(this, PALETTE.amber, 160)
    }
    if (this.banner) {
      const banner = this.banner
      showBanner(this, banner, label, tone)
      this.time.delayedCall(1100, () => banner.setVisible(false))
    }
    this.waitText?.setText(this.t('game.common.waiting'))
  }

  private renderStandings(snap: RouletteSnapshot): void {
    const ids = Object.keys(snap.spun)
    const spun = ids.filter((id) => snap.spun[id]).length
    this.spunText?.setText(this.t('game.roulette.spun', { n: spun, total: ids.length }))
    // Your own number only shows once your wheel has landed (no spoilers mid-spin).
    const shown = (id: string): number | undefined =>
      id === this.selfId && this.phase !== 'landed' ? undefined : snap.values[id]
    const ranked = [...ids].sort((a, b) => (shown(b) ?? -1) - (shown(a) ?? -1))
    this.rows.forEach((row, i) => {
      const id = ranked[i]
      row.setVisible(id !== undefined)
      if (id === undefined) return
      const known = shown(id) !== undefined
      const v = known ? String(snap.values[id]).padStart(3, ' ') : '  ?'
      const name = this.label(id).slice(0, 10).padEnd(10, ' ')
      row
        .setText(`${id === this.selfId ? '▶' : ' '} ${name} ${v}`)
        .setColor(hexToCss(this.state.colorOf(id, PALETTE.text)))
        .setAlpha(known ? 1 : 0.6)
    })
  }
}
