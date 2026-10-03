import { PALETTE, SUMO_ICE, type SumoIceBody, type SumoIceSnapshot } from '@pp/shared'
import type Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { addBanner, burst, eliminate, flash, floatText, ring, shake, showBanner } from '../fx'
import { SnapshotInterpolator, lerp } from '../netcode/SnapshotInterpolator'
import { ensurePixelGrid, shade } from '../pixelStyle'
import { YouMarker } from '../playerMarks'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Sumo ICE: sumo on a melting ice floe. A square of dark, rippling water with the floe drawn tile by
// tile from the snapshot — solid ice, cracking ice (flickering crack lines, the warning) and open water
// once a tile sinks (with a splash). Every wrestler is their lobby avatar on a little shadow; bumps
// throw ice chips; the first fall is a lifebuoy back onto the core (blinking while it's a ghost), the
// second an ELIMINATED splash. Steer with the arrows/WASD or by holding the
// pointer where you want to go — on ice you only nudge your momentum, so plan your slides.

const N = SUMO_ICE.grid
const CONTACT = SUMO_ICE.playerR * 2 * 1.25
const IMPACT_COOLDOWN_MS = 400

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
  private readonly interp = new SnapshotInterpolator<SumoIceSnapshot>(100)
  private compact = false
  private arena = { cx: 0, cy: 0, size: 0 }
  private water?: Phaser.GameObjects.Graphics
  private tileImgs: Phaser.GameObjects.Image[] = []
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
  private sentDir = ''
  private sentAt = 0
  private lastTick = -1
  private prev?: SumoIceSnapshot
  private pairDist = new Map<string, number>()
  private impactAt = new Map<string, number>()
  private ended = false

  constructor(...deps: SceneDeps) {
    super('sumo-ice', ...deps)
  }

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.interp.reset()
    this.tileImgs = []
    this.tiles = ''
    this.views = new Map()
    this.aim = undefined
    this.aimPointer = -1
    this.sentDir = ''
    this.sentAt = 0
    this.lastTick = -1
    this.prev = undefined
    this.pairDist = new Map()
    this.impactAt = new Map()
    this.ended = false

    const stripSize = this.compact ? 11 : 13
    this.strip = new PlayerStrip(this, width / 2, this.top + 8, width - 24, stripSize, 2)
    const areaTop = this.top + 8 + PlayerStrip.rowH(stripSize) * 2
    const areaBottom = height - (this.compact ? 16 : 20)
    const size = Math.floor(Math.min(width - 16, areaBottom - areaTop))
    this.arena = { cx: width / 2, cy: areaTop + (areaBottom - areaTop) / 2, size }
    this.avatarPx = avatarPx(Math.round(SUMO_ICE.playerR * 2 * size * 1.25))

    this.water = this.add.graphics().setDepth(1)
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
    const cell = size / N
    for (let i = 0; i < N * N; i++) {
      const p = this.toScreen(((i % N) + 0.5) / N, (Math.floor(i / N) + 0.5) / N)
      this.tileImgs.push(
        this.add
          .image(p.x, p.y, this.tileKeys.ice)
          .setDisplaySize(Math.ceil(cell), Math.ceil(cell))
          .setDepth(5)
          .setVisible(false),
      )
    }
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
    this.paintWater(time)
    if (!snap) return
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.interp.push(snap, time)
      this.onSnapshot(snap, time)
    }
    this.steer(time)
    this.paintTiles(snap, time)
    this.paintBodies(time)
  }

  private paintWater(time: number): void {
    const g = this.water as Phaser.GameObjects.Graphics
    const { cx, cy, size } = this.arena
    const x0 = cx - size / 2
    const y0 = cy - size / 2
    g.clear()
    g.fillStyle(0x0d2a4a, 1)
    g.fillRect(x0, y0, size, size)
    // Slow ripples: short light dashes drifting along rows (deterministic from index + time).
    g.fillStyle(0x1f4f7a, 1)
    const rows = 14
    for (let r = 0; r < rows; r++) {
      const y = y0 + ((r + 0.5) / rows) * size
      for (let k = 0; k < 6; k++) {
        const x = x0 + ((k / 6 + ((r * 0.37 + time / 9000) % 1) + (r % 2) * 0.08) % 1) * size
        g.fillRect(
          Math.round(x),
          Math.round(y + Math.sin(time / 700 + r + k) * 2),
          Math.round(size / 28),
          2,
        )
      }
    }
    g.lineStyle(4, PALETTE.frameLit, 1)
    g.strokeRect(x0, y0, size, size)
  }

  // Tiles change only a few times a second: update just those that did, with a splash when one sinks.
  private paintTiles(snap: SumoIceSnapshot, time: number): void {
    const next = snap.tiles
    const first = this.tiles === ''
    const me = snap.bodies.find((b) => b.id === this.selfId)
    for (let i = 0; i < N * N; i++) {
      const c = next[i]
      const was = this.tiles[i]
      const img = this.tileImgs[i]
      if (!img) continue
      if (c === '%') img.setAlpha(Math.floor(time / 110 + i) % 2 === 0 ? 1 : 0.75)
      if (c === was) continue
      img.setVisible(c !== '.')
      if (c === '#') img.setTexture(this.tileKeys.ice).setAlpha(1)
      else if (c === '%') img.setTexture(this.tileKeys.crack)
      else if (!first && was !== undefined && was !== '.') {
        burst(this, img.x, img.y, 0x9fd8ee, 8, 140)
        // Only the tiles going down right next to you make a sound (the floe melts all round long).
        if (me?.alive) {
          const tx = ((i % N) + 0.5) / N
          const ty = (Math.floor(i / N) + 0.5) / N
          if (Math.hypot(tx - me.x, ty - me.y) < 0.16) this.sfx.pop()
        }
      }
    }
    this.tiles = next
  }

  private steer(time: number): void {
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
    const mag = Math.hypot(dir.dx, dir.dy)
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
      this.sfx.pop()
      shake(this, 0.006, 120)
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
      this.t('game.common.eliminated'),
      this.compact ? 12 : 16,
    )
    this.sfx.eliminated()
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
    if (to.id === this.selfId) {
      this.sfx.wrong()
      flash(this, 0x29a8f2, 200, 0.25)
    } else this.sfx.pop()
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
      // Faces where it slides; dazed (hurt) while it blinks back in after a lifebuoy.
      if (!Number.isNaN(view.x) && !jump) view.avatar.faceMotion(s.x - view.x, s.y - view.y)
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
      }
    }
  }
}
