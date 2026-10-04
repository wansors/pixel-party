import { PALETTE, type PixelHoopsSnapshot, toleranceForShot } from '@pp/shared'
import Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { addBanner, burst, floatText, punch, ring, shake, showBanner } from '../fx'
import { bodyStyle, ensurePixelGrid, headlineStyle, hexToCss, shade } from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const CHARGE_MS = 1200
const FLIGHT_MS = 480
// How long a ball may wait at the rim for the server's verdict before it just fades out.
const VERDICT_WAIT_MS = 700
const HOT_COMBO = 3

// --- Pixel art (front view): backboard, rim (back + front halves around the ball), net, ball --------

const BOARD_W = 30
const BOARD_H = 20
const RIM_W = 16

// The everyone strip (PlayerStrip) rebuilds every chip from scratch on any change — new Text objects,
// each measuring its font again — which cost a frame per snapshot once a full room was scoring. It
// follows the scores at most twice a second; your own score in the HUD stays immediate.
const STRIP_EVERY_MS = 500

function boardRows(): string[] {
  const rows: string[] = []
  for (let y = 0; y < BOARD_H; y++) {
    let row = ''
    for (let x = 0; x < BOARD_W; x++) {
      const edge = x === 0 || y === 0 || x === BOARD_W - 1 || y === BOARD_H - 1
      // The classic shooter's square, sitting right above the rim.
      const sq = x >= 9 && x <= 20 && y >= 9 && y <= 17
      const sqEdge = sq && (x === 9 || x === 20 || y === 9 || y === 17)
      if (edge) row += 'f'
      else if (sqEdge) row += 'r'
      else row += (x + y * 2) % 11 === 0 && y < 8 ? 'g' : 'w'
    }
    rows.push(row)
  }
  return rows
}

const RIM_BACK = ['__oooooooooooo__', '_o____________o_']
const RIM_FRONT = ['o______________o', 'OhhhhhhhhhhhhhhO', '_OOOOOOOOOOOOOO_']

// A hanging mesh that tapers towards the bottom (diamond weave).
function netRows(): string[] {
  const rows: string[] = []
  for (let y = 0; y < 10; y++) {
    const inset = Math.floor(y * 0.35)
    let row = ''
    for (let x = 0; x < RIM_W; x++) {
      if (x < inset || x >= RIM_W - inset) row += '_'
      else if (x === inset || x === RIM_W - 1 - inset) row += 'n'
      else row += (x + y) % 4 === 0 || (x - y + 40) % 4 === 0 ? (y > 6 ? 'd' : 'n') : '_'
    }
    rows.push(row)
  }
  return rows
}

// A 12-cell basketball: outline, highlight and the dark seams.
function ballRows(): string[] {
  const rows: string[] = []
  const r = 6
  for (let y = 0; y < 12; y++) {
    let row = ''
    for (let x = 0; x < 12; x++) {
      const dx = x + 0.5 - r
      const dy = y + 0.5 - r
      const d = Math.hypot(dx, dy)
      if (d > r) row += '_'
      else if (d > r - 1.1) row += 'o'
      else if (
        Math.abs(dx) < 0.6 ||
        Math.abs(dy) < 0.6 ||
        Math.abs(Math.hypot(dx + 6, dy) - 4.2) < 0.5
      )
        row += 's'
      else if (dx < -1 && dy < -1 && d < r * 0.75) row += 'h'
      else row += 'b'
    }
    rows.push(row)
  }
  return rows
}

interface PendingShot {
  index: number
  power: number
  target: number
  scoreBefore: number
  ball: Phaser.GameObjects.Image
  // The flight arc; stopped when the verdict is played before the ball lands.
  flight?: Phaser.Tweens.Tween
  landed: boolean
  landedAt: number
  outcome?: { made: boolean; gained: number; combo: number }
}

// Pixel Hoops (basketball) canvas. Hold to charge the power meter (mouse/touch, Space or Enter), release
// to shoot (a charge is dropped, not fired, if the window loses focus mid-hold); match
// the green target band — it shrinks shot by shot (toleranceForShot), and the hoop rides higher for
// shots that need more power. The ball flies to the hoop along an arc that visibly reflects the power
// used (short / on target / long); once the server's make/miss verdict is in (score delta as the shot
// index advances) it swishes through the net or clanks off rim/board. Streaks light the ball on fire.
export class PixelHoopsScene extends MiniGameScene<PixelHoopsSnapshot> {
  private board?: Phaser.GameObjects.Image
  private rimBack?: Phaser.GameObjects.Image
  private rimFront?: Phaser.GameObjects.Image
  private net?: Phaser.GameObjects.Image
  private pole?: Phaser.GameObjects.Rectangle
  private hand?: Phaser.GameObjects.Image
  private meterFill?: Phaser.GameObjects.Graphics
  private band?: Phaser.GameObjects.Rectangle
  private bandArrow?: Phaser.GameObjects.Text
  private comboText?: Phaser.GameObjects.Text
  private hint?: Phaser.GameObjects.Text
  private waitText?: Phaser.GameObjects.Text
  private banner?: Phaser.GameObjects.Text
  // Everyone's score at a glance (avatar + name + points) under the HUD.
  private strip?: PlayerStrip
  private stripSnap?: PixelHoopsSnapshot
  private scoreSnap?: PixelHoopsSnapshot
  private stripAt = 0
  // Whether the meter currently shows a charge (so an idle meter is cleared once, not every frame).
  private meterShown = false
  // The shot the target band is placed for.
  private bandFor = -1
  private ballKey = ''
  private fireKey = ''
  private cell = 4
  private rimX = 0
  private hoopHi = 0
  private hoopLo = 0
  private floorY = 0
  private restX = 0
  // You: your avatar beside the ball, facing the hoop (happy on a basket, hurt on a miss).
  private shooter?: AvatarSprite
  private faceUntil = 0
  private face: 'happy' | 'hurt' = 'happy'
  private restY = 0
  private ballSize = 0
  private meterX = 0
  private meterW = 0
  private meterTop = 0
  private meterBottom = 0
  // Displayed hoop height as a 0..1 power target (tweened between shots).
  private hoop = { t: 0.5 }
  private hoopFor = -1
  private charging = false
  private chargeStart = 0
  private chargeStep = 0
  private pending?: PendingShot
  // Index of the shot just released: no second shot until the server moves this player on (a re-shot
  // of the same index would only be dropped as stale).
  private shotIndex = -1
  private lastCombo = 0
  private done = false

  constructor(...deps: SceneDeps) {
    super('pixel-hoops', ...deps)
  }

  override create(): void {
    super.create()
    this.charging = false
    this.pending = undefined
    this.shotIndex = -1
    this.lastCombo = 0
    this.hoopFor = -1
    this.hoop = { t: 0.5 }
    this.done = false
    this.stripSnap = undefined
    this.scoreSnap = undefined
    this.stripAt = 0
    this.meterShown = false
    this.bandFor = -1

    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    // Everyone's chips read from the couch on a big (1080p) canvas.
    const stripSize = compact ? 11 : width >= 1400 && height >= 860 ? 16 : 13
    const stripRows = width < 600 ? 3 : 2
    const stripH = PlayerStrip.rowH(stripSize)
    this.strip = new PlayerStrip(
      this,
      width / 2,
      this.top + 2 + stripH / 2,
      width - 24,
      stripSize,
      stripRows,
    )
    const top = this.top + stripRows * stripH + 2
    // Art pixel size: bigger on a big canvas (1080p).
    this.cell = compact ? 3 : width >= 1400 && height >= 860 ? 6 : height > 640 ? 5 : 4
    const legendFire = { o: 0x7a1f10, b: PALETTE.orange, h: PALETTE.amber, s: PALETTE.red }
    this.ballKey = ensurePixelGrid(this, {
      key: `pp-hoops-ball-${this.cell}`,
      rows: ballRows(),
      legend: { o: 0x5a2a10, b: 0xe8772e, h: 0xffb070, s: 0x3a1a08 },
      pixelSize: this.cell,
    })
    this.fireKey = ensurePixelGrid(this, {
      key: `pp-hoops-fire-${this.cell}`,
      rows: ballRows(),
      legend: legendFire,
      pixelSize: this.cell,
    })

    // Court floor: wood planks + the free-throw line.
    const floorH = compact ? 64 : 76
    this.floorY = height - floorH
    this.add.rectangle(0, this.floorY, width, floorH, 0x5a3a22).setOrigin(0, 0)
    const planks = this.add.graphics()
    planks.fillStyle(0x6e4a2c, 1)
    for (let y = this.floorY + 10; y < height; y += 14) planks.fillRect(0, y, width, 2)
    planks.fillStyle(0x3e2716, 1)
    for (let x = 30; x < width; x += 90) planks.fillRect(x, this.floorY + 4, 2, floorH)
    this.add.rectangle(0, this.floorY, width, 4, PALETTE.text).setOrigin(0, 0).setAlpha(0.85)

    // Power meter on the right: frame, draining track, fill and the target band.
    this.meterW = compact ? 30 : 40
    this.meterX = width - (compact ? 16 : 28) - this.meterW / 2
    this.meterTop = top + (compact ? 28 : 40)
    this.meterBottom = this.floorY - (compact ? 20 : 26)
    const meterH = this.meterBottom - this.meterTop
    this.add
      .rectangle(
        this.meterX,
        this.meterTop + meterH / 2,
        this.meterW + 8,
        meterH + 8,
        PALETTE.panel,
      )
      .setStrokeStyle(4, PALETTE.frameLit)
    this.band = this.add
      .rectangle(this.meterX, this.meterBottom, this.meterW, 10, PALETTE.lime, 0.35)
      .setStrokeStyle(2, PALETTE.lime)
      .setDepth(2)
    this.bandArrow = this.add
      .text(
        this.meterX - this.meterW / 2 - 6,
        this.meterBottom,
        '▶',
        headlineStyle(16, PALETTE.lime),
      )
      .setOrigin(1, 0.5)
    this.meterFill = this.add.graphics().setDepth(1)

    // Hoop assembly, centred in the play area left of the meter.
    const playRight = this.meterX - this.meterW / 2 - (compact ? 20 : 40)
    this.rimX = Math.round((16 + playRight) / 2)
    const boardH = BOARD_H * this.cell
    this.hoopHi = top + boardH + (compact ? 30 : 40)
    this.hoopLo = this.floorY - (compact ? 150 : 210)
    const boardKey = ensurePixelGrid(this, {
      key: `pp-hoops-board-${this.cell}`,
      rows: boardRows(),
      legend: { f: 0x8d95b5, w: 0xdfe8f3, g: 0xffffff, r: PALETTE.red },
      pixelSize: this.cell,
    })
    const rimLegend = { o: 0xa8431c, O: 0xd9541f, h: 0xff8a3d }
    this.pole = this.add.rectangle(this.rimX, 0, this.cell * 4, 10, 0x4a4f72).setOrigin(0.5, 0)
    this.board = this.add.image(this.rimX, 0, boardKey).setOrigin(0.5, 1)
    this.rimBack = this.add
      .image(
        this.rimX,
        0,
        ensurePixelGrid(this, {
          key: `pp-hoops-rimb-${this.cell}`,
          rows: RIM_BACK,
          legend: rimLegend,
          pixelSize: this.cell,
        }),
      )
      .setOrigin(0.5, 1)
      .setDepth(3)
    this.net = this.add
      .image(
        this.rimX,
        0,
        ensurePixelGrid(this, {
          key: `pp-hoops-net-${this.cell}`,
          rows: netRows(),
          legend: { n: PALETTE.text, d: 0x9aa2cc },
          pixelSize: this.cell,
        }),
      )
      .setOrigin(0.5, 0)
      .setDepth(6)
    this.rimFront = this.add
      .image(
        this.rimX,
        0,
        ensurePixelGrid(this, {
          key: `pp-hoops-rimf-${this.cell}`,
          rows: RIM_FRONT,
          legend: rimLegend,
          pixelSize: this.cell,
        }),
      )
      .setOrigin(0.5, 0.5)
      .setDepth(7)

    // The ball in hand, resting on the free-throw line.
    this.ballSize = 12 * this.cell * (compact ? 1.6 : 1.5)
    // Off to the side of the pole, so the ball in hand never reads as stuck on it.
    this.restX = Math.max(
      16 + this.ballSize / 2,
      this.rimX - Math.max(this.ballSize * 1.2, (playRight - 16) * 0.22),
    )
    this.restY = this.floorY - this.ballSize / 2 - 6
    this.hand = this.add
      .image(this.restX, this.restY, this.ballKey)
      .setDisplaySize(this.ballSize, this.ballSize)
      .setDepth(8)
    const shooterPx = avatarPx(this.ballSize * 1.3)
    this.shooter = new AvatarSprite(
      this,
      this.state.avatarOf(this.selfId),
      this.state.colorOf(this.selfId),
      shooterPx,
      'side',
    )
    this.shooter.image
      .setOrigin(0.5, 1)
      .setPosition(
        Math.max(shooterPx / 2, this.restX - this.ballSize * 0.5 - shooterPx * 0.4),
        this.floorY,
      )
      .setDepth(7)
    this.faceUntil = 0

    this.comboText = this.add
      .text(16, top + (compact ? 14 : 20), '', headlineStyle(16, PALETTE.amber))
      .setOrigin(0, 0.5)
    this.hint = this.add
      .text(
        width / 2,
        this.floorY + floorH / 2 + 6,
        this.t(compact ? 'game.pixelHoops.hint' : 'game.pixelHoops.keys'),
        bodyStyle(compact ? 12 : 15, PALETTE.text, { stroke: '#10121c', strokeThickness: 3 }),
      )
      .setOrigin(0.5)
    this.waitText = this.add
      .text(
        width / 2,
        height / 2 + (compact ? 44 : 56),
        '',
        bodyStyle(compact ? 14 : 18, PALETTE.text, { stroke: '#10121c', strokeThickness: 4 }),
      )
      .setOrigin(0.5)
      .setDepth(951)
    this.banner = addBanner(this)
    // The kit's 34px banner overflows a phone on longer words ("¡TERMINADO!").
    if (compact) this.banner.setFontSize(24)
    this.placeHoop()

    this.input.on('pointerdown', () => this.startCharge())
    this.input.on('pointerup', () => this.release())
    this.input.on('pointerupoutside', () => this.release())
    for (const k of ['SPACE', 'ENTER']) {
      this.onKey(k, () => this.startCharge())
      this.input.keyboard?.on(`keyup-${k}`, () => this.release())
    }
    // Focus lost mid-hold (alt-tab): the key-up never arrives, so drop the charge instead of letting
    // it sit at full power and fire on the next press.
    const drop = (): void => this.dropCharge()
    this.game.events.on(Phaser.Core.Events.BLUR, drop)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.game.events.off(Phaser.Core.Events.BLUR, drop),
    )
  }

  private dropCharge(): void {
    if (!this.charging) return
    this.charging = false
    this.hand?.setDisplaySize(this.ballSize, this.ballSize)
    this.drawMeter(0, false)
  }

  private hoopY(t: number): number {
    return this.hoopLo + (this.hoopHi - this.hoopLo) * t
  }

  private meterY(p: number): number {
    return this.meterBottom - p * (this.meterBottom - this.meterTop)
  }

  // Positions the hoop assembly at the displayed height (rim y = the power line it stands for).
  private placeHoop(): void {
    const y = this.hoopY(this.hoop.t)
    const rimTop = y - this.cell
    this.board?.setPosition(this.rimX, rimTop + this.cell * 2)
    this.rimBack?.setPosition(this.rimX, y)
    this.rimFront?.setPosition(this.rimX, y + this.cell * 0.5)
    this.net?.setPosition(this.rimX, y + this.cell)
    const poleTop = rimTop + this.cell * 2
    this.pole
      ?.setPosition(this.rimX, poleTop)
      .setSize(this.cell * 4, Math.max(0, this.floorY - poleTop))
  }

  private moveHoopTo(t: number, index: number): void {
    if (this.hoopFor === index) return
    const first = this.hoopFor === -1
    this.hoopFor = index
    this.tweens.killTweensOf(this.hoop)
    if (first) {
      this.hoop.t = t
      this.placeHoop()
      return
    }
    this.tweens.add({
      targets: this.hoop,
      t,
      duration: 220,
      ease: 'Back.easeOut',
      onUpdate: () => this.placeHoop(),
    })
  }

  private power(): number {
    return Math.min(1, (this.time.now - this.chargeStart) / CHARGE_MS)
  }

  private currentShot() {
    return this.snap?.shots[this.selfId] ?? null
  }

  private startCharge(): void {
    const shot = this.currentShot()
    if (this.charging || !shot || shot.index === this.shotIndex) return
    this.charging = true
    this.chargeStart = this.time.now
    this.chargeStep = 0
    // Lining up a new shot: bring the hoop to it right away.
    this.moveHoopTo(shot.distance, shot.index)
  }

  private release(): void {
    if (!this.charging) return
    this.charging = false
    const shot = this.currentShot()
    if (!shot) return
    const power = this.power()
    this.shotIndex = shot.index
    // The ball leaves the hand.
    this.sfx.whoosh()
    this.sendInput({ kind: 'shoot', index: shot.index, power })
    this.launch(shot.index, power, shot.distance)
  }

  // The ball's arc ends where this power would carry it: at the rim when on target, below it (front
  // rim) when short, above it (backboard) when long.
  private launch(index: number, power: number, target: number): void {
    // A quick follow-up shot: the previous ball plays its verdict now instead of vanishing mid-air.
    const prev = this.pending
    if (prev) {
      this.settle(prev)
      if (prev.outcome) this.resolve(prev)
      else this.fadeBall(prev)
    }
    const hot = this.lastCombo >= HOT_COMBO
    const ball = this.add
      .image(this.restX, this.restY, hot ? this.fireKey : this.ballKey)
      .setDisplaySize(this.ballSize, this.ballSize)
      .setDepth(8)
    this.hand?.setVisible(false)
    const pending: PendingShot = {
      index,
      power,
      target,
      scoreBefore: this.snap?.scores[this.selfId] ?? 0,
      ball,
      landed: false,
      landedAt: 0,
    }
    this.pending = pending
    const rimY = this.hoopY(this.hoop.t)
    const miss = power - target
    const endY = Phaser.Math.Clamp(
      rimY - this.ballSize * 0.35 - miss * (this.hoopLo - this.hoopHi) * 1.2,
      this.top + 10,
      this.floorY - 20,
    )
    const endX = this.rimX + Phaser.Math.Clamp(miss, -0.2, 0.2) * 60
    const start = new Phaser.Math.Vector2(this.restX, this.restY)
    const end = new Phaser.Math.Vector2(endX, endY)
    const control = new Phaser.Math.Vector2((start.x + end.x) / 2, Math.min(start.y, end.y) - 120)
    const path = new Phaser.Curves.QuadraticBezier(start, control, end)
    const size = this.ballSize
    // Fire trail: one small puff every other twelfth of the flight (not one per frame in between).
    let lastPuff = -1
    pending.flight = this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: FLIGHT_MS,
      ease: 'Sine.easeIn',
      onUpdate: (tw) => {
        const v = tw.getValue() ?? 0
        const p = path.getPoint(v)
        // Shrinks as it travels away from the shooter (front view).
        const s = size * (1 - 0.35 * v)
        ball
          .setPosition(p.x, p.y)
          .setAngle(v * 540)
          .setDisplaySize(s, s)
        const step = Math.floor(v * 12)
        if (hot && step % 2 === 0 && step !== lastPuff) {
          lastPuff = step
          burst(this, p.x, p.y, PALETTE.orange, 2, 40)
        }
      },
      onComplete: () => {
        pending.landed = true
        pending.landedAt = this.time.now
      },
    })
    // A fresh ball appears in hand shortly after.
    this.time.delayedCall(260, () => {
      if (this.currentShot())
        this.hand
          ?.setVisible(true)
          .setTexture(this.lastCombo >= HOT_COMBO ? this.fireKey : this.ballKey)
    })
  }

  protected frame(snap: PixelHoopsSnapshot | null, time: number): void {
    this.shooter?.setExpression(time < this.faceUntil ? this.face : 'idle').tick(time)
    if (!snap) return
    // Scores change only with a snapshot: the HUD chip follows each one, the strip is throttled.
    if (snap !== this.scoreSnap) {
      this.scoreSnap = snap
      this.hud?.setScore(this.t('game.common.pts', { n: snap.scores[this.selfId] ?? 0 }))
    }
    const now = this.time.now
    if (snap !== this.stripSnap && (now >= this.stripAt || this.state.final)) {
      this.stripSnap = snap
      this.stripAt = now + STRIP_EVERY_MS
      this.strip?.set(
        Object.keys(snap.scores).map((id) => ({
          text: `${this.label(id)} ${snap.scores[id] ?? 0}`,
          avatar: this.state.avatarOf(id),
          color: this.state.colorOf(id),
        })),
      )
    }
    const shot = snap.shots[this.selfId] ?? null
    const combo = snap.combos[this.selfId] ?? 0

    const p = this.pending
    if (p) this.settle(p)
    if (p?.landed) {
      if (p.outcome) this.resolve(p)
      else if (this.time.now - p.landedAt > VERDICT_WAIT_MS) this.fadeBall(p)
    }
    if (combo !== this.lastCombo) this.showCombo(combo)
    this.lastCombo = combo

    if (!shot) {
      // Out of shots — or a spectator, not in this round at all.
      this.showDone(!(this.selfId in snap.shots))
      return
    }
    // Keep the hoop on the ball in flight; afterwards (or once charging) it moves to the next shot.
    if (!this.pending) this.moveHoopTo(shot.distance, shot.index)

    // Target band = exactly the window the server accepts for this shot (placed once per shot).
    const tol = toleranceForShot(shot.index)
    if (shot.index !== this.bandFor) {
      this.bandFor = shot.index
      const bandTop = this.meterY(Math.min(1, shot.distance + tol))
      const bandBottom = this.meterY(Math.max(0, shot.distance - tol))
      this.band
        ?.setPosition(this.meterX, (bandTop + bandBottom) / 2)
        .setSize(this.meterW, Math.max(6, bandBottom - bandTop))
      this.bandArrow?.setY(this.meterY(shot.distance))
    }

    const power = this.charging ? this.power() : 0
    const inBand = this.charging && Math.abs(power - shot.distance) < tol
    this.drawMeter(power, inBand)
    if (this.charging) {
      // Rising tones every quarter of the charge; the ball squashes in hand.
      const step = Math.floor(power * 4)
      if (step > this.chargeStep) {
        this.chargeStep = step
        this.sfx.pad(step - 1)
      }
      this.hand?.setDisplaySize(
        this.ballSize * (1 + 0.1 * power),
        this.ballSize * (1 - 0.14 * power),
      )
    } else {
      this.hand?.setDisplaySize(this.ballSize, this.ballSize)
    }
  }

  // Segmented pixel fill; turns lime while the charge sits inside the target band.
  private drawMeter(power: number, inBand: boolean): void {
    const g = this.meterFill
    if (!g || (power <= 0 && !this.meterShown)) return
    g.clear()
    this.meterShown = power > 0
    if (power <= 0) return
    const seg = 6
    const gap = 2
    const y0 = this.meterBottom
    const top = this.meterY(power)
    g.fillStyle(inBand ? PALETTE.lime : PALETTE.amber, 1)
    for (let y = y0; y > top; y -= seg + gap) {
      const h = Math.min(seg, y - top)
      g.fillRect(this.meterX - this.meterW / 2 + 4, y - h, this.meterW - 8, h)
    }
  }

  // The server's verdict for a ball in flight, once this player's shot index has moved on (score delta).
  private settle(p: PendingShot): void {
    const snap = this.snap
    if (p.outcome || !snap) return
    const shot = snap.shots[this.selfId] ?? null
    if (shot !== null && shot.index <= p.index) return
    const score = snap.scores[this.selfId] ?? 0
    const combo = snap.combos[this.selfId] ?? 0
    p.outcome = { made: score > p.scoreBefore, gained: score - p.scoreBefore, combo }
  }

  private resolve(p: PendingShot): void {
    if (this.pending === p) this.pending = undefined
    p.flight?.stop()
    const outcome = p.outcome
    if (!outcome) return
    const rimY = this.hoopY(this.hoop.t)
    const ball = p.ball
    this.face = outcome.made ? 'happy' : 'hurt'
    this.faceUntil = this.time.now + 900
    if (outcome.made) {
      this.sfx.coin()
      // Drop through the net: behind the front rim + net, in front of the back rim.
      ball.setDepth(5).setPosition(this.rimX, rimY - this.cell)
      this.tweens.add({
        targets: ball,
        y: rimY + this.cell * 14,
        alpha: { from: 1, to: 0 },
        duration: 320,
        ease: 'Quad.easeIn',
        onComplete: () => ball.destroy(),
      })
      if (this.net) {
        this.tweens.add({
          targets: this.net,
          scaleY: 1.3,
          scaleX: 0.9,
          duration: 110,
          yoyo: true,
          ease: 'Quad.easeOut',
        })
      }
      ring(this, this.rimX, rimY, PALETTE.lime, 60)
      burst(this, this.rimX, rimY, PALETTE.amber, 14, 200)
      floatText(this, this.rimX, rimY - 40, this.t('game.pixelHoops.swishShort'), PALETTE.lime, 24)
      floatText(this, this.rimX + 70, rimY - 10, `+${outcome.gained}`, PALETTE.amber, 16)
      if (outcome.combo >= HOT_COMBO && outcome.combo % HOT_COMBO === 0) {
        // On fire: the next balls burn.
        this.sfx.powerUp()
        burst(this, this.rimX, rimY, PALETTE.orange, 20, 300)
      }
      return
    }
    // Clank off the rim / backboard, then a dull bounce on the floor.
    this.sfx.bounce(0.8)
    this.time.delayedCall(300, () => this.sfx.bounce(0.1))
    shake(this, 0.004, 120)
    floatText(this, this.rimX, rimY - 40, this.t('game.common.miss'), PALETTE.red, 24)
    burst(this, ball.x, ball.y, PALETTE.dim, 6, 90)
    // Clank: off the front rim (short) or the backboard (long), then down to the floor.
    const dir = p.power < p.target ? -1 : 1
    this.tweens.add({
      targets: ball,
      x: ball.x + dir * 90,
      y: this.floorY - this.ballSize * 0.3,
      angle: ball.angle + dir * 360,
      duration: 520,
      ease: 'Bounce.easeOut',
    })
    this.tweens.add({
      targets: ball,
      alpha: 0,
      delay: 420,
      duration: 200,
      onComplete: () => ball.destroy(),
    })
  }

  private fadeBall(p: PendingShot): void {
    if (this.pending === p) this.pending = undefined
    p.flight?.stop()
    this.tweens.add({
      targets: p.ball,
      alpha: 0,
      duration: 200,
      onComplete: () => p.ball.destroy(),
    })
  }

  private showCombo(combo: number): void {
    if (!this.comboText) return
    if (combo >= 2) {
      this.comboText.setText(this.t('game.common.combo', { n: combo })).setVisible(true)
      this.comboText.setColor(hexToCss(combo >= HOT_COMBO ? PALETTE.orange : PALETTE.amber))
      punch(this, this.comboText, 0.3, 100)
    } else {
      this.comboText.setVisible(false)
    }
  }

  private showDone(spectator: boolean): void {
    this.hand?.setVisible(false)
    this.charging = false
    this.drawMeter(0, false)
    this.band?.setVisible(false)
    this.bandArrow?.setVisible(false)
    this.hint?.setVisible(false)
    if (this.done) return
    this.done = true
    this.waitText?.setText(this.t('game.common.waiting'))
    if (spectator) return
    if (this.banner) showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.lime)
    if (this.firstSnapshot) return // relayout restart: the end state, without the fanfare
    this.sfx.cheer()
    burst(this, this.scale.width / 2, this.scale.height / 2, shade(PALETTE.amber, 0.2), 24, 260)
  }
}
