import {
  BALLOON_CHICKEN,
  type BalloonChickenSnapshot,
  type BalloonPlayer,
  PALETTE,
} from '@pp/shared'
import type Phaser from 'phaser'
import { type AvatarExpression, AvatarSprite, avatarPx, ensureAvatarTexture } from '../avatars'
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
// A pump shown before the server confirmed it is dropped if the server still hasn't counted it after
// this long (it never should; the balloon then shrinks back to the server's count).
const PUMP_CONFIRM_MS = 900
// After CASH OUT, inputs wait for the server's verdict (the next balloon) at most this long.
const CASH_WAIT_MS = 700
// Sound throttles: a pump's rush of air at most this often (a fast pumper layers them otherwise), and a
// rival's balloon popping at most this often (a full room can pop several at once).
const PUMP_SOUND_EVERY_MS = 110
const RIVAL_POP_EVERY_MS = 600
const PPP = BALLOON_CHICKEN.pointsPerPump
const BALLOONS = BALLOON_CHICKEN.balloons

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

const isDone = (p: BalloonPlayer): boolean => p.outcomes.length >= BALLOONS

interface Token {
  id: string
  // The rival's avatar beside their name (hurt after a burst, happy after a cash-out).
  icon: Phaser.GameObjects.Image
  // A fixed-size balloon while they still have one in hand: how far they've pumped it stays hidden.
  balloon: Phaser.GameObjects.Image
  value: Phaser.GameObjects.Text
  // One pip per balloon: lime = cashed, red = burst, dim = still to come.
  pips: Phaser.GameObjects.Rectangle[]
  // Offsets the token's sway, so a row of balloons doesn't swing in lockstep.
  phase: number
  outcomes: number
  key: string
}

interface Button {
  img: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  // The PC key for it ("SPACE" / "ENTER"), under the label (hidden on phones).
  key: Phaser.GameObjects.Text
  up: string
  down: string
}

// Balloon Chicken ("nerve") canvas. Everybody gets the same three balloons in a row, each with its own
// hidden burst point. Yours, in your color, is tied to a hand pump: PUMP (click or Space) inflates it
// for points, CASH OUT (click or Enter) banks them; either way the next balloon comes up, and one still
// in hand at the buzzer pops. A pump shows at once (the pump strokes, the balloon grows) and the server
// confirms it a snapshot later; a burst or a cash-out is the server's word. It visibly swells and wobbles harder the more it has been pumped — purely from the pump
// count, since the threshold is hidden server-side. A pop explodes into rubber shreds; a cash-out floats
// the balloon away under a coin shower. A row of pips under the rivals tracks your three balloons.
// Rivals ride along the top (two rows in a crowd) showing status only — balloon in hand, banked
// points, each balloon's fate — never how far they've pumped.
export class BalloonChickenScene extends MiniGameScene<BalloonChickenSnapshot> {
  private balloon?: Phaser.GameObjects.Image
  private scrap?: Phaser.GameObjects.Image
  private value?: Phaser.GameObjects.Text
  private handle?: Phaser.GameObjects.Image
  private banner?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private pump?: Button
  // You: your avatar working the pump (sweating as it grows, KO on a burst, happy on a cash-out).
  private pumper?: AvatarSprite
  private cash?: Button
  // Your three balloons: the one in hand, the ones to come, and how the finished ones ended.
  private ownPips: Phaser.GameObjects.Image[] = []
  private pipH = 0
  private tokens: Token[] = []
  private tokenRows = 1
  private tokenH = 0
  private knot = { x: 0, y: 0 }
  private size = { min: 0, max: 0 }
  private handleY = 0
  private hint?: Phaser.GameObjects.Text
  // Pumps the balloon on screen shows: the server's count, or more while a pump is on its way.
  private shownPumps = 0
  // Optimistic pumps: the balloon they were made on (its index = outcomes so far), how many, and when
  // the last one was pressed.
  private localBalloon = -1
  private localPumps = 0
  private lastPumpAt = 0
  // CASH OUT pressed, awaiting the server's verdict (the next balloon) — inputs wait for it.
  private cashingAt = -1
  private wasAlive = true
  private lastOutcomes = 0
  private lastBanked = 0
  // Out of balloons, or out of time: the total is up.
  private over = false
  private pumpSoundAt = Number.NEGATIVE_INFINITY
  private rivalPopAt = Number.NEGATIVE_INFINITY

  constructor(...deps: SceneDeps) {
    super('balloon-chicken', ...deps)
  }

  override create(): void {
    super.create()
    this.tokens = []
    this.ownPips = []
    this.shownPumps = 0
    this.localBalloon = -1
    this.localPumps = 0
    this.lastPumpAt = 0
    this.cashingAt = -1
    this.wasAlive = true
    this.lastOutcomes = 0
    this.lastBanked = 0
    this.over = false
    this.pumpSoundAt = Number.NEGATIVE_INFINITY
    this.rivalPopAt = Number.NEGATIVE_INFINITY
    const { width, height } = this.scale
    const cx = width / 2
    const compact = Math.min(width, height) < 520
    const color = this.state.colorOf(this.selfId, PALETTE.red)

    // Buttons along the bottom.
    const gap = compact ? 12 : 20
    // A big (1080p) screen gets bigger buttons: they're read from across the room.
    const big = !compact && height >= 900
    const bw = Math.round(Math.min(big ? 320 : 260, (width * 0.9 - gap) / 2))
    const bh = compact ? 64 : big ? 96 : 80
    const by = height - bh / 2 - (compact ? 14 : 22)
    this.pump = this.makeButton(
      cx - bw / 2 - gap / 2,
      by,
      bw,
      bh,
      PALETTE.lime,
      'game.balloon.pump',
      'game.balloon.pumpKey',
      () => this.act('pump'),
    )
    this.cash = this.makeButton(
      cx + bw / 2 + gap / 2,
      by,
      bw,
      bh,
      PALETTE.amber,
      'game.balloon.cashOut',
      'game.balloon.cashKey',
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
    const pumperPx = avatarPx(pumpH * 0.75)
    this.pumper = new AvatarSprite(
      this,
      this.state.avatarOf(this.selfId),
      this.state.colorOf(this.selfId, PALETTE.dim),
      pumperPx,
      'side',
    )
    this.pumper.image
      .setOrigin(0.5, 1)
      .setPosition(cx - pumpW * 0.5 - pumperPx * 0.42, pumpBottom)
      .setDepth(4)
    this.handle = this.add
      .image(cx, this.handleY, handleKey)
      .setOrigin(0.5, 1)
      .setDisplaySize(pumpW, pumpH * 0.5)
      .setDepth(2)

    // Rival tokens along the top (built on the first snapshot; the roster sizes the rows), then your
    // own balloon pips, then the play area.
    const rivals = Math.max(1, Object.keys(this.state.names).length - 1)
    this.tokenRows = rivals * (compact ? 64 : 96) > width * 0.94 ? 2 : 1
    this.tokenH = compact ? 70 : big ? 100 : 88
    const pipY = this.top + this.tokenRows * this.tokenH + (compact ? 14 : 18)
    this.pipH = compact ? 22 : 28
    for (let i = 0; i < BALLOONS; i++) {
      const pip = this.add
        .image(cx + (i - (BALLOONS - 1) / 2) * this.pipH * 1.3, pipY, balloonKey(this, color))
        .setDisplaySize(this.pipH * (14 / 17), this.pipH)
      this.ownPips.push(pip)
    }
    // What to do, under your balloon pips (the buttons name their keys).
    const hintY = pipY + this.pipH / 2 + (compact ? 6 : 10)
    this.hint = this.add
      .text(cx, hintY, this.t('game.balloon.hint'), bodyStyle(compact ? 13 : 16, PALETTE.dim))
      .setOrigin(0.5, 0)
    const areaTop = hintY + this.hint.height + 8
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
    this.setBalloonSize(0)

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
    this.onKey('ENTER', () => this.act('cashout'))
  }

  private makeButton(
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    labelKey: string,
    keyKey: string,
    onPress: () => void,
  ): Button {
    const compact = Math.min(this.scale.width, this.scale.height) < 520
    const up = ensureBevelPanel(this, w, h, color, 6)
    const down = ensureBevelPanel(this, w, h, shade(color, -0.3), 6)
    const img = this.add.image(x, y, up).setInteractive({ useHandCursor: true })
    const label = this.add
      .text(
        x,
        compact ? y : y - h * 0.12,
        this.t(labelKey),
        headlineStyle(compact ? 16 : 24, PALETTE.bg),
      )
      .setOrigin(0.5)
    fitText(label, w - 16, compact ? 16 : 24)
    const key = this.add
      .text(x, y + h * 0.26, this.t(keyKey), headlineStyle(16, shade(color, -0.65)))
      .setOrigin(0.5)
      .setVisible(!compact)
    img.on('pointerdown', onPress)
    return { img, label, key, up, down }
  }

  private act(kind: 'pump' | 'cashout'): void {
    const snap = this.snap
    const self = snap?.players[this.selfId]
    if (!snap || !self || isDone(self) || snap.remainingMs <= 0) return
    // A cash-out is on its way: the next input belongs to the next balloon, which isn't up yet.
    if (this.cashingAt >= 0) return
    const btn = kind === 'pump' ? this.pump : this.cash
    if (btn) {
      btn.img.setTexture(btn.down)
      punch(this, btn.img, -0.06, 60)
      this.time.delayedCall(80, () => btn.img.setTexture(btn.up))
    }
    if (kind === 'cashout') {
      // Nothing in it yet: the server would ignore it, so don't pretend.
      if (this.shownPumps === 0) {
        this.sfx.tick()
        return
      }
      this.sfx.click()
      this.cashingAt = this.time.now
      this.sendInput({ kind })
      return
    }
    // A stroke of the pump: a rush of air into the balloon.
    if (this.time.now - this.pumpSoundAt >= PUMP_SOUND_EVERY_MS) {
      this.pumpSoundAt = this.time.now
      this.sfx.whoosh()
    }
    this.sendInput({ kind })
    // Shown at once: the pump strokes and the balloon grows; the server confirms it (or pops it).
    if (this.localBalloon !== self.outcomes.length) {
      this.localBalloon = self.outcomes.length
      this.localPumps = self.pumps
    }
    this.localPumps = Math.max(this.localPumps, this.shownPumps) + 1
    this.lastPumpAt = this.time.now
    this.shownPumps = this.localPumps
    this.onPumped(this.shownPumps, true)
  }

  // Resizes the balloon for `pumps` and re-fits its points label (only on change: re-sizing text
  // re-renders it, so this never runs per frame).
  private setBalloonSize(pumps: number): void {
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
    this.value.setText(String(pumps * PPP))
    const size = Math.max(16, Math.min(48, Math.floor((d * 0.28) / 8) * 8))
    fitText(this.value, d * (14 / 17) * 0.8, size)
  }

  protected frame(snap: BalloonChickenSnapshot | null, time: number): void {
    if (!snap) return
    if (this.tokens.length === 0)
      this.buildTokens(Object.keys(snap.players).filter((id) => id !== this.selfId))
    this.renderTokens(snap, time)
    const self = snap.players[this.selfId]
    if (!self) return
    this.hud?.setScore(this.t('game.common.pts', { n: self.banked }))

    // A relayout restart mid-round restores the balloon as it is — no pump pop, burst or coin shower.
    const quiet = this.firstSnapshot
    if (self.outcomes.length !== this.lastOutcomes) {
      this.onOutcome(self, quiet)
      this.lastOutcomes = self.outcomes.length
      this.shownPumps = 0
      this.localBalloon = self.outcomes.length
      this.localPumps = 0
      this.cashingAt = -1
    }
    // A cash-out the server never answered (it should always): inputs open again.
    if (this.cashingAt >= 0 && this.time.now - this.cashingAt > CASH_WAIT_MS) this.cashingAt = -1
    // Optimistic pumps on the balloon in hand, until the server's count catches up with them.
    const mine = this.localBalloon === self.outcomes.length
    if (mine && self.pumps < this.localPumps && this.time.now - this.lastPumpAt > PUMP_CONFIRM_MS)
      this.localPumps = self.pumps
    const pumps = Math.max(self.pumps, mine ? this.localPumps : 0)
    if (pumps !== this.shownPumps) {
      if (quiet) this.setBalloonSize(pumps)
      else this.onPumped(pumps, pumps > this.shownPumps)
      this.shownPumps = pumps
    }
    this.lastBanked = self.banked
    this.renderOwnPips(self, time)

    const alive = !isDone(self) && snap.remainingMs > 0
    if (!alive && !this.over) this.showOver(self)
    this.pumper?.setExpression(this.pumperFace(self, alive)).tick(time)
    if (alive !== this.wasAlive) {
      this.wasAlive = alive
      for (const b of [this.pump, this.cash]) {
        for (const o of b ? [b.img, b.label, b.key] : []) o.setAlpha(alive ? 1 : 0.3)
      }
      this.hint?.setVisible(alive)
    }
    if (alive) this.wobble(this.shownPumps, time)
  }

  // Sweating over a big balloon, wincing at a pop, grinning at a cash-out (until the next pump).
  private pumperFace(self: BalloonPlayer, alive: boolean): AvatarExpression {
    if (!alive) return self.banked > 0 ? 'happy' : 'ko'
    if (this.shownPumps >= 10) return 'hurt'
    if (this.shownPumps > 0) return 'idle'
    const last = self.outcomes[self.outcomes.length - 1]
    return last === 'burst' ? 'hurt' : last === 'cashed' ? 'happy' : 'idle'
  }

  // Out of balloons (or time): the total, a jab at how the last one went, then the wait.
  private showOver(self: BalloonPlayer): void {
    this.over = true
    const banked = self.banked
    const last = self.outcomes[self.outcomes.length - 1]
    this.balloon?.setVisible(false)
    this.value?.setVisible(false)
    if (this.banner) {
      const color = banked > 0 ? PALETTE.lime : PALETTE.red
      showBanner(this, this.banner, this.t('game.common.pts', { n: banked }), color)
    }
    const key = last === 'cashed' ? 'game.balloon.cashLines' : 'game.balloon.bustLines'
    this.status?.setText(`${this.quip(key, this.selfId)}\n${this.t('game.common.waiting')}`)
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

  // The balloon shows `pumps`; `grew`: a new pump (stroke, lean, +10), else a quiet shrink back.
  private onPumped(pumps: number, grew: boolean): void {
    this.setBalloonSize(pumps)
    if (!this.balloon || !grew) return
    punch(this, this.balloon, 0.08, 80)
    // The pumper leans into the stroke.
    const pumper = this.pumper?.image
    if (pumper) {
      this.tweens.killTweensOf(pumper)
      pumper.setAngle(12)
      this.tweens.add({ targets: pumper, angle: 0, duration: 140, ease: 'Quad.easeOut' })
    }
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
      `+${PPP}`,
      PALETTE.lime,
      16,
    )
  }

  // A balloon just ended: it pops into shreds or floats away under a coin shower, and the next one is
  // tied on at once (the server already handed it over). `quiet`: restoring the state after a relayout
  // restart — the same look, no bang.
  private onOutcome(self: BalloonPlayer, quiet: boolean): void {
    const b = this.balloon
    const outcome = self.outcomes[self.outcomes.length - 1]
    if (!b || !outcome) return
    const gained = self.banked - this.lastBanked
    if (!quiet) {
      const cy = b.y - b.displayHeight / 2
      if (outcome === 'burst') {
        const color = this.state.colorOf(this.selfId, PALETTE.red)
        this.sfx.pop()
        // A rival popping in the same beat doesn't bang twice.
        this.rivalPopAt = this.time.now
        burst(this, this.knot.x, cy, color, 40, 420)
        burst(this, this.knot.x, cy, PALETTE.text, 12, 260)
        shake(this, 0.02, 320)
        flash(this, color, 140)
        floatText(this, this.knot.x, cy, this.t('game.balloon.pop'), PALETTE.red, 32)
        this.flashScrap()
      } else {
        this.sfx.coin()
        this.coinShower()
        floatText(this, this.knot.x, cy, `+${gained}`, PALETTE.lime, 32)
        // A copy floats away; the real one is already the next balloon.
        const ghost = this.add
          .image(b.x, b.y, b.texture.key)
          .setOrigin(0.5, 1)
          .setDisplaySize(b.displayWidth, b.displayHeight)
          .setAngle(b.angle)
          .setDepth(4)
        this.tweens.add({
          targets: ghost,
          y: `-=${this.scale.height * 0.25}`,
          alpha: 0,
          duration: 1200,
          ease: 'Sine.easeIn',
          onComplete: () => ghost.destroy(),
        })
      }
    }
    if (isDone(self)) {
      if (outcome === 'burst') this.scrap?.setAlpha(1).setVisible(true)
      return
    }
    // The next balloon: back to its smallest, popping in on the knot.
    this.setBalloonSize(0)
    b.setAngle(0)
    if (!quiet) punch(this, b, 0.3, 120)
  }

  // Rubber shreds left on the knot for a moment after a pop.
  private flashScrap(): void {
    const scrap = this.scrap
    if (!scrap) return
    this.tweens.killTweensOf(scrap)
    scrap.setVisible(true).setAlpha(1)
    this.tweens.add({ targets: scrap, alpha: 0, delay: 350, duration: 400 })
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

  // Your balloons: a coin for each cashed, shreds for each burst, the one in hand bobbing, the rest
  // waiting faded.
  private renderOwnPips(self: BalloonPlayer, time: number): void {
    const color = this.state.colorOf(this.selfId, PALETTE.red)
    this.ownPips.forEach((pip, i) => {
      const outcome = self.outcomes[i]
      const key =
        outcome === 'cashed'
          ? ensurePixelOrb(this, 'pp-balloon-coin', 8, PALETTE.amber)
          : outcome === 'burst'
            ? scrapKey(this, color)
            : balloonKey(this, color)
      if (pip.texture.key !== key) {
        const h = this.pipH
        pip.setTexture(key)
        if (outcome === 'cashed') pip.setDisplaySize(h * 0.8, h * 0.8)
        else if (outcome === 'burst') pip.setDisplaySize(h, h / 2)
        else pip.setDisplaySize(h * (14 / 17), h)
        if (!this.firstSnapshot && outcome) punch(this, pip, 0.4, 110)
      }
      const inHand = i === self.outcomes.length
      pip.setAlpha(outcome || inHand ? 1 : 0.3).setAngle(inHand ? Math.sin(time / 200) * 8 : 0)
    })
  }

  // Everyone else along the top — one row, or two in a crowd. Each token: a fixed-size balloon while
  // they still have one in hand, their avatar and name, banked points and a pip per balloon.
  private buildTokens(ids: string[]): void {
    if (ids.length === 0) return
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const perRow = Math.ceil(ids.length / this.tokenRows)
    const big = !compact && height >= 900
    const tokenW = Math.min(compact ? 100 : big ? 150 : 140, (width * 0.94) / perRow)
    const bSize = compact ? 26 : big ? 40 : 34
    const nameSize = compact ? 11 : big ? 16 : 14
    // Names are cut to what fits beside the avatar, so neighbors never overlap.
    const maxChars = Math.max(3, Math.floor((tokenW - 24) / (nameSize * 0.62)))
    ids.forEach((id, i) => {
      const row = Math.floor(i / perRow)
      const inRow = row < this.tokenRows - 1 ? perRow : ids.length - row * perRow
      const x = width / 2 + ((i % perRow) - (inRow - 1) / 2) * tokenW
      const top = this.top + 4 + row * this.tokenH
      const color = this.state.colorOf(id, PALETTE.dim)
      const balloon = this.add
        .image(x, top + bSize, balloonKey(this, color))
        .setOrigin(0.5, 1)
        .setDisplaySize(bSize * (14 / 17), bSize)
      const name = this.add
        .text(
          x + 9,
          top + bSize + 3,
          this.state.nameOf(id).slice(0, maxChars),
          bodyStyle(nameSize, color),
        )
        .setOrigin(0.5, 0)
      const icon = this.add
        .image(
          Math.round(name.x - name.width / 2 - 2),
          name.y + name.height / 2,
          ensureAvatarTexture(this, this.state.avatarOf(id), color, 1),
        )
        .setOrigin(1, 0.5)
      const valueY = name.y + name.height + 2
      const value = this.add
        .text(x, valueY, '', headlineStyle(compact ? 8 : 16, PALETTE.text))
        .setOrigin(0.5, 0)
      const pipY = valueY + (compact ? 13 : 22)
      const pips = Array.from({ length: BALLOONS }, (_, k) =>
        this.add.rectangle(x + (k - (BALLOONS - 1) / 2) * 9, pipY, 6, 6, PALETTE.panelAlt),
      )
      this.tokens.push({ id, icon, balloon, value, pips, phase: i * 1.7, outcomes: 0, key: '' })
    })
  }

  private renderTokens(snap: BalloonChickenSnapshot, time: number): void {
    for (const tok of this.tokens) {
      const p = snap.players[tok.id]
      if (!p) continue
      const done = isDone(p)
      if (!done) tok.balloon.setAngle(Math.sin(time / 300 + tok.phase) * 6)
      const key = `${p.outcomes.join(',')}:${p.banked}`
      if (key === tok.key) continue
      tok.key = key
      const color = this.state.colorOf(tok.id, PALETTE.dim)
      const last = p.outcomes[p.outcomes.length - 1]
      // A balloon just ended: shreds in their color, or a coin pop on the points.
      if (p.outcomes.length > tok.outcomes && !this.firstSnapshot) {
        const { x, y } = tok.balloon
        if (last === 'burst') {
          burst(this, x, y - tok.balloon.displayHeight / 2, color, 14, 160)
          // A rival's bang is part of the tension — but one at a time.
          if (this.time.now - this.rivalPopAt >= RIVAL_POP_EVERY_MS) {
            this.rivalPopAt = this.time.now
            this.sfx.pop()
          }
        } else {
          burst(this, tok.value.x, tok.value.y, PALETTE.amber, 10, 140)
          punch(this, tok.value, 0.4, 110)
        }
      }
      tok.outcomes = p.outcomes.length
      tok.balloon.setVisible(!done)
      const face =
        done && p.banked === 0 ? 'ko' : last === 'burst' ? 'hurt' : last ? 'happy' : 'idle'
      tok.icon.setTexture(
        ensureAvatarTexture(this, this.state.avatarOf(tok.id), color, 1, 'front', face),
      )
      tok.value
        .setText(String(p.banked))
        .setColor(hexToCss(p.banked > 0 ? PALETTE.lime : PALETTE.dim))
      tok.pips.forEach((pip, k) => {
        const outcome = p.outcomes[k]
        pip.setFillStyle(
          outcome === 'cashed'
            ? PALETTE.lime
            : outcome === 'burst'
              ? PALETTE.red
              : PALETTE.panelAlt,
        )
      })
    }
  }
}
