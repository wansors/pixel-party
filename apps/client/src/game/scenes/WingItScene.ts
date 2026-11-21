import {
  PALETTE,
  WING,
  type WingBody,
  type WingColumn,
  type WingFlierView,
  type WingSnapshot,
  wingDistance,
  wingFly,
  wingSnap,
} from '@pp/shared'
import Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { addBanner, eliminate, flash, floatText, punch, shake, showBanner } from '../fx'
import { ServerClock } from '../netcode/ServerClock'
import {
  bodyStyle,
  ensurePixelGrid,
  fitFontSize,
  fitText,
  headlineStyle,
  shade,
} from '../pixelStyle'
import { YouMarker } from '../playerMarks'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const PENDING_TTL_MS = 2000
// The narrowest view, in playfield heights: a portrait phone zooms out so the next column shows.
const MIN_VIEW_W = 1.35
const SKY_TOP = 0x1d2350
const SKY_LOW = 0x7a4a7a
const TOWER = 0x6a5a8c
const GROUND = 0x3c8a3c

// A small white wing (drawn raised; flipped vertically for the downstroke).
const WING_ROWS = ['__oo__', '_owwo_', 'owwwwo', 'owwwo_', '_ooo__']

// A puffy pixel cloud.
const CLOUD_ROWS = [
  '____cccc______',
  '__ccwwwwcc____',
  '_cwwwwwwwwcccc',
  'cwwwwwwwwwwwwc',
  '_cccccccccccc_',
]

interface Bird {
  id: string
  avatar: AvatarSprite
  wing: Phaser.GameObjects.Image
  alive: boolean
  // When this bird last flapped (scene time), for the wing's downstroke.
  flapAt: number
}

interface PendingFlap {
  seq: number
  at: number
  sentAt: number
}

// Wing It canvas (D42). The course is shared and server-owned; this scrolls it on the server's clock
// (wingDistance of the estimated flight time) under a dusk sky with parallax hills and clouds: brick
// towers with lit caps leave a gap to fly through. Your bird is your avatar with a flapping wing, tilted
// by its speed, predicted with the shared flight rules — a flap shows the frame you press it and carries
// that moment to the server, so both sides fly the very same path. Rivals are ghosts from their last
// judged state carried forward. A crash gets the elimination stamp and the bird tumbles off with the
// scrolling world. Controls: SPACE / ↑ / W / click / tap.
export class WingItScene extends MiniGameScene<WingSnapshot> {
  private field = { x: 0, y: 0, w: 0, unit: 0, top: 0 }
  private towerGfx?: Phaser.GameObjects.Graphics
  private hills?: Phaser.GameObjects.TileSprite
  private ground?: Phaser.GameObjects.TileSprite
  private clouds: Phaser.GameObjects.Image[] = []
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private you?: YouMarker
  private birds = new Map<string, Bird>()
  private readonly clock = new ServerClock()
  private base?: WingSnapshot
  private pending: PendingFlap[] = []
  private seq = 0
  private lastTick = -1
  private started = false
  private alive = true
  private phase: 'ready' | 'go' | 'out' | 'won' = 'ready'
  private shownPassed = -1
  private compact = false

  constructor(...deps: SceneDeps) {
    super('wing-it', ...deps)
  }

  override create(): void {
    super.create()
    for (const b of this.birds.values()) {
      b.avatar.destroy()
      b.wing.destroy()
    }
    this.birds = new Map()
    this.clouds = []
    this.clock.reset()
    this.base = undefined
    this.pending = []
    this.seq = 0
    this.lastTick = -1
    this.started = false
    this.alive = true
    this.phase = 'ready'
    this.shownPassed = -1

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    const hintH = this.compact ? 22 : 28
    const groundH = this.compact ? 14 : 22
    const top = this.top + 6
    const availH = height - top - hintH - groundH - 4
    const unit = Math.floor(Math.min(availH, width / MIN_VIEW_W))
    this.field = { x: 0, y: Math.round(top + (availH - unit) / 2), w: width, unit, top }
    const { y } = this.field

    // Sky: banded dusk gradient behind everything.
    const sky = this.add.graphics()
    const bands = 12
    for (let i = 0; i < bands; i++) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(SKY_TOP),
        Phaser.Display.Color.ValueToColor(SKY_LOW),
        bands - 1,
        i,
      )
      sky.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1)
      sky.fillRect(0, y + (unit * i) / bands, width, unit / bands + 1)
    }
    // Letterbox (portrait phones): a bank of storm clouds above the playfield reads as its ceiling,
    // soil fills in under the ground.
    if (y > top) {
      sky.fillStyle(shade(SKY_TOP, -0.4), 1)
      sky.fillRect(0, top, width, y - top)
      sky.fillStyle(shade(SKY_TOP, -0.2), 1)
      for (let x = 0; x < width; x += 8) {
        const bump = Math.round(6 + 5 * Math.abs(Math.sin(x / 23)))
        sky.fillRect(x, y - 2, 8, bump)
      }
    }
    const below = y + unit + groundH
    if (height - hintH > below) {
      sky.fillStyle(0x2e2018, 1)
      sky.fillRect(0, below, width, height - hintH - below)
    }
    const cloudKey = ensurePixelGrid(this, {
      key: 'pp-wing-cloud',
      rows: CLOUD_ROWS,
      legend: { c: shade(SKY_LOW, 0.35), w: shade(SKY_LOW, 0.6) },
    })
    for (let i = 0; i < 5; i++) {
      this.clouds.push(
        this.add
          .image(0, y + unit * (0.08 + ((i * 37) % 30) / 100), cloudKey)
          .setScale(this.compact ? 0.6 : 1)
          .setAlpha(0.7),
      )
    }
    this.hills = this.add
      .tileSprite(
        0,
        y + unit,
        width,
        Math.round(unit * 0.22),
        this.hillsTexture(Math.round(unit * 0.22)),
      )
      .setOrigin(0, 1)
      .setAlpha(0.85)
    this.towerGfx = this.add.graphics().setDepth(5)
    this.ground = this.add
      .tileSprite(0, y + unit, width, groundH, this.groundTexture(groundH))
      .setOrigin(0, 0)
      .setDepth(6)

    this.you = new YouMarker(this, this.compact ? 10 : 14, 820)
    const hint = this.add
      .text(
        width / 2,
        height - hintH / 2,
        this.t('game.wingIt.hint'),
        bodyStyle(this.compact ? 11 : 14, PALETTE.dim),
      )
      .setOrigin(0.5)
    fitText(hint, width - 16, this.compact ? 11 : 14)
    this.banner = addBanner(this)
    this.banner.setPosition(width / 2, y + unit * 0.42)
    this.subline = this.add
      .text(
        width / 2,
        y + unit * 0.42 + (this.compact ? 34 : 46),
        '',
        headlineStyle(this.compact ? 8 : 16, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setDepth(950)
      .setVisible(false)

    for (const key of ['SPACE', 'UP', 'W', 'ENTER']) this.onKey(key, () => this.flap())
    this.input.keyboard?.addKeys('SPACE,UP,W')
    this.input.on('pointerdown', () => this.flap())
  }

  // Rolling pixel hills for the parallax strip (tiles horizontally).
  private hillsTexture(h: number): string {
    const key = `pp-wing-hills-${h}`
    if (this.textures.exists(key)) return key
    const w = 256
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    const step = 4
    for (let x = 0; x < w; x += step) {
      const t = (x / w) * Math.PI * 2
      const top = Math.round((0.35 + 0.25 * Math.sin(t) + 0.12 * Math.sin(t * 3)) * h)
      g.fillStyle(shade(SKY_LOW, -0.45), 1)
      g.fillRect(x, top, step, h - top)
      g.fillStyle(shade(SKY_LOW, -0.3), 1)
      g.fillRect(x, top, step, step)
    }
    g.generateTexture(key, w, h)
    g.destroy()
    return key
  }

  // Grass lip over dark soil, with pebbles (tiles horizontally).
  private groundTexture(h: number): string {
    const key = `pp-wing-ground-${h}`
    if (this.textures.exists(key)) return key
    const w = 64
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(0x4a3424, 1).fillRect(0, 0, w, h)
    g.fillStyle(GROUND, 1).fillRect(0, 0, w, Math.max(4, Math.round(h * 0.3)))
    g.fillStyle(shade(GROUND, 0.35), 1).fillRect(0, 0, w, 2)
    for (let x = 0; x < w; x += 16) {
      g.fillStyle(shade(GROUND, -0.3), 1).fillRect(x + 6, Math.round(h * 0.3), 4, 2)
      g.fillStyle(0x6a4c34, 1).fillRect(x + 2, Math.round(h * 0.65), 3, 2)
    }
    g.generateTexture(key, w, h)
    g.destroy()
    return key
  }

  private buildBirds(snap: WingSnapshot): void {
    const size = avatarPx(Math.max(this.compact ? 24 : 16, this.field.unit * 0.075))
    const wingKey = ensurePixelGrid(this, {
      key: 'pp-wing-wing',
      rows: WING_ROWS,
      legend: { o: shade(PALETTE.text, -0.5), w: PALETTE.text },
    })
    for (const id of Object.keys(snap.fliers)) {
      const mine = id === this.selfId
      const avatar = new AvatarSprite(
        this,
        this.state.avatarOf(id),
        this.state.colorOf(id, PALETTE.lime),
        size,
        'side',
      )
      avatar.image.setDepth(mine ? 31 : 20).setAlpha(mine ? 1 : 0.5)
      const wing = this.add
        .image(0, 0, wingKey)
        .setDisplaySize(size * 0.45, size * 0.38)
        .setDepth(mine ? 32 : 21)
        .setAlpha(mine ? 1 : 0.5)
      this.birds.set(id, { id, avatar, wing, alive: true, flapAt: -1e9 })
    }
    this.warmAvatars(Object.keys(snap.fliers), [
      ['side', 'idle', 0],
      ['side', 'happy', 0],
      ['side', 'ko', 0],
    ])
  }

  // Ms after GO at scene time `now`, on the server's clock.
  private flightNow(now: number): number {
    const base = this.base
    if (!base) return -WING.startDelayMs
    const elapsed = this.state.final ? 0 : this.clock.since(base.remainingMs, now)
    return base.t + elapsed - WING.startDelayMs
  }

  private flap(): void {
    if (!this.base || !this.alive || this.state.final) return
    const now = this.time.now
    const t = this.flightNow(now)
    if (t < 0) return
    const at = wingSnap(t)
    const last = this.pending.at(-1)?.at ?? -1e9
    if (at - last < WING.minFlapGapMs) return
    const seq = ++this.seq
    this.pending.push({ seq, at, sentAt: now })
    this.sendInput({ kind: 'flap', at, seq })
    this.sfx.jump()
    const me = this.birds.get(this.selfId)
    if (me) me.flapAt = now
  }

  protected frame(snap: WingSnapshot | null, time: number): void {
    if (!snap) return
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.onSnapshot(snap)
    }
    this.render(this.time.now, time)
  }

  private onSnapshot(snap: WingSnapshot): void {
    if (this.birds.size === 0) this.buildBirds(snap)
    this.clock.sync(snap.remainingMs, this.time.now)
    const first = !this.started
    this.started = true
    this.base = snap
    const me = snap.fliers[this.selfId]
    if (me) {
      const now = this.time.now
      this.pending = this.pending.filter((p) => p.seq > me.ack && now - p.sentAt < PENDING_TTL_MS)
      if (first) this.seq = Math.max(this.seq, me.ack)
    }
    const ids = Object.keys(snap.fliers)
    let left = 0
    let outs = 0
    for (const id of ids) {
      const view = snap.fliers[id] as WingFlierView
      if (view.alive) left++
      const bird = this.birds.get(id)
      if (!bird || bird.alive === view.alive) continue
      bird.alive = view.alive
      if (view.alive) continue
      bird.avatar.setExpression('ko')
      if (first) continue
      outs++
      const p = this.crashPoint(view)
      eliminate(
        this,
        p.x,
        p.y,
        this.state.colorOf(id, PALETTE.lime),
        this.quip('game.common.stamps', id),
        this.compact ? 10 : 14,
      )
    }
    if (ids.length > 1)
      this.hud?.setCenter(this.t('game.common.left', { n: left, total: ids.length }))
    if (outs > 0) this.sfx.quiet(() => this.sfx.crash(), 0.6)
    if (me && this.alive && !me.alive) this.becomeOut(!first)
    if (me?.alive && left === 1 && ids.length > 1 && this.phase !== 'won') this.win()
  }

  // Screen point of a crashed bird at its crash moment (for the stamp).
  private crashPoint(view: WingFlierView): { x: number; y: number } {
    const body: WingBody = { t: view.t, y: view.y, vy: view.vy }
    wingFly(body, view.outAt, view.flaps)
    const live = Math.max(0, this.flightNow(this.time.now))
    const worldX = wingDistance(view.outAt) + WING.birdX
    return { x: this.screenX(worldX, wingDistance(live)), y: this.screenY(Math.min(1, body.y)) }
  }

  private becomeOut(withFx: boolean): void {
    this.alive = false
    this.phase = 'out'
    if (withFx) {
      this.sfx.eliminated()
      shake(this, 0.012, 260)
      flash(this, PALETTE.red, 160)
    }
    const banner = this.banner
    if (banner) {
      const text = this.t('game.common.out')
      banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
      showBanner(this, banner, text, PALETTE.red)
    }
    this.subline?.setText(this.quip('game.common.spectating', this.selfId)).setVisible(true)
    if (this.subline) fitText(this.subline, this.scale.width * 0.9, this.compact ? 8 : 16)
  }

  private win(): void {
    this.phase = 'won'
    const banner = this.banner
    if (!banner) return
    const text = this.t('game.wingIt.lastFlying')
    banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
    showBanner(this, banner, text, PALETTE.lime)
    this.subline?.setVisible(false)
    this.sfx.win()
    const me = this.birds.get(this.selfId)
    if (me) {
      me.avatar.setExpression('happy')
      punch(this, me.avatar.image, 0.3, 120)
    }
  }

  private screenX(worldX: number, dist: number): number {
    return this.field.x + (worldX - dist) * this.field.unit
  }

  private screenY(y: number): number {
    return this.field.y + y * this.field.unit
  }

  private render(now: number, time: number): void {
    const base = this.base
    if (!base) return
    const live = this.flightNow(now)
    this.updatePhase(live)
    const t = Math.max(0, wingSnap(live))
    const dist = wingDistance(t)
    const { unit } = this.field

    // Parallax: clouds slowest, hills, then the towers and the ground at full speed.
    const span = this.field.w + 240
    this.clouds.forEach((c, i) => {
      const x = (((i * span) / this.clouds.length - dist * unit * 0.12) % span) + span
      c.setX((x % span) - 120)
    })
    if (this.hills) this.hills.tilePositionX = dist * unit * 0.35
    if (this.ground) this.ground.tilePositionX = dist * unit
    this.drawTowers(base.columns, dist)

    for (const [id, bird] of this.birds) {
      const view = base.fliers[id]
      if (!view) continue
      const mine = id === this.selfId
      let y: number
      let vy: number
      let x = this.screenX(dist + WING.birdX, dist)
      if (view.alive) {
        const body: WingBody = { t: view.t, y: view.y, vy: view.vy }
        const flaps = mine
          ? [...view.flaps, ...this.pending.map((p) => p.at)].sort((a, b) => a - b)
          : view.flaps
        // Your own crash shows the moment it happens; rivals just never sink through the floor.
        wingFly(body, t, flaps, mine ? base.columns : undefined)
        y = Math.min(body.y, 1 - WING.radius)
        vy = body.vy
        if (mine) this.countPasses(base.columns, body.t)
      } else {
        // Down: it tumbles to the floor where it crashed and scrolls away with the world.
        const body: WingBody = { t: view.t, y: view.y, vy: view.vy }
        wingFly(body, view.outAt, view.flaps)
        const since = Math.max(0, t - view.outAt) / 1000
        y = Math.min(1 - WING.radius, body.y + 1.4 * since * since + 0.2 * since)
        vy = 2
        x = this.screenX(wingDistance(view.outAt) + WING.birdX, dist)
      }
      const py = this.screenY(y)
      const angle = Phaser.Math.Clamp(vy * 45, -25, view.alive ? 70 : 120)
      bird.avatar.image
        .setPosition(x, py)
        .setAngle(angle)
        .setVisible(x > -60)
      bird.avatar.tick(time)
      const down =
        now - bird.flapAt < 120 || (view.alive && Math.floor(time / 140) % 2 === 0 && vy < -0.2)
      const size = bird.avatar.image.displayWidth
      bird.wing
        .setPosition(x - size * 0.12, py - size * 0.05)
        .setAngle(angle)
        .setFlipY(down)
        .setVisible(view.alive && x > -60)
      if (mine) {
        if (this.alive) this.you?.place(x, py - size / 2 - 4, time)
        else this.you?.hide()
      }
    }
  }

  // Your score ticks up as your predicted bird clears each column: the server's count at its judged
  // moment, plus the columns cleared since (the next snapshot confirms them).
  private countPasses(columns: readonly WingColumn[], bodyT: number): void {
    const view = this.base?.fliers[this.selfId]
    if (!view) return
    const tailAt = (time: number) => wingDistance(time) + WING.birdX - WING.radius
    const from = tailAt(view.t)
    const to = tailAt(bodyT)
    const extra = columns.filter((c) => {
      const edge = c.x + WING.columnW / 2
      return edge >= from && edge < to
    }).length
    const passed = view.passed + extra
    if (passed === this.shownPassed) return
    const gained = this.shownPassed >= 0 && passed > this.shownPassed
    this.shownPassed = passed
    this.hud?.setScore(this.t('game.wingIt.score', { n: passed }))
    if (gained) {
      this.sfx.coin()
      const me = this.birds.get(this.selfId)
      if (me) floatText(this, me.avatar.image.x, me.avatar.image.y - 30, '+1', PALETTE.lime, 16)
    }
  }

  // GET READY until GO, then GO!
  private updatePhase(live: number): void {
    if (this.phase !== 'ready') return
    const banner = this.banner
    if (live < 0 && !this.state.final) {
      if (banner && !banner.visible) {
        const text = this.t('game.wingIt.ready')
        banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
        showBanner(this, banner, text, PALETTE.amber)
        this.subline?.setText(this.t('game.wingIt.readySub')).setVisible(true)
        if (this.subline) fitText(this.subline, this.scale.width * 0.9, this.compact ? 8 : 16)
      }
      return
    }
    this.phase = 'go'
    banner?.setVisible(false)
    this.subline?.setVisible(false)
    if (live < 300) this.sfx.go()
  }

  // Brick towers above and below each gap, with a lit cap at the gap's edges.
  private drawTowers(columns: readonly WingColumn[], dist: number): void {
    const g = this.towerGfx
    if (!g) return
    g.clear()
    const { unit, w } = this.field
    const cw = Math.round(WING.columnW * unit)
    const cap = Math.max(6, Math.round(unit * 0.028))
    const brick = Math.max(6, Math.round(unit * 0.03))
    for (const c of columns) {
      const left = Math.round(this.screenX(c.x - WING.columnW / 2, dist))
      if (left > w || left + cw < 0) continue
      const gapTop = Math.round(this.screenY(c.gapY - c.gapH / 2))
      const gapBot = Math.round(this.screenY(c.gapY + c.gapH / 2))
      // Upper towers reach the top of the canvas (on a letterboxed phone too).
      const top = this.field.top
      const floor = this.field.y + unit
      for (const [y0, y1] of [
        [top, gapTop],
        [gapBot, floor],
      ] as const) {
        if (y1 <= y0) continue
        g.fillStyle(shade(TOWER, -0.45), 1).fillRect(left - 2, y0, cw + 4, y1 - y0)
        g.fillStyle(TOWER, 1).fillRect(left, y0, cw, y1 - y0)
        g.fillStyle(shade(TOWER, 0.25), 1).fillRect(left + 3, y0, 4, y1 - y0)
        g.fillStyle(shade(TOWER, -0.25), 1).fillRect(left + cw - 6, y0, 4, y1 - y0)
        // Mortar: staggered brick rows.
        g.fillStyle(shade(TOWER, -0.3), 1)
        for (let y = y0 + brick; y < y1; y += brick) {
          g.fillRect(left, y, cw, 2)
          const off = Math.floor((y - top) / brick) % 2 === 0 ? cw / 3 : (2 * cw) / 3
          g.fillRect(left + Math.round(off), y - brick + 2, 2, brick - 2)
        }
      }
      // Caps framing the gap.
      for (const y of [gapTop - cap, gapBot]) {
        g.fillStyle(shade(PALETTE.amber, -0.55), 1).fillRect(left - 6, y, cw + 12, cap)
        g.fillStyle(PALETTE.amber, 1).fillRect(left - 4, y + 2, cw + 8, cap - 4)
        g.fillStyle(shade(PALETTE.amber, 0.4), 1).fillRect(left - 4, y + 2, cw + 8, 2)
      }
    }
  }
}
