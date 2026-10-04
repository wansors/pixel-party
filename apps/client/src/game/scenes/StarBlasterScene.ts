import {
  buildStarScript,
  forEachStarBullet,
  PALETTE,
  STAR,
  STAR_ENEMY,
  type StarArena,
  type StarBlasterSnapshot,
  type StarEnemy,
  type StarEnemyKind,
  type StarScript,
  starEnemyAt,
} from '@pp/shared'
import Phaser from 'phaser'
import { AvatarSprite, avatarPx, ensureAvatarTexture } from '../avatars'
import { addBanner, burst, eliminate, flash, floatText, shake, showBanner } from '../fx'
import { ServerClock } from '../netcode/ServerClock'
import {
  bodyStyle,
  ensurePixelGrid,
  fitFontSize,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Star Blaster: a vertical shmup in your own viewport — a scrolling starfield, your ship (in your color,
// your avatar in the cockpit) firing on its own once you first steer, and the round's seeded attack
// script: drone formations, hovering gunners spraying rings and fans, a boss at the end. Enemies and
// their bullets are evaluated locally from the shared script at the server's present (the wire only
// says who you've destroyed and which bullets hit you), so everything moves smoothly. Your ship is
// predicted: it moves the frame you press a key and snapshots only nudge it back in line. Steer with
// the arrows / WASD, or hold the mouse where you want the ship (it eases onto the spot). On wide screens
// everyone else's fight runs as live thumbnails beside yours.

const SHIP_ROWS = [
  '_____BB_____',
  '____BWWB____',
  '____BWWB____',
  '___BBBBBB___',
  '__BBBBBBBB__',
  '_BBDBBBBDBB_',
  'BBBDBBBBDBBB',
  'BB__BBBB__BB',
  'B___RRRR___B',
  '____R__R____',
]
const DRONE_ROWS = ['__MMMM__', '_MmmmmM_', 'MMWMMWMM', 'MMMMMMMM', '_M_MM_M_', 'M______M']
const GUNNER_ROWS = [
  '___OOOOOO___',
  '__OooooooO__',
  '_OOOWOOWOOO_',
  'OOOOOOOOOOOO',
  'OOddOOOOddOO',
  '_O_dd__dd_O_',
  '__O______O__',
]
const BOSS_ROWS = [
  '______RRRRRRRRRRRR______',
  '____RRrrrrrrrrrrrrRR____',
  '__RRRRRRWWRRRRWWRRRRRR__',
  '_RRRRRRRWWRRRRWWRRRRRRR_',
  'RRRRRRRRRRRRRRRRRRRRRRRR',
  'RRddRRRRRRRRRRRRRRRRddRR',
  'RRddddRRRRRRRRRRRRddddRR',
  '_RRRddddRRRRRRRRddddRRR_',
  '__RR__dd__RRRR__dd__RR__',
  '___R______RRRR______R___',
]
// Enemy bullets: a white-hot core in a pink halo — round and bright, unlike the drones' flat magenta.
const BULLET_ROWS = ['_ppp_', 'pwWwp', 'pWWWp', 'pwWwp', '_ppp_']
const BULLET_COLOR = 0xff6fcf

const SHIP_MIN_Y = STAR.h * 0.35
// The pointer eases the ship onto its spot inside this radius (world units) instead of overshooting.
const POINTER_EASE = 0.06
const POINTER_SEND_MS = 50
// A correction bigger than this (world units) is snapped instead of smoothed.
const SNAP_DIST = 0.12
const SMOOTH_MS = 100
const HISTORY = 128
const MINI_REFRESH_MS = 100
// The auto-fire's "pew" at most this often (the gun itself fires every STAR.shotEveryMs).
const SHOT_SFX_MS = 300
// Rivals' moments play at this fraction of the volume (yours stay full), so a full room stays readable.
const RIVAL_LEVEL = 0.5

interface Shot {
  x: number
  y: number
}

interface Live {
  e: StarEnemy
  x: number
  y: number
}

export class StarBlasterScene extends MiniGameScene<StarBlasterSnapshot> {
  private compact = false
  private wide = false
  private view = { x: 0, y: 0, scale: 1 }
  private script?: StarScript
  private stars?: Phaser.GameObjects.Graphics
  private fx?: Phaser.GameObjects.Graphics
  private minis?: Phaser.GameObjects.Graphics
  private miniFrame?: Phaser.GameObjects.Graphics
  private miniOutKey = ''
  private miniDrawnAt = 0
  private miniGrid = { x: 0, y: 0, w: 0, h: 0 }
  private miniBoxes: { x: number; y: number; w: number; h: number }[] = []
  private miniLabels: Phaser.GameObjects.Text[] = []
  private miniAvatars: Phaser.GameObjects.Image[] = []
  private enemyImgs = new Map<number, Phaser.GameObjects.Image>()
  private readonly seen = new Set<number>()
  private enemyPool: Record<StarEnemyKind, Phaser.GameObjects.Image[]> = {
    drone: [],
    gunner: [],
    boss: [],
  }
  // Clips everything inside the viewport (enemies veering off the side, bullets near the edges).
  // Everything that flies inside the arena (enemies, bullets, effects, your ship) lives in one masked
  // layer: one stencil pass for the lot instead of one per masked object (dozens of bullets).
  private world?: Phaser.GameObjects.Layer
  private enemyKeys: Record<StarEnemyKind, string> = { drone: '', gunner: '', boss: '' }
  private bulletImgs: Phaser.GameObjects.Image[] = []
  private bulletKey = ''
  private ship?: Phaser.GameObjects.Image
  private pilot?: AvatarSprite
  private canopy?: Phaser.GameObjects.Ellipse
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private bannerUntil = 0
  private prompt?: Phaser.GameObjects.Text
  // Guns online (the server arms them on the first steer; mirrored locally so the stream starts at once).
  private armed = false
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>
  private aim?: { x: number; y: number }
  private aimPointer = -1
  // The direction the server holds for the ship (as it will scale it: never longer than 1).
  private held = { dx: 0, dy: 0 }
  private sentAt = 0
  private readonly clock = new ServerClock()
  private lastTick = -1
  private mine?: StarArena
  // Per snapshot: each arena's kills and the bullets that hit it (read every frame).
  private killedOf = new Map<string, Map<number, number>>()
  private consumedOf = new Map<string, Set<string>>()
  private hpMine = new Map<number, number>()
  // Own ship prediction: the simulated position, a ring of [roundTime, x, y] and the fading
  // on-screen correction.
  private pred = { x: 0, y: 0, on: false }
  private readonly hist = new Float64Array(HISTORY * 3)
  private histHead = 0
  private histCount = 0
  private offset = { x: 0, y: 0 }
  private live: Live[] = []
  private liveCount = 0
  private shots: Shot[] = []
  private nextShotAt = 0
  private lastShotSfxAt = Number.NEGATIVE_INFINITY
  private lastFrameAt = 0
  private bossWarned = false
  // Pilots already shot down (a rival going out is announced once).
  private readonly outSeen = new Set<string>()

  constructor(...deps: SceneDeps) {
    super('star-blaster', ...deps)
  }

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.wide = !this.compact && width >= 900
    const big = !this.compact && height >= 900
    this.script = undefined
    this.enemyImgs = new Map()
    this.enemyPool = { drone: [], gunner: [], boss: [] }
    this.bulletImgs = []
    this.miniBoxes = []
    this.miniLabels = []
    this.miniAvatars = []
    this.ship = undefined
    this.pilot = undefined
    this.canopy = undefined
    this.aim = undefined
    this.aimPointer = -1
    this.held = { dx: 0, dy: 0 }
    this.sentAt = 0
    this.armed = false
    this.clock.reset()
    this.lastTick = -1
    this.mine = undefined
    this.killedOf = new Map()
    this.consumedOf = new Map()
    this.hpMine = new Map()
    this.pred = { x: 0, y: 0, on: false }
    this.histHead = 0
    this.histCount = 0
    this.offset = { x: 0, y: 0 }
    this.live = []
    this.liveCount = 0
    this.shots = []
    this.nextShotAt = 0
    this.lastShotSfxAt = Number.NEGATIVE_INFINITY
    this.lastFrameAt = 0
    this.bossWarned = false
    this.outSeen.clear()
    this.bannerUntil = 0

    // Layout: your arena as tall as the screen allows; on a wide screen the rivals' thumbnails fill
    // the room beside it (the pair centered), else a player strip on top.
    const hintH = this.compact ? 0 : big ? 26 : 22
    let areaTop = this.top + 4
    if (!this.wide) {
      const stripSize = this.compact ? 11 : 13
      this.strip = new PlayerStrip(this, width / 2, areaTop + 4, width - 24, stripSize, 2)
      areaTop += PlayerStrip.rowH(stripSize) * 2 + 4
    } else this.strip = undefined
    const areaBottom = height - 10 - hintH
    const areaH = areaBottom - areaTop
    let scale: number
    if (this.wide) {
      scale = Math.min(areaH / STAR.h, (width - 32) * 0.5)
      const arenaW = STAR.w * scale
      const gridW = Math.min(width - arenaW - 40, Math.round(arenaW * 1.45))
      const x0 = Math.round((width - arenaW - 16 - gridW) / 2)
      this.view = { x: x0, y: Math.round(areaTop), scale }
      this.miniGrid = {
        x: x0 + Math.round(arenaW) + 16,
        y: Math.round(areaTop),
        w: gridW,
        h: areaH,
      }
    } else {
      scale = Math.min((width - 16) / STAR.w, areaH / STAR.h)
      this.view = {
        x: Math.round((width - STAR.w * scale) / 2),
        y: Math.round(areaTop + (areaH - STAR.h * scale) / 2),
        scale,
      }
    }
    if (hintH > 0) {
      this.add
        .text(
          width / 2,
          height - 6 - hintH / 2,
          this.t('game.starBlaster.hint'),
          bodyStyle(big ? 16 : 14, PALETTE.dim),
        )
        .setOrigin(0.5)
    }
    const clipShape = this.make.graphics({ x: 0, y: 0 }, false)
    clipShape.fillStyle(0xffffff, 1)
    clipShape.fillRect(this.view.x, this.view.y, STAR.w * scale, STAR.h * scale)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => clipShape.destroy())
    this.world = this.add.layer().setDepth(30).enableFilters()
    // Clipped to the view by a Mask filter; the rectangle never changes, so it's captured once.
    const mask = this.world.filters?.internal.addMask(clipShape)
    if (mask) mask.autoUpdate = false
    this.stars = this.add.graphics().setDepth(1)
    this.fx = this.add.graphics().setDepth(45)
    this.world.add(this.fx)
    this.miniFrame = this.add.graphics().setDepth(4)
    this.minis = this.add.graphics().setDepth(5)
    this.miniOutKey = ''
    this.miniDrawnAt = 0
    const px = Math.max(2, Math.round(scale / 160))
    this.enemyKeys = {
      drone: ensurePixelGrid(this, {
        key: `sb-drone-${px}`,
        rows: DRONE_ROWS,
        legend: { M: PALETTE.magenta, m: shade(PALETTE.magenta, 0.4), W: 0xffffff },
        pixelSize: px,
      }),
      gunner: ensurePixelGrid(this, {
        key: `sb-gunner-${px}`,
        rows: GUNNER_ROWS,
        legend: {
          O: PALETTE.orange,
          o: shade(PALETTE.orange, 0.4),
          W: 0xffffff,
          d: shade(PALETTE.orange, -0.45),
        },
        pixelSize: px,
      }),
      boss: ensurePixelGrid(this, {
        key: `sb-boss-${px}`,
        rows: BOSS_ROWS,
        legend: {
          R: PALETTE.red,
          r: shade(PALETTE.red, 0.4),
          W: 0xffffff,
          d: shade(PALETTE.red, -0.5),
        },
        pixelSize: px,
      }),
    }
    // A bullet a touch bigger than its hitbox, on crisp pixels.
    const bulletPx = Math.max(2, Math.round((STAR.bulletR * 2.3 * scale) / BULLET_ROWS.length))
    this.bulletKey = ensurePixelGrid(this, {
      key: `sb-bullet-${bulletPx}`,
      rows: BULLET_ROWS,
      legend: { p: BULLET_COLOR, w: 0xffd9f2, W: 0xffffff },
      pixelSize: bulletPx,
    })
    this.banner = addBanner(this)
    const promptText = this.t('game.starBlaster.steerToFire')
    this.prompt = this.add
      .text(
        this.view.x + (STAR.w * scale) / 2,
        this.view.y + STAR.h * scale * 0.62,
        promptText,
        headlineStyle(
          fitFontSize(promptText, STAR.w * scale - 24, this.compact ? 12 : big ? 24 : 16),
          PALETTE.lime,
          {
            stroke: '#10121c',
            strokeThickness: 4,
          },
        ),
      )
      .setOrigin(0.5)
      .setDepth(60)
      .setVisible(false)

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
    const release = (): void => {
      this.aimPointer = -1
      this.aim = undefined
    }
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.id === this.aimPointer) release()
    })
    // Held keys are let go by Phaser when the window loses focus; a held pointer must let go too.
    this.game.events.on(Phaser.Core.Events.BLUR, release)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.game.events.off(Phaser.Core.Events.BLUR, release),
    )
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.view.x + x * this.view.scale, y: this.view.y + y * this.view.scale }
  }

  protected frame(snap: StarBlasterSnapshot | null, time: number): void {
    const now = this.time.now
    const dt = Math.min(0.05, (now - (this.lastFrameAt || now)) / 1000)
    this.lastFrameAt = now
    this.paintStars(time)
    if (!snap) return
    this.script ??= buildStarScript(snap.seed, snap.durationMs)
    let fresh = false
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.clock.sync(snap.remainingMs, now)
      this.onSnapshot(snap)
      fresh = true
    }
    // The round time on screen: the server's present (frozen on the final snapshot).
    const t = this.state.final ? snap.t : snap.t + this.clock.since(snap.remainingMs, now)
    this.steer(now)
    this.predict(t, dt, fresh ? snap : null)
    this.collectLive(t)
    this.fx?.clear()
    const shipPos = this.paintShip(time)
    this.paintEnemies(t)
    this.paintShots(t, dt, shipPos)
    this.paintMinis(snap, t, now)
    if (this.banner?.visible && time > this.bannerUntil && !this.state.final)
      this.banner.setVisible(false)
    this.prompt?.setVisible(
      !this.armed &&
        !!this.mine &&
        !this.mine.out &&
        !this.state.final &&
        Math.floor(time / 500) % 3 > 0,
    )
  }

  private paintStars(time: number): void {
    const g = this.stars as Phaser.GameObjects.Graphics
    const { x, y, scale } = this.view
    const w = STAR.w * scale
    const h = STAR.h * scale
    g.clear()
    g.fillStyle(0x070814, 1)
    g.fillRect(x, y, w, h)
    for (let i = 0; i < 90; i++) {
      const layer = i % 3
      const speed = [18, 40, 80][layer] ?? 30
      const sx = x + ((i * 97) % 101) * (w / 101)
      const sy = y + (((((i * 53) % 113) / 113) * h + (time / 1000) * speed) % h)
      g.fillStyle(layer === 2 ? 0xffffff : layer === 1 ? 0x9fb4ff : 0x4a5590, 1)
      g.fillRect(Math.round(sx), Math.round(sy), layer === 2 ? 2 : 1, layer === 2 ? 3 : 1)
    }
    g.lineStyle(3, PALETTE.frameLit, 1)
    g.strokeRect(x, y, w, h)
  }

  // Keys (8-way, full speed, sent the moment they change) or a held pointer (eases onto the spot,
  // sent at most every 50 ms). Only a real steer goes out — never an idle heartbeat.
  private steer(now: number): void {
    const keys = this.cursors
    const w = this.wasd
    const kx =
      (keys?.right.isDown || w?.D.isDown ? 1 : 0) - (keys?.left.isDown || w?.A.isDown ? 1 : 0)
    const ky = (keys?.down.isDown || w?.S.isDown ? 1 : 0) - (keys?.up.isDown || w?.W.isDown ? 1 : 0)
    let dx = 0
    let dy = 0
    let fromKeys = true
    if (kx !== 0 || ky !== 0) {
      const m = Math.hypot(kx, ky)
      dx = kx / m
      dy = ky / m
    } else if (this.aim && this.pred.on) {
      fromKeys = false
      const at = this.toScreen(this.pred.x + this.offset.x, this.pred.y + this.offset.y)
      const vx = (this.aim.x - at.x) / this.view.scale / POINTER_EASE
      const vy = (this.aim.y - at.y) / this.view.scale / POINTER_EASE
      const m = Math.max(1, Math.hypot(vx, vy))
      dx = Math.round((vx / m) * 20) / 20
      dy = Math.round((vy / m) * 20) / 20
    }
    if (dx === this.held.dx && dy === this.held.dy) return
    if (this.state.final || !this.mine || this.mine.out) return
    if (!fromKeys && now - this.sentAt < POINTER_SEND_MS) return
    this.held = { dx, dy }
    this.sentAt = now
    this.sendInput({ kind: 'move', dx, dy })
    if (dx !== 0 || dy !== 0) this.armed = true
  }

  // Own ship: flown locally with the held direction (the server's own rule), and on each snapshot
  // compared with what was predicted for its moment — the difference is folded in and faded on screen.
  private predict(t: number, dt: number, fresh: StarBlasterSnapshot | null): void {
    const mine = this.mine
    if (!mine || mine.out || this.state.final) {
      this.pred.on = false
      return
    }
    if (!this.pred.on) {
      this.pred = { x: mine.x, y: mine.y, on: true }
      this.histHead = 0
      this.histCount = 0
      this.offset = { x: 0, y: 0 }
    }
    const p = this.pred
    p.x = Math.max(
      STAR.shipR,
      Math.min(STAR.w - STAR.shipR, p.x + this.held.dx * STAR.shipSpeed * dt),
    )
    p.y = Math.max(
      SHIP_MIN_Y,
      Math.min(STAR.h - STAR.shipR, p.y + this.held.dy * STAR.shipSpeed * dt),
    )
    const o = this.histHead * 3
    this.hist[o] = t
    this.hist[o + 1] = p.x
    this.hist[o + 2] = p.y
    this.histHead = (this.histHead + 1) % HISTORY
    this.histCount = Math.min(HISTORY, this.histCount + 1)
    const k = Math.exp((-dt * 1000) / SMOOTH_MS)
    this.offset.x *= k
    this.offset.y *= k
    if (!fresh) return
    const was = this.historyAt(fresh.t)
    const ex = mine.x - (was?.x ?? p.x)
    const ey = mine.y - (was?.y ?? p.y)
    if (!was || Math.hypot(ex, ey) > SNAP_DIST) {
      p.x = mine.x
      p.y = mine.y
      this.histHead = 0
      this.histCount = 0
      this.offset = { x: 0, y: 0 }
      return
    }
    p.x += ex
    p.y += ey
    for (let i = 0; i < this.histCount; i++) {
      this.hist[i * 3 + 1] = (this.hist[i * 3 + 1] as number) + ex
      this.hist[i * 3 + 2] = (this.hist[i * 3 + 2] as number) + ey
    }
    this.offset.x -= ex
    this.offset.y -= ey
  }

  private historyAt(t: number): { x: number; y: number } | null {
    const H = this.hist
    let newer = -1
    for (let i = 0; i < this.histCount; i++) {
      const idx = (this.histHead - 1 - i + HISTORY) % HISTORY
      const ti = H[idx * 3] as number
      if (ti <= t) {
        if (newer < 0) return { x: H[idx * 3 + 1] as number, y: H[idx * 3 + 2] as number }
        const tn = H[newer * 3] as number
        const f = tn > ti ? (t - ti) / (tn - ti) : 1
        return {
          x: (H[idx * 3 + 1] as number) * (1 - f) + (H[newer * 3 + 1] as number) * f,
          y: (H[idx * 3 + 2] as number) * (1 - f) + (H[newer * 3 + 2] as number) * f,
        }
      }
      newer = idx
    }
    return null
  }

  private onSnapshot(snap: StarBlasterSnapshot): void {
    const prev = this.mine
    const mine = snap.arenas.find((a) => a.id === this.selfId)
    this.mine = mine
    this.killedOf = new Map(snap.arenas.map((a) => [a.id, new Map(a.killed)]))
    this.consumedOf = new Map(snap.arenas.map((a) => [a.id, new Set(a.consumed)]))
    this.hpMine = new Map(mine?.hp ?? [])
    if (mine?.armed) this.armed = true
    if (mine) {
      this.hud?.setScore(this.t('game.starBlaster.score', { n: mine.score }))
      this.hud?.setCenter(
        mine.out ? '✗' : '♥'.repeat(mine.lives),
        mine.lives <= 1 ? PALETTE.red : PALETTE.text,
      )
      if (prev && !this.firstSnapshot) this.react(prev, mine)
    }
    // A rival shot down for good: the elimination sting (yours plays in react()).
    for (const a of snap.arenas) {
      if (!a.out || this.outSeen.has(a.id)) continue
      this.outSeen.add(a.id)
      if (a.id !== this.selfId && !this.firstSnapshot)
        this.sfx.quiet(() => this.sfx.eliminated(), RIVAL_LEVEL)
    }
    this.strip?.set(
      snap.arenas.map((a) => ({
        text: `${this.label(a.id)} ${a.score} ${a.out ? '✗' : '♥'.repeat(a.lives)}`,
        avatar: this.state.avatarOf(a.id),
        color: this.state.colorOf(a.id),
        dim: a.out,
      })),
    )
    // Boss warning.
    const boss = this.script?.enemies.find((e) => e.kind === 'boss')
    if (boss && !this.bossWarned && snap.t >= boss.spawnAt - 1500 && snap.t < boss.endAt) {
      this.bossWarned = true
      if (!this.firstSnapshot) {
        showBanner(
          this,
          this.banner as Phaser.GameObjects.Text,
          this.t('game.starBlaster.warning'),
          PALETTE.red,
        )
        this.bannerUntil = this.time.now + 1400
        this.sfx.siren()
      }
    }
    if (this.state.final && mine && this.banner && !this.banner.visible) {
      const best = Math.max(...snap.arenas.map((a) => a.score))
      const won = mine.score === best && snap.arenas.length > 1
      showBanner(
        this,
        this.banner,
        won ? this.t('game.common.youWin') : this.t('game.starBlaster.final', { n: mine.score }),
        won ? PALETTE.lime : PALETTE.amber,
      )
    }
  }

  // Own events: kills (an explosion where the enemy was), hits, game over.
  private react(prev: StarArena, mine: StarArena): void {
    const size = this.compact ? 12 : 16
    const before = new Set(prev.killed.map(([id]) => id))
    // One blast per snapshot however many went down together.
    let blasted = false
    for (const [id, at] of mine.killed) {
      if (before.has(id)) continue
      const e = this.script?.enemies[id]
      const p = e ? starEnemyAt(e, at) : null
      if (!e || !p) continue
      const s = this.toScreen(p.x, p.y)
      const big = e.kind !== 'drone'
      burst(
        this,
        s.x,
        s.y,
        e.kind === 'boss' ? PALETTE.red : e.kind === 'gunner' ? PALETTE.orange : PALETTE.magenta,
        big ? 30 : 12,
        big ? 280 : 180,
      )
      if (big) shake(this, e.kind === 'boss' ? 0.012 : 0.005, 160)
      floatText(this, s.x, s.y, `+${STAR_ENEMY[e.kind].pts}`, PALETTE.amber, big ? size : 12)
      if (!blasted) this.sfx.explosion()
      blasted = true
      if (e.kind === 'boss') this.sfx.win()
    }
    if (mine.lives < prev.lives) {
      const at = this.pred.on ? this.pred : mine
      const s = this.toScreen(at.x, at.y)
      if (mine.out) {
        eliminate(
          this,
          s.x,
          s.y,
          this.state.colorOf(mine.id),
          this.quip('game.common.stamps', mine.id),
          size,
        )
        this.sfx.eliminated()
      } else {
        floatText(this, s.x, s.y - 20, `-${STAR.hitPenalty}`, PALETTE.red, size)
        this.sfx.hurt()
      }
      flash(this, PALETTE.red, 200, 0.3)
      shake(this, 0.008, 160)
    }
  }

  // Own ship (predicted); returns its position (world units), or null when out.
  private paintShip(time: number): { x: number; y: number } | null {
    const mine = this.mine
    if (!mine) return null
    const x = this.pred.on ? this.pred.x + this.offset.x : mine.x
    const y = this.pred.on ? this.pred.y + this.offset.y : mine.y
    const s = this.toScreen(x, y)
    const shipPx = Math.max(24, Math.round(this.view.scale * 0.075))
    if (!this.ship) {
      const color = this.state.colorOf(mine.id)
      const key = ensurePixelGrid(this, {
        key: `sb-ship-${color.toString(16)}`,
        rows: SHIP_ROWS,
        legend: { B: color, W: 0xdff6ff, D: shade(color, -0.45), R: PALETTE.amber },
        pixelSize: 3,
      })
      this.ship = this.add
        .image(0, 0, key)
        .setDisplaySize(shipPx, shipPx * (SHIP_ROWS.length / 12))
        .setDepth(50)
      // A dark canopy so the pilot (your lobby avatar, in your color) stands out from the hull — about
      // the size of the ship's real hitbox.
      const pilotPx = avatarPx(Math.max(16, shipPx * 0.5))
      this.canopy = this.add
        .ellipse(0, 0, pilotPx * 1.15, pilotPx * 1.05, 0x10121c, 0.9)
        .setDepth(51)
      this.pilot = new AvatarSprite(this, this.state.avatarOf(mine.id), color, pilotPx)
      this.pilot.image.setDepth(52)
      this.world?.add([this.ship, this.canopy, this.pilot.image])
    }
    const alpha = mine.out ? 0.25 : mine.shielded ? (Math.floor(time / 90) % 2 ? 0.3 : 1) : 1
    this.ship.setPosition(Math.round(s.x), Math.round(s.y)).setAlpha(alpha)
    // The pilot (your lobby avatar) sits in the middle of the hull.
    this.canopy?.setPosition(Math.round(s.x), Math.round(s.y + shipPx * 0.04)).setAlpha(alpha)
    this.pilot?.setExpression(mine.out ? 'ko' : mine.shielded ? 'hurt' : 'idle').tick(time)
    this.pilot?.image.setPosition(Math.round(s.x), Math.round(s.y + shipPx * 0.04)).setAlpha(alpha)
    // Engine flame.
    const g = this.fx as Phaser.GameObjects.Graphics
    if (!mine.out) {
      g.fillStyle(Math.floor(time / 60) % 2 ? PALETTE.amber : PALETTE.orange, 1)
      g.fillRect(
        Math.round(s.x - 3),
        Math.round(s.y + shipPx * 0.42),
        6,
        4 + (Math.floor(time / 60) % 2) * 3,
      )
    }
    return mine.out ? null : { x, y }
  }

  // Every enemy on screen at `t` (kills are per player and checked where used), into a reused buffer.
  private collectLive(t: number): void {
    const script = this.script
    let n = 0
    if (script) {
      for (const e of script.enemies) {
        if (e.spawnAt > t || e.endAt <= t) continue
        const p = starEnemyAt(e, t)
        if (!p) continue
        let slot = this.live[n]
        if (!slot) {
          slot = { e, x: 0, y: 0 }
          this.live.push(slot)
        }
        slot.e = e
        slot.x = p.x
        slot.y = p.y
        n++
      }
    }
    this.liveCount = n
  }

  private isDead(killed: ReadonlyMap<number, number> | undefined, id: number, t: number): boolean {
    const at = killed?.get(id)
    return at !== undefined && at <= t
  }

  private paintEnemies(t: number): void {
    const script = this.script
    if (!script) return
    const killed = this.killedOf.get(this.selfId)
    const g = this.fx as Phaser.GameObjects.Graphics
    const seen = this.seen
    seen.clear()
    for (let i = 0; i < this.liveCount; i++) {
      const { e, x, y } = this.live[i] as Live
      if (this.isDead(killed, e.id, t)) continue
      seen.add(e.id)
      let img = this.enemyImgs.get(e.id)
      if (!img) {
        img = this.enemyPool[e.kind].pop()
        if (!img) {
          img = this.add.image(0, 0, this.enemyKeys[e.kind]).setDepth(30)
          this.world?.add(img)
          const r = STAR_ENEMY[e.kind].r * 2 * this.view.scale
          img.setScale((r * 1.25) / (img.width || 1))
        }
        this.enemyImgs.set(e.id, img)
      }
      const s = this.toScreen(x, y)
      img.setPosition(Math.round(s.x), Math.round(s.y)).setVisible(true)
      // Damaged big enemies show an HP bar.
      const left = this.hpMine.get(e.id)
      if (left !== undefined && e.kind !== 'drone') {
        const full = STAR_ENEMY[e.kind].hp
        const w = img.displayWidth
        const bx = Math.round(s.x - w / 2)
        const by = Math.round(s.y - img.displayHeight / 2 - 8)
        g.fillStyle(PALETTE.panelAlt, 1).fillRect(bx, by, Math.round(w), 4)
        g.fillStyle(PALETTE.lime, 1).fillRect(bx, by, Math.round((w * left) / full), 4)
      }
    }
    // Gone from the screen: back to the pool.
    for (const [id, img] of this.enemyImgs) {
      if (seen.has(id)) continue
      img.setVisible(false)
      const kind = script.enemies[id]?.kind
      if (kind) this.enemyPool[kind].push(img)
      else img.destroy()
      this.enemyImgs.delete(id)
    }
    // Enemy bullets for this player (pooled images).
    let n = 0
    forEachStarBullet(
      script,
      t,
      killed ?? EMPTY_KILLS,
      this.consumedOf.get(this.selfId),
      (bx, by) => {
        let img = this.bulletImgs[n]
        if (!img) {
          img = this.add.image(0, 0, this.bulletKey).setDepth(40)
          this.world?.add(img)
          this.bulletImgs.push(img)
        }
        const s = this.toScreen(bx, by)
        img.setPosition(Math.round(s.x), Math.round(s.y)).setVisible(true)
        n++
        return false
      },
    )
    for (let i = n; i < this.bulletImgs.length; i++) {
      const img = this.bulletImgs[i]
      if (img?.visible) img.setVisible(false)
    }
  }

  // The ship's own fire is cosmetic (the server resolves the real hits): a stream from the ship that
  // stops at the first enemy it meets on this screen.
  private paintShots(t: number, dt: number, ship: { x: number; y: number } | null): void {
    if (ship && this.armed && !this.state.final) {
      if (this.nextShotAt === 0) this.nextShotAt = t
      while (this.nextShotAt <= t) {
        this.shots.push({ x: ship.x, y: ship.y - 0.03 })
        this.nextShotAt += STAR.shotEveryMs
        const now = this.time.now
        if (now - this.lastShotSfxAt >= SHOT_SFX_MS) {
          this.lastShotSfxAt = now
          this.sfx.shoot()
        }
      }
    } else this.nextShotAt = 0
    const killed = this.killedOf.get(this.selfId)
    const g = this.fx as Phaser.GameObjects.Graphics
    g.fillStyle(PALETTE.lime, 1)
    let kept = 0
    for (const s of this.shots) {
      s.y -= STAR.shotSpeed * dt
      if (s.y < -0.02) continue
      let spent = false
      for (let i = 0; i < this.liveCount && !spent; i++) {
        const { e, x, y } = this.live[i] as Live
        if (this.isDead(killed, e.id, t)) continue
        spent = Math.hypot(x - s.x, y - s.y) < STAR_ENEMY[e.kind].r + STAR.shotR
      }
      if (spent) continue
      const q = this.toScreen(s.x, s.y)
      g.fillRect(Math.round(q.x - 1), Math.round(q.y - 5), 3, 9)
      this.shots[kept++] = s
    }
    this.shots.length = kept
  }

  // Everyone else's fight, live, as thumbnails (wide screens only): a grid sized to the room beside
  // your arena, each box in its pilot's color with name, score and lives under it. The boxes are drawn
  // once (again when someone is knocked out); their contents refresh at ~10 Hz, plenty for a glance.
  private paintMinis(snap: StarBlasterSnapshot, t: number, now: number): void {
    const g = this.minis
    const frame = this.miniFrame
    const script = this.script
    if (!g || !frame || !this.wide || !script) return
    const others = snap.arenas.filter((a) => a.id !== this.selfId)
    let force = false
    if (this.miniBoxes.length !== others.length) {
      this.layoutMinis(others)
      force = true
    }
    const outKey = others.map((a) => (a.out ? 1 : 0)).join('')
    if (force || outKey !== this.miniOutKey) {
      this.miniOutKey = outKey
      frame.clear()
      others.forEach((a, i) => {
        const box = this.miniBoxes[i]
        if (!box) return
        frame.fillStyle(a.out ? 0x0b0c18 : 0x0d0f22, 1).fillRect(box.x, box.y, box.w, box.h)
        frame
          .lineStyle(2, this.state.colorOf(a.id), a.out ? 0.4 : 1)
          .strokeRect(box.x, box.y, box.w, box.h)
      })
    }
    if (!force && !this.state.final && now - this.miniDrawnAt < MINI_REFRESH_MS) return
    this.miniDrawnAt = now
    g.clear()
    others.forEach((a, i) => {
      const box = this.miniBoxes[i]
      if (!box) return
      const s = box.w / STAR.w
      const killed = this.killedOf.get(a.id)
      for (let k = 0; k < this.liveCount; k++) {
        const { e, x, y } = this.live[k] as Live
        if (this.isDead(killed, e.id, t) || x < 0 || x > STAR.w || y < 0 || y > STAR.h) continue
        const r = Math.max(2, Math.round(STAR_ENEMY[e.kind].r * s))
        g.fillStyle(
          e.kind === 'boss' ? PALETTE.red : e.kind === 'gunner' ? PALETTE.orange : PALETTE.magenta,
          1,
        ).fillRect(Math.round(box.x + x * s) - r, Math.round(box.y + y * s) - r, r * 2, r * 2)
      }
      if (!a.out) {
        g.fillStyle(0xffffff, 1)
        forEachStarBullet(script, t, killed ?? EMPTY_KILLS, this.consumedOf.get(a.id), (bx, by) => {
          if (bx >= 0 && bx <= STAR.w && by >= 0 && by <= STAR.h)
            g.fillRect(Math.round(box.x + bx * s) - 1, Math.round(box.y + by * s) - 1, 3, 3)
          return false
        })
      }
      // Each rival flies as their pilot avatar.
      this.miniAvatars[i]
        ?.setPosition(Math.round(box.x + a.x * s), Math.round(box.y + a.y * s))
        .setVisible(!a.out)
      const label = this.miniLabels[i]
      const tail = `${a.score} ${a.out ? '✗' : '♥'.repeat(a.lives)}`
      if (label && label.getData('tail') !== tail) {
        label.setData('tail', tail)
        this.fitMiniLabel(label, this.label(a.id), tail, box.w)
        label.setColor(hexToCss(this.state.colorOf(a.id))).setAlpha(a.out ? 0.45 : 1)
      }
    })
  }

  // The biggest thumbnails that fit the grid area: try every column count, keep the widest box.
  private layoutMinis(others: readonly StarArena[]): void {
    const { x, y, w, h } = this.miniGrid
    const big = this.scale.height >= 900
    const labelH = big ? 40 : 32
    const gap = 10
    const n = Math.max(1, others.length)
    let best = { cols: 1, boxW: 0 }
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols)
      const boxW = Math.floor(
        Math.min((w - (cols - 1) * gap) / cols, ((h - (rows - 1) * gap) / rows - labelH) / STAR.h),
      )
      if (boxW > best.boxW) best = { cols, boxW }
    }
    const { cols, boxW } = best
    const boxH = Math.round(boxW * STAR.h)
    const rows = Math.ceil(n / cols)
    const usedH = rows * (boxH + labelH) + (rows - 1) * gap
    const usedW = Math.min(n, cols) * (boxW + gap) - gap
    const x0 = x + Math.max(0, Math.round((w - usedW) / 2))
    const y0 = y + Math.max(0, Math.round((h - usedH) / 2))
    this.miniBoxes = others.map((_, i) => ({
      x: x0 + (i % cols) * (boxW + gap),
      y: y0 + Math.floor(i / cols) * (boxH + labelH + gap),
      w: boxW,
      h: boxH,
    }))
    for (const l of this.miniLabels) l.destroy()
    for (const m of this.miniAvatars) m.destroy()
    this.miniLabels = this.miniBoxes.map((b) =>
      this.add
        .text(b.x, b.y + b.h + 3, '', bodyStyle(big ? 15 : 12, PALETTE.text, { fontStyle: 'bold' }))
        .setDepth(6),
    )
    const avatarPixel = boxW >= 180 ? 2 : 1
    this.miniAvatars = others.map((a) =>
      this.add
        .image(
          0,
          0,
          ensureAvatarTexture(
            this,
            this.state.avatarOf(a.id),
            this.state.colorOf(a.id),
            avatarPixel,
          ),
        )
        .setDepth(6),
    )
  }

  // A thumbnail's caption: the name (shortened until it fits the box's width) over score and lives.
  private fitMiniLabel(
    label: Phaser.GameObjects.Text,
    name: string,
    tail: string,
    maxW: number,
  ): void {
    let shown = name
    label.setText(`${shown}\n${tail}`)
    while (shown.length > 1 && label.width > maxW) {
      shown = shown.slice(0, -1)
      label.setText(`${shown}…\n${tail}`)
    }
  }
}

const EMPTY_KILLS: ReadonlyMap<number, number> = new Map()
