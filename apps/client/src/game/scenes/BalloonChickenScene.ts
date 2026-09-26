import { type BalloonChickenSnapshot, type BalloonPlayer, PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { addBanner, burst, flash, floatText, punch, shake, showBanner } from '../fx'
import {
  bodyStyle,
  ensureBevelPanel,
  ensurePixelGrid,
  ensurePixelOrb,
  fitText,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Growth curve: the balloon swells fast at first and ever slower after (never tied to the hidden
// burst threshold — only to how many pumps the snapshot says it has taken).
const GROWTH_PUMPS = 9
const MIN_FRAC = 0.32
const COIN_COUNT = 16

// 14x17 balloon: outlined ellipse with a highlight, knot at the bottom.
function balloonRows(): string[] {
  const rows: string[] = []
  const rx = 7
  const ry = 7.5
  for (let y = 0; y < 15; y++) {
    let row = ''
    for (let x = 0; x < 14; x++) {
      const dx = (x + 0.5 - rx) / rx
      const dy = (y + 0.5 - ry) / ry
      const d = dx * dx + dy * dy
      if (d > 1) row += '_'
      else if (d > 0.72) row += 'o'
      else if (dx < -0.2 && dy < -0.25 && d < 0.42) row += 'h'
      else row += 'b'
    }
    rows.push(row)
  }
  rows.push('______oo______', '_____obbo_____')
  return rows
}

// Torn rubber shreds left on the knot after a pop.
const SCRAP_ROWS = [
  '_o___oo___o_',
  'ob__obbo_bo_',
  '_bo_obo__ob_',
  '__o_ob__ob__',
  '___oobooo___',
  '____obbo____',
]

// Hand pump: T handle + rod (the plunger that dips) over a barrel on a base.
const HANDLE_ROWS = [
  'oooooooooooo',
  'ohhhhhhhhhho',
  'oooooooooooo',
  '_____oo_____',
  '_____hb_____',
  '_____hb_____',
  '_____hb_____',
]
const BARREL_ROWS = [
  '___oooooo___',
  '___ohbbbo___',
  '___ohbbbo___',
  '___ohbbbo___',
  '___ohbbbo___',
  '___ohbbbo___',
  '___ohbbbo___',
  '_oooooooooo_',
  'ohhhhhhhhhho',
  'oooooooooooo',
]

function balloonKey(scene: Phaser.Scene, color: number): string {
  return ensurePixelGrid(scene, {
    key: `pp-balloon-${color.toString(16)}`,
    rows: balloonRows(),
    legend: { o: shade(color, -0.55), b: color, h: shade(color, 0.5) },
  })
}

function scrapKey(scene: Phaser.Scene, color: number): string {
  return ensurePixelGrid(scene, {
    key: `pp-balloon-scrap-${color.toString(16)}`,
    rows: SCRAP_ROWS,
    legend: { o: shade(color, -0.55), b: color },
  })
}

const pointsOf = (p: BalloonPlayer, ppp: number): number =>
  p.status === 'burst' ? 0 : p.status === 'cashed' ? p.banked : p.pumps * ppp

interface Token {
  id: string
  balloon: Phaser.GameObjects.Image
  scrap: Phaser.GameObjects.Image
  coin: Phaser.GameObjects.Image
  value: Phaser.GameObjects.Text
  size: number
  key: string
}

interface Button {
  img: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  up: string
  down: string
}

// Balloon Chicken ("nerve") canvas. Your balloon, in your color, is tied to a hand pump: PUMP (tap
// or Space) inflates it for points, CASH OUT banks them before it bursts. It visibly swells and
// wobbles harder the more it has been pumped — purely from the pump count, since the burst
// threshold is hidden server-side. A pop explodes into rubber shreds; a cash-out floats the balloon
// away under a coin shower. Every other player's balloon rides along the top in their color with
// their name.
export class BalloonChickenScene extends MiniGameScene<BalloonChickenSnapshot> {
  private balloon?: Phaser.GameObjects.Image
  private scrap?: Phaser.GameObjects.Image
  private value?: Phaser.GameObjects.Text
  private handle?: Phaser.GameObjects.Image
  private banner?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private pump?: Button
  private cash?: Button
  private tokens: Token[] = []
  private knot = { x: 0, y: 0 }
  private size = { min: 0, max: 0 }
  private handleY = 0
  private lastPumps = 0
  private lastStatus: BalloonPlayer['status'] = 'pumping'

  constructor(...deps: SceneDeps) {
    super('balloon-chicken', ...deps)
  }

  override create(): void {
    super.create()
    this.tokens = []
    this.lastPumps = 0
    this.lastStatus = 'pumping'
    const { width, height } = this.scale
    const cx = width / 2
    const compact = Math.min(width, height) < 520
    const color = this.state.colorOf(this.selfId, PALETTE.red)

    // Buttons along the bottom.
    const gap = compact ? 12 : 20
    const bw = Math.round(Math.min(260, (width * 0.9 - gap) / 2))
    const bh = compact ? 64 : 80
    const by = height - bh / 2 - (compact ? 14 : 22)
    this.pump = this.makeButton(
      cx - bw / 2 - gap / 2,
      by,
      bw,
      bh,
      PALETTE.lime,
      'game.balloon.pump',
      () => this.act('pump'),
    )
    this.cash = this.makeButton(
      cx + bw / 2 + gap / 2,
      by,
      bw,
      bh,
      PALETTE.amber,
      'game.balloon.cashOut',
      () => this.act('cashout'),
    )

    // The pump, a string up to the knot, and the balloon growing upward from the knot.
    const pumpH = compact ? 70 : 96
    const pumpW = pumpH * 0.8
    const pumpBottom = by - bh / 2 - (compact ? 10 : 16)
    const legend = { o: 0x3a1f10, h: 0xd26a3a, b: 0xa84a24 }
    const barrelKey = ensurePixelGrid(this, { key: 'pp-balloon-barrel', rows: BARREL_ROWS, legend })
    const handleKey = ensurePixelGrid(this, { key: 'pp-balloon-handle', rows: HANDLE_ROWS, legend })
    const barrel = this.add
      .image(cx, pumpBottom, barrelKey)
      .setOrigin(0.5, 1)
      .setDisplaySize(pumpW, pumpH * 0.72)
      .setDepth(3)
    this.handleY = barrel.y - barrel.displayHeight + 4
    this.handle = this.add
      .image(cx, this.handleY, handleKey)
      .setOrigin(0.5, 1)
      .setDisplaySize(pumpW, pumpH * 0.5)
      .setDepth(2)
    const tokenH = compact ? 74 : 96
    const areaTop = this.top + tokenH + (compact ? 8 : 12)
    const stringLen = compact ? 36 : 50
    this.knot = { x: cx, y: this.handleY - pumpH * 0.5 - stringLen }
    const string = this.add.graphics().setDepth(1)
    string.fillStyle(PALETTE.text, 0.8)
    for (let y = this.knot.y; y < this.handleY - pumpH * 0.4; y += 6)
      string.fillRect(cx - 1, y, 2, 4)
    const maxD = Math.min(width * 0.86 * (17 / 14), this.knot.y - areaTop - 10)
    this.size = { min: maxD * MIN_FRAC, max: maxD }
    this.balloon = this.add
      .image(this.knot.x, this.knot.y, balloonKey(this, color))
      .setOrigin(0.5, 1)
      .setDepth(4)
    this.scrap = this.add
      .image(this.knot.x, this.knot.y + 4, scrapKey(this, color))
      .setOrigin(0.5, 1)
      .setDisplaySize(this.size.min * 0.8, this.size.min * 0.4)
      .setVisible(false)
      .setDepth(4)
    this.value = this.add
      .text(
        cx,
        this.knot.y,
        '',
        headlineStyle(16, PALETTE.text, { stroke: '#10121c', strokeThickness: 6 }),
      )
      .setOrigin(0.5)
      .setDepth(6)
    this.setBalloonSize(0, 0)

    this.banner = addBanner(this)
    this.banner
      .setFontSize(compact ? 24 : 34)
      .setWordWrapWidth(width * 0.9)
      .setY(this.knot.y - maxD * 0.55)
    this.status = this.add
      .text(
        cx,
        this.knot.y - maxD * 0.55 + (compact ? 50 : 64),
        '',
        bodyStyle(compact ? 14 : 18, PALETTE.text, {
          align: 'center',
          stroke: '#10121c',
          strokeThickness: 4,
          wordWrap: { width: width * 0.9 },
        }),
      )
      .setOrigin(0.5, 0)
      .setDepth(951)

    this.onKey('SPACE', () => this.act('pump'))
  }

  private makeButton(
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    labelKey: string,
    onPress: () => void,
  ): Button {
    const compact = Math.min(this.scale.width, this.scale.height) < 520
    const up = ensureBevelPanel(this, w, h, color, 6)
    const down = ensureBevelPanel(this, w, h, shade(color, -0.3), 6)
    const img = this.add.image(x, y, up).setInteractive({ useHandCursor: true })
    const label = this.add
      .text(x, y, this.t(labelKey), headlineStyle(compact ? 16 : 24, PALETTE.bg))
      .setOrigin(0.5)
    fitText(label, w - 16, compact ? 16 : 24)
    img.on('pointerdown', onPress)
    return { img, label, up, down }
  }

  private act(kind: 'pump' | 'cashout'): void {
    const self = this.snap?.players[this.selfId]
    if (!self || self.status !== 'pumping') return
    this.sfx.click()
    this.sendInput({ kind })
    const btn = kind === 'pump' ? this.pump : this.cash
    if (!btn) return
    btn.img.setTexture(btn.down)
    punch(this, btn.img, -0.06, 60)
    this.time.delayedCall(80, () => btn.img.setTexture(btn.up))
  }

  // Resizes the balloon for `pumps` and re-fits its points label (only on change: re-sizing text
  // re-renders it, so this never runs per frame).
  private setBalloonSize(pumps: number, ppp: number): void {
    if (!this.balloon) return
    const frac = MIN_FRAC + (1 - MIN_FRAC) * (1 - Math.exp(-pumps / GROWTH_PUMPS))
    const d = this.size.max * frac
    // A running punch would restore the previous size when it ends.
    this.tweens.killTweensOf(this.balloon)
    this.balloon.setDisplaySize(d * (14 / 17), d)
    this.balloon
      .setData('pp-base-sx', this.balloon.scaleX)
      .setData('pp-base-sy', this.balloon.scaleY)
    if (!this.value) return
    this.value.setText(String(pumps * ppp))
    const size = Math.max(16, Math.min(48, Math.floor((d * 0.28) / 8) * 8))
    fitText(this.value, d * (14 / 17) * 0.8, size)
  }

  protected frame(snap: BalloonChickenSnapshot | null, time: number): void {
    if (!snap) return
    if (this.tokens.length === 0)
      this.buildTokens(Object.keys(snap.players).filter((id) => id !== this.selfId))
    const self = snap.players[this.selfId]
    this.renderTokens(snap)
    if (!self) return
    this.hud?.setScore(this.t('game.common.pts', { n: pointsOf(self, snap.pointsPerPump) }))

    // A relayout restart mid-round restores the balloon as it is — no pump pop, burst or coin shower.
    const quiet = this.firstSnapshot
    if (self.pumps !== this.lastPumps && self.status !== 'burst') {
      if (quiet) this.setBalloonSize(self.pumps, snap.pointsPerPump)
      else this.onPumped(self.pumps, snap.pointsPerPump)
    }
    if (self.status !== this.lastStatus) {
      if (self.status === 'burst') this.onBurst(quiet)
      if (self.status === 'cashed') this.onCashed(self.banked, quiet)
      this.lastStatus = self.status
    }
    this.lastPumps = self.pumps

    const alive = self.status === 'pumping'
    for (const b of [this.pump, this.cash]) b?.img.setAlpha(alive ? 1 : 0.3)
    if (alive) this.wobble(self.pumps, time)
    else this.status?.setText(this.t('game.common.waiting'))
  }

  // Wobble grows with the pump count (never with the hidden threshold): a lazy sway at first, a
  // nervous shiver once it's big.
  private wobble(pumps: number, time: number): void {
    if (!this.balloon || !this.value) return
    const amp = Math.min(12, 1.5 + pumps * 0.55)
    const speed = 380 - Math.min(260, pumps * 14)
    const shiver = pumps >= 10 ? Math.sin(time / 23) * Math.min(2.5, (pumps - 9) * 0.3) : 0
    const angle = Math.sin(time / speed) * amp + shiver
    this.balloon.setAngle(angle)
    const rad = (angle * Math.PI) / 180
    const r = this.balloon.displayHeight * 0.55
    this.value.setPosition(this.knot.x + Math.sin(rad) * r, this.knot.y - Math.cos(rad) * r)
  }

  private onPumped(pumps: number, ppp: number): void {
    this.setBalloonSize(pumps, ppp)
    if (!this.balloon || pumps < this.lastPumps) return
    punch(this, this.balloon, 0.08, 80)
    if (this.handle) {
      this.tweens.killTweensOf(this.handle)
      this.handle.setY(this.handleY + 10)
      this.tweens.add({
        targets: this.handle,
        y: this.handleY,
        duration: 140,
        ease: 'Quad.easeOut',
      })
    }
    burst(this, this.knot.x, this.knot.y + 10, PALETTE.text, 5, 90)
    floatText(
      this,
      this.knot.x + this.balloon.displayWidth * 0.45,
      this.knot.y - this.balloon.displayHeight * 0.8,
      `+${ppp}`,
      PALETTE.lime,
      16,
    )
  }

  // `quiet`: restoring the end state after a relayout restart — the same look, no bang.
  private onBurst(quiet = false): void {
    const color = this.state.colorOf(this.selfId, PALETTE.red)
    const b = this.balloon
    const cy = b ? b.y - b.displayHeight / 2 : this.knot.y
    if (!quiet) {
      this.sfx.pop()
      burst(this, this.knot.x, cy, color, 40, 420)
      burst(this, this.knot.x, cy, PALETTE.text, 12, 260)
      shake(this, 0.02, 320)
      flash(this, color, 140)
    }
    b?.setVisible(false)
    this.value?.setVisible(false)
    this.scrap?.setVisible(true)
    if (this.banner) showBanner(this, this.banner, this.t('game.balloon.pop'), PALETTE.red)
    this.status?.setText(this.t('game.common.waiting'))
  }

  // `quiet`: restoring the end state after a relayout restart — the balloon is long gone, just the
  // banner (no coin shower).
  private onCashed(banked: number, quiet = false): void {
    // The banner carries the banked points; the balloon itself floats away.
    this.value?.setVisible(false)
    if (quiet) this.balloon?.setVisible(false)
    else {
      this.sfx.coin()
      this.coinShower()
      if (this.balloon) {
        this.tweens.add({
          targets: this.balloon,
          y: `-=${this.scale.height * 0.25}`,
          alpha: 0,
          duration: 1200,
          ease: 'Sine.easeIn',
        })
      }
    }
    if (this.banner)
      showBanner(
        this,
        this.banner,
        `${this.t('game.balloon.cashed')}\n${this.t('game.common.pts', { n: banked })}`,
        PALETTE.lime,
      )
  }

  private coinShower(): void {
    const coinKey = ensurePixelOrb(this, 'pp-balloon-coin', 8, PALETTE.amber)
    const { width, height } = this.scale
    for (let i = 0; i < COIN_COUNT; i++) {
      // Fixed spread per coin index so the shower looks the same every time.
      const x = width * (0.1 + (0.8 * ((i * 7919) % 97)) / 97)
      const coin = this.add
        .image(x, this.top - 20 - (i % 5) * 30, coinKey)
        .setDisplaySize(20, 20)
        .setDepth(900)
      this.tweens.add({
        targets: coin,
        y: height + 30,
        scaleX: { from: coin.scaleX, to: coin.scaleX * 0.2 },
        duration: 900 + (i % 4) * 160,
        delay: (i % 6) * 60,
        ease: 'Quad.easeIn',
        onComplete: () => coin.destroy(),
      })
    }
  }

  // Everyone else's balloon along the top: grows with their pumps, pops into shreds, or turns into
  // a coin with the banked points.
  private buildTokens(ids: string[]): void {
    if (ids.length === 0) return
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const tokenW = Math.min(compact ? 100 : 140, (width * 0.94) / ids.length)
    const size = compact ? 40 : 52
    const baseY = this.top + size + 4
    ids.forEach((id, i) => {
      const x = width / 2 + (i - (ids.length - 1) / 2) * tokenW
      const color = this.state.colorOf(id, PALETTE.dim)
      const balloon = this.add.image(x, baseY, balloonKey(this, color)).setOrigin(0.5, 1)
      const scrap = this.add
        .image(x, baseY, scrapKey(this, color))
        .setOrigin(0.5, 1)
        .setDisplaySize(size * 0.7, size * 0.35)
        .setVisible(false)
      const coin = this.add
        .image(x, baseY - size * 0.35, ensurePixelOrb(this, 'pp-balloon-coin', 8, PALETTE.amber))
        .setDisplaySize(size * 0.5, size * 0.5)
        .setVisible(false)
      this.add
        .text(
          x,
          baseY + 4,
          this.state.nameOf(id).slice(0, compact ? 7 : 10),
          bodyStyle(compact ? 11 : 13, color),
        )
        .setOrigin(0.5, 0)
      const value = this.add
        .text(x, baseY + (compact ? 18 : 22), '', headlineStyle(compact ? 8 : 16, PALETTE.text))
        .setOrigin(0.5, 0)
      this.tokens.push({ id, balloon, scrap, coin, value, size, key: '' })
    })
  }

  private renderTokens(snap: BalloonChickenSnapshot): void {
    for (const tok of this.tokens) {
      const p = snap.players[tok.id]
      if (!p) continue
      const key = `${p.pumps}:${p.status}`
      if (key === tok.key) continue
      const popped = tok.key !== '' && p.status === 'burst'
      tok.key = key
      const frac = MIN_FRAC + (1 - MIN_FRAC) * (1 - Math.exp(-p.pumps / GROWTH_PUMPS))
      tok.balloon
        .setVisible(p.status === 'pumping')
        .setDisplaySize(tok.size * frac * (14 / 17), tok.size * frac)
      tok.scrap.setVisible(p.status === 'burst')
      tok.coin.setVisible(p.status === 'cashed')
      const v = pointsOf(p, snap.pointsPerPump)
      tok.value
        .setText(p.status === 'burst' ? this.t('game.balloon.bust') : String(v))
        .setColor(
          hexToCss(
            p.status === 'burst'
              ? PALETTE.red
              : p.status === 'cashed'
                ? PALETTE.lime
                : PALETTE.text,
          ),
        )
      if (popped)
        burst(
          this,
          tok.balloon.x,
          tok.balloon.y - tok.size / 2,
          this.state.colorOf(tok.id, PALETTE.dim),
          14,
          160,
        )
      if (p.status === 'cashed') punch(this, tok.coin, 0.3, 100)
    }
  }
}
