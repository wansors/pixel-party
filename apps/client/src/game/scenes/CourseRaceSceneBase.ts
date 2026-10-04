import {
  COURSE_BOOST,
  COURSE_CAR_R,
  COURSE_GRAVEL_TUNING,
  COURSE_PHYSICS,
  type CourseCar,
  type CourseDef,
  type CourseKind,
  type CourseRaceSnapshot,
  courseDef,
  inStretch,
  type MicroRacePoint,
  PALETTE,
  RACE_DRAFT_TUNING,
  type RaceCarTuning,
  sampleCourse,
} from '@pp/shared'
import Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { addBanner, burst, flash, floatText, ring, shake, showBanner } from '../fx'
import { ServerClock } from '../netcode/ServerClock'
import { bodyStyle, ensurePixelGrid, headlineStyle, hexToCss, shade } from '../pixelStyle'
import { nameTagStyle, YouMarker } from '../playerMarks'
import { COURSE_TEXEL, paintCourse } from './courseArt'
import type { SceneDeps } from './MiniGameScene'
import { MiniGameScene } from './MiniGameScene'
import { CAR_ROWS } from './microRaceArt'
import { DriveControls, LabelDeclutter, RaceMinimap, RaceStandings } from './raceKit'
import { type CarPose, OwnCar, RivalCars, RoadIndex, raceClock } from './raceNet'

// Shared scene for the course racers (Rally Stage, Speed Circuit). The course is bigger than the
// screen, so the world (the painted course, every car, the dust and boost trails) lives in one
// container that is moved and scaled each frame to follow your car — a chase camera that leaves the
// HUD, the start countdown, the race clock, the minimap and the standings column fixed on top. Cars are
// Micro Race's top-down racer in the player's color with their lobby avatar at the wheel and a name
// tag. Your own car is predicted locally with the server's integrator (it reacts the frame you press
// a key), rivals are dead-reckoned to the server's present. Arrows/WASD drive (SPACE brakes), or hold
// the pointer where you want to go. Subclasses supply the HUD line.

const VIEW_WORLD_W = 900 // world units across the view on a wide screen (zoom follows)
const CAR_LEN = 34 // world units (16 × 10 sprite cells)
const CAR_WID = 22
const LOOK = 90
const BANNER_MS = 1400
// The circuit's bump (Speed Circuit has contact): restitution and the approach speed of a hit.
const RESTITUTION = 1
const HIT_MIN_SPEED = 70
// A wall hit: the world edge flipped a velocity component at least this fast (world units/s).
const WALL_HIT_SPEED = 80
// Other cars crossing the line get the crowd at most this often (a pack finishing together is one roar).
const CHEER_GAP_MS = 1500
// Rivals' moments play at this fraction of the volume (yours stay full), and their bumps at most this
// often — a pile-up into the first corner is one crunch.
const RIVAL_LEVEL = 0.4
const RIVAL_BUMP_MS = 400
const NO_TUNING: RaceCarTuning = {}

interface CarView {
  body: Phaser.GameObjects.Image
  pilot: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  color: number
  x: number
  y: number
  a: number
}

export abstract class CourseRaceSceneBase extends MiniGameScene<CourseRaceSnapshot> {
  protected compact = false
  protected def?: CourseDef
  private samples: MicroRacePoint[] = []
  private road?: RoadIndex
  private world?: Phaser.GameObjects.Container
  private view = { x: 0, y: 0, w: 0, h: 0 }
  private zoom = 1
  private cam = { x: 0, y: 0, ready: false }
  private views = new Map<string, CarView>()
  private trails?: Phaser.GameObjects.Graphics
  private minimap?: RaceMinimap
  private mmBox = { x: 0, y: 0, w: 0 }
  private standings?: RaceStandings
  private countdown?: Phaser.GameObjects.Text
  private clockText?: Phaser.GameObjects.Text
  private marker?: YouMarker
  protected banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private bannerUntil = 0
  private controls?: DriveControls
  private readonly tags = new LabelDeclutter()
  private readonly clock = new ServerClock()
  private readonly rivals = new RivalCars()
  private readonly own = new OwnCar()
  private ownActive = false
  private ownResets = 0
  private lastLocalBump = 0
  private lastWallAt = 0
  // Your car on a boost pad as of the last frame, and when it last hit one (the server's echo of the
  // boost a snapshot later must not play the sound twice).
  private onPad = false
  private lastPadAt = Number.NEGATIVE_INFINITY
  private lastDraftAt = Number.NEGATIVE_INFINITY
  private lastCheerAt = Number.NEGATIVE_INFINITY
  private lastRivalBumpAt = Number.NEGATIVE_INFINITY
  private snapAt = 0
  private lastTick = -1
  private prev?: CourseRaceSnapshot
  private announcedGo = false
  private sawCountdown = false
  private goHideAt = 0
  private finished = false
  private timeUpShown = false
  private wrongWay = false
  private progressMs = 0
  private lastDustAt = 0

  constructor(
    key: string,
    private readonly kind: CourseKind,
    ...deps: SceneDeps
  ) {
    super(key, ...deps)
  }

  // One HUD line for the player's own state ("LAP 1/2 · P3", "SPLIT 2/3 · 45%").
  protected abstract statusOf(me: CourseCar, snap: CourseRaceSnapshot): string

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    const big = !this.compact && height >= 900
    this.def = undefined
    this.samples = []
    this.road = undefined
    this.world = undefined
    this.views = new Map()
    this.cam = { x: 0, y: 0, ready: false }
    this.clock.reset()
    this.rivals.reset()
    this.ownActive = false
    this.ownResets = 0
    this.lastLocalBump = 0
    this.lastWallAt = 0
    this.onPad = false
    this.lastPadAt = Number.NEGATIVE_INFINITY
    this.lastDraftAt = Number.NEGATIVE_INFINITY
    this.lastCheerAt = Number.NEGATIVE_INFINITY
    this.lastRivalBumpAt = Number.NEGATIVE_INFINITY
    this.snapAt = 0
    this.lastTick = -1
    this.prev = undefined
    this.announcedGo = false
    this.sawCountdown = false
    this.goHideAt = 0
    this.finished = false
    this.timeUpShown = false
    this.wrongWay = false
    this.progressMs = 0
    this.lastDustAt = 0
    this.bannerUntil = 0

    const hintH = this.compact ? 22 : 30
    this.view = { x: 0, y: this.top, w: width, h: height - this.top - hintH }
    this.zoom = Math.max(0.45, Math.min(1.6, this.view.w / (this.compact ? 620 : VIEW_WORLD_W)))
    // Opaque strips over the scrolling world: the HUD and the hint line.
    this.add.rectangle(0, 0, width, this.top, PALETTE.bg).setOrigin(0, 0).setDepth(700)
    this.add
      .rectangle(0, height - hintH, width, hintH, PALETTE.bg)
      .setOrigin(0, 0)
      .setDepth(700)
    this.add.rectangle(0, this.top, width, 2, PALETTE.frame).setOrigin(0, 0).setDepth(701)
    this.add
      .text(
        width / 2,
        height - hintH / 2,
        this.t(this.compact ? 'game.microRace.hintTouch' : 'game.microRace.hint'),
        bodyStyle(this.compact ? 11 : big ? 16 : 14, PALETTE.dim),
      )
      .setOrigin(0.5)
      .setDepth(701)

    const pad = this.compact ? 6 : 10
    this.mmBox = {
      x: 0,
      y: this.top + pad + 6,
      w: this.compact ? 110 : Math.round(Math.max(200, Math.min(320, width * 0.15))),
    }
    this.mmBox.x = width - this.mmBox.w - pad - 6
    this.standings = new RaceStandings(
      this,
      pad,
      this.top + pad,
      this.compact ? 4 : 12,
      this.compact ? 11 : big ? 16 : 14,
      710,
    )
    this.clockText = this.add
      .text(
        width / 2,
        this.top + pad,
        '',
        headlineStyle(this.compact ? 12 : big ? 24 : 16, PALETTE.amber, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5, 0)
      .setDepth(712)
      .setVisible(false)
    this.countdown = this.add
      .text(
        width / 2,
        this.top + this.view.h * 0.3,
        '',
        headlineStyle(this.compact ? 32 : 48, PALETTE.red, {
          stroke: '#10121c',
          strokeThickness: 8,
        }),
      )
      .setOrigin(0.5)
      .setDepth(900)
    this.marker = new YouMarker(this, this.compact ? 12 : 16, 640)
    this.banner = addBanner(this)
    this.subline = this.add
      .text(
        width / 2,
        0,
        '',
        headlineStyle(this.compact ? 12 : 16, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
          align: 'center',
        }),
      )
      .setOrigin(0.5)
      .setLineSpacing(8)
      .setDepth(950)
      .setVisible(false)
    this.controls = new DriveControls(this)
  }

  // The course is known from the first snapshot: paint it once into a texture, build the world.
  private buildWorld(snap: CourseRaceSnapshot): void {
    const def = courseDef(this.kind, snap.course)
    this.def = def
    this.samples = sampleCourse(def)
    this.road = new RoadIndex(this.samples, def.kind === 'circuit')
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
    // No mask: the course always fills the view (the camera stays inside it) and the opaque HUD and
    // hint strips cover whatever spills over — one full-screen pass instead of three. For the same
    // reason the arcade backdrop under it never shows: skip drawing it.
    for (const o of this.children.list) {
      if (o instanceof Phaser.GameObjects.TileSprite && o.depth === -1000) o.setVisible(false)
    }
    this.world = world
    this.minimap = new RaceMinimap(
      this,
      this.mmBox.x,
      this.mmBox.y,
      this.mmBox.w,
      def.world,
      this.samples,
      def.halfWidth,
      def.kind === 'circuit',
      this.compact,
      711,
    )
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
    const body = this.add.image(c.x, c.y, key).setDisplaySize(CAR_LEN, CAR_WID)
    const pilot = this.add
      .image(c.x, c.y, ensureAvatarTexture(this, this.state.avatarOf(c.id), color, 2))
      .setDisplaySize(12, 12)
    this.world?.add([body, pilot])
    // Your car draws over the ghosts / the pack (whichever order the cars were met in).
    const own = c.id === this.selfId ? { body, pilot } : this.views.get(this.selfId)
    if (own) this.world?.bringToTop(own.body).bringToTop(own.pilot)
    // Name tags ride on the fixed layer (crisp text at any zoom); yours is the ▼ marker instead.
    const label = this.add
      .text(0, 0, this.label(c.id), nameTagStyle(this.compact ? 8 : 12, color))
      .setOrigin(0.5, 1)
      .setDepth(630)
      .setVisible(false)
    v = { body, pilot, label, color, x: c.x, y: c.y, a: c.a }
    this.views.set(c.id, v)
    return v
  }

  protected frame(snap: CourseRaceSnapshot | null, time: number, delta: number): void {
    if (!snap) return
    if (!this.world) this.buildWorld(snap)
    const now = this.time.now
    let fresh = false
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.clock.sync(snap.remainingMs, now)
      this.snapAt = now - this.clock.since(snap.remainingMs, now)
      this.rivals.push(snap.cars, this.snapAt, now)
      this.onSnapshot(snap, now)
      fresh = true
    }
    if (this.state.final) this.timeUp(snap)
    this.drive(snap, now, fresh)
    this.paintCars(snap, time, delta)
    this.follow(snap, delta)
    this.paintLights(snap, now)
    this.paintClock(snap, now)
    if (this.bannerUntil > 0 && now > this.bannerUntil) {
      this.bannerUntil = 0
      this.banner?.setVisible(false)
      if (!this.finished && !this.timeUpShown) this.subline?.setVisible(false)
    }
  }

  // Your controls → the server (on change only), and your car's local prediction.
  private drive(snap: CourseRaceSnapshot, now: number, fresh: boolean): void {
    const me = snap.cars.find((c) => c.id === this.selfId)
    const def = this.def
    const racing = !!me && !me.gone && me.finishMs === null && !this.state.final && !this.finished
    if (!me || !def || !racing) {
      if (this.ownActive && me) this.rivals.adopt(me.id, this.own.pose(), now)
      this.ownActive = false
      return
    }
    const shown = this.views.get(me.id)
    const at = shown ? this.toScreen(shown.x, shown.y) : null
    const read = this.controls?.read(at && shown ? { x: at.x, y: at.y, a: shown.a } : null)
    const held = read
      ? (this.controls?.sync(read, now, (d) => this.sendInput({ kind: 'drive', ...d })) ??
        read.drive)
      : { steer: 0, throttle: 0 }
    if (!this.ownActive) {
      this.own.snapTo(me)
      this.ownResets = me.resets
      this.ownActive = true
    }
    const body = this.own.body
    body.steer = held.steer
    body.throttle = held.throttle
    body.finishMs = null
    if (snap.goInMs - this.clock.since(snap.remainingMs, now) > 0) {
      // On the line until the countdown ends.
      if (fresh) this.own.snapTo(me)
      this.own.hold(now)
      return
    }
    this.road?.update(body.x, body.y)
    body.off = (this.road?.dist ?? 0) > def.halfWidth
    // Rolling onto a boost pad (the server's own rule: a pad stretch, on the road) — the kick is heard
    // the frame it happens.
    const pad =
      this.kind === 'circuit' &&
      !body.off &&
      inStretch(def.boosts, this.road?.idx ?? -1, this.samples.length)
    if (pad && !this.onPad) {
      this.lastPadAt = now
      this.sfx.powerUp()
    }
    this.onPad = pad
    const vx0 = body.vx
    const vy0 = body.vy
    this.own.step(now, {
      physics: COURSE_PHYSICS[this.kind],
      tuning: this.tuning(me),
      world: def.world,
      carR: COURSE_CAR_R[this.kind],
    })
    this.wallHit(vx0, vy0, def, now)
    if (fresh) {
      if (me.resets > this.ownResets) this.own.snapTo(me)
      else this.own.reconcile(me, this.snapAt)
    }
    this.ownResets = me.resets
    if (this.kind !== 'circuit') return
    // Wheel-to-wheel: bumps happen on your screen right away (the server's verdict follows).
    for (const c of snap.cars) {
      if (c.id === me.id || c.gone) continue
      const other = this.rivals.state(c.id, now)
      if (!other) continue
      const hit = this.own.contact(other, COURSE_CAR_R.circuit, RESTITUTION)
      if (hit >= HIT_MIN_SPEED && now - this.lastLocalBump > 250) {
        this.lastLocalBump = now
        const p = this.own.pose()
        this.bumpFx(this.toScreen(p.x, p.y))
      }
    }
  }

  // The same per-step tweaks the server applies: rally gravel; the circuit's slipstream and boost
  // (as the latest snapshot has them).
  private tuning(me: CourseCar): RaceCarTuning {
    if (this.kind === 'stage') {
      const def = this.def
      const idx = this.road?.idx ?? -1
      return def && idx >= 0 && inStretch(def.gravel, idx, this.samples.length)
        ? COURSE_GRAVEL_TUNING
        : NO_TUNING
    }
    if (!me.draft && !me.boost) return NO_TUNING
    const draft = me.draft ? RACE_DRAFT_TUNING : { maxSpeedScale: 1, accelScale: 1 }
    const boost = me.boost ? COURSE_BOOST : { maxSpeedScale: 1, accelScale: 1 }
    return {
      maxSpeedScale: draft.maxSpeedScale * boost.maxSpeedScale,
      accelScale: draft.accelScale * boost.accelScale,
    }
  }

  private bumpFx(at: { x: number; y: number }): void {
    burst(this, at.x, at.y, PALETTE.amber, 8, 150)
    shake(this, 0.005, 110)
    this.sfx.crash()
  }

  // Your car slamming into the edge of the world: the step's wall bounce flipped a fast velocity
  // component with the car pressed against that edge.
  private wallHit(vx0: number, vy0: number, def: CourseDef, now: number): void {
    const b = this.own.body
    const r = COURSE_CAR_R[this.kind] + 1
    const { w, h } = def.world
    const hitX = vx0 * b.vx < 0 && Math.abs(vx0) >= WALL_HIT_SPEED && (b.x <= r || b.x >= w - r)
    const hitY = vy0 * b.vy < 0 && Math.abs(vy0) >= WALL_HIT_SPEED && (b.y <= r || b.y >= h - r)
    if (!(hitX || hitY) || now - this.lastWallAt < 400) return
    this.lastWallAt = now
    this.sfx.crash()
    shake(this, 0.005, 110)
  }

  private paintCars(snap: CourseRaceSnapshot, time: number, delta: number): void {
    const trails = this.trails
    if (!trails) return
    trails.clear()
    const now = this.time.now
    const freeze = this.state.final
    for (const c of snap.cars) {
      const v = this.carView(c)
      const mine = c.id === this.selfId
      const pose: CarPose | null =
        mine && this.ownActive ? this.own.pose() : this.rivals.pose(c.id, now, delta, freeze)
      if (pose) {
        v.x = pose.x
        v.y = pose.y
        v.a = pose.a
      }
      v.body.setPosition(v.x, v.y).setRotation(v.a)
      v.pilot
        .setPosition(v.x - Math.cos(v.a) * 2, v.y - Math.sin(v.a) * 2)
        .setRotation(v.a + Math.PI / 2)
      // Stage rivals are ghosts; a driver who left fades out further (no contact any more).
      const alpha = c.gone ? 0.3 : this.kind === 'stage' && !mine ? 0.55 : 1
      v.body.setAlpha(alpha)
      v.pilot.setAlpha(alpha)
      // Trails: dust off-road, wind lines in a slipstream, a flame on boost.
      const bx = v.x - Math.cos(v.a) * 18
      const by = v.y - Math.sin(v.a) * 18
      const off = mine && this.ownActive ? this.own.body.off : c.off
      if (off) {
        trails.fillStyle(0xc2a578, 0.6)
        trails.fillCircle(bx + Math.sin(time / 50) * 3, by + Math.cos(time / 60) * 3, 5)
      }
      if (c.draft) {
        trails.lineStyle(2, 0xffffff, 0.5)
        for (const o of [-8, 8]) {
          const px = -Math.sin(v.a) * o
          const py = Math.cos(v.a) * o
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
      if (mine && off && !this.compact && time - this.lastDustAt > 160 && this.own.speed > 60) {
        this.lastDustAt = time
        const s = this.toScreen(bx, by)
        burst(this, s.x, s.y, 0xc2a578, 3, 50)
      }
    }
  }

  // Chase camera: the world container is placed so your car sits a little behind the view's centre.
  private follow(snap: CourseRaceSnapshot, delta: number): void {
    const world = this.world
    const def = this.def
    if (!world || !def) return
    const me = this.views.get(this.selfId) ?? this.views.get(snap.cars[0]?.id ?? '')
    if (me) {
      const target = { x: me.x + Math.cos(me.a) * LOOK, y: me.y + Math.sin(me.a) * LOOK }
      if (!this.cam.ready) {
        this.cam = { ...target, ready: true }
      } else {
        const k = 1 - Math.exp(-delta / 160)
        this.cam.x += (target.x - this.cam.x) * k
        this.cam.y += (target.y - this.cam.y) * k
      }
    }
    const halfW = this.view.w / 2 / this.zoom
    const halfH = this.view.h / 2 / this.zoom
    const cx = Math.max(halfW, Math.min(def.world.w - halfW, this.cam.x))
    const cy = Math.max(halfH, Math.min(def.world.h - halfH, this.cam.y))
    world.setScale(this.zoom)
    world.setPosition(
      this.view.x + this.view.w / 2 - cx * this.zoom,
      this.view.y + this.view.h / 2 - cy * this.zoom,
    )
    // Name tags over the rivals (on screen, under the HUD; one that would overlap another stays hidden
    // while the pack is bunched), the ▼ over yours; the minimap.
    const labelUp = (CAR_LEN / 2 + 2) * this.zoom
    const mm = this.minimap
    mm?.clear()
    const now = this.time.now
    const tags = this.tags
    tags.reset()
    const own = this.views.get(this.selfId)
    if (own) {
      const s = this.toScreen(own.x, own.y)
      tags.reserve(s.x, s.y - labelUp, 24, 28)
    }
    for (const c of snap.cars) {
      const v = this.views.get(c.id)
      if (!v) continue
      const s = this.toScreen(v.x, v.y)
      const inView =
        s.x > this.view.x &&
        s.x < this.view.x + this.view.w &&
        s.y > this.view.y + 16 &&
        s.y < this.view.y + this.view.h
      if (c.id === this.selfId) {
        v.label.setVisible(false)
        if (inView) this.marker?.place(s.x, s.y - labelUp, now)
        else this.marker?.hide()
        continue
      }
      const x = Math.round(s.x)
      const y = Math.round(s.y - labelUp)
      const shown = inView && tags.place(x, y, v.label.width, v.label.height)
      v.label
        .setPosition(x, y)
        .setAlpha(c.gone ? 0.35 : this.kind === 'stage' ? 0.75 : 1)
        .setVisible(shown)
      mm?.car(v.x, v.y, v.color, c.gone)
    }
    const mine = this.views.get(this.selfId)
    if (mine) mm?.self(mine.x, mine.y, mine.color)
    this.wrongWayCheck(snap, now)
  }

  // Wrong way: heading against the course direction at the nearest sample while moving.
  private wrongWayCheck(snap: CourseRaceSnapshot, now: number): void {
    const mine = this.views.get(this.selfId)
    if (!mine || !this.road || !this.ownActive || this.finished || snap.goInMs > 0) return
    const wrong = this.road.along(mine.a) < -0.5 && this.own.speed > 30
    if (wrong && !this.wrongWay) {
      this.sfx.wrong()
      this.say(this.t('game.microRace.wrongWay'), PALETTE.red, BANNER_MS)
    }
    if (wrong && this.bannerUntil > 0) this.bannerUntil = Math.max(this.bannerUntil, now + 300)
    this.wrongWay = wrong
  }

  // World point → screen (for fx that live on the fixed layer).
  protected toScreen(x: number, y: number): { x: number; y: number } {
    const world = this.world
    if (!world) return { x, y }
    return { x: world.x + x * world.scaleX, y: world.y + y * world.scaleY }
  }

  // Start countdown 3 · 2 · 1 · GO!
  private paintLights(snap: CourseRaceSnapshot, now: number): void {
    const lights = this.countdown
    if (!lights) return
    if (this.goHideAt > 0 && now >= this.goHideAt) {
      this.goHideAt = 0
      lights.setVisible(false)
    }
    if (snap.goInMs > 0) {
      this.sawCountdown = true
      const n = String(Math.ceil(snap.goInMs / 800))
      if (lights.text !== n) {
        lights.setText(n).setColor(hexToCss(PALETTE.red)).setVisible(true)
        if (!this.firstSnapshot) this.sfx.tick()
      }
      return
    }
    if (!this.announcedGo) {
      this.announcedGo = true
      // Joined (or relaid out) mid-race: no GO! to replay.
      if (!this.sawCountdown) {
        lights.setVisible(false)
        return
      }
      this.sfx.go()
      lights.setText(this.t('game.courseRace.go')).setColor(hexToCss(PALETTE.lime)).setVisible(true)
      this.goHideAt = now + 700
    }
  }

  // The race clock (since the green light), extrapolated between snapshots; yours stops at the flag.
  private paintClock(snap: CourseRaceSnapshot, now: number): void {
    const text = this.clockText
    if (!text) return
    const racing = snap.goInMs <= 0 && this.goHideAt === 0
    text.setVisible(racing)
    if (!racing) return
    const me = snap.cars.find((c) => c.id === this.selfId)
    const ms =
      me?.finishMs ?? snap.raceMs + (this.state.final ? 0 : this.clock.since(snap.remainingMs, now))
    text.setText(raceClock(ms))
  }

  private onSnapshot(snap: CourseRaceSnapshot, now: number): void {
    const prev = this.prev
    this.prev = snap
    const me = snap.cars.find((c) => c.id === this.selfId)
    if (me) this.hud?.setScore(this.statusOf(me, snap))
    this.standings?.set(
      snap.cars.map((c) => ({
        id: c.id,
        pos: c.pos,
        name: this.label(c.id),
        color: this.state.colorOf(c.id, PALETTE.text),
        avatar: this.state.avatarOf(c.id),
        mine: c.id === this.selfId,
        done: c.finishMs !== null,
        gone: c.gone,
      })),
    )
    if (!prev || this.firstSnapshot) {
      this.progressMs = snap.raceMs
      if (me?.finishMs != null) this.onFinished(me, false)
      return
    }
    const before = new Map(prev.cars.map((c) => [c.id, c]))
    for (const c of snap.cars) {
      const was = before.get(c.id)
      if (!was) continue
      if (c.id !== this.selfId) {
        // Rivals trading paint (yours sounded when it happened on your screen): a softer crunch.
        const bumped = c.hits > was.hits && now - this.lastLocalBump > 400
        if (bumped && now - this.lastRivalBumpAt >= RIVAL_BUMP_MS) {
          this.lastRivalBumpAt = now
          this.sfx.quiet(() => this.sfx.crash(), RIVAL_LEVEL * 0.75)
        }
        // Someone else takes the flag: the crowd roars (yours plays with your own finish).
        const done = c.finishMs !== null && was.finishMs === null && !c.gone
        if (done && now - this.lastCheerAt >= CHEER_GAP_MS) {
          this.lastCheerAt = now
          this.sfx.quiet(() => this.sfx.cheer(), RIVAL_LEVEL)
        }
        continue
      }
      const v = this.views.get(c.id)
      const at = this.toScreen(v?.x ?? c.x, v?.y ?? c.y)
      if (c.hits > was.hits && now - this.lastLocalBump > 400) this.bumpFx(at)
      if (c.resets > was.resets) {
        const q = this.toScreen(c.x, c.y)
        ring(this, q.x, q.y, v?.color ?? PALETTE.amber, 40 * this.zoom)
        flash(this, PALETTE.red, 160, 0.25)
        floatText(
          this,
          q.x,
          q.y - 24,
          this.t('game.courseRace.rescued'),
          PALETTE.amber,
          this.compact ? 12 : 16,
        )
        this.sfx.wrong()
        this.cam.ready = false
      }
      if (c.boost && !was.boost) {
        // Already heard the frame your car rolled onto the pad (unless the prediction missed it).
        if (now - this.lastPadAt > 600) this.sfx.powerUp()
        burst(this, at.x, at.y, PALETTE.cyan, 8, 160)
      }
      // Tucked into a slipstream: a rush of air as the tow kicks in (not again for one that flickers).
      if (c.draft && !was.draft && c.finishMs === null && now - this.lastDraftAt > 2000) {
        this.lastDraftAt = now
        this.sfx.whoosh()
      }
      this.progress(was, c, snap)
      if (c.finishMs !== null && was.finishMs === null) this.onFinished(c, true)
    }
    if (me && snap.closing && !prev.closing && me.finishMs === null) {
      this.sfx.tick()
      this.say(this.t('game.courseRace.hurry'), PALETTE.amber, BANNER_MS)
    }
  }

  // A lap (circuit) or a checkpoint (stage) just went by: a pop with the lap / split time.
  private progress(was: CourseCar, me: CourseCar, snap: CourseRaceSnapshot): void {
    if (me.finishMs !== null) return
    if (this.kind === 'circuit' && me.lap > was.lap) {
      const lapTime = raceClock(snap.raceMs - this.progressMs)
      this.progressMs = snap.raceMs
      const last = me.lap === snap.laps
      this.sfx.correct()
      this.say(
        last ? this.t('game.microRace.finalLap') : this.t('game.courseRace.lap', { lap: me.lap }),
        last ? PALETTE.amber : PALETTE.cyan,
        BANNER_MS,
        lapTime,
      )
    } else if (this.kind === 'stage' && me.checkpoint > was.checkpoint && me.splitMs !== null) {
      this.sfx.correct()
      this.say(
        this.t('game.courseRace.split', { time: raceClock(me.splitMs) }),
        PALETTE.cyan,
        BANNER_MS,
        `${me.checkpoint}/${snap.checkpoints}`,
      )
    }
  }

  private onFinished(me: CourseCar, withFx: boolean): void {
    this.finished = true
    this.wrongWay = false
    const win = me.pos === 1
    this.placeBanner()
    if (this.banner)
      showBanner(
        this,
        this.banner,
        win ? this.t('game.common.youWin') : this.t('game.courseRace.finished', { pos: me.pos }),
        win ? PALETTE.lime : PALETTE.amber,
      )
    this.bannerUntil = 0
    this.subline
      ?.setText(
        `${this.t('game.microRace.time', { time: raceClock(me.finishMs ?? 0) })}\n${this.t('game.common.waiting')}`,
      )
      .setVisible(true)
    if (!withFx) return
    this.lastCheerAt = this.time.now
    this.sfx.cheer()
    if (win) this.sfx.win()
    const x = this.scale.width / 2
    const y = this.banner?.y ?? this.scale.height / 2
    burst(this, x, y, PALETTE.amber, 24, 260)
    burst(this, x, y, this.state.colorOf(this.selfId, PALETTE.lime), 18, 220)
  }

  // The flag fell before your car made it home: say so, with where it ended up.
  private timeUp(snap: CourseRaceSnapshot): void {
    const me = snap.cars.find((c) => c.id === this.selfId)
    if (!me || me.finishMs !== null || this.finished || this.timeUpShown) return
    this.timeUpShown = true
    this.wrongWay = false
    this.placeBanner()
    if (this.banner) showBanner(this, this.banner, this.t('game.microRace.outOfTime'), PALETTE.red)
    this.bannerUntil = 0
    this.subline?.setText(this.statusOf(me, snap)).setVisible(true)
  }

  // Transient banner (a lap, a split, hurry, wrong way) with an optional small line; the finish and
  // out-of-time banners are sticky.
  private say(text: string, color: number, ms: number, sub = ''): void {
    if (!this.banner || this.finished || this.timeUpShown) return
    this.placeBanner()
    showBanner(this, this.banner, text, color)
    this.subline?.setText(sub).setVisible(sub !== '')
    this.bannerUntil = this.time.now + ms
  }

  // Banners go in the half of the view your car isn't in.
  private placeBanner(): void {
    const me = this.views.get(this.selfId)
    const carY = me ? this.toScreen(me.x, me.y).y : this.top + this.view.h / 2
    const low = carY < this.top + this.view.h * 0.5
    const y = this.top + this.view.h * (low ? 0.68 : 0.3)
    this.banner?.setY(y)
    this.subline?.setY(y + (this.compact ? 34 : 50))
  }
}
