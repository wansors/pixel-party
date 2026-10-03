import {
  PALETTE,
  STAR,
  STAR_ENEMY,
  type StarArena,
  type StarBlasterSnapshot,
  type StarEnemy,
  type StarScript,
  buildStarScript,
  starBulletsAt,
  starEnemyAt,
} from '@pp/shared'
import type Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { addBanner, burst, eliminate, flash, floatText, shake, showBanner } from '../fx'
import { bodyStyle, ensurePixelGrid, ensurePixelOrb, shade } from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Star Blaster: a vertical shmup in your own viewport — a scrolling starfield, your ship (in your color,
// your avatar in the cockpit) firing on its own, and the round's seeded attack script: drone
// formations, hovering gunners spraying rings and fans, a boss at the end. Enemies and their bullets
// are evaluated locally from the shared script (the wire only says who you've destroyed and which
// bullets hit you), so everything moves smoothly. Steer with the arrows/WASD or by holding the pointer
// where you want the ship. On wide screens everyone else's fight runs as a live thumbnail.

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

interface Shot {
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
  private miniBoxes: { x: number; y: number; w: number; h: number }[] = []
  private miniLabels: Phaser.GameObjects.Text[] = []
  private enemyImgs = new Map<number, Phaser.GameObjects.Image>()
  // Clips everything inside the viewport (enemies veering off the side, bullets near the edges).
  private clip?: Phaser.Display.Masks.GeometryMask
  private enemyKeys: Record<string, string> = {}
  private bulletImgs: Phaser.GameObjects.Image[] = []
  private bulletKey = ''
  private ship?: Phaser.GameObjects.Image
  private pilot?: Phaser.GameObjects.Image
  private canopy?: Phaser.GameObjects.Ellipse
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private bannerUntil = 0
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>
  private aim?: { x: number; y: number }
  private aimPointer = -1
  private dir = { dx: 0, dy: 0 }
  private sentDir = ''
  private sentAt = 0
  private lastTick = -1
  private snapAt = 0
  private snapT = 0
  private mine?: StarArena
  private shots: Shot[] = []
  private nextShotAt = 0
  private lastFrameAt = 0
  private bossWarned = false

  constructor(...deps: SceneDeps) {
    super('star-blaster', ...deps)
  }

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.wide = !this.compact && width >= 900
    this.script = undefined
    this.enemyImgs = new Map()
    this.bulletImgs = []
    this.miniBoxes = []
    this.miniLabels = []
    this.ship = undefined
    this.pilot = undefined
    this.canopy = undefined
    this.aim = undefined
    this.aimPointer = -1
    this.dir = { dx: 0, dy: 0 }
    this.sentDir = ''
    this.sentAt = 0
    this.lastTick = -1
    this.snapAt = 0
    this.snapT = 0
    this.mine = undefined
    this.shots = []
    this.nextShotAt = 0
    this.lastFrameAt = 0
    this.bossWarned = false
    this.bannerUntil = 0

    let areaTop = this.top + 4
    if (!this.wide) {
      const stripSize = this.compact ? 11 : 13
      this.strip = new PlayerStrip(this, width / 2, areaTop + 4, width - 24, stripSize, 2)
      areaTop += PlayerStrip.rowH(stripSize) * 2 + 4
    } else this.strip = undefined
    const areaBottom = height - 10
    const areaRight = this.wide ? Math.round(width * 0.62) : width - 8
    const scale = Math.min((areaRight - 8) / STAR.w, (areaBottom - areaTop) / STAR.h)
    this.view = {
      x: Math.round(8 + (areaRight - 8 - STAR.w * scale) / 2),
      y: Math.round(areaTop + (areaBottom - areaTop - STAR.h * scale) / 2),
      scale,
    }
    const clipShape = this.make.graphics({ x: 0, y: 0 }, false)
    clipShape.fillStyle(0xffffff, 1)
    clipShape.fillRect(this.view.x, this.view.y, STAR.w * scale, STAR.h * scale)
    this.clip = clipShape.createGeometryMask()
    this.stars = this.add.graphics().setDepth(1)
    this.fx = this.add.graphics().setDepth(45).setMask(this.clip)
    this.minis = this.add.graphics().setDepth(5)
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
    const bulletCells = Math.max(3, Math.round((STAR.bulletR * 2 * scale) / 2))
    this.bulletKey = ensurePixelOrb(this, `sb-bullet-${bulletCells}`, bulletCells, 0xff8adf, 2)
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
    return { x: this.view.x + x * this.view.scale, y: this.view.y + y * this.view.scale }
  }

  // Round time the screen shows: the latest snapshot's, advanced by the time since it arrived.
  private localT(time: number): number {
    return this.snapT + Math.min(400, time - this.snapAt)
  }

  protected frame(snap: StarBlasterSnapshot | null, time: number): void {
    const dt = Math.min(0.05, (time - (this.lastFrameAt || time)) / 1000)
    this.lastFrameAt = time
    this.paintStars(time)
    if (!snap) return
    this.script ??= buildStarScript(snap.seed, snap.durationMs)
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.snapAt = time
      this.snapT = snap.t
      this.onSnapshot(snap)
    }
    this.steer(time)
    const t = this.localT(time)
    this.fx?.clear()
    const shipPos = this.paintShip(time)
    this.paintEnemies(t)
    this.paintShots(t, dt, shipPos)
    this.paintMinis(snap, t)
    if (this.banner?.visible && time > this.bannerUntil && !this.state.final)
      this.banner.setVisible(false)
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

  private steer(time: number): void {
    const keys = this.cursors
    const w = this.wasd
    const kx =
      (keys?.right.isDown || w?.D.isDown ? 1 : 0) - (keys?.left.isDown || w?.A.isDown ? 1 : 0)
    const ky = (keys?.down.isDown || w?.S.isDown ? 1 : 0) - (keys?.up.isDown || w?.W.isDown ? 1 : 0)
    if (kx !== 0 || ky !== 0) this.dir = { dx: kx, dy: ky }
    else if (this.aim && this.ship) {
      const dx = this.aim.x - this.ship.x
      const dy = this.aim.y - this.ship.y
      this.dir = Math.hypot(dx, dy) < 8 ? { dx: 0, dy: 0 } : { dx, dy }
    } else this.dir = { dx: 0, dy: 0 }
    const mag = Math.hypot(this.dir.dx, this.dir.dy)
    const key =
      mag < 0.001
        ? '0'
        : `${Math.round((this.dir.dx / mag) * 20)},${Math.round((this.dir.dy / mag) * 20)}`
    if (
      (key !== this.sentDir || time - this.sentAt > 250) &&
      !this.state.final &&
      !this.mine?.out
    ) {
      this.sentDir = key
      this.sentAt = time
      this.sendInput({ kind: 'move', dx: this.dir.dx, dy: this.dir.dy })
    }
  }

  private onSnapshot(snap: StarBlasterSnapshot): void {
    const prev = this.mine
    const mine = snap.arenas.find((a) => a.id === this.selfId)
    this.mine = mine
    if (mine) {
      this.hud?.setScore(this.t('game.starBlaster.score', { n: mine.score }))
      this.hud?.setCenter(
        mine.out ? '✗' : '♥'.repeat(mine.lives),
        mine.lives <= 1 ? PALETTE.red : PALETTE.text,
      )
      if (prev && !this.firstSnapshot) this.react(prev, mine)
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
        this.sfx.wrong()
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
    for (const [id, at] of mine.killed) {
      if (before.has(id)) continue
      const e = this.script?.enemies.find((x) => x.id === id)
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
      this.sfx.pop()
      if (e.kind === 'boss') this.sfx.win()
    }
    if (mine.lives < prev.lives) {
      const s = this.toScreen(mine.x, mine.y)
      if (mine.out) {
        eliminate(this, s.x, s.y, this.state.colorOf(mine.id), this.t('game.common.out'), size)
        this.sfx.eliminated()
      } else {
        floatText(this, s.x, s.y - 20, `-${STAR.hitPenalty}`, PALETTE.red, size)
        this.sfx.wrong()
      }
      flash(this, PALETTE.red, 200, 0.3)
      shake(this, 0.008, 160)
    }
  }

  // Own ship, dead-reckoned with the held direction; returns its position (world units).
  private paintShip(time: number): { x: number; y: number } | null {
    const mine = this.mine
    if (!mine) return null
    const since = Math.min(0.4, (time - this.snapAt) / 1000)
    const mag = Math.hypot(this.dir.dx, this.dir.dy) || 1
    const moving = !mine.out && (this.dir.dx !== 0 || this.dir.dy !== 0)
    const x = moving
      ? Math.max(
          STAR.shipR,
          Math.min(STAR.w - STAR.shipR, mine.x + (this.dir.dx / mag) * STAR.shipSpeed * since),
        )
      : mine.x
    const y = moving
      ? Math.max(
          STAR.h * 0.35,
          Math.min(STAR.h - STAR.shipR, mine.y + (this.dir.dy / mag) * STAR.shipSpeed * since),
        )
      : mine.y
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
      // A dark canopy so the pilot (your lobby avatar, in your color) stands out from the hull.
      this.canopy = this.add.ellipse(0, 0, shipPx * 0.5, shipPx * 0.46, 0x10121c, 0.9).setDepth(51)
      const pilot = ensureAvatarTexture(this, this.state.avatarOf(mine.id), shade(color, 0.25), 2)
      this.pilot = this.add
        .image(0, 0, pilot)
        .setDisplaySize(shipPx * 0.4, shipPx * 0.4)
        .setDepth(52)
      if (this.clip) for (const o of [this.ship, this.canopy, this.pilot]) o.setMask(this.clip)
    }
    const alpha = mine.out ? 0.25 : mine.shielded ? (Math.floor(time / 90) % 2 ? 0.3 : 1) : 1
    this.ship.setPosition(Math.round(s.x), Math.round(s.y)).setAlpha(alpha)
    // The pilot (your lobby avatar) sits in the middle of the hull.
    this.canopy?.setPosition(Math.round(s.x), Math.round(s.y + shipPx * 0.04)).setAlpha(alpha)
    this.pilot?.setPosition(Math.round(s.x), Math.round(s.y + shipPx * 0.04)).setAlpha(alpha)
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

  private aliveFor(arena: StarArena | undefined): Map<number, number> {
    return new Map((arena?.killed ?? []).map(([id, at]) => [id, at]))
  }

  private paintEnemies(t: number): void {
    const script = this.script
    if (!script) return
    const killed = this.aliveFor(this.mine)
    const hp = new Map(this.mine?.hp ?? [])
    const seen = new Set<number>()
    for (const e of script.enemies) {
      const at = killed.get(e.id)
      const p = at !== undefined && at <= t ? null : starEnemyAt(e, t)
      if (!p) continue
      seen.add(e.id)
      let img = this.enemyImgs.get(e.id)
      if (!img) {
        const r = STAR_ENEMY[e.kind].r * 2 * this.view.scale
        img = this.add.image(0, 0, this.enemyKeys[e.kind] ?? '').setDepth(30)
        if (this.clip) img.setMask(this.clip)
        const src = img.width || 1
        img.setScale((r * 1.25) / src)
        this.enemyImgs.set(e.id, img)
      }
      const s = this.toScreen(p.x, p.y)
      img.setPosition(Math.round(s.x), Math.round(s.y)).setVisible(true)
      // Damaged big enemies blink and show an HP bar.
      const left = hp.get(e.id)
      if (left !== undefined && e.kind !== 'drone') {
        const full = STAR_ENEMY[e.kind].hp
        const g = this.fx as Phaser.GameObjects.Graphics
        const w = img.displayWidth
        g.fillStyle(PALETTE.panelAlt, 1)
        g.fillRect(
          Math.round(s.x - w / 2),
          Math.round(s.y - img.displayHeight / 2 - 8),
          Math.round(w),
          4,
        )
        g.fillStyle(PALETTE.lime, 1)
        g.fillRect(
          Math.round(s.x - w / 2),
          Math.round(s.y - img.displayHeight / 2 - 8),
          Math.round((w * left) / full),
          4,
        )
      }
    }
    for (const [id, img] of this.enemyImgs) {
      if (seen.has(id)) continue
      img.destroy()
      this.enemyImgs.delete(id)
    }
    // Enemy bullets for this player (pooled images).
    const bullets = starBulletsAt(script, t, killed, new Set(this.mine?.consumed ?? []))
    bullets.forEach((b, i) => {
      let img = this.bulletImgs[i]
      if (!img) {
        img = this.add.image(0, 0, this.bulletKey).setDepth(40)
        if (this.clip) img.setMask(this.clip)
        this.bulletImgs.push(img)
      }
      const s = this.toScreen(b.x, b.y)
      img.setPosition(Math.round(s.x), Math.round(s.y)).setVisible(true)
    })
    for (let i = bullets.length; i < this.bulletImgs.length; i++)
      this.bulletImgs[i]?.setVisible(false)
  }

  // The ship's own fire is cosmetic (the server resolves the real hits): a stream from the ship that
  // stops at the first enemy it meets on this screen.
  private paintShots(t: number, dt: number, ship: { x: number; y: number } | null): void {
    const script = this.script
    if (ship && !this.state.final) {
      if (this.nextShotAt === 0) this.nextShotAt = t
      while (this.nextShotAt <= t) {
        this.shots.push({ x: ship.x, y: ship.y - 0.03 })
        this.nextShotAt += STAR.shotEveryMs
      }
    } else this.nextShotAt = 0
    const killed = this.aliveFor(this.mine)
    const live = (script?.enemies ?? [])
      .map((e) => ({
        e,
        p: (killed.get(e.id) ?? Number.POSITIVE_INFINITY) <= t ? null : starEnemyAt(e, t),
      }))
      .filter((x): x is { e: StarEnemy; p: { x: number; y: number } } => x.p !== null)
    const g = this.fx as Phaser.GameObjects.Graphics
    g.fillStyle(PALETTE.lime, 1)
    this.shots = this.shots.filter((s) => {
      s.y -= STAR.shotSpeed * dt
      if (s.y < -0.02) return false
      if (
        live.some(
          ({ e, p }) => Math.hypot(p.x - s.x, p.y - s.y) < STAR_ENEMY[e.kind].r + STAR.shotR,
        )
      )
        return false
      const q = this.toScreen(s.x, s.y)
      g.fillRect(Math.round(q.x - 1), Math.round(q.y - 5), 3, 9)
      return true
    })
  }

  // Everyone else's fight, live, as thumbnails (wide screens only).
  private paintMinis(snap: StarBlasterSnapshot, t: number): void {
    const g = this.minis
    const script = this.script
    if (!g || !this.wide || !script) return
    const others = snap.arenas.filter((a) => a.id !== this.selfId)
    const { width } = this.scale
    const colX = Math.round(width * 0.62) + 12
    const colW = width - colX - 10
    const cols = others.length > 3 ? 3 : Math.max(1, others.length)
    const rows = Math.max(1, Math.ceil(others.length / cols))
    const labelH = 20
    const boxW = Math.floor(
      Math.min(
        (colW - (cols - 1) * 8) / cols,
        ((STAR.h * this.view.scale) / rows - labelH) / STAR.h,
      ),
    )
    const boxH = Math.round(boxW * STAR.h)
    if (this.miniBoxes.length !== others.length) {
      this.miniBoxes = others.map((_, i) => ({
        x: colX + (i % cols) * (boxW + 8),
        y: this.view.y + Math.floor(i / cols) * (boxH + labelH),
        w: boxW,
        h: boxH,
      }))
      for (const l of this.miniLabels) l.destroy()
      this.miniLabels = this.miniBoxes.map((b) =>
        this.add
          .text(b.x, b.y + b.h + 2, '', bodyStyle(11, PALETTE.text, { fontStyle: 'bold' }))
          .setDepth(6),
      )
    }
    g.clear()
    others.forEach((a, i) => {
      const box = this.miniBoxes[i]
      if (!box) return
      const s = box.w / STAR.w
      g.fillStyle(a.out ? 0x0b0c18 : 0x0d0f22, 1)
      g.fillRect(box.x, box.y, box.w, box.h)
      g.lineStyle(2, this.state.colorOf(a.id), a.out ? 0.4 : 1)
      g.strokeRect(box.x, box.y, box.w, box.h)
      const killed = this.aliveFor(a)
      for (const e of script.enemies) {
        const at = killed.get(e.id)
        const p = at !== undefined && at <= t ? null : starEnemyAt(e, t)
        if (!p || p.x < 0 || p.x > STAR.w || p.y < 0 || p.y > STAR.h) continue
        g.fillStyle(
          e.kind === 'boss' ? PALETTE.red : e.kind === 'gunner' ? PALETTE.orange : PALETTE.magenta,
          1,
        )
        g.fillCircle(box.x + p.x * s, box.y + p.y * s, Math.max(1.5, STAR_ENEMY[e.kind].r * s))
      }
      g.fillStyle(0xff8adf, 1)
      for (const b of starBulletsAt(script, t, killed, new Set(a.consumed))) {
        if (b.x < 0 || b.x > STAR.w || b.y < 0 || b.y > STAR.h) continue
        g.fillRect(Math.round(box.x + b.x * s), Math.round(box.y + b.y * s), 2, 2)
      }
      if (!a.out) {
        g.fillStyle(this.state.colorOf(a.id), 1)
        const sx = box.x + a.x * s
        const sy = box.y + a.y * s
        g.fillTriangle(sx, sy - 5, sx - 4, sy + 4, sx + 4, sy + 4)
      }
      const label = this.miniLabels[i]
      const text = `${this.label(a.id).slice(0, 8)} · ${a.score} ${a.out ? '✗' : '♥'.repeat(a.lives)}`
      if (label && label.text !== text) label.setText(text).setColor(a.out ? '#7b88a8' : '#eef1f7')
    })
  }
}
