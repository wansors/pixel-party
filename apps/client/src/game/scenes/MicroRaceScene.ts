import {
  MICRO_RACE_CAR_R,
  MICRO_RACE_PHYSICS,
  MICRO_RACE_TRACKS,
  MICRO_RACE_WORLD,
  type MicroRaceCar,
  type MicroRacePoint,
  type MicroRaceSnapshot,
  type MicroRaceTheme,
  PALETTE,
  RACE_DRAFT_TUNING,
  sampleMicroRaceTrack,
} from '@pp/shared'
import type Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { addBanner, burst, flash, floatText, ring, shake, showBanner } from '../fx'
import { ServerClock } from '../netcode/ServerClock'
import {
  bodyStyle,
  ensureBevelPanel,
  ensurePixelGrid,
  ensurePixelOrb,
  headlineStyle,
  shade,
} from '../pixelStyle'
import { YouMarker, nameTagStyle } from '../playerMarks'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'
import {
  CAR_COLS,
  CAR_LINES,
  CAR_ROWS,
  TEXEL,
  TRACK_TEX_H,
  TRACK_TEX_W,
  paintMicroTrack,
} from './microRaceArt'
import { DriveControls, LabelDeclutter, RaceMinimap, RaceStandings } from './raceKit'
import { type CarPose, OwnCar, RivalCars, RoadIndex, raceClock } from './raceNet'

// World units shown across the view's shorter side (bigger = more zoomed out).
const VIEW_SPAN = 360
const LOOK_AHEAD = 70
const CAM_RATE = 5
// Cars snap to 32 headings, like a classic sprite-rotation racer.
const HEADING_STEP = Math.PI / 16
const DUST: Record<MicroRaceTheme, number> = { kitchen: 0xd9b27f, desk: 0x9fe0bf, pool: 0x8fd0a8 }
const BANNER_MS = 1200
// The server's bump: restitution, and the approach speed that counts as a hit.
const RESTITUTION = 1.1
const HIT_MIN_SPEED = 60
// A table-edge hit: the world wall flipped a velocity component at least this fast (world units/s).
const WALL_HIT_SPEED = 70
// Other cars crossing the line get the crowd at most this often (a pack finishing together is one roar).
const CHEER_GAP_MS = 1500
// Rivals' moments play at this fraction of the volume (yours stay full), and their bumps at most this
// often — a twelve-car pile-up is one crunch.
const RIVAL_LEVEL = 0.4
const RIVAL_BUMP_MS = 400
const NO_TUNING = {}

interface CarView {
  sprite: Phaser.GameObjects.Image
  // The driver: the player's lobby avatar riding in the cockpit (turns with the car).
  pilot: Phaser.GameObjects.Image
  shadow: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  color: number
  wx: number
  wy: number
  a: number
  hits: number
  resets: number
}

// Micro Race canvas. A camera-follow view of a pixel tabletop circuit (painted once per track from the
// shared spline). Your own car is predicted locally with the server's integrator (it turns the frame
// you press a key; snapshots only nudge it back in line), every other car is dead-reckoned to the
// server's present. Steer with the arrows / WASD (SPACE brakes) or by holding the pointer where you
// want to go. A minimap, a standings column and the race clock show the whole race; start lights,
// laps (with lap times), bumps, rescues, the flag and the finish window are all derived from snapshot
// deltas. Wind lines trail a car in a slipstream; a driver who left fades to a ghost.
export class MicroRaceScene extends MiniGameScene<MicroRaceSnapshot> {
  private readonly clock = new ServerClock()
  private readonly rivals = new RivalCars()
  private readonly own = new OwnCar()
  private ownActive = false
  private ownResets = 0
  private lastLocalBump = 0
  private lastWallAt = 0
  private lastRivalBumpAt = Number.NEGATIVE_INFINITY
  private lastCheerAt = Number.NEGATIVE_INFINITY
  private drafting = false
  private lastDraftAt = Number.NEGATIVE_INFINITY
  private readonly finishSeen = new Set<string>()
  private snapAt = 0
  private readonly cars = new Map<string, CarView>()
  private carKeys = new Map<number, string>()
  private lastTick = -1
  private compact = false
  private view = { x: 0, y: 0, w: 0, h: 0 }
  private zoom = 1
  private cam = { x: 0, y: 0, ready: false }
  private track = -1
  private samples: MicroRacePoint[] = []
  private road?: RoadIndex
  private theme: MicroRaceTheme = 'kitchen'
  private trackImage?: Phaser.GameObjects.Image
  private tableShadow?: Phaser.GameObjects.Graphics
  private minimap?: RaceMinimap
  // Slipstream wind lines behind towed cars (screen space, under the cars).
  private trails?: Phaser.GameObjects.Graphics
  private mmBox = { x: 0, y: 0, w: 0 }
  private standings?: RaceStandings
  private clockText?: Phaser.GameObjects.Text
  private lamps: Phaser.GameObjects.Image[] = []
  private lampPanel?: Phaser.GameObjects.Image
  private lampKeys = { off: '', red: '', green: '' }
  private lit = -1
  private lightsUntil = 0
  private marker?: YouMarker
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private bannerUntil = 0
  private controls?: DriveControls
  private readonly tags = new LabelDeclutter()
  private lastLap = 1
  private lapStartMs = 0
  private finished = false
  private closingSeen = false
  private timeUpShown = false
  private wrongWay = false
  private lastDustAt = 0
  private selfSpeed = 0
  private selfPrev?: { x: number; y: number }

  constructor(...deps: SceneDeps) {
    super('micro-race', ...deps)
  }

  override create(): void {
    super.create()
    this.clock.reset()
    this.rivals.reset()
    this.ownActive = false
    this.ownResets = 0
    this.lastLocalBump = 0
    this.lastWallAt = 0
    this.lastRivalBumpAt = Number.NEGATIVE_INFINITY
    this.lastCheerAt = Number.NEGATIVE_INFINITY
    this.drafting = false
    this.lastDraftAt = Number.NEGATIVE_INFINITY
    this.finishSeen.clear()
    this.snapAt = 0
    for (const c of this.cars.values()) {
      c.sprite.destroy()
      c.pilot.destroy()
      c.shadow.destroy()
      c.label.destroy()
    }
    this.cars.clear()
    this.lastTick = -1
    this.cam = { x: 0, y: 0, ready: false }
    this.track = -1
    this.samples = []
    this.road = undefined
    this.trackImage = undefined
    this.tableShadow = undefined
    this.minimap = undefined
    this.lamps = []
    this.lit = -1
    this.lightsUntil = 0
    this.bannerUntil = 0
    this.lastLap = 1
    this.lapStartMs = 0
    this.finished = false
    this.closingSeen = false
    this.timeUpShown = false
    this.wrongWay = false
    this.lastDustAt = 0
    this.selfSpeed = 0
    this.selfPrev = undefined

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    const big = !this.compact && height >= 900
    const hintH = this.compact ? 22 : 30
    this.view = { x: 0, y: this.top, w: width, h: height - this.top - hintH }
    this.zoom = Math.max(0.9, Math.min(2.4, Math.min(this.view.w, this.view.h) / VIEW_SPAN))

    // Opaque strips behind the HUD and the hint so the scrolling table never runs under them.
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

    // Minimap (top-right, built with the track) and standings (top-left), laid over the view.
    const pad = this.compact ? 6 : 10
    const mmW = this.compact ? 104 : Math.round(Math.max(180, Math.min(300, width * 0.14)))
    this.mmBox = { x: width - mmW - pad - 6, y: this.top + pad + 6, w: mmW }
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

    // Start lights.
    const lampD = this.compact ? 22 : 32
    this.lampKeys = {
      off: ensurePixelOrb(this, 'pp-mr-lamp-off', 12, 0x3a3f52),
      red: ensurePixelOrb(this, 'pp-mr-lamp-red', 12, PALETTE.red),
      green: ensurePixelOrb(this, 'pp-mr-lamp-green', 12, PALETTE.lime),
    }
    const mmH = Math.round((mmW * MICRO_RACE_WORLD.h) / MICRO_RACE_WORLD.w)
    const lampY = this.top + (this.compact ? mmH + 40 : 48)
    const panelW = lampD * 3 + lampD * 1.4
    this.lampPanel = this.add
      .image(
        width / 2,
        lampY,
        ensureBevelPanel(this, panelW, lampD * 1.5, PALETTE.panelAlt, 3, true),
      )
      .setDepth(720)
      .setVisible(false)
    for (let i = 0; i < 3; i++) {
      this.lamps.push(
        this.add
          .image(width / 2 + (i - 1) * lampD * 1.2, lampY, this.lampKeys.off)
          .setDisplaySize(lampD, lampD)
          .setDepth(721)
          .setVisible(false),
      )
    }

    this.trails = this.add.graphics().setDepth(18)
    this.marker = new YouMarker(this, this.compact ? 12 : 16, 40)
    // Banners go on whichever half of the view the player's car isn't in (see placeBanner).
    const bannerY = this.top + this.view.h * 0.3
    this.banner = addBanner(this).setY(bannerY)
    this.subline = this.add
      .text(
        width / 2,
        bannerY + (this.compact ? 34 : 50),
        '',
        headlineStyle(this.compact ? 12 : 16, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setDepth(950)
      .setVisible(false)

    this.controls = new DriveControls(this)
  }

  // --- world ↔ screen -------------------------------------------------------------------------------

  private toScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: this.view.x + this.view.w / 2 + (wx - this.cam.x) * this.zoom,
      y: this.view.y + this.view.h / 2 + (wy - this.cam.y) * this.zoom,
    }
  }

  // --- track ----------------------------------------------------------------------------------------

  private buildTrack(index: number): void {
    const def = MICRO_RACE_TRACKS[index] ?? MICRO_RACE_TRACKS[0]
    if (!def) return
    this.track = index
    this.theme = def.theme
    this.samples = sampleMicroRaceTrack(def, 8)
    this.road = new RoadIndex(this.samples, true)
    const key = `pp-mr-track-${index}`
    if (!this.textures.exists(key)) {
      const tex = this.textures.createCanvas(key, TRACK_TEX_W, TRACK_TEX_H)
      const ctx = tex?.getContext()
      if (tex && ctx) {
        const img = ctx.createImageData(TRACK_TEX_W, TRACK_TEX_H)
        img.data.set(paintMicroTrack(index))
        ctx.putImageData(img, 0, 0)
        tex.refresh()
      }
    }
    this.trackImage?.destroy()
    this.trackImage = this.add.image(0, 0, key).setOrigin(0, 0).setDepth(0)
    // A soft shadow along the table's far edges so it reads as furniture on the floor (two strips, not
    // a full table-sized quad hidden under the table).
    this.tableShadow?.destroy()
    const { w, h } = MICRO_RACE_WORLD
    this.tableShadow = this.add
      .graphics()
      .fillStyle(0x000000, 0.4)
      .fillRect(w, 14, 10, h)
      .fillRect(10, h, w - 10, 14)
      .setDepth(-1)
    this.minimap = new RaceMinimap(
      this,
      this.mmBox.x,
      this.mmBox.y,
      this.mmBox.w,
      MICRO_RACE_WORLD,
      this.samples,
      def.halfWidth,
      true,
      this.compact,
      711,
    )
  }

  private carKey(color: number): string {
    let key = this.carKeys.get(color)
    if (!key) {
      key = ensurePixelGrid(this, {
        key: `pp-mr-car-${color.toString(16)}`,
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
      this.carKeys.set(color, key)
    }
    return key
  }

  private shadowKey(): string {
    return ensurePixelGrid(this, {
      key: 'pp-mr-car-shadow',
      rows: CAR_ROWS,
      legend: { k: 0, o: 0, b: 0, h: 0, W: 0, w: 0, g: 0, y: 0 },
      pixelSize: 2,
    })
  }

  private viewOf(c: MicroRaceCar): CarView {
    let v = this.cars.get(c.id)
    if (!v) {
      const color = this.state.colorOf(c.id, PALETTE.red)
      const mine = c.id === this.selfId
      const w = CAR_COLS * TEXEL * this.zoom
      const h = CAR_LINES * TEXEL * this.zoom
      v = {
        sprite: this.add
          .image(0, 0, this.carKey(color))
          .setDisplaySize(w, h)
          .setDepth(mine ? 21 : 20),
        pilot: this.add
          .image(0, 0, ensureAvatarTexture(this, this.state.avatarOf(c.id), color, 2))
          .setDisplaySize(h * 0.62, h * 0.62)
          .setDepth(mine ? 21.5 : 20.5),
        shadow: this.add
          .image(0, 0, this.shadowKey())
          .setDisplaySize(w, h)
          .setAlpha(0.35)
          .setDepth(15),
        label: this.add
          .text(0, 0, this.label(c.id), nameTagStyle(this.compact ? 8 : 12, color))
          .setOrigin(0.5, 1)
          .setDepth(30),
        color,
        wx: c.x,
        wy: c.y,
        a: c.a,
        hits: c.hits,
        resets: c.resets,
      }
      this.cars.set(c.id, v)
    }
    return v
  }

  // --- per frame ------------------------------------------------------------------------------------

  protected frame(snap: MicroRaceSnapshot | null, _time: number, delta: number): void {
    const now = this.time.now
    let fresh = false
    if (snap && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      if (snap.track !== this.track) this.buildTrack(snap.track)
      this.clock.sync(snap.remainingMs, now)
      this.snapAt = now - this.clock.since(snap.remainingMs, now)
      this.rivals.push(snap.cars, this.snapAt, now)
      this.onSnapshot(snap, now)
      fresh = true
    }
    this.updateLights(snap?.goInMs ?? 0, now)
    if (snap && this.state.final) this.timeUp(snap)
    if (this.bannerUntil > 0 && now > this.bannerUntil) {
      this.bannerUntil = 0
      this.banner?.setVisible(false)
      // A transient banner's small line (a lap time) goes with it.
      if (!this.finished && !this.timeUpShown) this.subline?.setVisible(false)
    }
    if (!snap) return
    this.drive(snap, now, fresh)
    this.render(snap, now, delta)
    this.paintClock(snap, now)
  }

  // Your controls → the server (on change only), and your car's local prediction.
  private drive(snap: MicroRaceSnapshot, now: number, fresh: boolean): void {
    const me = snap.cars.find((c) => c.id === this.selfId)
    const racing = !!me && !me.gone && me.finishMs === null && !this.state.final && !this.finished
    if (!me || !racing) {
      // Spectators and finishers have nothing to drive; a finished car rolls on as the server has it.
      if (this.ownActive && me) this.rivals.adopt(me.id, this.own.pose(), now)
      this.ownActive = false
      return
    }
    const shown = this.cars.get(me.id)
    const at = shown ? this.toScreen(shown.wx, shown.wy) : null
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
    const goIn = snap.goInMs - this.clock.since(snap.remainingMs, now)
    if (goIn > 0) {
      // On the grid until the green light.
      if (fresh) this.own.snapTo(me)
      this.own.hold(now)
      return
    }
    const def = MICRO_RACE_TRACKS[this.track]
    this.road?.update(body.x, body.y)
    body.off = !!def && (this.road?.dist ?? 0) > def.halfWidth
    const vx0 = body.vx
    const vy0 = body.vy
    this.own.step(now, {
      physics: MICRO_RACE_PHYSICS,
      tuning: me.draft ? RACE_DRAFT_TUNING : NO_TUNING,
      world: MICRO_RACE_WORLD,
      carR: MICRO_RACE_CAR_R,
    })
    this.wallHit(vx0, vy0, now)
    if (fresh) {
      if (me.resets > this.ownResets) this.own.snapTo(me)
      else this.own.reconcile(me, this.snapAt)
    }
    this.ownResets = me.resets
    // Bumps happen on your screen right away (the server's verdict follows a snapshot later).
    for (const c of snap.cars) {
      if (c.id === me.id || c.gone) continue
      const other = this.rivals.state(c.id, now)
      if (!other) continue
      const hit = this.own.contact(other, MICRO_RACE_CAR_R, RESTITUTION)
      if (hit >= HIT_MIN_SPEED && now - this.lastLocalBump > 250) {
        this.lastLocalBump = now
        const p = this.own.pose()
        const s = this.toScreen(p.x, p.y)
        this.bumpFx(s.x, s.y)
      }
    }
  }

  // Your car slamming into the table's edge: the step's wall bounce flipped a fast velocity component
  // with the car pressed against that edge.
  private wallHit(vx0: number, vy0: number, now: number): void {
    const b = this.own.body
    const r = MICRO_RACE_CAR_R + 1
    const { w, h } = MICRO_RACE_WORLD
    const hitX = vx0 * b.vx < 0 && Math.abs(vx0) >= WALL_HIT_SPEED && (b.x <= r || b.x >= w - r)
    const hitY = vy0 * b.vy < 0 && Math.abs(vy0) >= WALL_HIT_SPEED && (b.y <= r || b.y >= h - r)
    if (!(hitX || hitY) || now - this.lastWallAt < 400) return
    this.lastWallAt = now
    this.sfx.crash()
    shake(this, 0.005, 110)
  }

  private bumpFx(x: number, y: number): void {
    burst(this, x, y, PALETTE.text, 10, 150)
    this.sfx.crash()
    shake(this, 0.006, 120)
    floatText(this, x, y - 24, this.t('game.microRace.bump'), PALETTE.amber, this.compact ? 12 : 16)
  }

  private onSnapshot(snap: MicroRaceSnapshot, now: number): void {
    const me = snap.cars.find((c) => c.id === this.selfId)
    this.hud?.setScore(
      me ? this.t('game.microRace.status', { lap: me.lap, laps: snap.laps, pos: me.pos }) : '',
    )
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

    if (this.firstSnapshot) {
      // Adopt the race as it is (a relayout mid-race must not replay laps, bumps or the flag).
      for (const c of snap.cars) {
        this.viewOf(c)
        if (c.finishMs !== null) this.finishSeen.add(c.id)
      }
      this.drafting = !!me?.draft
      this.lastLap = me?.lap ?? 1
      this.lapStartMs = snap.raceMs
      this.closingSeen = snap.closing
      this.lit = snap.goInMs > 0 ? this.litFor(snap.goInMs) : 4
      if (me && me.finishMs !== null) this.onFinished(me, false)
      return
    }

    // Start lights.
    const lit = snap.goInMs > 0 ? this.litFor(snap.goInMs) : 4
    if (lit !== this.lit) {
      if (lit === 4) {
        this.sfx.go()
        this.say(this.t('game.microRace.go'), PALETTE.lime, 800)
        this.lightsUntil = now + 900
      } else this.sfx.tick()
      this.lit = lit
    }

    for (const c of snap.cars) {
      const v = this.viewOf(c)
      const mine = c.id === this.selfId
      const p = this.toScreen(v.wx, v.wy)
      if (c.hits > v.hits) {
        // Your own bump already played the moment it happened on your screen; rivals' are softer.
        if (!mine) {
          burst(this, p.x, p.y, PALETTE.text, 6, 150)
          if (now - this.lastRivalBumpAt >= RIVAL_BUMP_MS && now - this.lastLocalBump > 400) {
            this.lastRivalBumpAt = now
            this.sfx.quiet(() => this.sfx.crash(), RIVAL_LEVEL * 0.75)
          }
        } else if (now - this.lastLocalBump > 400) this.bumpFx(p.x, p.y)
      }
      if (c.resets > v.resets) {
        const q = this.toScreen(c.x, c.y)
        ring(this, q.x, q.y, v.color, 30 * this.zoom)
        if (mine) {
          this.sfx.wrong()
          flash(this, PALETTE.red, 160, 0.25)
          floatText(
            this,
            q.x,
            q.y - 26,
            this.t('game.microRace.rescued'),
            PALETTE.red,
            this.compact ? 12 : 16,
          )
          this.cam.ready = false
        }
      }
      v.hits = c.hits
      v.resets = c.resets
      // Someone else takes the flag: the crowd roars (yours plays with your own finish).
      if (c.finishMs !== null && !this.finishSeen.has(c.id)) {
        this.finishSeen.add(c.id)
        if (!mine && !c.gone && now - this.lastCheerAt >= CHEER_GAP_MS) {
          this.lastCheerAt = now
          this.sfx.quiet(() => this.sfx.cheer(), RIVAL_LEVEL)
        }
      }
    }

    if (!me) return
    // Tucked into a slipstream: a rush of air as the tow kicks in (not again for a tow that flickers).
    if (me.draft && !this.drafting && me.finishMs === null && now - this.lastDraftAt > 2000) {
      this.lastDraftAt = now
      this.sfx.whoosh()
    }
    this.drafting = me.draft
    if (!this.finished && me.lap > this.lastLap) {
      const lapTime = raceClock(snap.raceMs - this.lapStartMs)
      this.lapStartMs = snap.raceMs
      if (me.lap === snap.laps) {
        this.sfx.correct()
        this.say(this.t('game.microRace.finalLap'), PALETTE.amber, BANNER_MS, lapTime)
      } else {
        this.sfx.coin()
        this.say(this.t('game.microRace.lap', { n: me.lap }), PALETTE.cyan, BANNER_MS, lapTime)
      }
    }
    this.lastLap = me.lap
    if (me.finishMs !== null && !this.finished) this.onFinished(me, true)
    if (snap.closing && !this.closingSeen) {
      this.closingSeen = true
      if (!this.finished) {
        this.sfx.tick()
        this.say(this.t('game.microRace.hurry'), PALETTE.red, BANNER_MS)
      }
    }
  }

  // The race clock (since the green light), extrapolated between snapshots; yours stops at the flag.
  private paintClock(snap: MicroRaceSnapshot, now: number): void {
    const text = this.clockText
    if (!text) return
    const me = snap.cars.find((c) => c.id === this.selfId)
    const racing = snap.goInMs <= 0 && this.lit === 4 && now >= this.lightsUntil
    text.setVisible(racing)
    if (!racing) return
    const ms =
      me?.finishMs ?? snap.raceMs + (this.state.final ? 0 : this.clock.since(snap.remainingMs, now))
    text.setText(raceClock(ms))
  }

  // The flag fell before this car made it home: say so, with where it ended up.
  private timeUp(snap: MicroRaceSnapshot): void {
    const me = snap.cars.find((c) => c.id === this.selfId)
    if (!me || me.finishMs !== null || this.finished || this.timeUpShown) return
    this.timeUpShown = true
    this.wrongWay = false
    this.placeBanner()
    if (this.banner) showBanner(this, this.banner, this.t('game.microRace.outOfTime'), PALETTE.red)
    this.bannerUntil = 0
    this.subline?.setText(`P${me.pos}`).setVisible(true)
  }

  private onFinished(me: MicroRaceCar, withFx: boolean): void {
    this.finished = true
    this.wrongWay = false
    const win = me.pos === 1
    const text = win
      ? this.t('game.common.youWin')
      : this.t('game.microRace.finished', { pos: me.pos })
    this.placeBanner()
    if (this.banner) showBanner(this, this.banner, text, win ? PALETTE.lime : PALETTE.amber)
    this.bannerUntil = 0
    this.subline
      ?.setText(
        `${this.t('game.microRace.time', { time: raceClock(me.finishMs ?? 0) })}\n${this.t('game.common.waiting')}`,
      )
      .setAlign('center')
      .setLineSpacing(8)
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

  // Transient banner (lap, GO!, hurry…) with an optional small line under it; the finish banner is
  // sticky.
  private say(text: string, color: number, ms: number, sub = ''): void {
    if (!this.banner || this.finished || this.timeUpShown) return
    this.placeBanner()
    showBanner(this, this.banner, text, color)
    this.subline?.setText(sub).setVisible(sub !== '')
    this.bannerUntil = this.time.now + ms
  }

  // The camera clamps at the table edges, so the car isn't always mid-view: keep banners clear of it.
  private placeBanner(): void {
    const me = this.cars.get(this.selfId)
    const carY = me ? this.toScreen(me.wx, me.wy).y : this.top + this.view.h / 2
    const low = carY < this.top + this.view.h * 0.5
    const y = this.top + this.view.h * (low ? 0.66 : 0.26)
    this.banner?.setY(y)
    this.subline?.setY(y + (this.compact ? 34 : 50))
  }

  private litFor(goInMs: number): number {
    return goInMs > 1600 ? 1 : goInMs > 800 ? 2 : 3
  }

  // Lights stay up through the countdown and a beat after the green.
  private updateLights(goInMs: number, now: number): void {
    const show = this.lit >= 0 && (goInMs > 0 || now < this.lightsUntil)
    this.lampPanel?.setVisible(show)
    this.lamps.forEach((lamp, i) => {
      lamp.setVisible(show)
      const key =
        this.lit === 4 ? this.lampKeys.green : i < this.lit ? this.lampKeys.red : this.lampKeys.off
      if (lamp.texture.key !== key) lamp.setTexture(key)
    })
  }

  private render(snap: MicroRaceSnapshot, now: number, delta: number): void {
    const freeze = this.state.final
    for (const c of snap.cars) {
      const v = this.viewOf(c)
      const pose: CarPose | null =
        c.id === this.selfId && this.ownActive
          ? this.own.pose()
          : this.rivals.pose(c.id, now, delta, freeze)
      if (!pose) continue
      v.wx = pose.x
      v.wy = pose.y
      v.a = pose.a
    }

    // Camera: chase the player's own car (or the leader) with a little look-ahead.
    const me = this.cars.get(this.selfId) ?? this.cars.get(snap.cars[0]?.id ?? '')
    if (me) {
      if (me === this.cars.get(this.selfId)) this.trackSpeed(me, delta)
      const look = LOOK_AHEAD * Math.min(1, this.selfSpeed / 120)
      const tx = me.wx + Math.cos(me.a) * look
      const ty = me.wy + Math.sin(me.a) * look
      if (!this.cam.ready) {
        this.cam = { x: tx, y: ty, ready: true }
      } else {
        const k = 1 - Math.exp((-CAM_RATE * delta) / 1000)
        this.cam.x += (tx - this.cam.x) * k
        this.cam.y += (ty - this.cam.y) * k
      }
      const halfW = this.view.w / 2 / this.zoom
      const halfH = this.view.h / 2 / this.zoom
      const margin = 60
      const { w, h } = MICRO_RACE_WORLD
      this.cam.x =
        halfW * 2 > w + margin * 2
          ? w / 2
          : Math.max(halfW - margin, Math.min(w - halfW + margin, this.cam.x))
      this.cam.y =
        halfH * 2 > h + margin * 2
          ? h / 2
          : Math.max(halfH - margin, Math.min(h - halfH + margin, this.cam.y))
    }

    if (this.trackImage) {
      const o = this.toScreen(0, 0)
      this.trackImage.setPosition(o.x, o.y).setScale(this.zoom * TEXEL)
      this.tableShadow?.setPosition(o.x, o.y).setScale(this.zoom)
    }

    const lift = this.zoom * 2
    const trails = this.trails
    trails?.clear()
    const tagUp = CAR_COLS * TEXEL * this.zoom * 0.5 + 2
    const tags = this.tags
    tags.reset()
    const own = this.cars.get(this.selfId)
    if (own) {
      const s = this.toScreen(own.wx, own.wy)
      tags.reserve(s.x, s.y - tagUp, 24, 28)
    }
    for (const c of snap.cars) {
      const v = this.cars.get(c.id)
      if (!v) continue
      const p = this.toScreen(v.wx, v.wy)
      const heading = Math.round(v.a / HEADING_STEP) * HEADING_STEP
      v.sprite.setPosition(p.x, p.y).setRotation(heading)
      v.pilot.setPosition(p.x, p.y).setRotation(heading)
      v.shadow.setPosition(p.x + lift, p.y + lift * 1.5).setRotation(heading)
      // Name tags in race order; one that would overlap another waits until the pack spreads out.
      v.label
        .setPosition(Math.round(p.x), Math.round(p.y - tagUp))
        .setVisible(
          c.id !== this.selfId && tags.place(p.x, p.y - tagUp, v.label.width, v.label.height),
        )
      // A driver who left races on as a faded ghost that blocks no one.
      const alpha = c.gone ? 0.35 : 1
      v.sprite.setAlpha(alpha)
      v.pilot.setAlpha(alpha)
      v.label.setAlpha(alpha)
      v.shadow.setAlpha(c.gone ? 0.1 : 0.35)
      if (c.draft && trails) {
        const back = CAR_COLS * TEXEL * this.zoom * 0.55
        const bx = p.x - Math.cos(heading) * back
        const by = p.y - Math.sin(heading) * back
        trails.lineStyle(2, 0xffffff, 0.5)
        for (const off of [-0.25, 0.25]) {
          const ox = -Math.sin(heading) * off * back
          const oy = Math.cos(heading) * off * back
          trails.lineBetween(
            bx + ox,
            by + oy,
            bx + ox - Math.cos(heading) * back * 1.2,
            by + oy - Math.sin(heading) * back * 1.2,
          )
        }
      }
      if (c.id === this.selfId) this.selfCues(c, v, p, now)
    }
    const mm = this.minimap
    if (!mm) return
    mm.clear()
    for (const c of snap.cars) {
      const v = this.cars.get(c.id)
      if (v && c.id !== this.selfId) mm.car(v.wx, v.wy, v.color, c.gone)
    }
    const mine = this.cars.get(this.selfId)
    if (mine) mm.self(mine.wx, mine.wy, mine.color)
  }

  // Your speed on screen (the camera's look-ahead): the predicted car's own, else from its motion.
  private trackSpeed(v: CarView, delta: number): void {
    if (this.ownActive) {
      this.selfSpeed = this.own.speed
    } else if (this.selfPrev && delta > 0) {
      const d = Math.hypot(v.wx - this.selfPrev.x, v.wy - this.selfPrev.y)
      this.selfSpeed += ((d * 1000) / delta - this.selfSpeed) * 0.2
    }
    this.selfPrev = { x: v.wx, y: v.wy }
  }

  // "That's you" marker, off-road dust and the wrong-way warning for the player's own car.
  private selfCues(c: MicroRaceCar, v: CarView, p: { x: number; y: number }, now: number): void {
    v.label.setVisible(false)
    this.marker?.place(p.x, p.y - CAR_COLS * TEXEL * this.zoom * 0.5, now)
    const off = this.ownActive ? this.own.body.off : c.off
    if (off && this.selfSpeed > 40 && now - this.lastDustAt > 150) {
      this.lastDustAt = now
      const bx = p.x - Math.cos(v.a) * 12 * this.zoom
      const by = p.y - Math.sin(v.a) * 12 * this.zoom
      burst(this, bx, by, DUST[this.theme], 3, 50)
    }
    // Wrong way: heading against the course direction at the nearest sample while moving.
    if (this.finished || this.timeUpShown || !this.road) return
    if ((this.snap?.goInMs ?? 0) > 0) return
    if (!this.ownActive) this.road.update(v.wx, v.wy)
    const wrong = this.road.along(v.a) < -0.5 && this.selfSpeed > 30
    if (wrong && !this.wrongWay) {
      this.sfx.wrong()
      this.say(this.t('game.microRace.wrongWay'), PALETTE.red, BANNER_MS)
    }
    if (wrong && this.bannerUntil > 0) this.bannerUntil = Math.max(this.bannerUntil, now + 300)
    this.wrongWay = wrong
  }
}
