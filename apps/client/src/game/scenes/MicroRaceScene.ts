import {
  MICRO_RACE_TRACKS,
  MICRO_RACE_WORLD,
  type MicroRaceCar,
  type MicroRacePoint,
  type MicroRaceSnapshot,
  type MicroRaceTheme,
  PALETTE,
  sampleMicroRaceTrack,
} from '@pp/shared'
import type Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { addBanner, burst, flash, floatText, ring, shake, showBanner } from '../fx'
import { SnapshotInterpolator, lerp } from '../netcode/SnapshotInterpolator'
import {
  bodyStyle,
  ensureBevelPanel,
  ensurePixelGrid,
  ensurePixelOrb,
  headlineStyle,
  hexToCss,
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

// World units shown across the view's shorter side (bigger = more zoomed out).
const VIEW_SPAN = 360
const LOOK_AHEAD = 70
const CAM_RATE = 5
const SEND_EVERY_MS = 60
// Cars snap to 32 headings, like a classic sprite-rotation racer.
const HEADING_STEP = Math.PI / 16
const DUST: Record<MicroRaceTheme, number> = { kitchen: 0xd9b27f, desk: 0x9fe0bf, pool: 0x8fd0a8 }
const BANNER_MS = 1200

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

function wrapAngle(a: number): number {
  let r = a
  while (r > Math.PI) r -= Math.PI * 2
  while (r < -Math.PI) r += Math.PI * 2
  return r
}

const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t

// Micro Race canvas. A camera-follow view of a pixel tabletop circuit (painted once per track from the
// shared spline), every car interpolated from the snapshot and drawn as a pixel racer in its player's
// colour. Steer by holding where you want to go (touch/mouse) or with the arrow keys / WASD. A minimap
// and a standings column show the whole race; start lights, laps, bumps, rescues, the flag and the
// finish window are all derived from snapshot deltas. Wind lines trail a car in a slipstream; a driver
// who left fades to a ghost.
export class MicroRaceScene extends MiniGameScene<MicroRaceSnapshot> {
  private readonly interp = new SnapshotInterpolator<MicroRaceSnapshot>(100)
  private readonly cars = new Map<string, CarView>()
  private carKeys = new Map<number, string>()
  private lastTick = -1
  private compact = false
  private view = { x: 0, y: 0, w: 0, h: 0 }
  private zoom = 1
  private cam = { x: 0, y: 0, ready: false }
  private track = -1
  private samples: MicroRacePoint[] = []
  private theme: MicroRaceTheme = 'kitchen'
  private trackImage?: Phaser.GameObjects.Image
  private tableShadow?: Phaser.GameObjects.Rectangle
  private minimap?: { track: Phaser.GameObjects.Graphics; dots: Phaser.GameObjects.Graphics }
  // Slipstream wind lines behind towed cars (screen space, under the cars).
  private trails?: Phaser.GameObjects.Graphics
  private mm = { x: 0, y: 0, w: 0, h: 0 }
  private standings: Phaser.GameObjects.Text[] = []
  private standingsKey = ''
  private lamps: Phaser.GameObjects.Image[] = []
  private lampPanel?: Phaser.GameObjects.Image
  private lampKeys = { off: '', red: '', green: '' }
  private lit = -1
  private lightsUntil = 0
  private marker?: YouMarker
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private bannerUntil = 0
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>
  private aim?: { x: number; y: number }
  private drive = { steer: 0, throttle: 0 }
  // The last drive sent (the server starts every car parked).
  private sent = { steer: 0, throttle: 0 }
  private lastSentAt = 0
  private lastLap = 1
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
    this.interp.reset()
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
    this.trackImage = undefined
    this.tableShadow = undefined
    this.minimap = undefined
    this.standings = []
    this.standingsKey = ''
    this.lamps = []
    this.lit = -1
    this.lightsUntil = 0
    this.bannerUntil = 0
    this.aim = undefined
    this.drive = { steer: 0, throttle: 0 }
    this.sent = { steer: 0, throttle: 0 }
    this.lastSentAt = 0
    this.lastLap = 1
    this.finished = false
    this.closingSeen = false
    this.timeUpShown = false
    this.wrongWay = false
    this.lastDustAt = 0
    this.selfSpeed = 0
    this.selfPrev = undefined

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    const hintH = this.compact ? 22 : 28
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
        bodyStyle(this.compact ? 11 : 14, PALETTE.dim),
      )
      .setOrigin(0.5)
      .setDepth(701)

    // Minimap (top-right) and standings (top-left), laid over the view.
    const pad = this.compact ? 6 : 10
    const mmW = this.compact ? 104 : 180
    const mmH = Math.round((mmW * MICRO_RACE_WORLD.h) / MICRO_RACE_WORLD.w)
    this.mm = { x: width - mmW - pad, y: this.top + pad, w: mmW, h: mmH }
    this.add
      .image(
        this.mm.x - 4,
        this.mm.y - 4,
        ensureBevelPanel(this, mmW + 8, mmH + 8, PALETTE.panel, 2, true),
      )
      .setOrigin(0, 0)
      .setAlpha(0.85)
      .setDepth(710)
    const rowH = this.compact ? 13 : 17
    for (let i = 0; i < 10; i++) {
      this.standings.push(
        this.add
          .text(pad + 2, this.top + pad + i * rowH, '', {
            ...bodyStyle(this.compact ? 11 : 14, PALETTE.text, { fontStyle: 'bold' }),
            stroke: '#10121c',
            strokeThickness: 3,
          })
          .setDepth(712),
      )
    }

    // Start lights.
    const lampD = this.compact ? 22 : 32
    this.lampKeys = {
      off: ensurePixelOrb(this, 'pp-mr-lamp-off', 12, 0x3a3f52),
      red: ensurePixelOrb(this, 'pp-mr-lamp-red', 12, PALETTE.red),
      green: ensurePixelOrb(this, 'pp-mr-lamp-green', 12, PALETTE.lime),
    }
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

    this.cursors = this.input.keyboard?.createCursorKeys()
    this.wasd = this.input.keyboard?.addKeys('W,A,S,D') as
      | Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>
      | undefined
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.aim = { x: p.x, y: p.y }
    })
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.aim = { x: p.x, y: p.y }
    })
    this.input.on('pointerup', () => {
      this.aim = undefined
    })
  }

  // --- world ↔ screen -------------------------------------------------------------------------------

  private toScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: this.view.x + this.view.w / 2 + (wx - this.cam.x) * this.zoom,
      y: this.view.y + this.view.h / 2 + (wy - this.cam.y) * this.zoom,
    }
  }

  private toWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: this.cam.x + (sx - this.view.x - this.view.w / 2) / this.zoom,
      y: this.cam.y + (sy - this.view.y - this.view.h / 2) / this.zoom,
    }
  }

  // --- track ----------------------------------------------------------------------------------------

  private buildTrack(index: number): void {
    const def = MICRO_RACE_TRACKS[index] ?? MICRO_RACE_TRACKS[0]
    if (!def) return
    this.track = index
    this.theme = def.theme
    this.samples = sampleMicroRaceTrack(def, 8)
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
    // A soft shadow under the table edge so it reads as furniture on the floor.
    this.tableShadow?.destroy()
    this.tableShadow = this.add
      .rectangle(0, 0, MICRO_RACE_WORLD.w, MICRO_RACE_WORLD.h, 0x000000, 0.4)
      .setOrigin(0, 0)
      .setDepth(-1)

    // Minimap: the course as a thick line + the start line.
    this.minimap?.track.destroy()
    this.minimap?.dots.destroy()
    const s = this.mm.w / MICRO_RACE_WORLD.w
    const g = this.add.graphics().setDepth(711)
    g.lineStyle(Math.max(3, def.halfWidth * 2 * s), 0x8a8d99, 1)
    g.beginPath()
    this.samples.forEach((p, i) => {
      if (i === 0) g.moveTo(this.mm.x + p.x * s, this.mm.y + p.y * s)
      else g.lineTo(this.mm.x + p.x * s, this.mm.y + p.y * s)
    })
    g.closePath()
    g.strokePath()
    const s0 = this.samples[0]
    if (s0) {
      g.fillStyle(PALETTE.text, 1)
      g.fillRect(
        this.mm.x + s0.x * s - 1,
        this.mm.y + s0.y * s - def.halfWidth * s,
        2,
        def.halfWidth * 2 * s,
      )
    }
    this.minimap = { track: g, dots: this.add.graphics().setDepth(712) }
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
          .text(0, 0, this.label(c.id), nameTagStyle(this.compact ? 8 : 10, color))
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
    if (snap && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      if (snap.track !== this.track) this.buildTrack(snap.track)
      this.interp.push(snap, now)
      this.onSnapshot(snap, now)
    }
    this.updateLights(snap?.goInMs ?? 0, now)
    if (snap && this.state.final) this.timeUp(snap)
    if (this.bannerUntil > 0 && now > this.bannerUntil) {
      this.bannerUntil = 0
      this.banner?.setVisible(false)
    }
    this.render(now, delta)
    this.steer(now)
  }

  private steer(now: number): void {
    // Spectators (not in this round) and finishers have nothing to drive.
    if (this.finished || !this.snap?.cars.some((c) => c.id === this.selfId)) return
    const left = this.cursors?.left.isDown || this.wasd?.A.isDown
    const right = this.cursors?.right.isDown || this.wasd?.D.isDown
    const up = this.cursors?.up.isDown || this.wasd?.W.isDown
    const down = this.cursors?.down.isDown || this.wasd?.S.isDown
    const me = this.cars.get(this.selfId)
    if (left || right || up || down) {
      this.drive = {
        steer: (right ? 1 : 0) - (left ? 1 : 0),
        throttle: (up ? 1 : 0) - (down ? 1 : 0),
      }
    } else if (this.aim && me) {
      // Steer toward the held point, measured from the car's nose.
      const target = this.toWorld(this.aim.x, this.aim.y)
      const diff = wrapAngle(Math.atan2(target.y - me.wy, target.x - me.wx) - me.a)
      const dist = Math.hypot(target.x - me.wx, target.y - me.wy)
      this.drive = {
        steer: Math.max(-1, Math.min(1, diff / 0.5)),
        throttle: Math.abs(diff) > 2.3 ? 0.45 : dist < 36 ? 0.3 : 1,
      }
    } else {
      this.drive = { steer: 0, throttle: 0 }
    }
    // The server holds the last drive: send changes only (rate-limited), never an idle heartbeat.
    const d = this.drive
    const changed = d.steer !== this.sent.steer || d.throttle !== this.sent.throttle
    if (changed && now - this.lastSentAt > SEND_EVERY_MS) {
      this.sent = d
      this.lastSentAt = now
      this.sendInput({ kind: 'drive', ...d })
    }
  }

  private onSnapshot(snap: MicroRaceSnapshot, now: number): void {
    const me = snap.cars.find((c) => c.id === this.selfId)
    this.hud?.setScore(
      me ? this.t('game.microRace.status', { lap: me.lap, laps: snap.laps, pos: me.pos }) : '',
    )
    this.updateStandings(snap)

    if (this.firstSnapshot) {
      // Adopt the race as it is (a relayout mid-race must not replay laps, bumps or the flag).
      for (const c of snap.cars) this.viewOf(c)
      this.lastLap = me?.lap ?? 1
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
        burst(this, p.x, p.y, PALETTE.text, mine ? 10 : 6, 150)
        if (mine) {
          this.sfx.pop()
          shake(this, 0.006, 120)
          floatText(
            this,
            p.x,
            p.y - 24,
            this.t('game.microRace.bump'),
            PALETTE.amber,
            this.compact ? 12 : 16,
          )
        }
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
    }

    if (!me) return
    if (!this.finished && me.lap > this.lastLap) {
      if (me.lap === snap.laps) {
        this.sfx.correct()
        this.say(this.t('game.microRace.finalLap'), PALETTE.amber, BANNER_MS)
      } else {
        this.sfx.coin()
        this.say(this.t('game.microRace.lap', { n: me.lap }), PALETTE.cyan, BANNER_MS)
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
    const time = me.finishMs ?? 0
    const tenths = Math.floor(time / 100)
    const stamp = `${Math.floor(tenths / 600)}:${String(Math.floor((tenths % 600) / 10)).padStart(2, '0')}.${tenths % 10}`
    this.subline
      ?.setText(
        `${this.t('game.microRace.time', { time: stamp })}\n${this.t('game.common.waiting')}`,
      )
      .setAlign('center')
      .setLineSpacing(8)
      .setVisible(true)
    if (!withFx) return
    if (win) this.sfx.win()
    else this.sfx.coin()
    const x = this.scale.width / 2
    const y = this.banner?.y ?? this.scale.height / 2
    burst(this, x, y, PALETTE.amber, 24, 260)
    burst(this, x, y, this.state.colorOf(this.selfId, PALETTE.lime), 18, 220)
  }

  // Transient banner (lap, GO!, hurry…); the finish banner is sticky.
  private say(text: string, color: number, ms: number): void {
    if (!this.banner || this.finished || this.timeUpShown) return
    this.placeBanner()
    showBanner(this, this.banner, text, color)
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

  private updateStandings(snap: MicroRaceSnapshot): void {
    const maxRows = this.compact ? 4 : 10
    let rows = snap.cars.slice(0, maxRows)
    const me = snap.cars.find((c) => c.id === this.selfId)
    if (me && !rows.includes(me)) rows = [...rows.slice(0, maxRows - 1), me]
    const lines = rows.map((c) => {
      const name = this.label(c.id).slice(0, 8)
      const tail = c.finishMs !== null ? ' ★' : ''
      return {
        text: `${c.pos}. ${name}${tail}`,
        color: this.state.colorOf(c.id, PALETTE.text),
        mine: c.id === this.selfId,
      }
    })
    const key = lines.map((l) => `${l.text}|${l.color}`).join(';')
    if (key === this.standingsKey) return
    this.standingsKey = key
    this.standings.forEach((t, i) => {
      const line = lines[i]
      if (!line) {
        t.setVisible(false)
        return
      }
      t.setText(line.mine ? `▶${line.text}` : ` ${line.text}`)
        .setColor(hexToCss(line.color))
        .setVisible(true)
    })
  }

  private render(now: number, delta: number): void {
    const sample = this.interp.sample(now)
    if (!sample) return
    const fromById = new Map(sample.from.cars.map((c) => [c.id, c]))
    for (const c of sample.to.cars) {
      const prev = fromById.get(c.id)
      const v = this.viewOf(c)
      v.wx = prev ? lerp(prev.x, c.x, sample.t) : c.x
      v.wy = prev ? lerp(prev.y, c.y, sample.t) : c.y
      v.a = prev ? lerpAngle(prev.a, c.a, sample.t) : c.a
    }

    // Camera: chase the player's own car (or the leader) with a little look-ahead.
    const me = this.cars.get(this.selfId) ?? this.cars.get(sample.to.cars[0]?.id ?? '')
    if (me) {
      const tx = me.wx + Math.cos(me.a) * LOOK_AHEAD * Math.min(1, this.selfSpeed / 120)
      const ty = me.wy + Math.sin(me.a) * LOOK_AHEAD * Math.min(1, this.selfSpeed / 120)
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
      const sh = this.toScreen(10, 14)
      this.tableShadow?.setPosition(sh.x, sh.y).setScale(this.zoom)
    }

    const lift = this.zoom * 2
    const dots = this.minimap?.dots
    dots?.clear()
    const trails = this.trails
    trails?.clear()
    const s = this.mm.w / MICRO_RACE_WORLD.w
    for (const c of sample.to.cars) {
      const v = this.cars.get(c.id)
      if (!v) continue
      const p = this.toScreen(v.wx, v.wy)
      const heading = Math.round(v.a / HEADING_STEP) * HEADING_STEP
      v.sprite.setPosition(p.x, p.y).setRotation(heading)
      v.pilot.setPosition(p.x, p.y).setRotation(heading)
      v.shadow.setPosition(p.x + lift, p.y + lift * 1.5).setRotation(heading)
      v.label.setPosition(p.x, p.y - CAR_COLS * TEXEL * this.zoom * 0.5 - 2)
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
      const mine = c.id === this.selfId
      if (dots) {
        const r = mine ? 4 : 3
        if (mine) {
          dots.fillStyle(PALETTE.text, 1)
          dots.fillRect(
            this.mm.x + v.wx * s - r - 1,
            this.mm.y + v.wy * s - r - 1,
            r * 2 + 2,
            r * 2 + 2,
          )
        }
        dots.fillStyle(v.color, 1)
        dots.fillRect(this.mm.x + v.wx * s - r, this.mm.y + v.wy * s - r, r * 2, r * 2)
      }
      if (mine) this.selfCues(c, v, p, now, delta)
    }
  }

  // "That's you" marker, off-road dust and the wrong-way warning for the player's own car.
  private selfCues(
    c: MicroRaceCar,
    v: CarView,
    p: { x: number; y: number },
    now: number,
    delta: number,
  ): void {
    if (this.selfPrev && delta > 0) {
      const d = Math.hypot(v.wx - this.selfPrev.x, v.wy - this.selfPrev.y)
      this.selfSpeed = lerp(this.selfSpeed, (d * 1000) / delta, 0.2)
    }
    this.selfPrev = { x: v.wx, y: v.wy }
    v.label.setVisible(false)
    this.marker?.place(p.x, p.y - CAR_COLS * TEXEL * this.zoom * 0.5, now)
    if (c.off && this.selfSpeed > 40 && now - this.lastDustAt > 150) {
      this.lastDustAt = now
      const bx = p.x - Math.cos(v.a) * 12 * this.zoom
      const by = p.y - Math.sin(v.a) * 12 * this.zoom
      burst(this, bx, by, DUST[this.theme], 3, 50)
    }
    // Wrong way: heading against the course direction at the nearest sample while moving.
    if (this.finished || this.timeUpShown || this.samples.length === 0) return
    if ((this.snap?.goInMs ?? 0) > 0) return
    let best = 0
    let bestD = Number.POSITIVE_INFINITY
    this.samples.forEach((q, i) => {
      const d = (q.x - v.wx) ** 2 + (q.y - v.wy) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    const n = this.samples.length
    const a = this.samples[(best - 1 + n) % n] as MicroRacePoint
    const b = this.samples[(best + 1) % n] as MicroRacePoint
    const along = Math.cos(v.a) * (b.x - a.x) + Math.sin(v.a) * (b.y - a.y)
    const wrong = along < -8 && this.selfSpeed > 30
    if (wrong && !this.wrongWay) {
      this.sfx.wrong()
      this.say(this.t('game.microRace.wrongWay'), PALETTE.red, BANNER_MS)
    }
    if (wrong && this.bannerUntil > 0) this.bannerUntil = Math.max(this.bannerUntil, now + 300)
    this.wrongWay = wrong
  }
}
