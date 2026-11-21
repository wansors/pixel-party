import {
  MAZE,
  MAZE_LAYOUT,
  type MazeRunner,
  type MazeTurn,
  type MazeWorld,
  type MunchMazeSnapshot,
  mazeChilli,
  mazeClone,
  mazePigeonCount,
  mazeRun,
  mazeSnap,
  PALETTE,
} from '@pp/shared'
import type Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { DirPad } from '../dirPad'
import { addBanner, burst, floatText, ring, shake, showBanner } from '../fx'
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
// Rivals' sounds are throttled to one per this long each.
const RIVAL_SFX_MS = 200
const SWIPE_PX = 18
const U = MAZE.unit

const HEDGE = 0x2f7a3a
const HEDGE_LIT = 0x46a050
const HEDGE_DARK = 0x1d4f26
const PATH = 0xd8c08a
const PEBBLE = 0xc2a86f
const FEATHER = 0xdde2ea

const SEED_ROWS = ['_kk_', 'kwdk', 'kdwk', 'kwdk', '_kk_']
const CHILLI_ROWS = [
  '____gg__',
  '___gg___',
  '__rrrr__',
  '_rrrrrr_',
  '_rlrrrr_',
  '_rlrrrr_',
  '__rrrrr_',
  '__rrrr__',
  '___rrr__',
  '____r___',
]
// A pigeon facing right, two walking frames (the head bobs, the feet swap).
const PIGEON_ROWS = [
  [
    '________kkk___',
    '_______kgggk__',
    '_______kgegko_',
    '______knnggk__',
    '__kkkknnnk____',
    '_kggggggnk____',
    'kddgggggggk___',
    'kdddggggggk___',
    '_kdddgggggk___',
    '__kkkkkkkk____',
    '_____o__o_____',
    '____oo_oo_____',
  ],
  [
    '_________kkk__',
    '________kgggk_',
    '________kgegko',
    '______knnggk__',
    '__kkkknnnk____',
    '_kggggggnk____',
    'kddgggggggk___',
    'kdddggggggk___',
    '_kdddgggggk___',
    '__kkkkkkkk____',
    '______o_o_____',
    '_____oo_oo____',
  ],
]
const PIGEON_LEGEND = {
  k: 0x3c4150,
  g: 0x9aa0ac,
  d: 0x6e7480,
  n: 0x4aa88a,
  e: 0x10121c,
  o: 0xff9f3d,
}

interface Runner {
  id: string
  index: number
  avatar: AvatarSprite
  mine: boolean
  sfxAt: number
  // Pecks + tackles taken, as last seen (−1 = not yet).
  hits: number
}

interface PendingTurn extends MazeTurn {
  seq: number
  sentAt: number
}

// Munch Maze canvas (D50). A hedge maze in a sandy park, seen from above: black-and-white seeds on
// every path, a chilli in each corner, the pigeons' nest in the middle. Everyone is their avatar
// (back view going up, side view across, stride frames while walking); the pigeons waddle with a
// head bob and turn pale and flee while anyone is SPICY (a red glow). The whole world is run forward
// from the last judged state with every turn known — yours the moment you press — so your runner, the
// seeds you eat and the pigeons all move on the frame. Pecks and tackles burst into feathers.
// Controls: arrows / WASD, the on-screen pad, a swipe, or a tap beside your avatar.
export class MunchMazeScene extends MiniGameScene<MunchMazeSnapshot> {
  private maze = { x: 0, y: 0, cell: 0 }
  private compact = false
  private readonly clock = new ServerClock()
  private base?: MunchMazeSnapshot
  private pending: PendingTurn[] = []
  private seq = 0
  private lastSentAt = -1e9
  private lastTick = -1
  private started = false
  private phase: 'ready' | 'go' = 'ready'
  private runners: Runner[] = []
  private pigeons: Phaser.GameObjects.Image[] = []
  private seeds: (Phaser.GameObjects.Image | undefined)[] = []
  private shownFood: number[] = []
  private glow?: Phaser.GameObjects.Graphics
  private pad?: DirPad
  private you?: YouMarker
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private prev?: MazeRunner
  private shownScore = -1
  private seedSfxAt = 0

  constructor(...deps: SceneDeps) {
    super('munch-maze', ...deps)
  }

  override create(): void {
    super.create()
    for (const r of this.runners) r.avatar.destroy()
    this.runners = []
    this.pigeons = []
    this.seeds = []
    this.shownFood = []
    this.clock.reset()
    this.base = undefined
    this.pending = []
    this.seq = 0
    this.lastSentAt = -1e9
    this.lastTick = -1
    this.started = false
    this.phase = 'ready'
    this.prev = undefined
    this.shownScore = -1
    this.seedSfxAt = 0

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    const pad = this.compact ? 8 : 16
    const hintH = this.compact ? 20 : 26
    const btn = Math.round(this.compact ? Math.max(48, Math.min(64, width * 0.15)) : 64)
    const gap = this.compact ? 6 : 8
    const { w: padW, h: padH } = DirPad.size(btn, gap)
    const top = this.top + pad
    const bottom = height - hintH - pad
    let padX: number
    let padY: number
    if (height > width) {
      const cell = Math.floor(
        Math.min((width - pad * 2) / MAZE.w, (bottom - top - padH - pad) / MAZE.h),
      )
      this.maze = { x: Math.round((width - cell * MAZE.w) / 2), y: top, cell }
      padX = width / 2
      padY = (top + cell * MAZE.h + bottom) / 2
    } else {
      const cell = Math.floor(Math.min((bottom - top) / MAZE.h, (width - padW - pad * 3) / MAZE.w))
      const mw = cell * MAZE.w
      const mh = cell * MAZE.h
      const x = Math.round(Math.min((width - mw) / 2, width - pad * 2 - padW - mw))
      this.maze = { x: Math.max(pad, x), y: Math.round(top + (bottom - top - mh) / 2), cell }
      padX = Math.min(width - pad - padW / 2, (this.maze.x + mw + width) / 2)
      padY = this.maze.y + mh - padH / 2
    }

    this.paintMaze()
    this.buildFood()
    this.glow = this.add.graphics().setDepth(19)
    this.pad = new DirPad(this, padX, padY, btn, gap, this.compact, (dir) => this.turn(dir))
    this.you = new YouMarker(this, this.compact ? 8 : 12, 820)

    const hint = this.add
      .text(
        width / 2,
        height - hintH / 2,
        this.t(this.compact ? 'game.munchMaze.hintShort' : 'game.munchMaze.hint'),
        bodyStyle(this.compact ? 11 : 14, PALETTE.dim),
      )
      .setOrigin(0.5)
      .setDepth(60)
    fitText(hint, width - 16, this.compact ? 11 : 14)
    const midY = this.maze.y + (MAZE.h * this.maze.cell) / 2
    this.banner = addBanner(this)
    this.banner.setPosition(width / 2, midY - (this.compact ? 14 : 20))
    this.subline = this.add
      .text(
        width / 2,
        midY + (this.compact ? 18 : 26),
        '',
        headlineStyle(this.compact ? 8 : 16, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setDepth(950)
      .setVisible(false)

    const keys: [string, number][] = [
      ['UP', 0],
      ['W', 0],
      ['RIGHT', 1],
      ['D', 1],
      ['DOWN', 2],
      ['S', 2],
      ['LEFT', 3],
      ['A', 3],
    ]
    for (const [key, dir] of keys) this.onKey(key, () => this.turn(dir))
    this.input.keyboard?.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D')
    // Swipe, or tap beside your avatar (not on the pad).
    let from: { x: number; y: number } | undefined
    this.input.on(
      'pointerdown',
      (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        from = over.length > 0 ? undefined : { x: p.x, y: p.y }
      },
    )
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!from) return
      let dx = p.x - from.x
      let dy = p.y - from.y
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) {
        const me = this.runners.find((r) => r.mine)
        if (!me) return
        dx = p.x - me.avatar.image.x
        dy = p.y - me.avatar.image.y
      }
      from = undefined
      if (Math.abs(dx) > Math.abs(dy)) this.turn(dx > 0 ? 1 : 3)
      else this.turn(dy < 0 ? 0 : 2)
    })
  }

  private sx(units: number): number {
    return this.maze.x + (units / U + 0.5) * this.maze.cell
  }

  private sy(units: number): number {
    return this.maze.y + (units / U + 0.5) * this.maze.cell
  }

  // Sandy paths with pebbles; hedges with a lit top and a dark rim where they meet a path.
  private paintMaze(): void {
    const { x, y, cell } = this.maze
    const g = this.add.graphics().setDepth(1)
    const px = Math.max(1, Math.round(cell / 16))
    const wall = (cx: number, cy: number): boolean =>
      cy >= 0 && cy < MAZE.h && cx >= 0 && cx < MAZE.w && MAZE_LAYOUT[cy]?.[cx] === '#'
    g.fillStyle(PATH, 1).fillRect(x, y, cell * MAZE.w, cell * MAZE.h)
    for (let cy = 0; cy < MAZE.h; cy++) {
      for (let cx = 0; cx < MAZE.w; cx++) {
        const left = x + cx * cell
        const top = y + cy * cell
        if (!wall(cx, cy)) {
          g.fillStyle(PEBBLE, 1)
          g.fillRect(
            left + ((cx * 7 + cy * 3) % 5) * px * 2,
            top + ((cx + cy * 5) % 4) * px * 3,
            px * 2,
            px,
          )
          continue
        }
        g.fillStyle(HEDGE_DARK, 1).fillRect(left, top, cell, cell)
        // Inset on the sides that face a path, so the hedge reads as one rounded mass.
        const inL = wall(cx - 1, cy) ? 0 : 2 * px
        const inR = wall(cx + 1, cy) ? 0 : 2 * px
        const inT = wall(cx, cy - 1) ? 0 : 2 * px
        const inB = wall(cx, cy + 1) ? 0 : 3 * px
        g.fillStyle(HEDGE, 1).fillRect(left + inL, top + inT, cell - inL - inR, cell - inT - inB)
        g.fillStyle(HEDGE_LIT, 1)
        for (let k = 0; k < 3; k++) {
          const lx =
            left + inL + ((cx * 5 + cy * 3 + k * 7) % Math.max(1, cell - inL - inR - 3 * px))
          const ly =
            top + inT + ((cx * 3 + cy * 7 + k * 5) % Math.max(1, cell - inT - inB - 2 * px))
          g.fillRect(lx, ly, 3 * px, 2 * px)
        }
        if (!inT) continue
        g.fillStyle(shade(HEDGE_LIT, 0.15), 1).fillRect(left + inL, top + inT, cell - inL - inR, px)
      }
    }
    // The nest: a ring of straw in the middle.
    const [nx, ny] = MAZE.nest
    g.fillStyle(0x8a6234, 1).fillEllipse(
      x + (nx + 0.5) * cell,
      y + (ny + 0.6) * cell,
      cell * 0.9,
      cell * 0.5,
    )
    g.fillStyle(0xb88a4a, 1).fillEllipse(
      x + (nx + 0.5) * cell,
      y + (ny + 0.55) * cell,
      cell * 0.6,
      cell * 0.28,
    )
    // The tunnel mouths: a dark gap at both ends of the middle row.
    g.fillStyle(PALETTE.bg, 0.55)
    g.fillRect(x - px * 3, y + MAZE.tunnelRow * cell, px * 3, cell)
    g.fillRect(x + MAZE.w * cell, y + MAZE.tunnelRow * cell, px * 3, cell)
  }

  private buildFood(): void {
    const { cell } = this.maze
    const seedKey = ensurePixelGrid(this, {
      key: 'mm-seed',
      rows: SEED_ROWS,
      legend: { k: 0x1a1a1a, d: 0x2e2e2e, w: 0xe8e8e8 },
      pixelSize: 1,
    })
    const chilliKey = ensurePixelGrid(this, {
      key: 'mm-chilli',
      rows: CHILLI_ROWS,
      legend: { g: 0x3caa3c, r: 0xe8322a, l: 0xff8a7a },
      pixelSize: 1,
    })
    const seedW = Math.max(3, Math.round(cell * 0.2))
    for (let cy = 0; cy < MAZE.h; cy++) {
      for (let cx = 0; cx < MAZE.w; cx++) {
        const ch = MAZE_LAYOUT[cy]?.[cx]
        const [nx, ny] = MAZE.nest
        if (ch === '#' || (cx === nx && cy === ny)) {
          this.seeds.push(undefined)
          continue
        }
        const chilli = mazeChilli(cx, cy)
        const img = this.add
          .image(
            this.maze.x + (cx + 0.5) * cell,
            this.maze.y + (cy + 0.5) * cell,
            chilli ? chilliKey : seedKey,
          )
          .setDepth(chilli ? 3 : 2)
        if (chilli) img.setDisplaySize(cell * 0.62, cell * 0.78)
        else
          img
            .setDisplaySize(seedW, Math.round(seedW * 1.25))
            .setAngle(((cx * 37 + cy * 11) % 5) * 18 - 36)
        this.seeds.push(img)
      }
    }
    // Every seed and chilli starts out shown.
    this.shownFood = this.seeds.map(() => 0)
  }

  private buildCast(snap: MunchMazeSnapshot): void {
    const size = avatarPx(Math.max(16, this.maze.cell * 0.95))
    snap.ids.forEach((id, index) => {
      const mine = id === this.selfId
      const avatar = new AvatarSprite(
        this,
        this.state.avatarOf(id),
        this.state.colorOf(id, PALETTE.lime),
        size,
        'front',
      )
      avatar.image.setDepth(mine ? 31 : 21)
      this.runners.push({ id, index, avatar, mine, sfxAt: -1e9, hits: -1 })
    })
    this.warmAvatars(snap.ids, [
      ['front', 'idle', 0],
      ['front', 'idle', 1],
      ['front', 'idle', 2],
      ['back', 'idle', 1],
      ['back', 'idle', 2],
      ['side', 'idle', 0],
      ['side', 'idle', 1],
      ['front', 'ko', 0],
      ['front', 'happy', 0],
    ])
    const keys = PIGEON_ROWS.map((rows, i) =>
      ensurePixelGrid(this, { key: `mm-pigeon-${i}`, rows, legend: PIGEON_LEGEND, pixelSize: 1 }),
    )
    const pw = Math.round(this.maze.cell * 0.9)
    for (let i = 0; i < MAZE.maxPigeons; i++)
      this.pigeons.push(
        this.add
          .image(0, 0, keys[0] as string)
          .setDisplaySize(pw, Math.round((pw * 12) / 14))
          .setDepth(20)
          .setVisible(false),
      )
  }

  // Round ms at scene time `now`, on the server's clock (frozen once the round is over).
  private roundNow(now: number): number {
    const base = this.base
    if (!base) return 0
    const elapsed = this.state.final ? 0 : this.clock.since(base.remainingMs, now)
    return base.t + elapsed
  }

  // Everyone's known turns, yours with the ones the server hasn't taken yet.
  private allTurns(base: MunchMazeSnapshot): MazeTurn[][] {
    const me = base.ids.indexOf(this.selfId)
    const ack = base.acks[this.selfId] ?? 0
    const mine = this.pending.filter((p) => p.seq > ack).map((p) => ({ at: p.at, dir: p.dir }))
    if (me < 0 || mine.length === 0) return base.turns
    return base.turns.map((list, i) =>
      i === me ? [...list, ...mine].sort((a, b) => a.at - b.at) : list,
    )
  }

  private turn(dir: number): void {
    this.pad?.flash(dir)
    const base = this.base
    if (!base?.ids.includes(this.selfId) || this.state.final) return
    const now = this.time.now
    const rt = this.roundNow(now)
    if (rt < MAZE.startDelayMs) return
    const at = mazeSnap(rt)
    if (at - this.lastSentAt < 20) return
    const seq = ++this.seq
    this.lastSentAt = at
    this.pending.push({ seq, at, dir, sentAt: now })
    this.sendInput({ kind: 'turn', dir, at, seq })
  }

  protected frame(snap: MunchMazeSnapshot | null, time: number): void {
    if (!snap) return
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.onSnapshot(snap)
    }
    this.render(this.time.now, time)
  }

  private onSnapshot(snap: MunchMazeSnapshot): void {
    if (this.runners.length === 0) this.buildCast(snap)
    this.clock.sync(snap.remainingMs, this.time.now)
    const first = !this.started
    this.started = true
    this.base = snap
    const ack = snap.acks[this.selfId]
    if (ack !== undefined) {
      const now = this.time.now
      this.pending = this.pending.filter((p) => p.seq > ack && now - p.sentAt < PENDING_TTL_MS)
      if (first) this.seq = Math.max(this.seq, ack)
    }
  }

  private render(now: number, time: number): void {
    const base = this.base
    if (!base) return
    const rt = this.roundNow(now)
    this.updatePhase(rt)
    const w = mazeClone(base.world)
    mazeRun(w, Math.max(mazeSnap(Math.max(0, rt)), w.t), this.allTurns(base))
    this.drawFood(w, time)
    this.drawPigeons(w, time)
    this.drawRunners(w, time)
  }

  private drawFood(w: MazeWorld, time: number): void {
    for (let i = 0; i < w.food.length; i++) {
      const img = this.seeds[i]
      if (!img) continue
      const here = w.food[i] === 0
      if ((this.shownFood[i] === 0) !== here) {
        this.shownFood[i] = here ? 0 : 1
        img.setVisible(here)
      }
    }
    // The chillies bob.
    const bob = Math.round(Math.sin(time / 220) * this.maze.cell * 0.06)
    for (let cy = 0; cy < MAZE.h; cy++)
      for (let cx = 0; cx < MAZE.w; cx++)
        if (mazeChilli(cx, cy))
          this.seeds[cy * MAZE.w + cx]?.setY(this.maze.y + (cy + 0.5) * this.maze.cell + bob)
  }

  private drawPigeons(w: MazeWorld, time: number): void {
    const count = mazePigeonCount(w.t, w.players)
    const fleeing = w.runners.some((r) => r.spicyUntil > w.t)
    const step = Math.floor(time / (fleeing ? 90 : 160)) % 2
    this.pigeons.forEach((img, i) => {
      const p = w.pigeons[i]
      if (!p || i >= count) {
        img.setVisible(false)
        return
      }
      const roosting = p.homeUntil > w.t || w.t < MAZE.startDelayMs
      img
        .setTexture(`mm-pigeon-${roosting ? 0 : step}`)
        .setPosition(this.sx(p.x) + (roosting ? (i - 2) * 3 : 0), this.sy(p.y) - (roosting ? 2 : 0))
        .setVisible(true)
        .setAlpha(roosting ? 0.75 : 1)
      if (p.dir === 1) img.setFlipX(false)
      else if (p.dir === 3) img.setFlipX(true)
      if (fleeing && !roosting) img.setTint(0x9fd8ff)
      else img.clearTint()
    })
  }

  private drawRunners(w: MazeWorld, time: number): void {
    const g = this.glow
    g?.clear()
    const dirs: [number, number][] = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]
    for (const view of this.runners) {
      const r = w.runners[view.index]
      if (!r) continue
      const x = this.sx(r.x)
      const y = this.sy(r.y)
      const img = view.avatar.image
      const dazed = r.downUntil > w.t
      const spicy = r.spicyUntil > w.t
      if (dazed) view.avatar.faceMotion(0, 1).setExpression('ko')
      else {
        const [dx, dy] = dirs[r.dir] ?? [0, 0]
        view.avatar
          .faceMotion(dx, dy)
          .walk(r.dir >= 0, time, 130)
          .setExpression(spicy ? 'happy' : 'idle')
      }
      // Blinks while safe after starting over; the last second of SPICY flickers.
      let alpha = 1
      if (r.safeUntil > w.t && Math.floor(time / 90) % 2) alpha = 0.35
      img
        .setPosition(x, y - (dazed ? 0 : Math.abs(Math.sin(time / 90)) * (r.dir >= 0 ? 1.5 : 0)))
        .setAlpha(alpha)
      img.setAngle(dazed ? Math.sin(time / 60) * 12 : 0)
      view.avatar.tick(time)
      if (spicy && g && (r.spicyUntil - w.t > 1000 || Math.floor(time / 100) % 2)) {
        g.fillStyle(PALETTE.red, 0.35).fillCircle(x, y, this.maze.cell * 0.62)
        g.fillStyle(PALETTE.orange, 0.5).fillCircle(x, y, this.maze.cell * 0.42)
      }
      if (view.mine) {
        this.you?.place(x, y - img.displayHeight / 2 - 2, time)
        this.mine(r, w, x, y)
      } else this.rivalMoments(view, r, x, y)
    }
  }

  // Your own moments, from the predicted world: seeds, the chilli, shoos, pecks and tackles.
  private mine(r: MazeRunner, w: MazeWorld, x: number, y: number): void {
    const prev = this.prev
    this.prev = { ...r }
    if (r.score !== this.shownScore) {
      this.shownScore = r.score
      this.hud?.setScore(this.t('game.munchMaze.score', { n: r.score }))
    }
    const left = Math.max(0, Math.ceil((r.spicyUntil - w.t) / 1000))
    this.hud?.setCenter(left > 0 ? this.t('game.munchMaze.spicy', { s: left }) : '', PALETTE.orange)
    if (!prev) return
    const now = this.time.now
    const size = this.compact ? 10 : 14
    if (r.seeds > prev.seeds && now - this.seedSfxAt > 70) {
      this.seedSfxAt = now
      this.sfx.quiet(() => this.sfx.tick(), 0.25)
    }
    if (r.spicyUntil > prev.spicyUntil && r.spicyUntil > w.t) {
      this.sfx.powerUp()
      ring(this, x, y, PALETTE.orange, this.maze.cell)
      floatText(this, x, y - this.maze.cell, this.t('game.munchMaze.hot'), PALETTE.orange, size)
    }
    if (r.shoos > prev.shoos) {
      this.sfx.coin()
      burst(this, x, y, FEATHER, 10, 160)
      floatText(this, x, y - this.maze.cell, `+${MAZE.pigeonPoints}`, PALETTE.lime, size)
    }
    if (r.tackles > prev.tackles) {
      this.sfx.hit(1)
      const gained = r.score - prev.score
      if (gained > 0) floatText(this, x, y - this.maze.cell, `+${gained}`, PALETTE.lime, size)
    }
    if (r.pecks > prev.pecks || r.tackled > prev.tackled) {
      this.sfx.hurt()
      shake(this, 0.006, 140)
      burst(this, x, y, FEATHER, 12, 180)
      const pool = r.pecks > prev.pecks ? 'game.munchMaze.pecked' : 'game.munchMaze.tackled'
      floatText(
        this,
        x,
        y - this.maze.cell,
        this.quip(pool, `${this.selfId}:${r.pecks + r.tackled}`),
        PALETTE.red,
        size,
      )
    }
  }

  private rivalMoments(view: Runner, r: MazeRunner, x: number, y: number): void {
    const hits = r.pecks + r.tackled
    const seen = view.hits
    view.hits = hits
    if (seen < 0 || hits <= seen) return
    burst(this, x, y, FEATHER, 6, 140)
    const now = this.time.now
    if (now - view.sfxAt > RIVAL_SFX_MS) {
      view.sfxAt = now
      this.sfx.quiet(() => this.sfx.hurt(), 0.25)
    }
  }

  // GET READY until GO.
  private updatePhase(rt: number): void {
    if (this.phase !== 'ready') return
    const banner = this.banner
    if (rt < MAZE.startDelayMs && !this.state.final) {
      if (banner && !banner.visible) {
        const text = this.t('game.munchMaze.ready')
        banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
        showBanner(this, banner, text, PALETTE.amber)
        this.subline?.setText(this.t('game.munchMaze.readySub')).setVisible(true)
        if (this.subline) fitText(this.subline, this.scale.width * 0.9, this.compact ? 8 : 16)
      }
      return
    }
    this.phase = 'go'
    banner?.setVisible(false)
    this.subline?.setVisible(false)
    if (rt < MAZE.startDelayMs + 300) this.sfx.go()
  }
}
