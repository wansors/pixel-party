import {
  HOP,
  HOP_CROSSED,
  HOP_DOWN,
  HOP_LEFT,
  HOP_RIGHT,
  HOP_SPLASHED,
  HOP_SQUASHED,
  HOP_UP,
  type HopBody,
  type HopKind,
  type HopLane,
  type HopMove,
  type HopperView,
  hopLaneTime,
  hopLeft,
  hopRun,
  hopSnap,
  PALETTE,
  type RoadHopSnapshot,
} from '@pp/shared'
import type Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { addBanner, burst, floatText, ring, shake, showBanner } from '../fx'
import { ServerClock } from '../netcode/ServerClock'
import {
  bodyStyle,
  ensurePixelBlock,
  fitFontSize,
  fitText,
  headlineStyle,
  shade,
} from '../pixelStyle'
import { YouMarker } from '../playerMarks'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const PENDING_TTL_MS = 2000
const HOP_ANIM_MS = 110
// Rivals' sounds are throttled to one per this long each (12 players stay readable).
const RIVAL_SFX_MS = 160
const GLYPH = ['▲', '▶', '▼', '◀'] as const

const ASPHALT = 0x2c2f3a
const WATER = 0x2a5fb0
const GRASS = 0x3f8a3a
const PAVEMENT = 0x8c90a0
const GLASS = 0x9ad8f0
const TYRE = 0x15161c

const CAR_COLORS = [0xe8463c, 0x3c7be8, 0xf2c230, 0xe4e6ee]
const SPORT_COLORS = [0xff7b3d, 0x8be94b, 0xff3e7f, 0x29d3f2]
const VAN_COLORS = [0xf0f0f4, 0x4a78c8, 0xb07840, 0xc84a4a]
const CAB_COLORS = [0x3c9a5a, 0xd84a3a, 0x3a6ad8, 0xe8a030]
const RAFT_COLORS = [0xff7b3d, 0xf2c230, 0xff3e7f, 0x8be94b]

interface Hopper {
  id: string
  avatar: AvatarSprite
  mine: boolean
  size: number
  // The cell it stands on (to tell a hop from a ride), and the hop animation's take-off.
  row: number
  x: number
  fromX: number
  fromY: number
  hopAt: number
  // Screen position before the hop lift (where the next hop takes off from).
  px: number
  py: number
  crossings: number
  deaths: number
  sfxAt: number
}

interface PendingHop {
  seq: number
  at: number
  dir: number
  sentAt: number
}

interface PadKey {
  img: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  y: number
}

interface Thing {
  lane: HopLane
  idx: number
  img: Phaser.GameObjects.Image
}

// Road Hop canvas (D48). One shared field, bottom to top: the pavement, five lanes of traffic, a grass
// verge, five lanes of river and the far bank. The traffic and the floats are a pure function of the
// round clock, drawn on the server's clock (ServerClock) — vehicles roll in from beyond the field's
// shaded edges. Every player is their avatar, hopping cell to cell (back view going up, side view
// sideways) with a little arc; your own hopper is predicted with the shared rules, so a hop shows on the
// frame you press it and carries that moment to the server. Rivals are translucent, carried forward
// from their last judged state. A squash flattens you, the river swallows you, the far bank cheers;
// then you blink back onto the pavement for another go. Controls: arrows / WASD (SPACE = up), the
// on-screen pad, or a tap beside your avatar.
export class RoadHopScene extends MiniGameScene<RoadHopSnapshot> {
  private field = { x: 0, y: 0, cell: 0 }
  private compact = false
  private readonly clock = new ServerClock()
  private base?: RoadHopSnapshot
  private pending: PendingHop[] = []
  private seq = 0
  private lastSentAt = -1e9
  private lastTick = -1
  private started = false
  private phase: 'ready' | 'go' = 'ready'
  private hoppers = new Map<string, Hopper>()
  private things: Thing[] = []
  private water?: Phaser.GameObjects.TileSprite
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private you?: YouMarker
  private readonly pad = new Map<number, PadKey>()
  private padKey = ''
  private padDownKey = ''
  private shownScore = -1

  constructor(...deps: SceneDeps) {
    super('road-hop', ...deps)
  }

  override create(): void {
    super.create()
    for (const h of this.hoppers.values()) h.avatar.destroy()
    this.hoppers = new Map()
    this.things = []
    this.pad.clear()
    this.clock.reset()
    this.base = undefined
    this.pending = []
    this.seq = 0
    this.lastSentAt = -1e9
    this.lastTick = -1
    this.started = false
    this.phase = 'ready'
    this.shownScore = -1

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    const pad = this.compact ? 8 : 16
    const hintH = this.compact ? 20 : 26
    const btn = Math.round(this.compact ? Math.max(48, Math.min(64, width * 0.15)) : 64)
    const gap = this.compact ? 6 : 8
    const padW = btn * 3 + gap * 2
    const padH = btn * 2 + gap
    const top = this.top + pad
    const bottom = height - hintH - pad
    let padX: number
    let padY: number
    if (height > width) {
      // Portrait: the field on top, the pad under it.
      const cell = Math.floor(
        Math.min((width - pad * 2) / HOP.cols, (bottom - top - padH - pad) / HOP.rows),
      )
      this.field = { x: Math.round((width - cell * HOP.cols) / 2), y: top, cell }
      padX = width / 2
      padY = (top + cell * HOP.rows + bottom) / 2
    } else {
      // Landscape: the field centred, the pad in the space to its right.
      const cell = Math.floor(
        Math.min((bottom - top) / HOP.rows, (width - padW - pad * 3) / HOP.cols),
      )
      const fw = cell * HOP.cols
      const fh = cell * HOP.rows
      const x = Math.round(Math.min((width - fw) / 2, width - pad * 2 - padW - fw))
      this.field = { x: Math.max(pad, x), y: Math.round(top + (bottom - top - fh) / 2), cell }
      padX = Math.min(width - pad - padW / 2, (this.field.x + fw + width) / 2)
      padY = this.field.y + fh - padH / 2
    }

    this.paintField()
    this.buildPad(padX, padY, btn, gap)
    this.you = new YouMarker(this, this.compact ? 10 : 14, 820)

    const hint = this.add
      .text(
        width / 2,
        height - hintH / 2,
        this.t(this.compact ? 'game.roadHop.hintShort' : 'game.roadHop.hint'),
        bodyStyle(this.compact ? 11 : 14, PALETTE.dim),
      )
      .setOrigin(0.5)
      .setDepth(60)
    fitText(hint, width - 16, this.compact ? 11 : 14)
    const midY = this.field.y + (HOP.rows * this.field.cell) / 2
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
      ['UP', HOP_UP],
      ['W', HOP_UP],
      ['SPACE', HOP_UP],
      ['RIGHT', HOP_RIGHT],
      ['D', HOP_RIGHT],
      ['DOWN', HOP_DOWN],
      ['S', HOP_DOWN],
      ['LEFT', HOP_LEFT],
      ['A', HOP_LEFT],
    ]
    for (const [key, dir] of keys) this.onKey(key, () => this.hop(dir))
    this.input.keyboard?.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,SPACE')
    // A tap on the field hops toward it (on your avatar: up).
    this.input.on(
      'pointerdown',
      (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (over.length > 0) return
        const me = this.hoppers.get(this.selfId)
        if (!me) return
        const dx = p.x - me.px
        const dy = p.y - me.py
        const near = this.field.cell * 0.6
        if (Math.abs(dx) < near && Math.abs(dy) < near) this.hop(HOP_UP)
        else if (Math.abs(dx) > Math.abs(dy)) this.hop(dx > 0 ? HOP_RIGHT : HOP_LEFT)
        else this.hop(dy < 0 ? HOP_UP : HOP_DOWN)
      },
    )
  }

  private rowTop(row: number): number {
    return this.field.y + (HOP.rows - 1 - row) * this.field.cell
  }

  // The field's ground, across the whole width (beyond the field it's shaded: out of bounds).
  private paintField(): void {
    const { width } = this.scale
    const { x, y, cell } = this.field
    const fw = cell * HOP.cols
    const fh = cell * HOP.rows
    const g = this.add.graphics().setDepth(0)
    const px = Math.max(2, Math.round(cell / 16))
    for (let row = 0; row < HOP.rows; row++) {
      const top = this.rowTop(row)
      if (row === HOP.goal || row === HOP.verge) {
        g.fillStyle(row === HOP.goal ? shade(GRASS, 0.08) : GRASS, 1).fillRect(0, top, width, cell)
        for (let i = 0; i * cell * 0.5 < width; i++) {
          const tx = Math.round(i * cell * 0.5 + ((i * 37) % 11) * px)
          const ty = top + Math.round((((i * 53) % 7) / 8) * (cell - 3 * px)) + px
          g.fillStyle(shade(GRASS, -0.25), 1).fillRect(tx, ty, px, 2 * px)
          g.fillRect(tx + 2 * px, ty + px, px, px)
          if (row === HOP.goal && i % 3 === 0) {
            g.fillStyle(i % 2 ? PALETTE.amber : PALETTE.magenta, 1)
            g.fillRect(tx + 5 * px, ty + px, 2 * px, 2 * px)
          }
        }
      } else if (row === 0) {
        g.fillStyle(PAVEMENT, 1).fillRect(0, top, width, cell)
        g.fillStyle(shade(PAVEMENT, -0.18), 1)
        for (let i = Math.floor(-x / cell); x + i * cell < width; i++)
          g.fillRect(x + i * cell, top, px, cell)
        g.fillRect(0, top + Math.round(cell / 2), width, px)
        // The kerb.
        g.fillStyle(shade(PAVEMENT, 0.3), 1).fillRect(0, top, width, 2 * px)
      } else if (row < HOP.verge) {
        g.fillStyle(ASPHALT, 1).fillRect(0, top, width, cell)
        if (row > 1) {
          // Dashed lines between the lanes.
          g.fillStyle(0xd8dce6, 0.7)
          const dash = Math.round(cell * 0.45)
          for (let dx = -(x % cell); dx < width; dx += cell)
            g.fillRect(Math.round(dx + cell * 0.27), top + cell - px, dash, 2 * px)
        }
      }
    }
    // Solid edge lines along the road.
    g.fillStyle(PALETTE.amber, 0.85)
    g.fillRect(0, this.rowTop(HOP.verge - 1), width, px)
    g.fillRect(0, this.rowTop(1) + cell - px, width, px)
    // The river: rippling water, with dark banks.
    const riverTop = this.rowTop(HOP.goal - 1)
    this.water = this.add
      .tileSprite(0, riverTop, width, cell * 5, this.waterTexture(px))
      .setOrigin(0, 0)
      .setDepth(0.5)
    const banks = this.add.graphics().setDepth(0.6)
    banks.fillStyle(shade(GRASS, -0.45), 1)
    banks.fillRect(0, riverTop, width, px)
    banks.fillRect(0, riverTop + cell * 5 - px, width, px)
    // Out of bounds: above, below and beside the field.
    const shadeG = this.add.graphics().setDepth(15)
    shadeG.fillStyle(PALETTE.bg, 0.45)
    shadeG.fillRect(0, y, x, fh)
    shadeG.fillRect(x + fw, y, width - x - fw, fh)
    shadeG.fillStyle(PALETTE.bg, 1)
    shadeG.fillRect(0, this.top, width, Math.max(0, y - this.top))
    shadeG.fillRect(0, y + fh, width, this.scale.height - y - fh)
    shadeG.lineStyle(2, PALETTE.frameLit, 1).strokeRect(x - 1, y - 1, fw + 2, fh + 2)
  }

  private waterTexture(px: number): string {
    const key = `rh-water-${px}`
    if (this.textures.exists(key)) return key
    const w = 32 * px
    const h = 16 * px
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(WATER, 1).fillRect(0, 0, w, h)
    g.fillStyle(shade(WATER, 0.28), 1)
    g.fillRect(3 * px, 3 * px, 6 * px, px)
    g.fillRect(19 * px, 9 * px, 7 * px, px)
    g.fillRect(10 * px, 13 * px, 4 * px, px)
    g.fillStyle(shade(WATER, -0.22), 1)
    g.fillRect(14 * px, 5 * px, 5 * px, px)
    g.fillRect(2 * px, 10 * px, 5 * px, px)
    g.generateTexture(key, w, h)
    g.destroy()
    return key
  }

  // A lane thing's top-down pixel art, facing right, 16 texture px per cell of length.
  private thingTexture(kind: HopKind, len: number, look: number): string {
    const key = `rh-${kind}-${len}-${look}`
    if (this.textures.exists(key)) return key
    const w = 16 * len
    const river = kind === 'log' || kind === 'raft'
    const h = river ? 14 : 12
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    const box = (c: number, x: number, y: number, bw: number, bh: number) =>
      g.fillStyle(c, 1).fillRect(x, y, bw, bh)
    const wheels = (xs: number[], ww = 3) => {
      for (const wx of xs) {
        box(TYRE, wx, 0, ww, 2)
        box(TYRE, wx, h - 2, ww, 2)
      }
    }
    const pick = (list: number[]) => list[look % list.length] as number
    if (kind === 'car' || kind === 'sport') {
      const c = pick(kind === 'car' ? CAR_COLORS : SPORT_COLORS)
      wheels([2, 11])
      box(shade(c, -0.5), 1, 1, 14, 10)
      box(c, 2, 2, 12, 8)
      box(shade(c, 0.3), 2, 2, 12, 1)
      if (kind === 'car') {
        box(shade(c, -0.15), 5, 3, 4, 6)
        box(GLASS, 9, 3, 2, 6)
        box(shade(GLASS, -0.3), 4, 3, 1, 6)
      } else {
        box(0xf4f4f8, 2, 5, 12, 2)
        box(GLASS, 8, 3, 2, 6)
        box(shade(c, -0.5), 1, 1, 2, 10)
      }
      box(PALETTE.amber, 14, 2, 1, 2)
      box(PALETTE.amber, 14, 8, 1, 2)
      box(PALETTE.red, 1, 2, 1, 2)
      box(PALETTE.red, 1, 8, 1, 2)
    } else if (kind === 'tractor') {
      const c = look % 2 ? 0xd84a3a : 0x3caa3c
      box(TYRE, 2, 0, 5, 3)
      box(TYRE, 2, h - 3, 5, 3)
      box(TYRE, 11, 1, 3, 2)
      box(TYRE, 11, h - 3, 3, 2)
      box(shade(c, -0.5), 3, 3, 12, 6)
      box(c, 4, 4, 10, 4)
      box(shade(c, 0.3), 9, 4, 5, 1)
      box(GLASS, 4, 4, 3, 4)
      box(0x30323c, 11, 5, 1, 2)
    } else if (kind === 'van') {
      const c = pick(VAN_COLORS)
      wheels([4, 23], 4)
      box(shade(c, -0.5), 1, 1, w - 2, 10)
      box(c, 2, 2, w - 4, 8)
      box(shade(c, 0.25), 2, 2, w - 4, 1)
      box(shade(c, -0.12), 8, 3, 1, 6)
      box(shade(c, -0.12), 15, 3, 1, 6)
      box(GLASS, w - 7, 3, 2, 6)
      box(PALETTE.amber, w - 2, 2, 1, 2)
      box(PALETTE.amber, w - 2, 8, 1, 2)
    } else if (kind === 'truck') {
      const c = pick(CAB_COLORS)
      wheels([4, 12, 26, 38], 4)
      box(0x6c7080, 1, 1, w - 14, 10)
      box(0xd8dce4, 2, 2, w - 16, 8)
      for (let rx = 6; rx < w - 14; rx += 4) box(0xb4b8c4, rx, 2, 1, 8)
      box(shade(c, -0.5), w - 12, 1, 11, 10)
      box(c, w - 11, 2, 9, 8)
      box(shade(c, 0.3), w - 11, 2, 9, 1)
      box(GLASS, w - 5, 3, 2, 6)
      box(PALETTE.amber, w - 2, 2, 1, 2)
      box(PALETTE.amber, w - 2, 8, 1, 2)
    } else if (kind === 'log') {
      box(0x4a2e16, 0, 1, w, 12)
      box(0x8a5a2e, 1, 2, w - 2, 10)
      box(0xa8743e, 1, 2, w - 2, 2)
      for (let bx = 3; bx < w - 4; bx += 5) {
        box(0x6e4622, bx, 6 + ((bx * 7) % 3), 3, 1)
        box(0x6e4622, bx + 2, 10, 2, 1)
      }
      for (const ex of [1, w - 4]) {
        box(0xc89a5a, ex, 3, 3, 8)
        box(0x8a5a2e, ex + 1, 6, 1, 2)
      }
    } else {
      const c = pick(RAFT_COLORS)
      box(shade(c, -0.5), 1, 0, w - 2, h)
      box(shade(c, -0.5), 0, 1, w, h - 2)
      box(c, 1, 1, w - 2, h - 2)
      box(shade(c, 0.35), 2, 1, w - 4, 1)
      box(shade(c, -0.3), 3, 3, w - 6, h - 6)
      for (let rx = 4; rx < w - 3; rx += 5) {
        box(0xf4f4f8, rx, 0, 1, 1)
        box(0xf4f4f8, rx, h - 1, 1, 1)
      }
    }
    g.generateTexture(key, w, h)
    g.destroy()
    return key
  }

  private buildThings(lanes: readonly HopLane[]): void {
    const { cell } = this.field
    for (const lane of lanes) {
      const cy = this.rowTop(lane.row) + cell / 2
      lane.things.forEach((th, idx) => {
        const img = this.add
          .image(0, cy, this.thingTexture(th.kind, th.len, th.look))
          .setOrigin(0, 0.5)
          .setDisplaySize(th.len * cell, cell * (lane.river ? 0.86 : 0.74))
          .setDepth(lane.river ? 8 : 10)
          .setFlipX(lane.dir < 0)
        this.things.push({ lane, idx, img })
      })
    }
  }

  private buildHoppers(snap: RoadHopSnapshot): void {
    const size = avatarPx(Math.max(this.compact ? 24 : 16, this.field.cell * 0.8))
    for (const [id, view] of Object.entries(snap.hoppers)) {
      const mine = id === this.selfId
      const avatar = new AvatarSprite(
        this,
        this.state.avatarOf(id),
        this.state.colorOf(id, PALETTE.lime),
        size,
        'back',
      )
      avatar.image.setDepth(mine ? 31 : 20).setAlpha(mine ? 1 : 0.6)
      this.hoppers.set(id, {
        id,
        avatar,
        mine,
        size,
        row: -1,
        x: 0,
        fromX: 0,
        fromY: 0,
        hopAt: -1e9,
        px: 0,
        py: 0,
        crossings: view.body.crossings,
        deaths: view.body.deaths,
        sfxAt: -1e9,
      })
    }
    this.warmAvatars(Object.keys(snap.hoppers), [
      ['back', 'idle', 0],
      ['front', 'idle', 0],
      ['side', 'idle', 0],
      ['front', 'ko', 0],
      ['front', 'happy', 0],
    ])
  }

  private buildPad(cx: number, cy: number, btn: number, gap: number): void {
    this.padKey = ensurePixelBlock(this, 'pp-hop-key', 16, PALETTE.panelAlt)
    this.padDownKey = ensurePixelBlock(this, 'pp-hop-key-down', 16, shade(PALETTE.panelAlt, -0.35))
    const step = btn + gap
    const top = cy - (btn * 2 + gap) / 2 + btn / 2
    const spots: [number, number, number][] = [
      [HOP_UP, cx, top],
      [HOP_LEFT, cx - step, top + step],
      [HOP_DOWN, cx, top + step],
      [HOP_RIGHT, cx + step, top + step],
    ]
    for (const [dir, x, y] of spots) {
      const img = this.add
        .image(x, y, this.padKey)
        .setDisplaySize(btn, btn)
        .setDepth(50)
        .setInteractive({ useHandCursor: true })
      img.on('pointerdown', () => this.hop(dir))
      const label = this.add
        .text(x, y, GLYPH[dir] as string, headlineStyle(this.compact ? 16 : 24, PALETTE.text))
        .setOrigin(0.5)
        .setDepth(51)
      this.pad.set(dir, { img, label, y })
    }
  }

  private pressKey(dir: number): void {
    const key = this.pad.get(dir)
    if (!key) return
    key.img.setTexture(this.padDownKey).setY(key.y + 2)
    key.label.setY(key.y + 2).setColor('#ffcf4b')
    this.time.delayedCall(90, () => {
      key.img.setTexture(this.padKey).setY(key.y)
      key.label.setY(key.y).setColor('#eef1f7')
    })
  }

  // Round ms at scene time `now`, on the server's clock (frozen once the round is over).
  private roundNow(now: number): number {
    const base = this.base
    if (!base) return 0
    const elapsed = this.state.final ? 0 : this.clock.since(base.remainingMs, now)
    return base.t + elapsed
  }

  // Your hops: the server's pending ones plus those it hasn't acknowledged yet.
  private myMoves(view: HopperView): HopMove[] {
    const mine = this.pending.filter((p) => p.seq > view.ack).map((p) => ({ at: p.at, dir: p.dir }))
    return mine.length ? [...view.moves, ...mine].sort((a, b) => a.at - b.at) : view.moves
  }

  private hop(dir: number): void {
    this.pressKey(dir)
    const base = this.base
    const view = base?.hoppers[this.selfId]
    if (!base || !view || this.state.final) return
    const now = this.time.now
    const rt = this.roundNow(now)
    if (rt < HOP.startDelayMs) return
    const at = hopSnap(rt)
    if (at - this.lastSentAt < HOP.minHopGapMs) return
    // Out of play (squashed, soaked or cheering on the bank): nothing to hop.
    const body: HopBody = { ...view.body }
    hopRun(body, Math.max(at, body.t), this.myMoves(view), base.lanes, view.home)
    if (body.waitUntil > at) return
    const seq = ++this.seq
    this.lastSentAt = at
    this.pending.push({ seq, at, dir, sentAt: now })
    this.sendInput({ kind: 'hop', dir, at, seq })
    this.sfx.step(seq % 2)
  }

  protected frame(snap: RoadHopSnapshot | null, time: number): void {
    if (!snap) return
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.onSnapshot(snap)
    }
    this.render(this.time.now, time)
  }

  private onSnapshot(snap: RoadHopSnapshot): void {
    if (this.things.length === 0) this.buildThings(snap.lanes)
    if (this.hoppers.size === 0) this.buildHoppers(snap)
    this.clock.sync(snap.remainingMs, this.time.now)
    const first = !this.started
    this.started = true
    this.base = snap
    const me = snap.hoppers[this.selfId]
    if (me) {
      const now = this.time.now
      this.pending = this.pending.filter((p) => p.seq > me.ack && now - p.sentAt < PENDING_TTL_MS)
      if (first) this.seq = Math.max(this.seq, me.ack)
    }
  }

  private render(now: number, time: number): void {
    const base = this.base
    if (!base) return
    const rt = this.roundNow(now)
    this.updatePhase(rt)
    const t = hopSnap(Math.max(0, rt))
    const lt = hopLaneTime(t)
    const { x: fx, cell } = this.field
    for (const th of this.things) {
      const thing = th.lane.things[th.idx]
      if (thing) th.img.setX(fx + hopLeft(th.lane, thing, lt) * cell)
    }
    if (this.water) this.water.tilePositionX = Math.round(Math.sin(time / 900) * cell * 0.15)
    for (const [id, h] of this.hoppers) {
      const view = base.hoppers[id]
      if (!view) continue
      const body: HopBody = { ...view.body }
      const moves = h.mine ? this.myMoves(view) : view.moves
      // Your own squash or splash shows the moment it happens; rivals wait for the server's word.
      hopRun(body, Math.max(t, body.t), moves, base.lanes, view.home, h.mine)
      this.place(h, body, t, now, time)
      this.moments(h, body)
    }
  }

  // Positions and poses one hopper from its run at round time `t`.
  private place(h: Hopper, body: HopBody, t: number, now: number, time: number): void {
    const { x: fx, cell } = this.field
    const tx = fx + body.x * cell
    const ty = this.rowTop(body.row) + cell / 2
    const moved = body.row !== h.row || Math.abs(body.x - h.x) > 0.6
    if (moved) {
      // A hop animates from where it took off; starting over just appears on the pavement.
      if (h.row >= 0 && Math.abs(body.row - h.row) <= 1 && Math.abs(body.x - h.x) <= 1.1) {
        h.fromX = h.px
        h.fromY = h.py
        h.hopAt = now
      } else h.hopAt = -1e9
      h.row = body.row
    }
    h.x = body.x
    let px = tx
    let py = ty
    let lift = 0
    const k = (now - h.hopAt) / HOP_ANIM_MS
    if (k < 1) {
      px = h.fromX + (tx - h.fromX) * k
      py = h.fromY + (ty - h.fromY) * k
      lift = Math.sin(k * Math.PI) * cell * 0.28
    }
    h.px = px
    h.py = py
    const img = h.avatar.image
    const size = h.size
    let alpha = h.mine ? 1 : 0.6
    let w = size
    let hh = size
    const out = body.waitUntil > 0
    if (out && body.last === HOP_SQUASHED) {
      h.avatar.faceMotion(0, 1).setExpression('ko')
      w = size * 1.2
      hh = size * 0.45
      py += size * 0.2
    } else if (out && body.last === HOP_SPLASHED) {
      h.avatar.setExpression('ko')
      const sink = Math.min(1, (t - body.lastAt) / 450)
      alpha *= 1 - sink
      w = size * (1 - sink * 0.5)
      hh = w
    } else if (out && body.last === HOP_CROSSED) {
      h.avatar.faceMotion(0, 1).setExpression('happy')
      lift = Math.abs(Math.sin(time / 110)) * cell * 0.18
    } else {
      h.avatar.setExpression('idle')
      const dirs: [number, number][] = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ]
      const [dx, dy] = dirs[body.dir] ?? [0, -1]
      h.avatar.faceMotion(dx, dy)
      // Blinks back in for a moment after starting over.
      const wait = body.last === HOP_CROSSED ? HOP.homeMs : HOP.respawnMs
      const since = t - (body.lastAt + wait)
      if (body.lastAt > 0 && since >= 0 && since < 450 && Math.floor(since / 75) % 2 === 1)
        alpha *= 0.25
    }
    img
      .setPosition(px, py - lift)
      .setDisplaySize(w, hh)
      .setAlpha(alpha)
    h.avatar.tick(time)
    if (h.mine) this.you?.place(px, py - lift - hh / 2 - 4, time)
  }

  // Crossings and mishaps since the last frame: a sound and a splash of colour each.
  private moments(h: Hopper, body: HopBody): void {
    const crossed = body.crossings > h.crossings
    const died = body.deaths > h.deaths
    h.crossings = body.crossings
    h.deaths = body.deaths
    if (!crossed && !died) return
    const color = this.state.colorOf(h.id, PALETTE.lime)
    const now = this.time.now
    const loud = h.mine
    const rivalSfx = !loud && now - h.sfxAt > RIVAL_SFX_MS
    if (rivalSfx) h.sfxAt = now
    const { px: x, py: y } = h
    const seed = `${h.id}:${body.deaths}`
    if (crossed) {
      burst(this, x, y, color, loud ? 16 : 8)
      if (loud) {
        this.sfx.coin()
        floatText(this, x, y - this.field.cell * 0.8, '+1', PALETTE.lime, this.compact ? 14 : 18)
      } else if (rivalSfx) this.sfx.quiet(() => this.sfx.coin(), 0.25)
      return
    }
    if (body.last === HOP_SPLASHED) {
      ring(this, x, y, shade(WATER, 0.5), this.field.cell * 0.7)
      burst(this, x, y, GLASS, loud ? 12 : 6, 160)
      if (loud) this.sfx.splash()
      else if (rivalSfx) this.sfx.quiet(() => this.sfx.splash(), 0.3)
    } else {
      burst(this, x, y, color, loud ? 14 : 7)
      if (loud) {
        this.sfx.crash()
        shake(this, 0.006, 140)
      } else if (rivalSfx) this.sfx.quiet(() => this.sfx.crash(), 0.3)
    }
    if (loud) {
      const pool = body.last === HOP_SPLASHED ? 'game.roadHop.splashed' : 'game.roadHop.squashed'
      floatText(
        this,
        x,
        y - this.field.cell * 0.8,
        this.quip(pool, seed),
        PALETTE.amber,
        this.compact ? 10 : 14,
      )
    }
  }

  // GET READY until GO; your crossings on the HUD.
  private updatePhase(rt: number): void {
    const me = this.hoppers.get(this.selfId)
    if (me && me.crossings !== this.shownScore) {
      this.shownScore = me.crossings
      this.hud?.setScore(this.t('game.roadHop.score', { n: me.crossings }))
    }
    if (this.phase !== 'ready') return
    const banner = this.banner
    if (rt < HOP.startDelayMs && !this.state.final) {
      if (banner && !banner.visible) {
        const text = this.t('game.roadHop.ready')
        banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
        showBanner(this, banner, text, PALETTE.amber)
        this.subline?.setText(this.t('game.roadHop.readySub')).setVisible(true)
        if (this.subline) fitText(this.subline, this.scale.width * 0.9, this.compact ? 8 : 16)
      }
      return
    }
    this.phase = 'go'
    banner?.setVisible(false)
    this.subline?.setVisible(false)
    if (rt < HOP.startDelayMs + 300) this.sfx.go()
  }
}
