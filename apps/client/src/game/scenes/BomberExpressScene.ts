import { BOMBER, type BomberDir, type BomberPlayer, type BomberSnapshot, PALETTE } from '@pp/shared'
import Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { addBanner, burst, eliminate, flash, floatText, shake, showBanner } from '../fx'
import {
  ensureBevelPanel,
  ensurePixelGrid,
  ensurePixelOrb,
  fitFontSize,
  headlineStyle,
} from '../pixelStyle'
import { YouMarker, addShadow } from '../playerMarks'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Bomber Express: the classic grid — brick walls and pillars, wooden crates, a checkered floor — with
// every player as their lobby avatar, stepping tile to tile (interpolated). Bombs pulse faster as the
// fuse burns down and flash red at the end; the blast draws a cross of fire; crates burst into
// splinters and may leave a power-up (flame = range, bomb = more bombs, boot = speed). Arrows/WASD
// (or the d-pad) walk, SPACE (or BOMB) drops a bomb.

const W = BOMBER.w
const H = BOMBER.h
const ICONS: Record<'r' | 'b' | 's', { rows: string[]; legend: Record<string, number> }> = {
  r: {
    rows: [
      '___O____',
      '__OOO___',
      '_OOYOO__',
      '_OYYYO__',
      'OOYWYOO_',
      'OYYWYYO_',
      '_OYYYO__',
      '__OOO___',
    ],
    legend: { O: PALETTE.orange, Y: PALETTE.amber, W: 0xffffff },
  },
  b: {
    rows: [
      '_____YY_',
      '____K___',
      '__KKKK__',
      '_KKWKKK_',
      '_KWKKKK_',
      '_KKKKKK_',
      '_KKKKKK_',
      '__KKKK__',
    ],
    legend: { K: 0x1b1d2a, W: 0x8f96b0, Y: PALETTE.amber },
  },
  s: {
    rows: [
      '__CCC___',
      '__CCC___',
      '__CCC___',
      '__CCCC__',
      '_CCCCCC_',
      'CCCCCCCC',
      'WWWWWWWW',
      '________',
    ],
    legend: { C: PALETTE.cyan, W: 0xffffff },
  },
}

interface View {
  avatar: AvatarSprite
  shadow: Phaser.GameObjects.Ellipse
  alive: boolean
  // Celebrating a knock-out until then (scene time).
  cheerUntil: number
  kos: number
}

export class BomberExpressScene extends MiniGameScene<BomberSnapshot> {
  private compact = false
  private board = { x: 0, y: 0, cell: 0 }
  private tiles: Phaser.GameObjects.Image[] = []
  private keys = {
    wall: '',
    border: '',
    crate: '',
    floorA: '',
    floorB: '',
    bomb: '',
    bombHot: '',
    r: '',
    b: '',
    s: '',
  }
  private grid = ''
  private bombImgs: Phaser.GameObjects.Image[] = []
  private flames?: Phaser.GameObjects.Graphics
  private views = new Map<string, View>()
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private marker?: YouMarker
  private held: BomberDir[] = []
  private padHeld = new Map<number, BomberDir>()
  private sentDir: BomberDir | null | '' = ''
  private sentAt = 0
  private lastTick = -1
  private snapAt = 0
  private prev?: BomberSnapshot

  constructor(...deps: SceneDeps) {
    super('bomber-express', ...deps)
  }

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.tiles = []
    this.grid = ''
    this.bombImgs = []
    this.views = new Map()
    this.held = []
    this.padHeld = new Map()
    this.sentDir = ''
    this.sentAt = 0
    this.lastTick = -1
    this.snapAt = 0
    this.prev = undefined

    const stripSize = this.compact ? 11 : 13
    this.strip = new PlayerStrip(this, width / 2, this.top + 8, width - 24, stripSize, 2)
    const areaTop = this.top + 8 + PlayerStrip.rowH(stripSize) * 2

    // Controls: a d-pad on the left, BOMB on the right.
    const padBtn = this.compact ? 50 : 42
    const padY = height - (this.compact ? 14 : 14) - padBtn * 1.5
    const padX = Math.max(16 + padBtn * 1.5, width / 2 - 200)
    const dirs: [BomberDir, number, number, string][] = [
      ['up', 0, -1, '▲'],
      ['down', 0, 1, '▼'],
      ['left', -1, 0, '◀'],
      ['right', 1, 0, '▶'],
    ]
    const up = ensureBevelPanel(this, padBtn, padBtn, PALETTE.frameLit, 4, true)
    for (const [dir, dx, dy, label] of dirs) {
      const img = this.add
        .image(padX + dx * padBtn, padY + dy * padBtn, up)
        .setDepth(700)
        .setInteractive()
      this.add
        .text(img.x, img.y, label, headlineStyle(16, PALETTE.text))
        .setOrigin(0.5)
        .setDepth(701)
      img.on('pointerdown', (p: Phaser.Input.Pointer) => this.padHeld.set(p.id, dir))
    }
    const bombW = Math.min(220, width - padX - padBtn * 1.5 - 40)
    const bombKey = ensureBevelPanel(this, bombW, padBtn * 2, PALETTE.orange, 5, true)
    const bombX = Math.min(width - 16 - bombW / 2, width / 2 + 200)
    const bombBtn = this.add.image(bombX, padY, bombKey).setDepth(700).setInteractive()
    const bombLabel = this.t('game.bomber.bomb')
    this.add
      .text(
        bombX,
        padY,
        bombLabel,
        headlineStyle(fitFontSize(bombLabel, bombW - 16, this.compact ? 16 : 24), PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setDepth(701)
    bombBtn.on('pointerdown', () => this.dropBomb())
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.padHeld.delete(p.id))
    const kb = this.input.keyboard
    const bind = (names: string[], dir: BomberDir): void => {
      for (const n of names) {
        kb?.on(`keydown-${n}`, () => {
          this.held = [...this.held.filter((d) => d !== dir), dir]
        })
        kb?.on(`keyup-${n}`, () => {
          this.held = this.held.filter((d) => d !== dir)
        })
      }
    }
    bind(['UP', 'W'], 'up')
    bind(['DOWN', 'S'], 'down')
    bind(['LEFT', 'A'], 'left')
    bind(['RIGHT', 'D'], 'right')
    this.onKey('SPACE', () => this.dropBomb())
    const release = (): void => {
      this.held = []
      this.padHeld.clear()
    }
    this.game.events.on(Phaser.Core.Events.BLUR, release)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.game.events.off(Phaser.Core.Events.BLUR, release),
    )

    // The board.
    const areaBottom = padY - padBtn * 1.5 - 10
    const cell = Math.floor(Math.min((width - 16) / W, (areaBottom - areaTop) / H))
    this.board = {
      x: Math.round((width - cell * W) / 2),
      y: Math.round(areaTop + (areaBottom - areaTop - cell * H) / 2),
      cell,
    }
    const px = Math.max(1, Math.floor(cell / 8))
    this.keys = {
      ...this.keys,
      wall: ensureBevelPanel(this, cell, cell, 0x6b6f86, Math.max(2, Math.round(cell / 10))),
      border: ensureBevelPanel(this, cell, cell, 0x4a4e66, Math.max(2, Math.round(cell / 10))),
      crate: ensurePixelGrid(this, {
        key: `bx-crate-${px}`,
        rows: [
          'DDDDDDDD',
          'DWWDWWWD',
          'DWWDWWWD',
          'DDDDDDDD',
          'DWWWDWWD',
          'DWWWDWWD',
          'DWWWDWWD',
          'DDDDDDDD',
        ],
        legend: { D: 0x6e4424, W: 0xb77a3f },
        pixelSize: px,
      }),
      floorA: ensurePixelGrid(this, {
        key: 'bx-floor-a',
        rows: ['G'],
        legend: { G: 0x2f5a35 },
        pixelSize: 1,
      }),
      floorB: ensurePixelGrid(this, {
        key: 'bx-floor-b',
        rows: ['G'],
        legend: { G: 0x2a5230 },
        pixelSize: 1,
      }),
      bomb: ensurePixelOrb(this, `bx-bomb-${px}`, 8, 0x22243a, px),
      bombHot: ensurePixelOrb(this, `bx-bomb-hot-${px}`, 8, 0xb02a2a, px),
    }
    for (const k of ['r', 'b', 's'] as const) {
      const icon = ICONS[k]
      this.keys[k] = ensurePixelGrid(this, {
        key: `bx-icon-${k}-${px}`,
        rows: icon.rows,
        legend: icon.legend,
        pixelSize: px,
      })
    }
    for (let i = 0; i < W * H; i++) {
      const x = i % W
      const y = Math.floor(i / W)
      const p = this.cellCenter(x, y)
      this.tiles.push(
        this.add.image(p.x, p.y, this.keys.floorA).setDisplaySize(cell, cell).setDepth(5),
      )
    }
    this.flames = this.add.graphics().setDepth(35)
    this.marker = new YouMarker(this, this.compact ? 12 : 16, 75)
    this.banner = addBanner(this)
  }

  private cellCenter(x: number, y: number): { x: number; y: number } {
    const { x: bx, y: by, cell } = this.board
    return { x: bx + (x + 0.5) * cell, y: by + (y + 0.5) * cell }
  }

  private dropBomb(): void {
    const me = this.snap?.players.find((p) => p.id === this.selfId)
    if (!me?.alive || this.state.final) return
    this.sendInput({ kind: 'bomb' })
    this.sfx.click()
  }

  private syncDir(time: number): void {
    const pad = [...this.padHeld.values()].at(-1)
    const dir: BomberDir | null = this.held.at(-1) ?? pad ?? null
    if (
      (dir !== this.sentDir || (dir && time - this.sentAt > 300)) &&
      this.snap &&
      !this.state.final
    ) {
      this.sentDir = dir
      this.sentAt = time
      this.sendInput({ kind: 'move', dir })
    }
  }

  protected frame(snap: BomberSnapshot | null, time: number): void {
    this.syncDir(time)
    if (!snap) return
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.snapAt = time
      this.onSnapshot(snap)
    }
    this.paintBombs(snap, time)
    this.paintFlames(snap)
    this.paintPlayers(snap, time)
  }

  private paintGrid(grid: string): void {
    const cell = this.board.cell
    for (let i = 0; i < grid.length; i++) {
      const c = grid[i]
      if (c === this.grid[i]) continue
      const x = i % W
      const y = Math.floor(i / W)
      const img = this.tiles[i]
      if (!img) continue
      const border = x === 0 || y === 0 || x === W - 1 || y === H - 1
      const key =
        c === '#'
          ? border
            ? this.keys.border
            : this.keys.wall
          : c === 'c'
            ? this.keys.crate
            : c === 'r' || c === 'b' || c === 's'
              ? this.keys[c]
              : (x + y) % 2 === 0
                ? this.keys.floorA
                : this.keys.floorB
      img.setTexture(key).setDisplaySize(cell, cell)
      // Power-up icons sit on the floor, a little smaller than the tile.
      if (c === 'r' || c === 'b' || c === 's') img.setDisplaySize(cell * 0.8, cell * 0.8)
    }
    this.grid = grid
  }

  private paintBombs(snap: BomberSnapshot, time: number): void {
    const cell = this.board.cell
    snap.bombs.forEach(([x, y, fuse], i) => {
      let img = this.bombImgs[i]
      if (!img) {
        img = this.add.image(0, 0, this.keys.bomb).setDepth(30)
        this.bombImgs.push(img)
      }
      const left = Math.max(0, fuse - (time - this.snapAt))
      const hot = left < 500
      const rate = 120 + (left / BOMBER.fuseMs) * 380
      const pulse = 1 + 0.12 * Math.sin((time / rate) * Math.PI)
      const p = this.cellCenter(x, y)
      img.setTexture(hot && Math.floor(time / 80) % 2 ? this.keys.bombHot : this.keys.bomb)
      img
        .setPosition(p.x, p.y)
        .setDisplaySize(cell * 0.82 * pulse, cell * 0.82 * pulse)
        .setVisible(true)
    })
    for (let i = snap.bombs.length; i < this.bombImgs.length; i++)
      this.bombImgs[i]?.setVisible(false)
  }

  // Fire: a hot core per burning cell, joined to burning neighbours by bands (so a blast reads as a cross).
  private paintFlames(snap: BomberSnapshot): void {
    const g = this.flames as Phaser.GameObjects.Graphics
    g.clear()
    const burning = new Set(snap.flames.map(([x, y]) => y * W + x))
    const cell = this.board.cell
    const band = cell * 0.62
    const core = cell * 0.36
    for (const [x, y] of snap.flames) {
      const p = this.cellCenter(x, y)
      g.fillStyle(PALETTE.orange, 0.95)
      g.fillRect(p.x - band / 2, p.y - band / 2, band, band)
      if (burning.has(y * W + x + 1)) g.fillRect(p.x, p.y - band / 2, cell, band)
      if (burning.has((y + 1) * W + x)) g.fillRect(p.x - band / 2, p.y, band, cell)
      g.fillStyle(PALETTE.amber, 1)
      g.fillRect(p.x - core / 2, p.y - core / 2, core, core)
      if (burning.has(y * W + x + 1)) g.fillRect(p.x, p.y - core / 2, cell, core)
      if (burning.has((y + 1) * W + x)) g.fillRect(p.x - core / 2, p.y, core, cell)
    }
  }

  private paintPlayers(snap: BomberSnapshot, time: number): void {
    const cell = this.board.cell
    const since = time - this.snapAt
    for (const p of snap.players) {
      let view = this.views.get(p.id)
      if (!view) {
        const size = avatarPx(cell)
        const avatar = new AvatarSprite(
          this,
          this.state.avatarOf(p.id),
          this.state.colorOf(p.id),
          size,
        )
        avatar.image.setOrigin(0.5, 0.6).setDepth(50)
        const shadow = addShadow(this, size, 49)
        view = { avatar, shadow, alive: p.alive, cheerUntil: 0, kos: p.kos }
        this.views.set(p.id, view)
        if (!p.alive) {
          avatar.setExpression('ko')
          avatar.image.setAlpha(0.25).setAngle(90)
          shadow.setVisible(false)
        }
      }
      // A knock-out you scored: a short happy face.
      if (p.kos > view.kos) view.cheerUntil = time + 900
      view.kos = p.kos
      const moving = p.tx !== p.x || p.ty !== p.y
      const step = moving ? Math.min(1, p.step + since / Math.max(1, p.stepMs)) : 0
      const a = this.cellCenter(p.x, p.y)
      const b = this.cellCenter(p.tx, p.ty)
      const x = Phaser.Math.Linear(a.x, b.x, step)
      const y =
        Phaser.Math.Linear(a.y, b.y, step) -
        (moving && p.alive ? Math.abs(Math.sin(step * Math.PI)) * 3 : 0)
      // Faces the way it walks (top-down: back going up, front going down, side going across).
      if (moving && p.alive) view.avatar.faceMotion(b.x - a.x, b.y - a.y)
      if (p.alive) view.avatar.setExpression(time < view.cheerUntil ? 'happy' : 'idle')
      view.avatar.tick(time)
      view.avatar.image.setPosition(Math.round(x), Math.round(y))
      view.shadow.setPosition(Math.round(x), Math.round(y + cell * 0.3)).setVisible(p.alive)
      if (p.id === this.selfId) {
        if (p.alive) this.marker?.place(x, y - cell * 0.5, time)
        else this.marker?.hide()
      }
    }
  }

  // Snapshot deltas: blasts, broken crates, pick-ups, knock-outs.
  private onSnapshot(snap: BomberSnapshot): void {
    const prev = this.prev
    this.prev = snap
    const first = !prev || this.firstSnapshot
    if (!first && prev) {
      const before = new Set(prev.flames.map(([x, y]) => y * W + x))
      const fresh = snap.flames.filter(([x, y]) => !before.has(y * W + x))
      if (fresh.length > 0) {
        this.sfx.boom()
        shake(this, Math.min(0.012, 0.004 + fresh.length * 0.0004), 160)
      }
      for (let i = 0; i < snap.grid.length; i++) {
        const was = prev.grid[i]
        const now = snap.grid[i]
        if (was === now) continue
        const p = this.cellCenter(i % W, Math.floor(i / W))
        if (was === 'c') burst(this, p.x, p.y, 0xb77a3f, 10, 180)
      }
      const prevById = new Map(prev.players.map((p) => [p.id, p]))
      for (const p of snap.players) {
        const was = prevById.get(p.id)
        if (!was) continue
        if (was.alive && !p.alive) this.knockOut(p)
        if (
          p.id === this.selfId &&
          (p.range > was.range || p.bombs > was.bombs || p.speed > was.speed)
        ) {
          const at = this.cellCenter(p.tx, p.ty)
          const label =
            p.range > was.range
              ? 'game.bomber.pickRange'
              : p.bombs > was.bombs
                ? 'game.bomber.pickBomb'
                : 'game.bomber.pickSpeed'
          floatText(this, at.x, at.y - this.board.cell * 0.6, this.t(label), PALETTE.lime, 12)
          this.sfx.coin()
        }
        if (p.id === this.selfId && p.kos > was.kos) this.sfx.win()
      }
    }
    this.paintGrid(snap.grid)
    for (const p of snap.players) {
      const view = this.views.get(p.id)
      if (view && !p.alive && view.alive) {
        view.alive = false
        view.avatar.setExpression('ko')
        this.tweens.add({ targets: view.avatar.image, angle: 90, alpha: 0.25, duration: 300 })
      }
    }
    const me = snap.players.find((p) => p.id === this.selfId)
    const alive = snap.players.filter((p) => p.alive).length
    if (me) this.hud?.setScore(this.t('game.bomber.kos', { n: me.kos }))
    this.hud?.setCenter(
      this.t('game.common.left', { n: alive, total: snap.players.length }),
      alive <= 1 ? PALETTE.red : PALETTE.text,
    )
    this.strip?.set(
      snap.players.map((p) => ({
        text: `${this.label(p.id)} ${this.t('game.bomber.kos', { n: p.kos })}${p.alive ? '' : ' ✗'}`,
        avatar: this.state.avatarOf(p.id),
        color: this.state.colorOf(p.id),
        dim: !p.alive,
      })),
    )
    if (this.state.final && me && this.banner && !this.banner.visible) {
      const won = me.alive && snap.players.length > 1 && alive === 1
      showBanner(
        this,
        this.banner,
        won
          ? this.t('game.common.youWin')
          : me.alive
            ? this.t('game.bomber.survived')
            : this.t('game.common.out'),
        won || me.alive ? PALETTE.lime : PALETTE.red,
      )
    }
  }

  private knockOut(p: BomberPlayer): void {
    const at = this.cellCenter(p.x, p.y)
    eliminate(
      this,
      at.x,
      at.y,
      this.state.colorOf(p.id),
      this.quip('game.common.stamps', p.id),
      this.compact ? 12 : 16,
    )
    this.sfx.eliminated()
    if (p.id === this.selfId) {
      flash(this, PALETTE.red, 220, 0.3)
      this.marker?.hide()
    }
  }
}
