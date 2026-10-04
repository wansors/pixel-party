import {
  BOMBER,
  BOMBER_DIRS,
  type BomberDir,
  type BomberPlayer,
  type BomberSnapshot,
  bomberStepDir,
  PALETTE,
} from '@pp/shared'
import Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { addBanner, eliminate, flash, floatText, shake, showBanner } from '../fx'
import {
  ensureBevelPanel,
  ensurePixelGrid,
  ensurePixelOrb,
  fitFontSize,
  headlineStyle,
} from '../pixelStyle'
import { addShadow, type Shadow, YouMarker } from '../playerMarks'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Bomber Express: the classic grid — brick walls and pillars, wooden crates, a checkered floor — with
// every player as their lobby avatar, stepping tile to tile. Your own avatar is PREDICTED: it steps the
// moment you press (same walk rules as the server, checked against every snapshot and eased back if
// the server disagrees); everyone else walks a path of the tiles the snapshots reported, drawn a beat
// in the past so it never stutters. Bombs pulse faster as the fuse burns down and flash red at the
// end (yours shows the instant you drop it); the blast draws a cross of fire; crates burst into
// splinters and may leave a power-up (flame = range, bomb = more bombs, boot = speed).
// Arrows/WASD (or the d-pad) walk — hold the new way a little early and you turn at the next opening —
// SPACE (also Enter/Z/J, or BOMB) drops a bomb.

const W = BOMBER.w
const H = BOMBER.h
// Everyone else is drawn this far in the past, walking between the tiles the snapshots reported.
const REMOTE_DELAY_MS = 120
// How long the server may trail our own prediction (it hears the keys a network hop later) before
// the prediction gives in and eases back to the server's tile.
const LAG_OK_MS = 220
// Rivals' moments play at this fraction of the volume (yours stay full), so a full room stays readable.
const RIVAL_LEVEL = 0.5
// Time constant of that ease (a correction never snaps).
const CORRECT_TAU_MS = 90
const OPPOSITE: Record<BomberDir, BomberDir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}
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

// One step: from (fx, fy) to (tx, ty) over [start, end] (scene time).
interface Seg {
  fx: number
  fy: number
  tx: number
  ty: number
  start: number
  end: number
}

// Your own predicted walker, plus the steps it already finished (to recognise the server's lagging
// view of them).
interface Pred {
  x: number
  y: number
  tx: number
  ty: number
  start: number
  end: number
  trail: Seg[]
}

// A remote player's path: "at time t they stood on tile (x, y)".
interface Point {
  t: number
  x: number
  y: number
}

interface View {
  avatar: AvatarSprite
  shadow: Shadow
  alive: boolean
  // Celebrating a knock-out until then (scene time).
  cheerUntil: number
  kos: number
  path: Point[]
  // The step the last snapshot showed (so each one is added to the path once).
  seg: string
}

export class BomberExpressScene extends MiniGameScene<BomberSnapshot> {
  private compact = false
  private board = { x: 0, y: 0, cell: 0 }
  // The board (floor, walls, crates, power-ups) baked into one render texture; a cell is redrawn only
  // when the grid changes there.
  private boardRT?: Phaser.GameObjects.RenderTexture
  private splinters?: Phaser.GameObjects.Particles.ParticleEmitter
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
  // Held direction keys, oldest first (the newest wins; the one before it is the turn fallback).
  private held: { key: string; dir: BomberDir }[] = []
  private padHeld = new Map<number, BomberDir>()
  private sent = ''
  private sentAt = 0
  private pred?: Pred
  // Visual offset (tiles) left by a correction, eased to zero.
  private predOff = { x: 0, y: 0 }
  // Bombs you just dropped, shown at once until the server's snapshot has them (or they expire).
  private ghosts: { x: number; y: number; until: number }[] = []
  private lastFrameAt = 0
  private warmed = false
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
    this.grid = ''
    this.bombImgs = []
    this.views = new Map()
    this.held = []
    this.padHeld = new Map()
    this.sent = ''
    this.sentAt = 0
    this.pred = undefined
    this.predOff = { x: 0, y: 0 }
    this.ghosts = []
    this.lastFrameAt = 0
    this.warmed = false
    this.lastTick = -1
    this.snapAt = 0
    this.prev = undefined

    const stripSize = this.compact ? 11 : 13
    this.strip = new PlayerStrip(this, width / 2, this.top + 8, width - 24, stripSize, 2)
    const areaTop = this.top + 8 + PlayerStrip.rowH(stripSize) * 2

    // Controls: a d-pad on the left, BOMB on the right.
    const padBtn = this.compact ? 50 : 42
    // A wide screen puts the d-pad and BOMB beside the board (which is height-bound there), so the
    // board gets the full height; otherwise they sit in a row under it.
    const hintH = this.compact ? 0 : 28
    const sideCell = Math.floor(Math.min((width - 16) / W, (height - 14 - hintH - areaTop) / H))
    const margin = (width - sideCell * W) / 2
    const side = !this.compact && margin >= padBtn * 3 + 56
    const padY = side
      ? areaTop + (height - 14 - hintH - areaTop) / 2
      : height - (this.compact ? 14 : 14) - padBtn * 1.5
    const padX = side ? margin / 2 : Math.max(16 + padBtn * 1.5, width / 2 - 200)
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
    const bombW = side
      ? Math.min(220, Math.floor(margin - 32))
      : Math.min(220, width - padX - padBtn * 1.5 - 40)
    const bombKey = ensureBevelPanel(this, bombW, padBtn * 2, PALETTE.orange, 5, true)
    const bombX = side ? width - margin / 2 : Math.min(width - 16 - bombW / 2, width / 2 + 200)
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
      for (const key of names) {
        kb?.on(`keydown-${key}`, (e: KeyboardEvent) => {
          if (e.repeat) return
          this.held = [...this.held.filter((h) => h.key !== key), { key, dir }]
        })
        kb?.on(`keyup-${key}`, () => {
          this.held = this.held.filter((h) => h.key !== key)
        })
      }
    }
    bind(['UP', 'W'], 'up')
    bind(['DOWN', 'S'], 'down')
    bind(['LEFT', 'A'], 'left')
    bind(['RIGHT', 'D'], 'right')
    for (const k of ['SPACE', 'ENTER', 'Z', 'J']) this.onKey(k, () => this.dropBomb())
    const release = (): void => {
      this.held = []
      this.padHeld.clear()
    }
    this.game.events.on(Phaser.Core.Events.BLUR, release)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.game.events.off(Phaser.Core.Events.BLUR, release),
    )

    // The keys, named once above the controls / along the bottom (phones get the d-pad and the
    // button alone).
    let areaBottom = side ? height - 10 : padY - padBtn * 1.5 - 10
    if (!this.compact) {
      const hint = this.t('game.bomber.hint')
      const hintText = this.add
        .text(
          width / 2,
          areaBottom,
          hint,
          headlineStyle(fitFontSize(hint, width - 32, 16), PALETTE.dim),
        )
        .setOrigin(0.5, 1)
        .setDepth(600)
      areaBottom = hintText.y - hintText.height - 8
    }

    // The board.
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
    this.boardRT = this.add
      .renderTexture(this.board.x, this.board.y, cell * W, cell * H)
      .setOrigin(0, 0)
      .setDepth(5)
    // One emitter for every crate that bursts (a chain can break a dozen in one snapshot).
    const chip = ensurePixelGrid(this, {
      key: 'bx-chip',
      rows: ['W'],
      legend: { W: 0xffffff },
      pixelSize: 4,
    })
    this.splinters = this.add
      .particles(0, 0, chip, {
        speed: { min: 70, max: 180 },
        angle: { min: 0, max: 360 },
        lifespan: { min: 280, max: 520 },
        gravityY: 250,
        scale: { start: 1.3, end: 0.4 },
        alpha: { start: 1, end: 0 },
        tint: [0xb77a3f, 0xe0a868, 0x6e4424],
        emitting: false,
      })
      .setDepth(850)
    this.flames = this.add.graphics().setDepth(35)
    this.marker = new YouMarker(this, this.compact ? 12 : 16, 75)
    this.banner = addBanner(this)
  }

  private cellCenter(x: number, y: number): { x: number; y: number } {
    const { x: bx, y: by, cell } = this.board
    return { x: bx + (x + 0.5) * cell, y: by + (y + 0.5) * cell }
  }

  private me(): BomberPlayer | undefined {
    return this.snap?.players.find((p) => p.id === this.selfId)
  }

  // Drops a bomb: sent at once, and shown at once on the tile your predicted walker stands on (as long
  // as you still have one in your pocket) until the server's snapshot has it.
  private dropBomb(): void {
    const snap = this.snap
    const me = this.me()
    if (!snap || !me?.alive || this.state.final) return
    this.sendInput({ kind: 'bomb' })
    const now = this.time.now
    const [x, y] = this.predTile(now) ?? [me.x, me.y]
    const idx = snap.players.indexOf(me)
    const down = snap.bombs.filter((b) => b[3] === idx).length + this.ghosts.length
    const taken =
      snap.bombs.some((b) => b[0] === x && b[1] === y) ||
      this.ghosts.some((g) => g.x === x && g.y === y)
    // A bomb down: its fuse fizzes. No bomb left in your pocket (or one already here): a dry click.
    if (down < me.bombs && !taken) {
      this.ghosts.push({ x, y, until: now + 450 })
      this.sfx.fuse()
    } else this.sfx.click()
  }

  // The held direction and the turn fallback: the newest key, then the newest one before it (not its
  // opposite — holding ← and → doesn't mean "go back").
  private heldDirs(): { dir: BomberDir | null; alt: BomberDir | null } {
    const order = this.held.map((h) => h.dir)
    const pad = [...this.padHeld.values()].at(-1)
    if (pad) order.push(pad)
    const dirs: BomberDir[] = []
    for (let i = order.length - 1; i >= 0 && dirs.length < 2; i--) {
      const d = order[i] as BomberDir
      if (!dirs.includes(d)) dirs.push(d)
    }
    const dir = dirs[0] ?? null
    const alt = dirs[1] && dir && dirs[1] !== OPPOSITE[dir] ? dirs[1] : null
    return { dir, alt }
  }

  // Sends the held direction when it changes (and again while held, in case one got lost). Nothing goes
  // out before a key or the d-pad is pressed: an untouched seat must stay idle for the engine.
  private syncDir(time: number): void {
    const { dir, alt } = this.heldDirs()
    const me = this.me()
    if (!me?.alive || this.state.final) return
    const key = `${dir}|${alt}`
    if (key === this.sent && !(dir && time - this.sentAt > 300)) return
    if (!dir && this.sent === '') return
    this.sent = key
    this.sentAt = time
    this.sendInput({ kind: 'move', dir, alt })
  }

  protected frame(snap: BomberSnapshot | null, time: number): void {
    const dt = this.lastFrameAt ? Math.min(100, time - this.lastFrameAt) : 0
    this.lastFrameAt = time
    this.syncDir(time)
    if (!snap) return
    if (!this.warmed) {
      this.warmed = true
      this.warmAvatars(
        snap.players.map((p) => p.id),
        [
          ['front', 'idle', 1],
          ['front', 'idle', 2],
          ['back', 'idle', 0],
          ['back', 'idle', 1],
          ['back', 'idle', 2],
          ['side', 'idle', 0],
          ['side', 'idle', 1],
          ['front', 'happy', 0],
          ['front', 'ko', 0],
        ],
      )
    }
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.snapAt = time
      this.onSnapshot(snap)
    }
    const me = snap.players.find((p) => p.id === this.selfId)
    if (me?.alive && !this.state.final) this.advancePred(snap, me, time)
    const ease = Math.exp(-dt / CORRECT_TAU_MS)
    this.predOff.x = Math.abs(this.predOff.x) < 0.01 ? 0 : this.predOff.x * ease
    this.predOff.y = Math.abs(this.predOff.y) < 0.01 ? 0 : this.predOff.y * ease
    this.paintBombs(snap, time)
    this.paintPlayers(snap, time)
  }

  // --- Own prediction -----------------------------------------------------------------------------

  private walkable(snap: BomberSnapshot, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= W || y >= H) return false
    const c = snap.grid[y * W + x]
    if (c !== '.' && c !== 'r' && c !== 'b' && c !== 's') return false
    if (snap.bombs.some((b) => b[0] === x && b[1] === y)) return false
    return !this.ghosts.some((g) => g.x === x && g.y === y)
  }

  // The server's walk rule, run locally on the held keys: arrive, then chain the next step from the
  // exact arrival time while a direction is held (several per frame if a frame ran long).
  private advancePred(snap: BomberSnapshot, me: BomberPlayer, time: number): void {
    const p = this.pred
    if (!p) return
    const { dir, alt } = this.heldDirs()
    for (let guard = 0; guard < 6; guard++) {
      let readyAt = time
      if (p.tx !== p.x || p.ty !== p.y) {
        if (time < p.end) return
        p.trail.push({ fx: p.x, fy: p.y, tx: p.tx, ty: p.ty, start: p.start, end: p.end })
        if (p.trail.length > 6) p.trail.shift()
        p.x = p.tx
        p.y = p.ty
        readyAt = p.end
      }
      const from = { x: p.x, y: p.y }
      const go = bomberStepDir(dir, alt, (dx, dy) => this.walkable(snap, from.x + dx, from.y + dy))
      if (!go) return
      const [dx, dy] = BOMBER_DIRS[go]
      p.tx = p.x + dx
      p.ty = p.y + dy
      p.start = Math.max(readyAt, time - 50)
      p.end = p.start + (BOMBER.stepMs[me.speed] ?? 150)
      if (p.end > time) return
    }
  }

  private predPos(p: Pred, time: number): { x: number; y: number } {
    if (p.tx === p.x && p.ty === p.y) return { x: p.x, y: p.y }
    const f = Phaser.Math.Clamp((time - p.start) / Math.max(1, p.end - p.start), 0, 1)
    return { x: p.x + (p.tx - p.x) * f, y: p.y + (p.ty - p.y) * f }
  }

  // The tile the predicted walker counts as standing on (the one it leaves, until halfway).
  private predTile(time: number): [number, number] | null {
    const p = this.pred
    if (!p) return null
    if (p.tx === p.x && p.ty === p.y) return [p.x, p.y]
    return (time - p.start) / Math.max(1, p.end - p.start) < 0.5 ? [p.x, p.y] : [p.tx, p.ty]
  }

  // Does the server's (lagging) view of you fit what the prediction did recently?
  private agrees(p: Pred, me: BomberPlayer, time: number): boolean {
    const segs = [...p.trail]
    if (p.tx !== p.x || p.ty !== p.y)
      segs.push({ fx: p.x, fy: p.y, tx: p.tx, ty: p.ty, start: p.start, end: p.end })
    if (me.tx !== me.x || me.ty !== me.y) {
      return segs.some(
        (s) =>
          s.fx === me.x &&
          s.fy === me.y &&
          s.tx === me.tx &&
          s.ty === me.ty &&
          time - s.start < LAG_OK_MS + (s.end - s.start),
      )
    }
    // Standing still on the server: where the prediction stands too, or a tile it only just left.
    if (p.tx === p.x && p.ty === p.y && p.x === me.x && p.y === me.y) return true
    return segs.some((s) => s.fx === me.x && s.fy === me.y && time - s.start < LAG_OK_MS)
  }

  // Every snapshot checks the prediction; a disagreement re-bases it on the server (visually eased).
  private reconcile(me: BomberPlayer, time: number): void {
    if (!me.alive || this.state.final) {
      this.pred = undefined
      return
    }
    const p = this.pred
    if (p && this.agrees(p, me, time)) return
    const before = p ? this.predPos(p, time) : undefined
    const moving = me.tx !== me.x || me.ty !== me.y
    const start = moving ? time - me.step * me.stepMs : time
    const next: Pred = {
      x: me.x,
      y: me.y,
      tx: me.tx,
      ty: me.ty,
      start,
      end: start + (moving ? me.stepMs : 0),
      trail: [],
    }
    this.pred = next
    if (before) {
      const after = this.predPos(next, time)
      this.predOff.x += before.x - after.x
      this.predOff.y += before.y - after.y
    }
  }

  // --- Everyone else: a path of reported tiles, drawn REMOTE_DELAY_MS in the past ---------------------

  private track(view: View, p: BomberPlayer, time: number): void {
    if (!p.alive) {
      view.path = [{ t: time, x: p.x, y: p.y }]
      view.seg = ''
      return
    }
    if (p.tx === p.x && p.ty === p.y) {
      view.seg = ''
      this.addPoint(view, time, p.x, p.y)
      return
    }
    const seg = `${p.x},${p.y}>${p.tx},${p.ty}`
    if (seg === view.seg) return
    view.seg = seg
    const depart = time - p.step * p.stepMs
    this.addPoint(view, depart, p.x, p.y)
    this.addPoint(view, depart + p.stepMs, p.tx, p.ty)
  }

  private addPoint(view: View, t: number, x: number, y: number): void {
    const last = view.path.at(-1)
    if (!last) {
      view.path.push({ t, x, y })
      return
    }
    const gap = Math.abs(last.x - x) + Math.abs(last.y - y)
    // A jump the path can't explain (a missed stretch): start over there rather than cut a corner.
    if (gap > 1) view.path = [{ t, x, y }]
    // Same tile: a wait until t. Next tile: a step ending at t.
    else if (gap === 0 ? t > last.t : true) view.path.push({ t: Math.max(t, last.t + 1), x, y })
  }

  private pathPos(
    view: View,
    time: number,
  ): { x: number; y: number; dx: number; dy: number; moving: boolean; f: number } | null {
    const r = time - REMOTE_DELAY_MS
    const path = view.path
    while (path.length > 2 && (path[1] as Point).t <= r) path.shift()
    const a = path[0]
    if (!a) return null
    const b = path[1]
    if (!b || r <= a.t) return { x: a.x, y: a.y, dx: 0, dy: 0, moving: false, f: 0 }
    const f = Phaser.Math.Clamp((r - a.t) / Math.max(1, b.t - a.t), 0, 1)
    const dx = b.x - a.x
    const dy = b.y - a.y
    return { x: a.x + dx * f, y: a.y + dy * f, dx, dy, moving: (dx !== 0 || dy !== 0) && f < 1, f }
  }

  private paintGrid(grid: string): void {
    const rt = this.boardRT
    if (!rt || grid === this.grid) return
    const cell = this.board.cell
    // Stamps take their values when queued (a drawn game object would be read at render time).
    const stamp = (texture: string, x: number, y: number, size: number) => {
      const frame = this.textures.getFrame(texture)
      rt.stamp(texture, undefined, x, y, {
        scaleX: size / frame.width,
        scaleY: size / frame.height,
      })
    }
    for (let i = 0; i < grid.length; i++) {
      const c = grid[i]
      if (c === this.grid[i]) continue
      const x = i % W
      const y = Math.floor(i / W)
      const at = { x: (x + 0.5) * cell, y: (y + 0.5) * cell }
      const floor = (x + y) % 2 === 0 ? this.keys.floorA : this.keys.floorB
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
              : floor
      // The floor under it first (power-up icons have holes), then the cell's content.
      stamp(floor, at.x, at.y, cell)
      if (key === floor) continue
      // Power-up icons sit on the floor, a little smaller than the tile.
      const size = c === 'r' || c === 'b' || c === 's' ? cell * 0.8 : cell
      stamp(key, at.x, at.y, size)
    }
    rt.render()
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
    // Your own just-dropped bombs, until the server's snapshot shows them.
    this.ghosts.forEach((gh, k) => {
      const i = snap.bombs.length + k
      let img = this.bombImgs[i]
      if (!img) {
        img = this.add.image(0, 0, this.keys.bomb).setDepth(30)
        this.bombImgs.push(img)
      }
      const p = this.cellCenter(gh.x, gh.y)
      img
        .setTexture(this.keys.bomb)
        .setPosition(p.x, p.y)
        .setDisplaySize(cell * 0.82, cell * 0.82)
        .setVisible(true)
    })
    for (let i = snap.bombs.length + this.ghosts.length; i < this.bombImgs.length; i++)
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
    for (const p of snap.players) {
      const view = this.views.get(p.id)
      if (!view) continue
      // You: the prediction (plus whatever is left of a correction); the others: their path.
      let pos: { x: number; y: number; dx: number; dy: number; moving: boolean; f: number } | null
      const pred = p.id === this.selfId ? this.pred : undefined
      if (pred) {
        const at = this.predPos(pred, time)
        const moving = pred.tx !== pred.x || pred.ty !== pred.y
        const f = moving ? (time - pred.start) / Math.max(1, pred.end - pred.start) : 0
        pos = {
          x: at.x + this.predOff.x,
          y: at.y + this.predOff.y,
          dx: pred.tx - pred.x,
          dy: pred.ty - pred.y,
          moving,
          f,
        }
      } else if (p.id === this.selfId || !p.alive) {
        pos = { x: p.x, y: p.y, dx: 0, dy: 0, moving: false, f: 0 }
      } else pos = this.pathPos(view, time)
      if (!pos) continue
      const c = this.cellCenter(pos.x, pos.y)
      const walking = pos.moving && p.alive
      const hop = walking ? Math.abs(Math.sin(pos.f * Math.PI)) * 3 : 0
      // Faces the way it walks (top-down: back going up, front going down, side going across).
      if (walking) view.avatar.faceMotion(pos.dx, pos.dy, 0.1)
      if (p.alive) {
        view.avatar
          .setExpression(time < view.cheerUntil ? 'happy' : 'idle')
          .walk(walking, time, (BOMBER.stepMs[p.speed] ?? 150) / 2)
      }
      view.avatar.tick(time)
      view.avatar.image.setPosition(Math.round(c.x), Math.round(c.y - hop))
      view.shadow.setPosition(Math.round(c.x), Math.round(c.y + cell * 0.3)).setVisible(p.alive)
      if (p.id === this.selfId) {
        if (p.alive) this.marker?.place(c.x, c.y - hop - cell * 0.5, time)
        else this.marker?.hide()
      }
    }
  }

  // Snapshot deltas: blasts, broken crates, pick-ups, knock-outs.
  private onSnapshot(snap: BomberSnapshot): void {
    const prev = this.prev
    this.prev = snap
    const first = !prev || this.firstSnapshot
    const clock = this.time.now
    // Bombs the server now shows (or that never came) stop being ghosts: one per new bomb of yours
    // (the server may have dropped it a tile off the prediction), any on a tile that has a real one,
    // and any that expired.
    const mineIdx = snap.players.findIndex((p) => p.id === this.selfId)
    const own = (s: BomberSnapshot | undefined): number =>
      s ? s.bombs.filter((b) => b[3] === mineIdx).length : 0
    this.ghosts = this.ghosts
      .slice(Math.max(0, own(snap) - own(prev)))
      .filter((g) => g.until > clock && !snap.bombs.some((b) => b[0] === g.x && b[1] === g.y))
    for (const p of snap.players) {
      const view = this.views.get(p.id) ?? this.addView(p)
      if (p.id === this.selfId) this.reconcile(p, clock)
      else this.track(view, p, clock)
      // A knock-out you scored: a short happy face.
      if (p.kos > view.kos) view.cheerUntil = clock + 900
      view.kos = p.kos
    }
    if (!first && prev) {
      const before = new Set(prev.flames.map(([x, y]) => y * W + x))
      const fresh = snap.flames.filter(([x, y]) => !before.has(y * W + x))
      if (fresh.length > 0) {
        // Your own bomb going off is full blast; only rivals' bombs going off is softer.
        const mineBlew = prev.bombs.some(
          (b) => b[3] === mineIdx && !snap.bombs.some((c) => c[0] === b[0] && c[1] === b[1]),
        )
        this.sfx.quiet(() => this.sfx.boom(), mineBlew ? 1 : RIVAL_LEVEL * 1.4)
        shake(this, Math.min(0.012, 0.004 + fresh.length * 0.0004), 160)
      }
      for (let i = 0; i < snap.grid.length; i++) {
        const was = prev.grid[i]
        const now = snap.grid[i]
        if (was === now) continue
        const p = this.cellCenter(i % W, Math.floor(i / W))
        if (was === 'c') this.splinters?.explode(10, p.x, p.y)
      }
      const prevById = new Map(prev.players.map((p) => [p.id, p]))
      for (const p of snap.players) {
        const was = prevById.get(p.id)
        if (!was) continue
        if (was.alive && !p.alive && !p.left) this.knockOut(p)
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
          this.sfx.powerUp()
        }
        if (p.id === this.selfId && p.kos > was.kos) this.sfx.win()
      }
    }
    this.paintGrid(snap.grid)
    // Flames only change with the snapshot.
    this.paintFlames(snap)
    for (const p of snap.players) {
      const view = this.views.get(p.id)
      if (view && !p.alive && view.alive) {
        view.alive = false
        view.avatar.setExpression('ko')
        // A leaver just fades off the board; a knock-out keels over.
        const fall = p.left ? { alpha: 0 } : { angle: 90, alpha: 0.25 }
        this.tweens.add({ targets: view.avatar.image, ...fall, duration: 300 })
      }
    }
    const me = snap.players.find((p) => p.id === this.selfId)
    const alive = snap.players.filter((p) => p.alive).length
    if (me) this.hud?.setScore(this.t('game.bomber.kos', { n: me.kos }))
    this.hud?.setCenter(
      this.t('game.common.left', { n: alive, total: snap.players.length }),
      alive <= 1 ? PALETTE.red : PALETTE.text,
    )
    // The KO stat is glued into one trailing token (no-break spaces), so a crowded strip clips the name,
    // not the score.
    const stat = (p: BomberPlayer): string =>
      `${this.t('game.bomber.kos', { n: p.kos })}${p.alive || p.left ? '' : ' ✗'}`.replaceAll(
        ' ',
        '\u00a0',
      )
    this.strip?.set(
      snap.players.map((p) => ({
        text: `${this.label(p.id)} ${stat(p)}`,
        avatar: this.state.avatarOf(p.id),
        color: this.state.colorOf(p.id),
        dim: !p.alive,
      })),
    )
    if (this.state.final && me && !me.left && this.banner && !this.banner.visible) {
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

  private addView(p: BomberPlayer): View {
    const size = avatarPx(this.board.cell)
    const avatar = new AvatarSprite(this, this.state.avatarOf(p.id), this.state.colorOf(p.id), size)
    avatar.image.setOrigin(0.5, 0.6).setDepth(50)
    const shadow = addShadow(this, size, 49)
    const view: View = {
      avatar,
      shadow,
      alive: p.alive,
      cheerUntil: 0,
      kos: p.kos,
      path: [],
      seg: '',
    }
    this.views.set(p.id, view)
    if (!p.alive) {
      avatar.setExpression('ko')
      avatar.image.setAlpha(p.left ? 0 : 0.25).setAngle(p.left ? 0 : 90)
      shadow.setVisible(false)
    }
    return view
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
    this.sfx.quiet(() => this.sfx.eliminated(), p.id === this.selfId ? 1 : RIVAL_LEVEL)
    if (p.id === this.selfId) {
      this.sfx.hurt()
      flash(this, PALETTE.red, 220, 0.3)
      this.marker?.hide()
    }
  }
}
