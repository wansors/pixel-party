import {
  PALETTE,
  SHOOT,
  SHOOT_SPOTS,
  type ShootKind,
  type ShootSnapshot,
  type ShootTarget,
  shootHit,
  shootNerves,
  shootSway,
  shootTargetAt,
} from '@pp/shared'
import Phaser from 'phaser'
import { addBanner, burst, flash, floatText, showBanner } from '../fx'
import { ServerClock } from '../netcode/ServerClock'
import {
  bodyStyle,
  ensurePixelGrid,
  fitFontSize,
  fitText,
  headlineStyle,
  shade,
} from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

type KeyName = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'W' | 'A' | 'S' | 'D' | 'SHIFT' | 'SPACE'

const HAND_SPEED = 0.95 // world units/s with the keyboard
const RECOIL = 0.06
const RECOIL_MS = 260
const WALL = 0x8a5a34
const WALL_DARK = 0x5e3b20
const INSIDE = 0x1d1410

const BANDIT = [
  '....kkkk....',
  '...kkkkkk...',
  '.kkkkkkkkkk.',
  '...ssssss...',
  '...sesses...',
  '...ssssss...',
  '..rrrrrrrr..',
  '..rrrrrrrr..',
  '.bbbbbbbbbb.',
  '.bbbbybbbbgg',
  '.bbbbbbbbbb.',
  '.bbbbbbbbbb.',
  '..bbb..bbb..',
  '..bbb..bbb..',
  '..kk....kk..',
  '............',
]
const CIVILIAN = [
  '...pppppp...',
  '..pppppppp..',
  '.pppssssppp.',
  '..pssssssp..',
  '...sesses...',
  '...ssmmss...',
  '..wwwwwwww..',
  '.dddddddddd.',
  '.ddwddddwdd.',
  '.dddddddddd.',
  '..dddddddd..',
  '..dddddddd..',
  '...dddddd...',
  '....s..s....',
  '....s..s....',
  '............',
]
const BOTTLE = [
  '..c..',
  '..g..',
  '..g..',
  '.ggg.',
  'ggggg',
  'ghggg',
  'ghggg',
  'ggggg',
  'ggggg',
  'ggggg',
  'ggggg',
  '.ggg.',
]
const CAN = ['.mmmm.', 'mmmmmm', 'rrrrrr', 'rwwrrr', 'rrrrrr', 'mmmmmm', 'mhmmmm', '.mmmm.']

interface TargetSprite {
  tg: ShootTarget
  img: Phaser.GameObjects.Image
  // Shot down on this screen (it falls / shatters and stays out of the hit test).
  down: boolean
}

// Sharpshooter canvas (D45): a sunset Western street — the saloon on the left, the store on the right,
// a fence between them — on one 16:9 stage, letterboxed. Targets follow the server's clock (each one's
// position is a pure function of time): cardboard bandits and townsfolk rise behind window sills and
// batwing doors, bottles stand on the fence, cans arc across the sky. Your crosshair rides your mouse
// (or arrows / WASD) and BREATHES — a slow figure-eight from the shared shootSway, wider as nerves
// grow; hold SHIFT or the right button to steady it until your lungs give out (then you gasp). Click /
// SPACE fires the six-shooter (recoil kick, a hole, the target drops at once — the server confirms
// the score), R reloads. Rivals' hits show as holes in their colors.
export class SharpshooterScene extends MiniGameScene<ShootSnapshot> {
  private stage = { x: 0, y: 0, unit: 0 }
  private readonly clock = new ServerClock()
  private sprites = new Map<number, TargetSprite>()
  private cross?: Phaser.GameObjects.Graphics
  private hud2?: Phaser.GameObjects.Graphics
  private reloadText?: Phaser.GameObjects.Text
  private banner?: Phaser.GameObjects.Text
  private shownHoles = new Set<string>()
  // Hand (where the mouse / keys point), world units.
  private hand = { x: SHOOT.w / 2, y: 0.5 }
  private lungs = 1
  private steady = 0
  private gaspUntil = -1
  private holding = false
  private recoilAt = -1e9
  private rivalShotAt = -1e9
  // The six-shooter as this screen sees it (resynced from the snapshot when idle).
  private ammo: number = SHOOT.ammo
  private reloadUntil = 0
  private lastShot = -1e9
  private done = new Set<number>()
  private phase = 0
  private ready = false
  private lastTick = -1
  private keys?: Record<KeyName, Phaser.Input.Keyboard.Key>
  private compact = false

  constructor(...deps: SceneDeps) {
    super('sharpshooter', ...deps)
  }

  override create(): void {
    super.create()
    for (const s of this.sprites.values()) s.img.destroy()
    this.sprites = new Map()
    this.shownHoles = new Set()
    this.clock.reset()
    this.hand = { x: SHOOT.w / 2, y: 0.5 }
    this.lungs = 1
    this.steady = 0
    this.gaspUntil = -1
    this.holding = false
    this.recoilAt = -1e9
    this.rivalShotAt = -1e9
    this.ammo = SHOOT.ammo
    this.reloadUntil = 0
    this.lastShot = -1e9
    this.done = new Set()
    this.ready = false
    this.lastTick = -1
    // Everyone breathes to their own rhythm.
    this.phase = [...this.selfId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 6283, 7) / 1000

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    const hintH = this.compact ? 20 : 26
    const top = this.top + 4
    const availH = height - top - hintH - 4
    const unit = Math.floor(Math.min(availH, width / SHOOT.w))
    this.stage = {
      x: Math.round((width - unit * SHOOT.w) / 2),
      y: Math.round(top + (availH - unit) / 2),
      unit,
    }
    this.textureSet()
    this.paintBack()
    this.paintFront()
    this.cross = this.add.graphics().setDepth(900)
    this.hud2 = this.add.graphics().setDepth(890)
    this.reloadText = this.add
      .text(
        0,
        0,
        this.t('game.sharpshooter.reloading'),
        headlineStyle(this.compact ? 8 : 12, PALETTE.amber, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setDepth(901)
      .setVisible(false)
    const hint = this.add
      .text(
        width / 2,
        height - hintH / 2,
        this.t('game.sharpshooter.hint'),
        bodyStyle(this.compact ? 10 : 13, PALETTE.dim),
      )
      .setOrigin(0.5)
    fitText(hint, width - 16, this.compact ? 10 : 13)
    this.banner = addBanner(this)
    this.banner.setPosition(width / 2, this.sy(0.3))

    this.input.setDefaultCursor('none')
    this.input.mouse?.disableContextMenu()
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.hand = { x: this.wx(p.x), y: this.wy(p.y) }
    })
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        this.holding = true
        return
      }
      this.hand = { x: this.wx(p.x), y: this.wy(p.y) }
      this.fire()
    })
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!p.rightButtonDown()) this.holding = this.keys?.SHIFT.isDown === true
    })
    for (const k of ['SPACE', 'ENTER', 'F']) this.onKey(k, () => this.fire())
    this.onKey('R', () => this.reload())
    this.keys = this.input.keyboard?.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,SHIFT,SPACE') as
      | Record<KeyName, Phaser.Input.Keyboard.Key>
      | undefined
    // Held keys let go when the window loses focus; the system cursor comes back when the scene goes.
    const onBlur = (): void => {
      this.holding = false
    }
    this.game.events.on(Phaser.Core.Events.BLUR, onBlur)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.BLUR, onBlur)
      this.input.setDefaultCursor('default')
    })
  }

  private sx(x: number): number {
    return this.stage.x + x * this.stage.unit
  }
  private sy(y: number): number {
    return this.stage.y + y * this.stage.unit
  }
  private wx(px: number): number {
    return Phaser.Math.Clamp((px - this.stage.x) / this.stage.unit, 0, SHOOT.w)
  }
  private wy(py: number): number {
    return Phaser.Math.Clamp((py - this.stage.y) / this.stage.unit, 0, 1)
  }

  private textureSet(): void {
    ensurePixelGrid(this, {
      key: 'pp-shoot-bandit',
      rows: BANDIT,
      legend: {
        k: 0x2a1d14,
        s: 0xe0a070,
        e: 0x1a1010,
        r: 0xc0392b,
        b: 0x6b4a2a,
        y: PALETTE.amber,
        g: 0x9aa0b0,
      },
    })
    ensurePixelGrid(this, {
      key: 'pp-shoot-civilian',
      rows: CIVILIAN,
      legend: { p: 0xff8fb8, s: 0xe0a070, e: 0x1a1010, m: 0xd0506a, w: 0xffffff, d: 0x3d7fd8 },
    })
    ensurePixelGrid(this, {
      key: 'pp-shoot-bottle',
      rows: BOTTLE,
      legend: { c: 0x8b5a2b, g: 0x2e8b57, h: 0x9fe0b0 },
    })
    ensurePixelGrid(this, {
      key: 'pp-shoot-can',
      rows: CAN,
      legend: { m: 0x9aa0a8, h: 0xd8dde3, r: 0xc0392b, w: 0xffffff },
    })
  }

  // Sky, sun, mesas, the street, and the buildings' walls with dark openings (targets go over these).
  private paintBack(): void {
    const g = this.add.graphics().setDepth(0)
    const { unit } = this.stage
    const W = SHOOT.w
    const bands = 10
    for (let i = 0; i < bands; i++) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(0x2b1d4a),
        Phaser.Display.Color.ValueToColor(0xff9a4d),
        bands - 1,
        i,
      )
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1)
      g.fillRect(this.sx(0), this.sy((0.6 * i) / bands), W * unit, (0.6 * unit) / bands + 1)
    }
    g.fillStyle(0xffd27a, 1).fillCircle(this.sx(0.92), this.sy(0.42), unit * 0.07)
    // Mesas.
    g.fillStyle(0x7a3b3b, 1)
    for (const [x0, x1, top] of [
      [0.0, 0.35, 0.47],
      [0.62, 1.05, 0.5],
      [1.25, 1.78, 0.45],
    ] as const) {
      g.fillRect(this.sx(x0), this.sy(top), (x1 - x0) * unit, (0.62 - top) * unit)
      g.fillRect(
        this.sx(x0 - 0.04),
        this.sy(top + 0.06),
        (x1 - x0 + 0.08) * unit,
        (0.56 - top) * unit,
      )
    }
    // Street.
    g.fillStyle(0xd8a65a, 1).fillRect(this.sx(0), this.sy(0.6), W * unit, 0.4 * unit)
    g.fillStyle(0xc89448, 1)
    for (let y = 0.64; y < 1; y += 0.07)
      g.fillRect(this.sx(0), this.sy(y), W * unit, Math.max(2, unit * 0.006))
    // Buildings: saloon (left) and store (right), plank walls.
    for (const [x0, x1, top] of [
      [0.08, 0.7, 0.2],
      [1.1, 1.72, 0.24],
    ] as const) {
      g.fillStyle(WALL, 1).fillRect(
        this.sx(x0),
        this.sy(top),
        (x1 - x0) * unit,
        (0.84 - top) * unit,
      )
      g.fillStyle(WALL_DARK, 1)
      for (let y = top + 0.035; y < 0.84; y += 0.035)
        g.fillRect(this.sx(x0), this.sy(y), (x1 - x0) * unit, Math.max(1, unit * 0.004))
      // False front and roof line.
      g.fillStyle(shade(WALL, 0.15), 1).fillRect(
        this.sx(x0 - 0.01),
        this.sy(top - 0.02),
        (x1 - x0 + 0.02) * unit,
        0.03 * unit,
      )
    }
    // Dark openings behind every window and door.
    g.fillStyle(INSIDE, 1)
    SHOOT_SPOTS.forEach((s) => {
      if (s.kind === 'window')
        g.fillRect(this.sx(s.x - 0.075), this.sy(s.y - 0.11), 0.15 * unit, 0.18 * unit)
      if (s.kind === 'door')
        g.fillRect(
          this.sx(s.x - 0.08),
          this.sy(s.y - 0.14),
          0.16 * unit,
          (0.84 - s.y + 0.14) * unit,
        )
    })
    // Signs.
    const sign = (x: number, y: number, key: string): void => {
      g.fillStyle(0x3b2414, 1).fillRect(
        this.sx(x - 0.16),
        this.sy(y - 0.035),
        0.32 * unit,
        0.07 * unit,
      )
      const text = this.t(key)
      const label = this.add
        .text(
          this.sx(x),
          this.sy(y),
          text,
          headlineStyle(fitFontSize(text, 0.28 * unit, this.compact ? 8 : 16), PALETTE.amber),
        )
        .setOrigin(0.5)
        .setDepth(1)
      // Still too wide at the smallest crisp size (a long word on a phone): squeeze it onto the board.
      label.setScale(Math.min(1, (0.28 * unit) / label.width))
    }
    sign(0.39, 0.25, 'game.sharpshooter.saloon')
    sign(1.41, 0.29, 'game.sharpshooter.store')
  }

  // What stands in front of the targets: the wall under each window sill, batwing doors, the
  // boardwalk, the fence; barrels and a cactus for the look.
  private paintFront(): void {
    const g = this.add.graphics().setDepth(3)
    const { unit } = this.stage
    SHOOT_SPOTS.forEach((s) => {
      if (s.kind === 'window') {
        g.fillStyle(WALL, 1).fillRect(
          this.sx(s.x - 0.09),
          this.sy(s.y + 0.07),
          0.18 * unit,
          0.2 * unit,
        )
        g.fillStyle(WALL_DARK, 1)
        for (let y = s.y + 0.1; y < s.y + 0.27; y += 0.035)
          g.fillRect(this.sx(s.x - 0.09), this.sy(y), 0.18 * unit, Math.max(1, unit * 0.004))
        g.fillStyle(0xd9c08a, 1).fillRect(
          this.sx(s.x - 0.09),
          this.sy(s.y + 0.06),
          0.18 * unit,
          0.02 * unit,
        )
        // Frame posts.
        g.fillStyle(0xd9c08a, 1)
        g.fillRect(this.sx(s.x - 0.085), this.sy(s.y - 0.115), 0.012 * unit, 0.18 * unit)
        g.fillRect(this.sx(s.x + 0.073), this.sy(s.y - 0.115), 0.012 * unit, 0.18 * unit)
        g.fillRect(this.sx(s.x - 0.085), this.sy(s.y - 0.12), 0.17 * unit, 0.012 * unit)
      } else if (s.kind === 'door') {
        // Batwing doors with the dark under them.
        g.fillStyle(INSIDE, 1).fillRect(
          this.sx(s.x - 0.08),
          this.sy(s.y + 0.15),
          0.16 * unit,
          (0.84 - s.y - 0.15) * unit,
        )
        g.fillStyle(0xb07a3e, 1)
        g.fillRect(this.sx(s.x - 0.078), this.sy(s.y + 0.04), 0.074 * unit, 0.11 * unit)
        g.fillRect(this.sx(s.x + 0.004), this.sy(s.y + 0.04), 0.074 * unit, 0.11 * unit)
        g.fillStyle(0x7a5228, 1)
        for (const dx of [-0.06, -0.04, -0.02, 0.022, 0.042, 0.062])
          g.fillRect(this.sx(s.x + dx), this.sy(s.y + 0.05), Math.max(1, unit * 0.006), 0.09 * unit)
        g.fillStyle(0xd9c08a, 1)
        g.fillRect(
          this.sx(s.x - 0.09),
          this.sy(s.y - 0.15),
          0.012 * unit,
          (0.84 - s.y + 0.15) * unit,
        )
        g.fillRect(
          this.sx(s.x + 0.078),
          this.sy(s.y - 0.15),
          0.012 * unit,
          (0.84 - s.y + 0.15) * unit,
        )
      }
    })
    // Boardwalks.
    g.fillStyle(0x6e4a28, 1)
    g.fillRect(this.sx(0.06), this.sy(0.84), 0.66 * unit, 0.035 * unit)
    g.fillRect(this.sx(1.08), this.sy(0.84), 0.66 * unit, 0.035 * unit)
    // The fence: posts and two rails; bottles stand on the top rail.
    g.fillStyle(0x7a5530, 1)
    g.fillRect(this.sx(0.68), this.sy(0.712), 0.42 * unit, 0.018 * unit)
    g.fillRect(this.sx(0.68), this.sy(0.78), 0.42 * unit, 0.016 * unit)
    for (let x = 0.69; x <= 1.1; x += 0.1) {
      g.fillStyle(0x5e3f22, 1).fillRect(this.sx(x - 0.008), this.sy(0.7), 0.016 * unit, 0.17 * unit)
    }
    // Barrels and a cactus.
    for (const x of [0.03, 1.76]) {
      g.fillStyle(0x7a4a24, 1).fillRect(this.sx(x - 0.035), this.sy(0.8), 0.07 * unit, 0.11 * unit)
      g.fillStyle(0x3a3a44, 1)
      g.fillRect(this.sx(x - 0.035), this.sy(0.82), 0.07 * unit, 0.01 * unit)
      g.fillRect(this.sx(x - 0.035), this.sy(0.88), 0.07 * unit, 0.01 * unit)
    }
    g.fillStyle(0x3f8a4a, 1)
    g.fillRect(this.sx(0.89), this.sy(0.83), 0.03 * unit, 0.15 * unit)
    g.fillRect(this.sx(0.86), this.sy(0.86), 0.02 * unit, 0.06 * unit)
    g.fillRect(this.sx(0.86), this.sy(0.86), 0.04 * unit, 0.015 * unit)
    g.fillRect(this.sx(0.93), this.sy(0.84), 0.02 * unit, 0.05 * unit)
  }

  // Ms after GO at scene time `now`, on the server's clock.
  private live(now: number): number {
    const snap = this.snap
    if (!snap) return -SHOOT.startDelayMs
    const elapsed = this.state.final ? 0 : this.clock.since(snap.remainingMs, now)
    return snap.t + elapsed - SHOOT.startDelayMs
  }

  // The crosshair: the hand plus the breathing sway and the recoil kick.
  private crosshair(time: number): { x: number; y: number } {
    const t = this.live(this.time.now)
    const gasp = Math.max(0, (this.gaspUntil - time) / SHOOT.gaspMs)
    const sway = shootSway(time, this.phase, this.steady, gasp, shootNerves(Math.max(0, t)))
    const kick = Math.max(0, 1 - (time - this.recoilAt) / RECOIL_MS)
    return {
      x: Phaser.Math.Clamp(this.hand.x + sway.dx, 0, SHOOT.w),
      y: Phaser.Math.Clamp(this.hand.y + sway.dy - RECOIL * kick * kick, 0, 1),
    }
  }

  private fire(): void {
    const snap = this.snap
    if (!snap || this.state.final) return
    const t = this.live(this.time.now)
    if (t < 0) return
    this.syncReload(t)
    if (this.reloadUntil > t) return
    if (this.ammo <= 0) {
      this.sfx.click()
      return
    }
    if (t - this.lastShot < SHOOT.shotGapMs) return
    const time = this.time.now
    const aim = this.crosshair(time)
    this.ammo -= 1
    this.lastShot = t
    if (this.ammo === 0) this.reloadUntil = t + SHOOT.reloadMs
    this.recoilAt = time
    this.sendInput({ kind: 'shot', x: aim.x, y: aim.y, at: Math.round(t) })
    this.sfx.gunshot()
    flash(this, 0xfff1c0, 50)
    const hit = shootHit(snap.targets, t, aim.x, aim.y, this.done)
    if (!hit) {
      // A puff of dust where it hit the street or a wall.
      burst(this, this.sx(aim.x), this.sy(aim.y), 0xc8a070, 6, 90)
      return
    }
    this.done.add(hit.id)
    this.knockDown(hit, aim.x, aim.y)
  }

  private reload(): void {
    const t = this.live(this.time.now)
    if (t < 0 || this.state.final) return
    this.syncReload(t)
    if (this.ammo >= SHOOT.ammo || this.reloadUntil > t) return
    this.reloadUntil = t + SHOOT.reloadMs
    this.sendInput({ kind: 'reload' })
    this.sfx.lock()
  }

  private syncReload(t: number): void {
    if (this.reloadUntil > 0 && t >= this.reloadUntil) {
      this.ammo = SHOOT.ammo
      this.reloadUntil = 0
      this.sfx.lock()
    }
  }

  // Your hit, shown at once: the target goes down its own way, and the points pop.
  private knockDown(tg: ShootTarget, x: number, y: number): void {
    const s = this.sprites.get(tg.id)
    const pts = SHOOT.points[tg.kind]
    const px = this.sx(x)
    const py = this.sy(y)
    floatText(
      this,
      px,
      py - 20,
      pts > 0 ? `+${pts}` : `${pts}`,
      pts > 0 ? PALETTE.lime : PALETTE.red,
      this.compact ? 12 : 16,
    )
    if (tg.kind === 'civilian') {
      this.sfx.wrong()
      floatText(
        this,
        px,
        py - 44,
        this.t('game.sharpshooter.oops'),
        PALETTE.red,
        this.compact ? 10 : 14,
      )
    } else if (tg.kind === 'bottle') this.sfx.shatter()
    else if (tg.kind === 'can') this.sfx.bounce(0.8)
    else this.sfx.hit()
    this.hole(px, py, 0x1a1010)
    if (!s) return
    s.down = true
    if (tg.kind === 'bottle') {
      burst(this, s.img.x, s.img.y, 0x9fe0b0, 14, 160)
      s.img.setVisible(false)
    } else if (tg.kind === 'can') {
      this.tweens.add({
        targets: s.img,
        y: s.img.y - this.stage.unit * 0.2,
        angle: 540,
        alpha: 0,
        duration: 500,
      })
    } else {
      // Cardboard flips back on its hinge.
      this.tweens.add({
        targets: s.img,
        scaleY: 0,
        y: s.img.y + s.img.displayHeight / 2,
        duration: 160,
        ease: 'Quad.easeIn',
      })
    }
  }

  // A bullet hole that fades after a moment.
  private hole(px: number, py: number, color: number, delay = 900): void {
    const dot = this.add.circle(px, py, Math.max(2, this.stage.unit * 0.006), color).setDepth(7)
    this.tweens.add({
      targets: dot,
      alpha: 0,
      delay,
      duration: 400,
      onComplete: () => dot.destroy(),
    })
  }

  protected frame(snap: ShootSnapshot | null, time: number, delta: number): void {
    if (!snap) return
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.onSnapshot(snap)
    }
    const now = this.time.now
    const t = this.live(now)
    if (this.state.final) this.input.setDefaultCursor('default')
    this.steer(delta)
    this.breathe(time, delta)
    this.syncReload(t)
    this.drawTargets(snap, t)
    this.drawCrosshair(time, t)
    this.updateBanner(t)
  }

  private onSnapshot(snap: ShootSnapshot): void {
    this.clock.sync(snap.remainingMs, this.time.now)
    const me = snap.players[this.selfId]
    if (me) {
      this.hud?.setScore(this.t('game.common.pts', { n: me.score }))
      // Idle for a moment: trust the server's cylinder.
      const t = this.live(this.time.now)
      if (t - this.lastShot > 400 && this.reloadUntil <= t) {
        this.ammo = me.ammo
        if (me.reloadMs > 0) this.reloadUntil = t + me.reloadMs
      }
    }
    // Rivals' hits: a hole in their color on the target.
    for (const h of snap.holes) {
      if (h.player === this.selfId) continue
      const key = `${h.player}:${h.target}`
      if (this.shownHoles.has(key)) continue
      this.shownHoles.add(key)
      this.hole(this.sx(h.x), this.sy(h.y), this.state.colorOf(h.player, PALETTE.magenta), 600)
      // Rivals' shots: faint, and at most one every 150 ms (eleven of them would be a din).
      if (this.time.now - this.rivalShotAt > 150) {
        this.rivalShotAt = this.time.now
        this.sfx.quiet(() => this.sfx.gunshot(), 0.15)
      }
    }
  }

  // Arrows / WASD move the hand (mouse users just move the mouse).
  private steer(delta: number): void {
    const k = this.keys
    if (!k) return
    const dx = (k.RIGHT.isDown || k.D.isDown ? 1 : 0) - (k.LEFT.isDown || k.A.isDown ? 1 : 0)
    const dy = (k.DOWN.isDown || k.S.isDown ? 1 : 0) - (k.UP.isDown || k.W.isDown ? 1 : 0)
    if (!dx && !dy) return
    const step = (HAND_SPEED * delta) / 1000
    this.hand = {
      x: Phaser.Math.Clamp(this.hand.x + dx * step, 0, SHOOT.w),
      y: Phaser.Math.Clamp(this.hand.y + dy * step, 0, 1),
    }
  }

  // Holding your breath (SHIFT / right button) steadies the aim until the lungs run dry: then a gasp.
  private breathe(time: number, delta: number): void {
    const wants = this.holding || this.keys?.SHIFT.isDown === true
    const gasping = time < this.gaspUntil
    if (wants && !gasping && this.lungs > 0) {
      this.lungs = Math.max(0, this.lungs - delta / SHOOT.lungsMs)
      this.steady = Math.min(1, this.steady + delta / 180)
      if (this.lungs === 0) {
        this.gaspUntil = time + SHOOT.gaspMs
        this.sfx.whoosh()
      }
    } else {
      this.steady = Math.max(0, this.steady - delta / 220)
      if (!gasping) this.lungs = Math.min(1, this.lungs + delta / SHOOT.refillMs)
    }
  }

  private drawTargets(snap: ShootSnapshot, t: number): void {
    const live = new Set<number>()
    for (const tg of snap.targets) {
      const pos = shootTargetAt(tg, t)
      if (!pos) continue
      live.add(tg.id)
      let s = this.sprites.get(tg.id)
      if (!s) {
        s = { tg, img: this.makeTarget(tg.kind), down: this.done.has(tg.id) }
        this.sprites.set(tg.id, s)
      }
      if (s.down) continue
      if (tg.kind === 'can') {
        s.img.setPosition(this.sx(pos.x), this.sy(pos.y)).setAngle(t * 0.5)
      } else if (tg.kind === 'bottle') {
        s.img.setPosition(this.sx(pos.x), this.sy(pos.y))
      } else {
        // Rising from behind the sill / the doors: hidden by the front layer until it's up.
        const [, hh] = SHOOT.box[tg.kind]
        s.img.setPosition(this.sx(pos.x), this.sy(pos.y + (1 - pos.rise) * hh * 2.1))
      }
      s.img.setVisible(true)
    }
    for (const [id, s] of this.sprites) {
      if (live.has(id)) continue
      // Gone: let a knock-down finish, then drop it.
      if (s.down) this.time.delayedCall(500, () => s.img.destroy())
      else s.img.destroy()
      this.sprites.delete(id)
    }
  }

  private makeTarget(kind: ShootKind): Phaser.GameObjects.Image {
    const { unit } = this.stage
    if (kind === 'can') {
      const d = SHOOT.canR * 2 * unit
      return this.add
        .image(0, 0, 'pp-shoot-can')
        .setDisplaySize(d * 0.8, d)
        .setDepth(5)
    }
    if (kind === 'bottle') {
      const [hw, hh] = SHOOT.box.bottle
      return this.add
        .image(0, 0, 'pp-shoot-bottle')
        .setDisplaySize(hw * 2 * unit, hh * 2 * unit)
        .setDepth(4)
    }
    const [hw, hh] = SHOOT.box[kind]
    return this.add
      .image(0, 0, kind === 'bandit' ? 'pp-shoot-bandit' : 'pp-shoot-civilian')
      .setDisplaySize(hw * 2 * unit, hh * 2 * unit)
      .setDepth(2)
  }

  private drawCrosshair(time: number, t: number): void {
    const g = this.cross
    const h = this.hud2
    if (!g || !h) return
    g.clear()
    h.clear()
    const { unit } = this.stage
    const aim = this.crosshair(time)
    const x = this.sx(aim.x)
    const y = this.sy(aim.y)
    const r = Math.max(10, unit * 0.035)
    const reloading = this.reloadUntil > t
    const color = reloading ? PALETTE.dim : this.steady > 0.6 ? PALETTE.lime : PALETTE.amber
    for (const [w, c] of [
      [5, 0x10121c],
      [2, color],
    ] as const) {
      g.lineStyle(w, c, 1)
      g.strokeCircle(x, y, r)
      g.lineBetween(x - r * 1.6, y, x - r * 0.45, y)
      g.lineBetween(x + r * 0.45, y, x + r * 1.6, y)
      g.lineBetween(x, y - r * 1.6, x, y - r * 0.45)
      g.lineBetween(x, y + r * 0.45, x, y + r * 1.6)
    }
    g.fillStyle(color, 1).fillRect(x - 1, y - 1, 3, 3)
    this.reloadText?.setPosition(x, y + r * 2.2).setVisible(reloading)

    // Bullets (bottom left) and lungs (bottom right) along the stage's lower edge.
    const by = this.sy(0.955)
    const bw = Math.max(5, unit * 0.012)
    for (let i = 0; i < SHOOT.ammo; i++) {
      const bx = this.sx(0.04) + i * bw * 1.8
      h.fillStyle(0x10121c, 0.7).fillRect(bx - 2, by - bw * 1.6 - 2, bw + 4, bw * 3.2 + 4)
      h.fillStyle(i < this.ammo && !reloading ? PALETTE.amber : PALETTE.frame, 1).fillRect(
        bx,
        by - bw * 1.6,
        bw,
        bw * 3.2,
      )
    }
    if (reloading) {
      const p = 1 - (this.reloadUntil - t) / SHOOT.reloadMs
      h.fillStyle(PALETTE.amber, 1).fillRect(
        this.sx(0.04),
        by + bw * 2,
        SHOOT.ammo * bw * 1.8 * Phaser.Math.Clamp(p, 0, 1),
        3,
      )
    }
    const lw = unit * 0.25
    const lx = this.sx(SHOOT.w - 0.04) - lw
    const gasping = time < this.gaspUntil
    h.fillStyle(0x10121c, 0.7).fillRect(lx - 3, by - 8, lw + 6, 14)
    h.fillStyle(
      gasping ? PALETTE.red : this.steady > 0.5 ? PALETTE.lime : PALETTE.cyan,
      1,
    ).fillRect(lx, by - 5, lw * this.lungs, 8)
  }

  private updateBanner(t: number): void {
    const banner = this.banner
    if (!banner) return
    if (t < 0 && !this.state.final) {
      if (!banner.visible) {
        const text = this.t('game.sharpshooter.ready')
        banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
        showBanner(this, banner, text, PALETTE.amber)
      }
      return
    }
    if (!this.ready) {
      this.ready = true
      const text = this.t('game.sharpshooter.draw')
      banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
      showBanner(this, banner, text, PALETTE.red)
      this.sfx.go()
      this.time.delayedCall(700, () => banner.setVisible(false))
    }
  }
}
