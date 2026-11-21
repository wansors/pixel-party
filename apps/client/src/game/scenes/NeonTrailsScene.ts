import {
  PALETTE,
  TRAILS,
  type TrailDir,
  type TrailRider,
  type TrailsSnapshot,
  type TrailView,
  trailCanTurn,
  trailCells,
  trailHead,
  trailLevel,
  trailMove,
  trailNext,
  trailStepsAt,
} from '@pp/shared'
import type Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { addBanner, eliminate, flash, floatText, punch, shake, showBanner } from '../fx'
import { ServerClock } from '../netcode/ServerClock'
import { bodyStyle, fitFontSize, fitText, headlineStyle, shade } from '../pixelStyle'
import { YouMarker } from '../playerMarks'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const SWIPE_MIN_PX = 16
// Prediction never runs more than this many steps past the last snapshot (a stalled connection
// freezes the riders instead of sending them off on their own).
const MAX_PREDICT_STEPS = 4
const PENDING_TTL_MS = 2000
const DEREZ_MS = 700

interface Look {
  id: string
  color: number
  avatar: AvatarSprite
  // The trail of a crashed rider, faded out on its own layer.
  derez: Phaser.GameObjects.Graphics
  alive: boolean
}

interface PendingTurn {
  seq: number
  dir: TrailDir
  at: number
  sentAt: number
}

// Neon Trails canvas (D41). The server owns the shared arena; this draws it as a dark pixel grid with
// every trail glowing in its rider's identity color and the rider's avatar on the head (facing its
// heading). Everything moves on the server's clock: the own rider is predicted with the shared rules
// (a turn shows on the very next step and names that step, so the server turns on the same cell),
// rivals are carried forward along their heading and queued turns until the next snapshot; nobody is
// predicted through a wall — crashes come from the server. A crash fades the trail out ("derez") with
// the elimination stamp. The HUD shows the speed notch (it climbs every TRAILS.levelSteps cells) and
// how many riders are left. Controls: arrow keys / WASD, swipe on touch.
export class NeonTrailsScene extends MiniGameScene<TrailsSnapshot> {
  private trailGfx?: Phaser.GameObjects.Graphics
  private floorGfx?: Phaser.GameObjects.Graphics
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private you?: YouMarker
  private looks = new Map<string, Look>()
  private arena = { x: 0, y: 0, cell: 8, cols: 0, rows: 0 }
  private readonly clock = new ServerClock()
  private base?: TrailsSnapshot
  // Cells taken in the last snapshot (no rider is predicted into one).
  private taken = new Set<number>()
  private pending: PendingTurn[] = []
  private seq = 0
  private lastTick = -1
  private started = false
  private alive = true
  private shownLevel = -1
  private phase: 'ready' | 'go' | 'out' | 'won' = 'ready'
  private drawnKey = ''
  private swipeStart?: { x: number; y: number }
  private compact = false

  constructor(...deps: SceneDeps) {
    super('neon-trails', ...deps)
  }

  override create(): void {
    super.create()
    for (const look of this.looks.values()) look.avatar.destroy()
    this.looks = new Map()
    this.clock.reset()
    this.base = undefined
    this.taken = new Set()
    this.pending = []
    this.seq = 0
    this.lastTick = -1
    this.started = false
    this.alive = true
    this.shownLevel = -1
    this.phase = 'ready'
    this.drawnKey = ''
    this.swipeStart = undefined

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.floorGfx = this.add.graphics()
    this.trailGfx = this.add.graphics().setDepth(10)
    this.you = new YouMarker(this, this.compact ? 10 : 14, 820)

    const hintH = this.compact ? 22 : 28
    const hint = this.add
      .text(
        width / 2,
        height - hintH / 2,
        this.t('game.neonTrails.hint'),
        bodyStyle(this.compact ? 11 : 14, PALETTE.dim),
      )
      .setOrigin(0.5)
    fitText(hint, width - 16, this.compact ? 11 : 14)

    this.banner = addBanner(this)
    this.subline = this.add
      .text(
        width / 2,
        height / 2 + (this.compact ? 34 : 46),
        '',
        headlineStyle(this.compact ? 8 : 16, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setDepth(950)
      .setVisible(false)

    const keys: [string, TrailDir][] = [
      ['UP', 'up'],
      ['DOWN', 'down'],
      ['LEFT', 'left'],
      ['RIGHT', 'right'],
      ['W', 'up'],
      ['S', 'down'],
      ['A', 'left'],
      ['D', 'right'],
    ]
    for (const [key, dir] of keys) this.onKey(key, () => this.turn(dir))
    // Captured so the arrows never scroll the page.
    this.input.keyboard?.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D')
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.swipeStart = { x: p.x, y: p.y }
    })
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.endSwipe(p.x, p.y))

    if (this.snap) this.layoutArena(this.snap.cols, this.snap.rows)
  }

  // Biggest whole-pixel cell that fits the arena between the HUD and the hint line, then the floor:
  // a dark grid with brighter lines every 6 cells, inside a double neon frame.
  private layoutArena(cols: number, rows: number): void {
    const { width, height } = this.scale
    const hintH = this.compact ? 22 : 28
    const pad = this.compact ? 10 : 20
    const top = this.top + 8
    const availW = width - pad * 2
    const availH = height - top - hintH - 8
    const cell = Math.max(3, Math.floor(Math.min(availW / cols, availH / rows)))
    const w = cell * cols
    const h = cell * rows
    this.arena = {
      x: Math.round((width - w) / 2),
      y: Math.round(top + (availH - h) / 2),
      cell,
      cols,
      rows,
    }
    const g = this.floorGfx
    if (!g) return
    const { x, y } = this.arena
    g.clear()
    g.fillStyle(PALETTE.cyan, 1)
    g.fillRect(x - 6, y - 6, w + 12, h + 12)
    g.fillStyle(PALETTE.bg, 1)
    g.fillRect(x - 3, y - 3, w + 6, h + 6)
    g.fillStyle(shade(PALETTE.bg, 0.04), 1)
    g.fillRect(x, y, w, h)
    if (cell >= 6) {
      for (let c = 1; c < cols; c++) {
        g.fillStyle(PALETTE.frame, c % 6 === 0 ? 0.55 : 0.18)
        g.fillRect(x + c * cell, y, 1, h)
      }
      for (let r = 1; r < rows; r++) {
        g.fillStyle(PALETTE.frame, r % 6 === 0 ? 0.55 : 0.18)
        g.fillRect(x, y + r * cell, w, 1)
      }
    }
    this.subline?.setPosition(width / 2, y + h / 2 + (this.compact ? 34 : 46))
    this.banner?.setPosition(width / 2, y + h / 2)
  }

  private buildLooks(snap: TrailsSnapshot): void {
    const size = avatarPx(Math.max(16, this.arena.cell * 2.4))
    for (const id of Object.keys(snap.riders)) {
      const color = this.state.colorOf(id, PALETTE.lime)
      const avatar = new AvatarSprite(this, this.state.avatarOf(id), color, size, 'side')
      avatar.image.setDepth(id === this.selfId ? 31 : 30)
      this.looks.set(id, {
        id,
        color,
        avatar,
        derez: this.add.graphics().setDepth(9).setVisible(false),
        alive: true,
      })
    }
    this.warmAvatars(Object.keys(snap.riders), [
      ['side', 'idle', 0],
      ['front', 'idle', 0],
      ['back', 'idle', 0],
      ['front', 'ko', 0],
      ['side', 'ko', 0],
    ])
  }

  // A turn: booked for the next step as this screen sees it (or after the turns already queued),
  // shown by the prediction at once and sent with that step for the server to honour.
  private turn(dir: TrailDir): void {
    if (!this.base || !this.alive || this.state.final) return
    const now = this.time.now
    const p = this.predictSelf(now)
    if (!p || !trailCanTurn(p.rider, dir)) return
    const at = Math.max(p.step + 1, (p.rider.turns.at(-1)?.at ?? 0) + 1)
    const seq = ++this.seq
    this.pending.push({ seq, dir, at, sentAt: now })
    this.sendInput({ kind: 'turn', dir, at, seq })
    this.sfx.click()
  }

  private endSwipe(x: number, y: number): void {
    if (!this.swipeStart) return
    const dx = x - this.swipeStart.x
    const dy = y - this.swipeStart.y
    this.swipeStart = undefined
    if (Math.abs(dx) < SWIPE_MIN_PX && Math.abs(dy) < SWIPE_MIN_PX) return
    if (Math.abs(dx) > Math.abs(dy)) this.turn(dx > 0 ? 'right' : 'left')
    else this.turn(dy > 0 ? 'down' : 'up')
  }

  // The step the server is on right now, as estimated from the last snapshot.
  private targetStep(now: number): number {
    const base = this.base
    if (!base) return 0
    const elapsed = this.state.final ? 0 : this.clock.since(base.remainingMs, now)
    return Math.min(
      base.step + MAX_PREDICT_STEPS,
      Math.max(base.step, trailStepsAt(base.t + elapsed)),
    )
  }

  // A rider carried from the snapshot to `target`, with `extra` turns booked in; it holds at the last
  // free cell instead of riding through a wall (the server says when it crashed).
  private carry(view: TrailView, extra: PendingTurn[], target: number): TrailRider {
    const base = this.base as TrailsSnapshot
    const rider: TrailRider = {
      pts: [...view.pts],
      dir: view.dir,
      turns: [
        ...view.turns.map(([dir, at]) => ({ dir, at })),
        ...extra.map((p) => ({ dir: p.dir, at: p.at })),
      ].sort((a, b) => a.at - b.at),
      alive: view.alive,
    }
    if (!view.alive) return rider
    for (let k = base.step + 1; k <= target; k++) {
      const pts = rider.pts.length
      const cell = trailNext(rider, k, base.cols, base.rows)
      if (cell < 0 || this.taken.has(cell)) {
        // Undo a corner the held step may have added: the rider hasn't left that cell yet.
        if (rider.pts.length > pts) rider.pts.length = pts
        break
      }
      trailMove(rider, cell)
    }
    return rider
  }

  private predictSelf(now: number): { rider: TrailRider; step: number } | null {
    const me = this.base?.riders[this.selfId]
    if (!me) return null
    const step = this.targetStep(now)
    return { rider: this.carry(me, this.pending, step), step }
  }

  protected frame(snap: TrailsSnapshot | null, time: number): void {
    if (!snap) return
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.onSnapshot(snap)
    }
    this.render(this.time.now, time)
  }

  private onSnapshot(snap: TrailsSnapshot): void {
    if (snap.cols !== this.arena.cols || snap.rows !== this.arena.rows)
      this.layoutArena(snap.cols, snap.rows)
    if (this.looks.size === 0) this.buildLooks(snap)
    this.clock.sync(snap.remainingMs, this.time.now)
    // The first snapshot of this (possibly restarted) scene only syncs state: no replayed events.
    const first = !this.started
    this.started = true
    this.base = snap
    this.taken = new Set()
    for (const view of Object.values(snap.riders)) {
      if (view.alive) for (const c of trailCells(view.pts, snap.cols)) this.taken.add(c)
    }
    const me = snap.riders[this.selfId]
    if (me) {
      const now = this.time.now
      this.pending = this.pending.filter((p) => p.seq > me.ack && now - p.sentAt < PENDING_TTL_MS)
      if (first) this.seq = Math.max(this.seq, me.ack)
    }

    const total = Object.keys(snap.riders).length
    let left = 0
    const outs: Look[] = []
    for (const [id, view] of Object.entries(snap.riders)) {
      if (view.alive) left++
      const look = this.looks.get(id)
      if (!look || look.alive === view.alive) continue
      look.alive = view.alive
      if (!view.alive) outs.push(look)
      if (!view.alive && !first) this.derez(look, view)
      else if (!view.alive) look.avatar.image.setVisible(false)
    }
    if (total > 1) this.hud?.setCenter(this.t('game.common.left', { n: left, total }))
    if (outs.length > 0 && !first) {
      this.sfx.quiet(() => this.sfx.crash(), 0.6)
      this.sfx.eliminated()
    }
    if (me && this.alive && !me.alive) this.becomeOut(!first)
    if (me?.alive && left === 1 && total > 1 && this.phase !== 'won') this.win()
  }

  // A crash: the elimination stamp on the spot, and the trail flickers out on its own layer.
  private derez(look: Look, view: TrailView): void {
    const head = trailHead(view)
    const { x, y } = this.cellCenter(head)
    eliminate(
      this,
      x,
      y,
      look.color,
      this.quip('game.common.stamps', look.id),
      this.compact ? 10 : 14,
    )
    look.avatar.setExpression('ko')
    const g = look.derez
    g.clear().setVisible(true).setAlpha(1)
    this.drawTrail(g, view.pts, look.color, false)
    this.tweens.add({
      targets: g,
      alpha: { from: 1, to: 0 },
      duration: DEREZ_MS,
      ease: 'Stepped',
      easeParams: [6],
      onComplete: () => g.setVisible(false),
    })
    this.tweens.add({
      targets: look.avatar.image,
      alpha: { from: 1, to: 0 },
      delay: DEREZ_MS * 0.6,
      duration: DEREZ_MS * 0.6,
      onComplete: () => look.avatar.image.setVisible(false).setAlpha(1),
    })
  }

  private becomeOut(withFx: boolean): void {
    this.alive = false
    this.phase = 'out'
    if (withFx) {
      this.sfx.crash()
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
    const text = this.t('game.neonTrails.lastRider')
    banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
    showBanner(this, banner, text, PALETTE.lime)
    this.subline?.setVisible(false)
    this.sfx.win()
    const look = this.looks.get(this.selfId)
    if (look) punch(this, look.avatar.image, 0.3, 120)
  }

  private cellCenter(cell: number): { x: number; y: number } {
    const { x, y, cell: c, cols } = this.arena
    return { x: x + (cell % cols) * c + c / 2, y: y + Math.floor(cell / cols) * c + c / 2 }
  }

  // Everything that moves, from the snapshot carried to the current step.
  private render(now: number, time: number): void {
    const base = this.base
    if (!base) return
    const step = this.targetStep(now)
    this.updatePhase(base, now, step)

    const riders = new Map<string, TrailRider>()
    for (const [id, view] of Object.entries(base.riders)) {
      if (!view.alive) continue
      riders.set(id, this.carry(view, id === this.selfId ? this.pending : [], step))
    }
    let key = `${step}`
    for (const [id, r] of riders) key += `|${id}:${r.pts.join(',')}`
    if (key !== this.drawnKey) {
      this.drawnKey = key
      const g = this.trailGfx
      if (g) {
        g.clear()
        for (const [id, r] of riders) this.drawTrail(g, r.pts, this.looks.get(id)?.color ?? 0, true)
      }
    }

    for (const [id, look] of this.looks) {
      const r = riders.get(id)
      if (!r) continue
      const { x, y } = this.cellCenter(trailHead(r))
      const [dx, dy] =
        r.dir === 'left' ? [-1, 0] : r.dir === 'right' ? [1, 0] : r.dir === 'up' ? [0, -1] : [0, 1]
      look.avatar.image.setPosition(x, y).setVisible(true)
      look.avatar.faceMotion(dx, dy).tick(time)
      if (id === this.selfId) this.you?.place(x, y - look.avatar.image.displayHeight / 2, time)
    }
    if (!this.alive) this.you?.hide()
  }

  // GET READY → GO! from the clock; the speed notch on the HUD, with a SPEED UP! pop as it climbs.
  private updatePhase(base: TrailsSnapshot, now: number, step: number): void {
    const t = base.t + (this.state.final ? 0 : this.clock.since(base.remainingMs, now))
    if (this.phase === 'ready') {
      if (t < TRAILS.startDelayMs && !this.state.final) {
        const banner = this.banner
        if (banner && !banner.visible) {
          const text = this.t('game.neonTrails.ready')
          banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
          showBanner(this, banner, text, PALETTE.amber)
          this.subline?.setText(this.t('game.neonTrails.readySub')).setVisible(true)
          if (this.subline) fitText(this.subline, this.scale.width * 0.9, this.compact ? 8 : 16)
        }
        return
      }
      this.phase = 'go'
      this.banner?.setVisible(false)
      this.subline?.setVisible(false)
      if (this.started && step <= 2) this.sfx.go()
    }
    const level = trailLevel(Math.max(1, step))
    if (level !== this.shownLevel) {
      const climbed = this.shownLevel >= 0 && level > this.shownLevel
      this.shownLevel = level
      this.hud?.setScore(this.t('game.neonTrails.speed', { n: level + 1 }))
      if (climbed && this.phase !== 'out') {
        this.sfx.whoosh()
        const { width } = this.scale
        floatText(
          this,
          width / 2,
          this.arena.y + 24,
          this.t('game.neonTrails.speedUp'),
          PALETTE.cyan,
          this.compact ? 12 : 18,
        )
      }
    }
  }

  // A trail as glowing spans between its vertices: a soft halo, the colored core and a bright center
  // line, plus a white-hot head for a rider still riding.
  private drawTrail(
    g: Phaser.GameObjects.Graphics,
    pts: readonly number[],
    color: number,
    hotHead: boolean,
  ): void {
    const c = this.arena.cell
    const halo = Math.max(1, Math.round(c * 0.05))
    const core = Math.max(1, Math.round(c * 0.22))
    const line = Math.max(1, Math.round(c * 0.4))
    g.fillStyle(color, 0.22)
    for (let i = 1; i < pts.length; i++) this.span(g, pts[i - 1] as number, pts[i] as number, -halo)
    g.fillStyle(shade(color, -0.2), 1)
    for (let i = 1; i < pts.length; i++) this.span(g, pts[i - 1] as number, pts[i] as number, core)
    g.fillStyle(shade(color, 0.45), 1)
    for (let i = 1; i < pts.length; i++) this.span(g, pts[i - 1] as number, pts[i] as number, line)
    if (!hotHead || pts.length === 0) return
    const { x, y } = this.cellCenter(pts[pts.length - 1] as number)
    g.fillStyle(0xffffff, 1)
    g.fillRect(
      Math.round(x - c * 0.3),
      Math.round(y - c * 0.3),
      Math.max(2, Math.round(c * 0.6)),
      Math.max(2, Math.round(c * 0.6)),
    )
  }

  // The cells from a to b (same row or column) as one rectangle, inset by `inset` px (negative grows).
  private span(g: Phaser.GameObjects.Graphics, a: number, b: number, inset: number): void {
    const { x, y, cell: c, cols } = this.arena
    const ax = a % cols
    const ay = Math.floor(a / cols)
    const bx = b % cols
    const by = Math.floor(b / cols)
    const x0 = Math.min(ax, bx)
    const y0 = Math.min(ay, by)
    const w = Math.abs(ax - bx) + 1
    const h = Math.abs(ay - by) + 1
    g.fillRect(x + x0 * c + inset, y + y0 * c + inset, w * c - inset * 2, h * c - inset * 2)
  }
}
