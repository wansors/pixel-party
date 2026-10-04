import { PALETTE, SUMO_ICE, type SumoIceBody, type SumoIceSnapshot } from '@pp/shared'
import type Phaser from 'phaser'
import { AvatarSprite, avatarPx, ensureAvatarTexture } from '../avatars'
import { addBanner, burst, eliminate, flash, floatText, ring, shake, showBanner } from '../fx'
import { SnapshotInterpolator, lerp } from '../netcode/SnapshotInterpolator'
import { ensurePixelGrid, fitFontSize, headlineStyle, hexToCss, shade } from '../pixelStyle'
import { YouMarker } from '../playerMarks'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Sumo ICE: sumo on a melting ice floe. A square of dark, rippling water with the floe drawn tile by
// tile from the snapshot — solid ice, cracking ice (flickering crack lines, the warning) and open water
// once a tile sinks (with a splash). Every wrestler is their lobby avatar on a little shadow; bumps
// throw ice chips; the first fall is a lifebuoy back onto the core (blinking while it's a ghost), the
// second an ELIMINATED splash. Steer with the arrows/WASD or by holding the
// pointer where you want to go — on ice you only nudge your momentum, so plan your slides. A small
// arrow at your feet shows where you're pushing the moment you press (your body follows the server).
// Rendering is cheap on purpose: the water is one scrolling tile sprite, the solid ice is baked into
// one render texture (redrawn only where a tile changes), and only the few cracking tiles are images.

// Minimum gap between ice-crack sounds (a ring of tiles often starts cracking at once).
const CRACK_SOUND_GAP_MS = 400
const N = SUMO_ICE.grid
const CONTACT = SUMO_ICE.playerR * 2 * 1.25
const IMPACT_COOLDOWN_MS = 400
// Rivals' moments play at this fraction of the volume (yours stay full); rivals' bumps (softer still)
// at most this often, so a scrum on the ice is a few thuds, not a drum roll.
const RIVAL_LEVEL = 0.5
const RIVAL_BUMP_MS = 250
// Snapshots arrive every ~150 ms: interpolating a full interval behind keeps bodies gliding instead of
// pausing and hopping each time one lands.
const RENDER_DELAY_MS = 150
// One water ripple tile (repeated and slowly scrolled): '.' deep water, '-' a ripple dash.
const WATER_ROWS = [
  '................................',
  '................................',
  '...------...............--------',
  '................................',
  '................................',
  '................................',
  '................................',
  '..............-------...........',
  '................................',
  '................................',
  '................................',
  '-----...........................',
  '................................',
  '.......................------....',
  '................................',
  '................................',
]
const ARROW_ROWS = ['__W___', '__WW__', 'WWWWW_', 'WWWWWW', 'WWWWW_', '__WW__', '__W___']

// 8×8 ice tiles: solid (white-cyan with highlights) and cracking (dark crack lines through it).
const ICE_ROWS = [
  'WWWWWWWw',
  'WhhWWWWw',
  'WhWWWWWw',
  'WWWWWhWw',
  'WWWWWWWw',
  'WWWhWWWw',
  'WWWWWWWw',
  'wwwwwwww',
]
const CRACK_ROWS = [
  'WWWWWWWw',
  'WhhWWkWw',
  'WhWWkWWw',
  'WWkkWhWw',
  'WkWWkWWw',
  'kWWhWkWw',
  'WWWWWWkw',
  'wwwwwwww',
]

interface View {
  avatar: AvatarSprite
  shadow: Phaser.GameObjects.Ellipse
  out: boolean
  x: number
  y: number
}

export class SumoIceScene extends MiniGameScene<SumoIceSnapshot> {
  private readonly interp = new SnapshotInterpolator<SumoIceSnapshot>(RENDER_DELAY_MS)
  private compact = false
  private arena = { cx: 0, cy: 0, size: 0 }
  private water?: Phaser.GameObjects.TileSprite
  // The solid ice, baked: a tile is drawn in when the floe is first seen and erased when it cracks.
  private floe?: Phaser.GameObjects.RenderTexture
  private stamp?: Phaser.GameObjects.Image
  // Cracking tiles (a handful at a time) as flickering images, pooled.
  private cracks = new Map<number, Phaser.GameObjects.Image>()
  private crackPool: Phaser.GameObjects.Image[] = []
  private crackSoundAt = 0
  private splash?: Phaser.GameObjects.Particles.ParticleEmitter
  private arrow?: Phaser.GameObjects.Image
  private prompt?: Phaser.GameObjects.Text
  private promptText = ''
  private steerDir = { dx: 0, dy: 0 }
  private warmed = false
  private tileKeys = { ice: '', crack: '' }
  private tiles = ''
  private views = new Map<string, View>()
  private avatarPx = 0
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private marker?: YouMarker
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>
  private aim?: { x: number; y: number }
  private aimPointer = -1
  // Nothing is sent until you steer for the first time (an untouched seat must stay idle).
  private steered = false
  private sentDir = ''
  private sentAt = 0
  private lastTick = -1
  private prev?: SumoIceSnapshot
  private pairDist = new Map<string, number>()
  private impactAt = new Map<string, number>()
  private rivalBumpAt = Number.NEGATIVE_INFINITY
  private ended = false

  constructor(...deps: SceneDeps) {
    super('sumo-ice', ...deps)
  }

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.interp.reset()
    this.cracks = new Map()
    this.crackSoundAt = 0
    this.crackPool = []
    this.promptText = ''
    this.steerDir = { dx: 0, dy: 0 }
    this.warmed = false
    this.tiles = ''
    this.views = new Map()
    this.aim = undefined
    this.aimPointer = -1
    this.steered = false
    this.sentDir = ''
    this.sentAt = 0
    this.lastTick = -1
    this.prev = undefined
    this.pairDist = new Map()
    this.impactAt = new Map()
    this.rivalBumpAt = Number.NEGATIVE_INFINITY
    this.ended = false

    const stripSize = this.compact ? 11 : 13
    this.strip = new PlayerStrip(this, width / 2, this.top + 8, width - 24, stripSize, 2)
    const areaTop = this.top + 8 + PlayerStrip.rowH(stripSize) * 2
    // The prompt line along the bottom: the keys while you're on the ice, a heckle once you're out.
    const promptSize = this.compact ? 12 : 16
    this.prompt = this.add
      .text(
        width / 2,
        height - (this.compact ? 10 : 14),
        '',
        headlineStyle(promptSize, PALETTE.dim),
      )
      .setOrigin(0.5, 1)
      .setDepth(600)
    const areaBottom = this.prompt.y - promptSize - (this.compact ? 8 : 10)
    const size = Math.floor(Math.min(width - 16, areaBottom - areaTop))
    this.arena = { cx: width / 2, cy: areaTop + (areaBottom - areaTop) / 2, size }
    this.avatarPx = avatarPx(Math.round(SUMO_ICE.playerR * 2 * size * 1.25))
    const x0 = Math.round(this.arena.cx - size / 2)
    const y0 = Math.round(this.arena.cy - size / 2)

    const waterKey = ensurePixelGrid(this, {
      key: 'ice-water',
      rows: WATER_ROWS,
      legend: { '.': 0x0d2a4a, '-': 0x1f4f7a },
      pixelSize: Math.max(2, Math.round(size / 220)),
    })
    this.water = this.add.tileSprite(x0, y0, size, size, waterKey).setOrigin(0, 0).setDepth(1)
    this.add
      .rectangle(x0, y0, size, size)
      .setOrigin(0, 0)
      .setStrokeStyle(4, PALETTE.frameLit)
      .setDepth(2)
    const px = Math.max(1, Math.floor(size / N / 8))
    const legend = { W: 0xdff6ff, h: 0xffffff, w: 0x9fd8ee, k: 0x2b5d7a }
    this.tileKeys = {
      ice: ensurePixelGrid(this, { key: `ice-tile-${px}`, rows: ICE_ROWS, legend, pixelSize: px }),
      crack: ensurePixelGrid(this, {
        key: `ice-crack-${px}`,
        rows: CRACK_ROWS,
        legend,
        pixelSize: px,
      }),
    }
    this.floe = this.add.renderTexture(x0, y0, size, size).setOrigin(0, 0).setDepth(5)
    const stamp = this.make.image({ key: this.tileKeys.ice, add: false }).setOrigin(0, 0)
    this.stamp = stamp
    this.events.once('shutdown', () => stamp.destroy())
    const dot = ensurePixelGrid(this, {
      key: 'ice-chip',
      rows: ['W'],
      legend: { W: 0xffffff },
      pixelSize: 4,
    })
    this.splash = this.add
      .particles(0, 0, dot, {
        speed: { min: 50, max: 140 },
        angle: { min: 0, max: 360 },
        lifespan: { min: 260, max: 520 },
        gravityY: 180,
        scale: { start: 1.3, end: 0.4 },
        alpha: { start: 1, end: 0 },
        tint: [0x9fd8ee, 0xdff6ff],
        emitting: false,
      })
      .setDepth(850)
    const arrowKey = ensurePixelGrid(this, {
      key: 'ice-steer',
      rows: ARROW_ROWS,
      legend: { W: PALETTE.amber },
      pixelSize: this.compact ? 2 : 3,
    })
    this.arrow = this.add.image(0, 0, arrowKey).setDepth(58).setAlpha(0.85).setVisible(false)
    this.marker = new YouMarker(this, this.compact ? 8 : 12, 75)
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

  private toScreen(x: number, y: number): { x: number; y: number } {
    const { cx, cy, size } = this.arena
    return { x: cx + (x - 0.5) * size, y: cy + (y - 0.5) * size }
  }

  protected frame(snap: SumoIceSnapshot | null, time: number): void {
    // The ripples drift slowly (one scrolling tile sprite, nothing redrawn).
    if (this.water) this.water.tilePositionX = (time / 90) % 4096
    if (!snap) return
    if (!this.warmed) {
      this.warmed = true
      this.warmAvatars(
        snap.bodies.map((b) => b.id),
        [
          ['front', 'hurt', 0],
          ['front', 'ko', 0],
          ['back', 'idle', 0],
          ['side', 'idle', 0],
        ],
      )
    }
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.interp.push(snap, time)
      this.onSnapshot(snap, time)
      this.paintTiles(snap)
      this.paintPrompt(snap)
    }
    this.steer(snap, time)
    // Cracking tiles flicker (only the few that are cracking are touched).
    for (const [i, img] of this.cracks)
      img.setAlpha(Math.floor(time / 110 + i) % 2 === 0 ? 1 : 0.75)
    this.paintBodies(time)
  }

  // Cell i's exact pixel rectangle inside the floe texture (cells tile without gaps or overlaps).
  private cellRect(i: number): { x: number; y: number; w: number; h: number } {
    const c = this.arena.size / N
    const gx = i % N
    const gy = Math.floor(i / N)
    const x = Math.round(gx * c)
    const y = Math.round(gy * c)
    return { x, y, w: Math.round((gx + 1) * c) - x, h: Math.round((gy + 1) * c) - y }
  }

  // Tiles change only a few times a second: redraw just those that did, with a splash when one sinks.
  private paintTiles(snap: SumoIceSnapshot): void {
    const next = snap.tiles
    const floe = this.floe
    const stamp = this.stamp
    if (next === this.tiles || !floe || !stamp) return
    const first = this.tiles === ''
    const me = snap.bodies.find((b) => b.id === this.selfId)
    const x0 = this.arena.cx - this.arena.size / 2
    const y0 = this.arena.cy - this.arena.size / 2
    let sankNear = false
    for (let i = 0; i < N * N; i++) {
      const c = next[i]
      const was = this.tiles[i]
      if (c === was) continue
      const r = this.cellRect(i)
      stamp.setPosition(r.x, r.y).setDisplaySize(r.w, r.h)
      if (c === '#') floe.draw(stamp)
      else if (was === '#') floe.erase(stamp)
      if (c === '%') this.showCrack(i, x0 + r.x + r.w / 2, y0 + r.y + r.h / 2, r.w, r.h)
      else this.hideCrack(i)
      if (c === '.' && !first && was !== undefined && was !== '.') {
        this.splash?.explode(8, x0 + r.x + r.w / 2, y0 + r.y + r.h / 2)
        // Only the tiles going down right next to you make a sound (the floe melts all round long).
        if (me?.alive) {
          const tx = ((i % N) + 0.5) / N
          const ty = (Math.floor(i / N) + 0.5) / N
          if (Math.hypot(tx - me.x, ty - me.y) < 0.16) sankNear = true
        }
      }
    }
    // One splash however many tiles went under together.
    if (sankNear) this.sfx.splash()
    this.tiles = next
  }

  private showCrack(i: number, x: number, y: number, w: number, h: number): void {
    if (this.cracks.has(i)) return
    // The ice's warning creak — once however many tiles start cracking together.
    if (this.time.now - this.crackSoundAt > CRACK_SOUND_GAP_MS) {
      this.crackSoundAt = this.time.now
      this.sfx.crack()
    }
    const img = this.crackPool.pop() ?? this.add.image(0, 0, this.tileKeys.crack).setDepth(6)
    img.setPosition(x, y).setDisplaySize(w, h).setAlpha(1).setVisible(true)
    this.cracks.set(i, img)
  }

  private hideCrack(i: number): void {
    const img = this.cracks.get(i)
    if (!img) return
    this.cracks.delete(i)
    img.setVisible(false)
    this.crackPool.push(img)
  }

  // Bottom line: how to steer while you're on the ice; a heckle once you're in the water.
  private paintPrompt(snap: SumoIceSnapshot): void {
    const me = snap.bodies.find((b) => b.id === this.selfId)
    const text = this.state.final
      ? ''
      : !me || !me.alive
        ? this.quip('game.common.spectating', this.selfId)
        : this.compact
          ? ''
          : this.t('game.sumoIce.hint')
    if (!this.prompt || text === this.promptText) return
    this.promptText = text
    this.prompt
      .setText(text)
      .setColor(hexToCss(me?.alive ? PALETTE.dim : PALETTE.text))
      .setFontSize(fitFontSize(text, this.scale.width - 24, this.compact ? 12 : 16))
  }

  private steer(snap: SumoIceSnapshot, time: number): void {
    this.steerDir = { dx: 0, dy: 0 }
    if (!snap.bodies.some((b) => b.id === this.selfId && b.alive) || this.state.final) return
    const keys = this.cursors
    const w = this.wasd
    const kx =
      (keys?.right.isDown || w?.D.isDown ? 1 : 0) - (keys?.left.isDown || w?.A.isDown ? 1 : 0)
    const ky = (keys?.down.isDown || w?.S.isDown ? 1 : 0) - (keys?.up.isDown || w?.W.isDown ? 1 : 0)
    let dir = { dx: kx, dy: ky }
    if (kx === 0 && ky === 0 && this.aim) {
      const me = this.views.get(this.selfId)?.avatar.image
      const dx = this.aim.x - (me?.x ?? this.arena.cx)
      const dy = this.aim.y - (me?.y ?? this.arena.cy)
      dir = Math.hypot(dx, dy) < this.avatarPx * 0.4 ? { dx: 0, dy: 0 } : { dx, dy }
    }
    if (kx !== 0 || ky !== 0 || this.aim) this.steered = true
    if (!this.steered) return
    const mag = Math.hypot(dir.dx, dir.dy)
    if (mag > 0.001) this.steerDir = { dx: dir.dx / mag, dy: dir.dy / mag }
    const key =
      mag < 0.001 ? '0' : `${Math.round((dir.dx / mag) * 20)},${Math.round((dir.dy / mag) * 20)}`
    if ((key !== this.sentDir || time - this.sentAt > 250) && !this.state.final) {
      this.sentDir = key
      this.sentAt = time
      this.sendInput({ kind: 'move', dx: dir.dx, dy: dir.dy })
    }
  }

  // Discrete events per fresh snapshot: bumps, falls, the last one standing.
  private onSnapshot(snap: SumoIceSnapshot, now: number): void {
    const prevById = new Map((this.prev?.bodies ?? []).map((b) => [b.id, b]))
    const firstSnap = !this.prev
    this.prev = snap
    const alive = snap.bodies.filter((b) => b.alive)
    this.hud?.setCenter(
      this.t('game.common.left', { n: alive.length, total: snap.bodies.length }),
      alive.length <= 1 ? PALETTE.red : PALETTE.text,
    )
    this.strip?.set(
      snap.bodies.map((b) => ({
        text: `${this.label(b.id)} ${b.alive ? '♥'.repeat(b.lives) : '✗'}`,
        avatar: this.state.avatarOf(b.id),
        color: this.state.colorOf(b.id),
        dim: !b.alive,
      })),
    )
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        this.checkImpact(alive[i] as SumoIceBody, alive[j] as SumoIceBody, now, firstSnap)
      }
    }
    for (const b of snap.bodies) {
      const before = prevById.get(b.id)
      if (firstSnap || !before?.alive) continue
      if (!b.alive) this.fallIn({ ...b, x: before.x, y: before.y })
      else if (b.lives < before.lives) this.rescued(before, b)
    }
    const me = snap.bodies.find((b) => b.id === this.selfId)
    if (!this.ended && me?.alive && snap.bodies.length > 1 && alive.length === 1) {
      this.ended = true
      this.sfx.win()
      showBanner(
        this,
        this.banner as Phaser.GameObjects.Text,
        this.t('game.common.youWin'),
        PALETTE.lime,
      )
    }
  }

  private checkImpact(a: SumoIceBody, b: SumoIceBody, now: number, baseline: boolean): void {
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
    const d = Math.hypot(a.x - b.x, a.y - b.y)
    const before = this.pairDist.get(key) ?? Number.POSITIVE_INFINITY
    this.pairDist.set(key, d)
    if (baseline || d >= CONTACT || before < CONTACT) return
    if (now - (this.impactAt.get(key) ?? Number.NEGATIVE_INFINITY) < IMPACT_COOLDOWN_MS) return
    this.impactAt.set(key, now)
    const p = this.toScreen((a.x + b.x) / 2, (a.y + b.y) / 2)
    burst(this, p.x, p.y, 0xdff6ff, 10, 180)
    if (a.id === this.selfId || b.id === this.selfId) {
      this.sfx.hit()
      shake(this, 0.006, 120)
    } else if (now - this.rivalBumpAt >= RIVAL_BUMP_MS) {
      this.rivalBumpAt = now
      this.sfx.quiet(() => this.sfx.hit(0.8), RIVAL_LEVEL * 0.6)
    }
  }

  private fallIn(b: SumoIceBody): void {
    const view = this.views.get(b.id)
    const p = this.toScreen(b.x, b.y)
    ring(this, p.x, p.y, 0x9fd8ee, this.avatarPx * 1.4)
    burst(this, p.x, p.y, 0x9fd8ee, 18, 220)
    eliminate(
      this,
      p.x,
      p.y - this.avatarPx,
      this.state.colorOf(b.id),
      this.quip('game.common.stamps', b.id),
      this.compact ? 12 : 16,
    )
    this.sfx.quiet(
      () => {
        this.sfx.splash()
        this.sfx.eliminated()
      },
      b.id === this.selfId ? 1 : RIVAL_LEVEL,
    )
    if (b.id === this.selfId) {
      flash(this, 0x29a8f2, 220, 0.3)
      this.marker?.hide()
      this.ended = true
      // A short SPLASH! — then the banner clears so you can watch the rest of the fight.
      const banner = this.banner as Phaser.GameObjects.Text
      showBanner(this, banner, this.t('game.sumoIce.splash'), PALETTE.cyan)
      this.time.delayedCall(1400, () => {
        if (!this.state.final) banner.setVisible(false)
      })
    }
    if (view) this.sink(view)
  }

  // The lifebuoy: a splash where they went in, a pop where they come back out.
  private rescued(from: SumoIceBody, to: SumoIceBody): void {
    const p = this.toScreen(from.x, from.y)
    const q = this.toScreen(to.x, to.y)
    burst(this, p.x, p.y, 0x9fd8ee, 14, 200)
    ring(this, q.x, q.y, PALETTE.amber, this.avatarPx)
    floatText(
      this,
      q.x,
      q.y - this.avatarPx,
      this.t('game.sumoIce.lifebuoy'),
      PALETTE.amber,
      this.compact ? 12 : 16,
    )
    // Into the water (a rival's fall softer); losing your own life also stings.
    this.sfx.quiet(() => this.sfx.splash(), to.id === this.selfId ? 1 : RIVAL_LEVEL)
    if (to.id === this.selfId) {
      this.sfx.hurt()
      flash(this, 0x29a8f2, 200, 0.25)
    }
  }

  // Into the water: shrink, spin and fade under the surface.
  private sink(view: View): void {
    view.out = true
    view.shadow.setVisible(false)
    view.avatar.setExpression('ko').tick(0)
    this.tweens.add({
      targets: view.avatar.image,
      scale: view.avatar.image.scale * 0.3,
      angle: 180,
      alpha: 0,
      duration: 700,
      ease: 'Quad.easeIn',
    })
  }

  private paintBodies(time: number): void {
    this.arrow?.setVisible(false)
    const sample = this.interp.sample(time)
    if (!sample) return
    for (const b of sample.to.bodies) {
      let view = this.views.get(b.id)
      if (!view) {
        const shadow = this.add
          .ellipse(0, 0, this.avatarPx * 0.9, this.avatarPx * 0.35, shade(0x0d2a4a, -0.3), 0.55)
          .setDepth(50)
        const avatar = new AvatarSprite(
          this,
          this.state.avatarOf(b.id),
          this.state.colorOf(b.id),
          this.avatarPx,
        )
        avatar.image.setDepth(60)
        view = { avatar, shadow, out: false, x: Number.NaN, y: 0 }
        this.views.set(b.id, view)
        if (!b.alive) {
          view.out = true
          avatar.image.setVisible(false)
          shadow.setVisible(false)
        }
      }
      if (view.out) continue
      const from = sample.from.bodies.find((q) => q.id === b.id) ?? b
      // A respawn snaps instead of sliding across the floe; a ghost blinks.
      const jump = Math.hypot(b.x - from.x, b.y - from.y) > 0.12
      const s = jump
        ? this.toScreen(b.x, b.y)
        : this.toScreen(lerp(from.x, b.x, sample.t), lerp(from.y, b.y, sample.t))
      // Faces where it slides (you: where you push, at once); dazed (hurt) while it blinks back in
      // after a lifebuoy.
      const push = b.id === this.selfId ? this.steerDir : { dx: 0, dy: 0 }
      if (push.dx !== 0 || push.dy !== 0) view.avatar.faceMotion(push.dx, push.dy, 0.1)
      else if (!Number.isNaN(view.x) && !jump) view.avatar.faceMotion(s.x - view.x, s.y - view.y)
      view.x = s.x
      view.y = s.y
      view.avatar.setExpression(b.ghost ? 'hurt' : 'idle').tick(time)
      view.avatar.image
        .setPosition(Math.round(s.x), Math.round(s.y - this.avatarPx * 0.15))
        .setAlpha(b.ghost ? (Math.floor(time / 90) % 2 ? 0.35 : 0.9) : 1)
      view.shadow.setPosition(Math.round(s.x), Math.round(s.y + this.avatarPx * 0.32))
      if (b.id === this.selfId) {
        if (b.alive) this.marker?.place(s.x, s.y - this.avatarPx * 0.62, time)
        else this.marker?.hide()
        // Your push, at your feet, the moment you press.
        if (b.alive && (push.dx !== 0 || push.dy !== 0))
          this.arrow
            ?.setVisible(true)
            .setPosition(
              Math.round(s.x + push.dx * this.avatarPx * 0.75),
              Math.round(s.y + this.avatarPx * 0.1 + push.dy * this.avatarPx * 0.75),
            )
            .setRotation(Math.atan2(push.dy, push.dx))
      }
    }
  }
}
