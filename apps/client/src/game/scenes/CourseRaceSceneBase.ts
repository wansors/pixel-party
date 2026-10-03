import {
  type CourseCar,
  type CourseDef,
  type CourseKind,
  type CourseRaceSnapshot,
  type MicroRacePoint,
  PALETTE,
  courseDef,
  sampleCourse,
} from '@pp/shared'
import type Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { addBanner, burst, floatText, showBanner } from '../fx'
import { ensurePixelGrid, headlineStyle, hexToCss, shade } from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import type { SceneDeps } from './MiniGameScene'
import { MiniGameScene } from './MiniGameScene'
import { COURSE_TEXEL, paintCourse } from './courseArt'
import { CAR_ROWS } from './microRaceArt'

// Shared scene for the course racers (Rally Stage, Speed Circuit). The course is bigger than the
// screen, so the world (the painted course, every car, the dust and boost trails) lives in one
// container that is moved and scaled each frame to follow your car — a chase camera that leaves the
// HUD, the start lights, the minimap and the standings strip fixed on top. Cars are Micro Race's
// top-down racer in the player's color with their lobby avatar at the wheel. Arrows/WASD drive, or hold
// the pointer where you want to go. Subclasses supply the per-game HUD line and finish wording.

const VIEW_WORLD_W = 900 // world units across the view on a wide screen (zoom follows)
const SEND_EVERY_MS = 60

interface CarView {
  body: Phaser.GameObjects.Image
  pilot: Phaser.GameObjects.Image
  x: number
  y: number
  a: number
}

function wrapAngle(a: number): number {
  let r = a
  while (r > Math.PI) r -= Math.PI * 2
  while (r < -Math.PI) r += Math.PI * 2
  return r
}

export abstract class CourseRaceSceneBase extends MiniGameScene<CourseRaceSnapshot> {
  protected compact = false
  protected def?: CourseDef
  private samples: MicroRacePoint[] = []
  private world?: Phaser.GameObjects.Container
  private view = { x: 0, y: 0, w: 0, h: 0 }
  private zoom = 1
  private cam = { x: 0, y: 0 }
  private views = new Map<string, CarView>()
  private trails?: Phaser.GameObjects.Graphics
  private minimap?: {
    g: Phaser.GameObjects.Graphics
    dots: Phaser.GameObjects.Graphics
    x: number
    y: number
    s: number
  }
  private countdown?: Phaser.GameObjects.Text
  private strip?: PlayerStrip
  protected banner?: Phaser.GameObjects.Text
  private bannerUntil = 0
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>
  private aim?: { x: number; y: number }
  private aimPointer = -1
  private lastSentAt = 0
  private lastTick = -1
  private snapAt = 0
  private prev?: CourseRaceSnapshot
  private announcedGo = false
  private finished = false

  constructor(
    key: string,
    private readonly kind: CourseKind,
    ...deps: SceneDeps
  ) {
    super(key, ...deps)
  }

  // One HUD line for the player's own state ("LAP 1/2 · P3", "SPLIT 2/3 · 0:12.3").
  protected abstract statusOf(me: CourseCar, snap: CourseRaceSnapshot): string
  // A short pop for progress events (a lap, a split) and the finish banner.
  protected abstract progressPop(prev: CourseCar, me: CourseCar): string | null

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.def = undefined
    this.samples = []
    this.views = new Map()
    this.aim = undefined
    this.aimPointer = -1
    this.lastSentAt = 0
    this.lastTick = -1
    this.snapAt = 0
    this.prev = undefined
    this.announcedGo = false
    this.finished = false
    this.bannerUntil = 0

    const stripSize = this.compact ? 11 : 13
    this.strip = new PlayerStrip(this, width / 2, this.top + 8, width - 24, stripSize, 2)
    const viewTop = this.top + 8 + PlayerStrip.rowH(stripSize) * 2
    this.view = { x: 8, y: viewTop, w: width - 16, h: height - viewTop - 10 }
    this.zoom = Math.max(0.45, Math.min(1.6, this.view.w / (this.compact ? 620 : VIEW_WORLD_W)))
    this.countdown = this.add
      .text(
        width / 2,
        viewTop + this.view.h * 0.3,
        '',
        headlineStyle(this.compact ? 32 : 48, PALETTE.red, {
          stroke: '#10121c',
          strokeThickness: 8,
        }),
      )
      .setOrigin(0.5)
      .setDepth(900)
    this.banner = addBanner(this)
    this.cursors = this.input.keyboard?.createCursorKeys()
    const kb = this.input.keyboard
    if (kb)
      this.wasd = { W: kb.addKey('W'), A: kb.addKey('A'), S: kb.addKey('S'), D: kb.addKey('D') }
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.aimPointer = p.id
      this.aim = { x: p.x, y: p.y }
    })
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.id === this.aimPointer && p.isDown) this.aim = { x: p.x, y: p.y }
    })
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.id !== this.aimPointer) return
      this.aimPointer = -1
      this.aim = undefined
    })
  }

  // The course is known from the first snapshot: paint it once into a texture, build the world.
  private buildWorld(snap: CourseRaceSnapshot): void {
    const def = courseDef(this.kind, snap.course)
    this.def = def
    this.samples = sampleCourse(def)
    const key = `course-${this.kind}-${snap.course}`
    if (!this.textures.exists(key)) {
      const { rgba, w, h } = paintCourse(def)
      const canvas = this.textures.createCanvas(key, w, h)
      const ctx = canvas?.getContext()
      if (canvas && ctx) {
        const img = ctx.createImageData(w, h)
        img.data.set(rgba)
        ctx.putImageData(img, 0, 0)
        canvas.refresh()
      }
    }
    const world = this.add.container(0, 0).setDepth(10)
    world.add(this.add.image(0, 0, key).setOrigin(0, 0).setScale(COURSE_TEXEL))
    this.trails = this.add.graphics()
    world.add(this.trails)
    const shape = this.make.graphics({ x: 0, y: 0 }, false)
    shape.fillStyle(0xffffff, 1)
    shape.fillRect(this.view.x, this.view.y, this.view.w, this.view.h)
    world.setMask(shape.createGeometryMask())
    this.world = world
    // Minimap: the whole course, top-right of the view.
    const mmW = this.compact ? 110 : 180
    const s = mmW / def.world.w
    const mx = this.view.x + this.view.w - mmW - 8
    const my = this.view.y + 8
    const g = this.add.graphics().setDepth(710)
    g.fillStyle(0x10121c, 0.75).fillRect(mx - 4, my - 4, mmW + 8, def.world.h * s + 8)
    g.lineStyle(Math.max(2, def.halfWidth * 2 * s), 0x9aa3b8, 1)
    g.beginPath()
    this.samples.forEach((p, i) =>
      i === 0 ? g.moveTo(mx + p.x * s, my + p.y * s) : g.lineTo(mx + p.x * s, my + p.y * s),
    )
    if (def.kind === 'circuit') g.closePath()
    g.strokePath()
    this.minimap = { g, dots: this.add.graphics().setDepth(711), x: mx, y: my, s }
  }

  private carView(c: CourseCar): CarView {
    let v = this.views.get(c.id)
    if (v) return v
    const color = this.state.colorOf(c.id, PALETTE.red)
    const key = ensurePixelGrid(this, {
      key: `pp-course-car-${color.toString(16)}`,
      rows: CAR_ROWS,
      legend: {
        k: 0x14141c,
        o: shade(color, -0.6),
        b: color,
        h: shade(color, 0.35),
        W: shade(color, -0.35),
        w: shade(color, 0.7),
        g: 0x1d2a44,
        y: 0xfff3a0,
      },
      pixelSize: 2,
    })
    // 16 × 10 sprite cells → about 2.6 × 1.6 car radii long/wide in world units.
    const body = this.add.image(c.x, c.y, key).setDisplaySize(34, 22)
    const pilot = this.add
      .image(c.x, c.y, ensureAvatarTexture(this, this.state.avatarOf(c.id), shade(color, 0.3), 1))
      .setDisplaySize(10, 10)
    this.world?.add([body, pilot])
    // Your car draws over the ghosts / the pack.
    if (c.id === this.selfId) this.world?.bringToTop(body).bringToTop(pilot)
    v = { body, pilot, x: c.x, y: c.y, a: c.a }
    this.views.set(c.id, v)
    return v
  }

  protected frame(snap: CourseRaceSnapshot | null, time: number, delta: number): void {
    if (!snap) return
    if (!this.world) this.buildWorld(snap)
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.snapAt = time
      this.onSnapshot(snap)
    }
    this.paintCars(snap, time, delta)
    this.follow(snap, delta)
    this.paintLights(snap)
    this.steer(time, snap)
    if (this.bannerUntil > 0 && time > this.bannerUntil && !this.state.final) {
      this.bannerUntil = 0
      this.banner?.setVisible(false)
    }
  }

  private paintCars(snap: CourseRaceSnapshot, time: number, delta: number): void {
    const k = Math.min(1, delta / 70)
    const trails = this.trails as Phaser.GameObjects.Graphics
    trails.clear()
    for (const c of snap.cars) {
      const v = this.carView(c)
      // Ease toward the snapshot (snapshots arrive a few times a second).
      v.x += (c.x - v.x) * k
      v.y += (c.y - v.y) * k
      v.a += wrapAngle(c.a - v.a) * k
      v.body.setPosition(v.x, v.y).setRotation(v.a)
      v.pilot
        .setPosition(v.x - Math.cos(v.a) * 2, v.y - Math.sin(v.a) * 2)
        .setRotation(v.a + Math.PI / 2)
      const ghost = this.kind === 'stage' && c.id !== this.selfId
      v.body.setAlpha(ghost ? 0.55 : 1)
      v.pilot.setAlpha(ghost ? 0.55 : 1)
      // Trails: dust off-road / on gravel, wind lines in a slipstream, a flame on boost.
      const bx = v.x - Math.cos(v.a) * 18
      const by = v.y - Math.sin(v.a) * 18
      if (c.off) {
        trails.fillStyle(0xc2a578, 0.6)
        trails.fillCircle(bx + Math.sin(time / 50) * 3, by + Math.cos(time / 60) * 3, 5)
      }
      if (c.draft) {
        trails.lineStyle(2, 0xffffff, 0.5)
        for (const off of [-8, 8]) {
          const px = -Math.sin(v.a) * off
          const py = Math.cos(v.a) * off
          trails.lineBetween(
            bx + px,
            by + py,
            bx + px - Math.cos(v.a) * 26,
            by + py - Math.sin(v.a) * 26,
          )
        }
      }
      if (c.boost) {
        trails.fillStyle(Math.floor(time / 60) % 2 ? PALETTE.amber : PALETTE.orange, 1)
        trails.fillTriangle(
          bx - Math.cos(v.a) * 18,
          by - Math.sin(v.a) * 18,
          bx - Math.sin(v.a) * 7,
          by + Math.cos(v.a) * 7,
          bx + Math.sin(v.a) * 7,
          by - Math.cos(v.a) * 7,
        )
      }
    }
  }

  // Chase camera: the world container is placed so your car sits a little below the view's centre.
  private follow(snap: CourseRaceSnapshot, delta: number): void {
    const world = this.world
    const def = this.def
    if (!world || !def) return
    const me = this.views.get(this.selfId) ?? this.views.get(snap.cars[0]?.id ?? '')
    if (!me) return
    const look = 90
    const target = { x: me.x + Math.cos(me.a) * look, y: me.y + Math.sin(me.a) * look }
    const k = Math.min(1, delta / 160)
    this.cam.x += (target.x - this.cam.x) * k
    this.cam.y += (target.y - this.cam.y) * k
    if (this.cam.x === 0 && this.cam.y === 0) this.cam = { ...target }
    const halfW = this.view.w / 2 / this.zoom
    const halfH = this.view.h / 2 / this.zoom
    const cx = Math.max(halfW, Math.min(def.world.w - halfW, this.cam.x))
    const cy = Math.max(halfH, Math.min(def.world.h - halfH, this.cam.y))
    world.setScale(this.zoom)
    world.setPosition(
      this.view.x + this.view.w / 2 - cx * this.zoom,
      this.view.y + this.view.h / 2 - cy * this.zoom,
    )
    // Minimap dots.
    const mm = this.minimap
    if (!mm) return
    mm.dots.clear()
    for (const c of snap.cars) {
      const mine = c.id === this.selfId
      mm.dots.fillStyle(this.state.colorOf(c.id), 1)
      mm.dots.fillCircle(mm.x + c.x * mm.s, mm.y + c.y * mm.s, mine ? 4 : 2.5)
      if (mine)
        mm.dots.lineStyle(1, 0xffffff, 1).strokeCircle(mm.x + c.x * mm.s, mm.y + c.y * mm.s, 5)
    }
  }

  // World point → screen (for fx that live on the fixed layer).
  protected toScreen(x: number, y: number): { x: number; y: number } {
    const world = this.world
    if (!world) return { x, y }
    return { x: world.x + x * world.scaleX, y: world.y + y * world.scaleY }
  }

  // Start countdown 3 · 2 · 1 · GO!
  private paintLights(snap: CourseRaceSnapshot): void {
    const lights = this.countdown
    if (!lights) return
    if (snap.goInMs > 0) {
      const n = String(Math.ceil(snap.goInMs / 800))
      if (lights.text !== n) {
        lights.setText(n).setColor(hexToCss(PALETTE.red)).setVisible(true)
        if (!this.firstSnapshot) this.sfx.tick()
      }
      return
    }
    if (!this.announcedGo) {
      this.announcedGo = true
      if (!this.firstSnapshot) this.sfx.go()
      lights.setText(this.t('game.courseRace.go')).setColor(hexToCss(PALETTE.lime))
      this.time.delayedCall(700, () => lights.setVisible(false))
    }
  }

  private steer(time: number, snap: CourseRaceSnapshot): void {
    if (this.finished || this.state.final) return
    const left = this.cursors?.left.isDown || this.wasd?.A.isDown
    const right = this.cursors?.right.isDown || this.wasd?.D.isDown
    const up = this.cursors?.up.isDown || this.wasd?.W.isDown
    const down = this.cursors?.down.isDown || this.wasd?.S.isDown
    const me = this.views.get(this.selfId)
    let drive = { steer: 0, throttle: 0 }
    if (left || right || up || down) {
      drive = { steer: (right ? 1 : 0) - (left ? 1 : 0), throttle: (up ? 1 : 0) - (down ? 1 : 0) }
    } else if (this.aim && me) {
      // Steer toward the held point, measured from the car's nose (screen space).
      const at = this.toScreen(me.x, me.y)
      const diff = wrapAngle(Math.atan2(this.aim.y - at.y, this.aim.x - at.x) - me.a)
      const dist = Math.hypot(this.aim.x - at.x, this.aim.y - at.y)
      drive = {
        steer: Math.max(-1, Math.min(1, diff / 0.5)),
        throttle: Math.abs(diff) > 2.3 ? 0.45 : dist < 30 ? 0.3 : 1,
      }
    }
    if (time - this.lastSentAt > SEND_EVERY_MS && snap.cars.some((c) => c.id === this.selfId)) {
      this.lastSentAt = time
      this.sendInput({ kind: 'drive', ...drive })
    }
  }

  private onSnapshot(snap: CourseRaceSnapshot): void {
    const prev = this.prev
    this.prev = snap
    const me = snap.cars.find((c) => c.id === this.selfId)
    if (me) this.hud?.setScore(this.statusOf(me, snap))
    this.strip?.set(
      snap.cars.map((c) => ({
        text: `${c.pos}. ${this.label(c.id)}${c.finishMs !== null ? ' ✓' : ''}`,
        avatar: this.state.avatarOf(c.id),
        color: this.state.colorOf(c.id),
        dim: false,
      })),
    )
    if (!prev || this.firstSnapshot) {
      if (me?.finishMs != null) this.finished = true
      return
    }
    const before = new Map(prev.cars.map((c) => [c.id, c]))
    for (const c of snap.cars) {
      const was = before.get(c.id)
      if (!was) continue
      const at = this.toScreen(c.x, c.y)
      if (c.hits > was.hits && c.id === this.selfId) {
        burst(this, at.x, at.y, PALETTE.amber, 8, 150)
        this.sfx.pop()
      }
      if (c.resets > was.resets && c.id === this.selfId) {
        floatText(this, at.x, at.y - 20, this.t('game.courseRace.rescued'), PALETTE.amber, 12)
        this.sfx.wrong()
      }
      if (c.boost && !was.boost && c.id === this.selfId) this.sfx.coin()
      if (c.id !== this.selfId) continue
      const pop = this.progressPop(was, c)
      if (pop) {
        floatText(this, at.x, at.y - 24, pop, PALETTE.lime, this.compact ? 12 : 16)
        this.sfx.correct()
      }
      if (c.finishMs !== null && was.finishMs === null) {
        this.finished = true
        this.sfx.win()
        showBanner(
          this,
          this.banner as Phaser.GameObjects.Text,
          this.t('game.courseRace.finished', { pos: c.pos }),
          PALETTE.lime,
        )
        this.bannerUntil = this.time.now + 2200
      }
    }
    if (me && snap.closing && !prev.closing && me.finishMs === null) {
      showBanner(
        this,
        this.banner as Phaser.GameObjects.Text,
        this.t('game.courseRace.hurry'),
        PALETTE.amber,
      )
      this.bannerUntil = this.time.now + 1600
    }
  }
}
