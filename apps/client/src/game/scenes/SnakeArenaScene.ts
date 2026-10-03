import { type Cell, PALETTE, type SnakeSnapshot, type SnakeView } from '@pp/shared'
import type Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { addBanner, burst, flash, floatText, punch, shake, showBanner } from '../fx'
import {
  bodyStyle,
  ensurePixelGrid,
  fitFontSize,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

type Dir = 'up' | 'down' | 'left' | 'right'

const DEFAULT_GRID = 15
const SWIPE_MIN_PX = 16

// Snake head, 8x8 cells, facing right (rotated per heading): eyes on both flanks near the snout.
const HEAD_ROWS = [
  'oooooooo',
  'ohhhhhbo',
  'ohbbwkbo',
  'obbbbbbo',
  'obbbbbbo',
  'ohbbwkbo',
  'obbbbbbo',
  'oooooooo',
]

// Food: a round 8x8 apple with an outline + highlight under a stem and a leaf.
function appleRows(): string[] {
  const rows = ['___sl___', '___s____']
  const r = 4
  for (let y = 0; y < 8; y++) {
    let row = ''
    for (let x = 0; x < 8; x++) {
      const dx = x + 0.5 - r
      const dy = y + 0.5 - r
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > r) row += '_'
      else if (d > r - 1.1) row += 'o'
      else if (dx < -0.5 && dy < -0.5 && d < r * 0.75) row += 'h'
      else row += 'b'
    }
    rows.push(row)
  }
  return rows
}

// Best column count to fit `n` square tiles (plus a label row each) inside a w×h area.
function fitGrid(n: number, w: number, h: number, labelH: number, gap: number, max: number) {
  let best = { cols: 1, size: 0 }
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const size = Math.min(
      (w - (cols - 1) * gap) / cols,
      (h - (rows - 1) * gap) / rows - labelH,
      max,
    )
    if (size > best.size) best = { cols, size }
  }
  return best
}

interface Rival {
  id: string
  // Their avatar before the name (KO face once out).
  icon: Phaser.GameObjects.Image
  gfx: Phaser.GameObjects.Graphics
  out: Phaser.GameObjects.Text
  len: Phaser.GameObjects.Text
  x: number
  y: number
  size: number
  dead: boolean
}

// Snake Arena canvas (Phase 5). The server owns every player's independent board; this renders THIS
// player's board big (snake in their identity color with a heading-aware head, apple food) and every
// rival's board as a live mini-map in their colors. Grid movement needs no interpolation — boards are
// redrawn on each snapshot. Controls: arrow keys / WASD and swipe.
export class SnakeArenaScene extends MiniGameScene<SnakeSnapshot> {
  private boardGfx?: Phaser.GameObjects.Graphics
  private snakeGfx?: Phaser.GameObjects.Graphics
  private head?: Phaser.GameObjects.Image
  private tongue?: Phaser.GameObjects.Rectangle
  private food?: Phaser.GameObjects.Image
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private rivals: Rival[] = []
  private headKey = ''
  private deadHeadKey = ''
  private board = { x: 0, y: 0, size: 0 }
  private rivalArea = { x: 0, y: 0, w: 0, h: 0 }
  private cell = 0
  private grid = DEFAULT_GRID
  private lastTick = -1
  private lastLen = 0
  private alive = true
  private started = false
  private lastFood?: Cell
  private swipeStart?: { x: number; y: number }
  private selfColor = 0
  private compact = false

  constructor(...deps: SceneDeps) {
    super('snake-arena', ...deps)
  }

  override create(): void {
    super.create()
    this.rivals = []
    this.lastTick = -1
    this.lastLen = 0
    this.alive = true
    this.started = false
    this.lastFood = undefined
    this.swipeStart = undefined

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.selfColor = this.state.colorOf(this.selfId, PALETTE.lime)
    this.headKey = this.headTexture(this.selfColor)
    this.deadHeadKey = this.headTexture(PALETTE.frame)
    const foodKey = ensurePixelGrid(this, {
      key: 'pp-snake-apple',
      rows: appleRows(),
      legend: {
        o: shade(PALETTE.red, -0.55),
        b: PALETTE.red,
        h: shade(PALETTE.red, 0.45),
        s: 0x7a4a26,
        l: PALETTE.lime,
      },
    })

    // Layout: the own board takes the biggest square; rivals get a column (landscape) or the space
    // underneath (portrait). The hint sits along the bottom edge.
    // `pad` keeps the board's 6 px frame clear of the canvas edges.
    const hintH = this.compact ? 22 : 28
    const pad = this.compact ? 14 : 22
    const availTop = this.top + 8
    const availH = height - availTop - hintH - 6
    const landscape = width > height * 1.15
    if (landscape) {
      const rivalsW = Math.min(320, width * 0.28)
      const size = Math.min(availH, width - rivalsW - pad * 3)
      this.board = { x: pad + (width - rivalsW - pad * 2 - size) / 2, y: availTop, size }
      this.rivalArea = { x: width - rivalsW - pad, y: availTop, w: rivalsW, h: availH }
    } else {
      const size = Math.min(width - pad * 2, availH * 0.6)
      this.board = { x: (width - size) / 2, y: availTop, size }
      const ry = availTop + size + pad
      this.rivalArea = { x: pad, y: ry, w: width - pad * 2, h: height - hintH - ry }
    }
    this.boardGfx = this.add.graphics()
    this.snakeGfx = this.add.graphics().setDepth(10)
    this.layoutBoard(this.snap?.grid ?? DEFAULT_GRID)

    this.food = this.add.image(0, 0, foodKey).setDepth(9).setVisible(false)
    this.tongue = this.add.rectangle(0, 0, 1, 1, PALETTE.red).setDepth(10).setVisible(false)
    this.head = this.add.image(0, 0, this.headKey).setDepth(11).setVisible(false)

    this.add
      .text(
        width / 2,
        height - hintH / 2,
        this.t('game.snakeArena.hint'),
        bodyStyle(this.compact ? 11 : 14, PALETTE.dim),
      )
      .setOrigin(0.5)

    this.banner = addBanner(this)
    this.banner.setY(this.board.y + this.board.size / 2)
    this.subline = this.add
      .text(
        width / 2,
        this.board.y + this.board.size / 2 + (this.compact ? 34 : 46),
        '',
        headlineStyle(this.compact ? 8 : 16, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setDepth(950)
      .setVisible(false)

    const keys: [string, Dir][] = [
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
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.swipeStart = { x: p.x, y: p.y }
    })
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.endSwipe(p.x, p.y))
  }

  private headTexture(color: number): string {
    return ensurePixelGrid(this, {
      key: `pp-snake-head-${color.toString(16)}`,
      rows: HEAD_ROWS,
      legend: {
        o: shade(color, -0.6),
        h: shade(color, 0.35),
        b: color,
        w: PALETTE.text,
        k: PALETTE.bg,
      },
    })
  }

  // Static board: checkerboard floor inside a double arcade frame.
  private layoutBoard(grid: number): void {
    const g = this.boardGfx
    if (!g) return
    this.grid = grid
    this.cell = Math.floor(this.board.size / grid)
    const size = this.cell * grid
    this.board.x = Math.round(this.board.x + (this.board.size - size) / 2)
    this.board.size = size
    const { x, y } = this.board
    g.clear()
    g.fillStyle(PALETTE.frameLit, 1)
    g.fillRect(x - 6, y - 6, size + 12, size + 12)
    g.fillStyle(PALETTE.bg, 1)
    g.fillRect(x - 3, y - 3, size + 6, size + 6)
    for (let r = 0; r < grid; r++) {
      for (let c = 0; c < grid; c++) {
        g.fillStyle((r + c) % 2 === 0 ? PALETTE.panel : shade(PALETTE.panel, 0.06), 1)
        g.fillRect(x + c * this.cell, y + r * this.cell, this.cell, this.cell)
      }
    }
  }

  private turn(dir: Dir): void {
    this.sfx.click()
    this.sendInput({ kind: 'turn', dir })
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

  private cellCenter(c: Cell): { x: number; y: number } {
    return {
      x: this.board.x + c.x * this.cell + this.cell / 2,
      y: this.board.y + c.y * this.cell + this.cell / 2,
    }
  }

  protected frame(snap: SnakeSnapshot | null, time: number): void {
    // Idle life between snapshots: the apple bobs, the tongue flicks.
    if (this.food?.visible) {
      const base = this.cell * 0.8
      this.food.setDisplaySize(base, base * 1.25).setAngle(Math.sin(time / 240) * 8)
    }
    this.tongue?.setVisible(this.alive && this.head?.visible === true && time % 1400 < 220)
    if (!snap || this.state.tick === this.lastTick) return
    this.lastTick = this.state.tick
    if (snap.grid !== this.grid) this.layoutBoard(snap.grid)

    // The first snapshot of this (possibly restarted) scene only syncs state: no replayed events.
    const first = !this.started
    this.started = true
    const me = snap.snakes[this.selfId]
    const myFood = snap.food[this.selfId]
    // A spectator (joined mid-round) has no snake: just the rivals' boards.
    if (me) this.hud?.setScore(this.t('game.snakeArena.length', { n: me.len }))
    if (this.rivals.length === 0) this.buildRivals(snap)
    this.renderRivals(snap, first)

    if (me) this.trackEvents(me, first)
    if (me) this.renderSnake(me)
    if (myFood) {
      const { x, y } = this.cellCenter(myFood)
      this.food?.setPosition(x, y).setVisible(me?.alive !== false)
    }
    this.lastFood = myFood ? { ...myFood } : undefined
  }

  private trackEvents(me: SnakeView, first: boolean): void {
    if (first) {
      this.lastLen = me.len
      if (!me.alive) this.becomeOut(me, false)
      return
    }
    if (me.len > this.lastLen && this.lastFood) {
      const { x, y } = this.cellCenter(this.lastFood)
      this.sfx.coin()
      burst(this, x, y, PALETTE.red, 12, 180)
      floatText(this, x, y - this.cell / 2, `+${me.len - this.lastLen}`, PALETTE.lime, 16)
      if (this.head) punch(this, this.head, 0.3, 90)
    }
    this.lastLen = me.len
    if (this.alive && !me.alive) this.becomeOut(me, true)
  }

  private becomeOut(me: SnakeView, withFx: boolean): void {
    this.alive = false
    this.head?.setTexture(this.deadHeadKey)
    if (withFx) {
      this.sfx.wrong()
      shake(this, 0.012, 260)
      flash(this, PALETTE.red, 160)
      const first = me.body[0]
      if (first) {
        const { x, y } = this.cellCenter(first)
        burst(this, x, y, this.selfColor, 24, 260)
      }
      // The body crumbles: a puff of grey pixels along every few segments.
      me.body.forEach((c, i) => {
        if (i % 3 !== 1) return
        const { x, y } = this.cellCenter(c)
        this.time.delayedCall(i * 18, () => burst(this, x, y, PALETTE.dim, 5, 90))
      })
    }
    const banner = this.banner
    if (banner) {
      const text = this.t('game.common.out')
      banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
      showBanner(this, banner, text, PALETTE.red)
    }
    this.subline?.setText(this.t('game.common.waiting')).setVisible(true)
  }

  private renderSnake(me: SnakeView): void {
    const g = this.snakeGfx
    if (!g) return
    g.clear()
    const body = me.body
    const color = me.alive ? this.selfColor : PALETTE.frame
    const c = this.cell
    const pad = Math.max(1, Math.floor(c * 0.12))
    const { x: bx, y: by } = this.board
    // A continuous tube: fill the span between each pair of consecutive cells, then scale stripes.
    g.fillStyle(shade(color, -0.55), 1)
    for (let i = 1; i < body.length; i++) this.span(g, body[i - 1], body[i], pad - 1)
    g.fillStyle(color, 1)
    for (let i = 1; i < body.length; i++) this.span(g, body[i - 1], body[i], pad)
    body.forEach((cell, i) => {
      if (i === 0) return
      const x = bx + cell.x * c
      const y = by + cell.y * c
      if (i % 2 === 0) {
        g.fillStyle(shade(color, -0.25), 1)
        g.fillRect(x + c * 0.35, y + c * 0.35, c * 0.3, c * 0.3)
      }
      g.fillStyle(shade(color, 0.35), 1)
      g.fillRect(x + pad + 1, y + pad + 1, Math.max(2, c * 0.25), 2)
    })

    const head = body[0]
    const neck = body[1]
    if (!head || !this.head) return
    const { x, y } = this.cellCenter(head)
    const dx = neck ? head.x - neck.x : 1
    const dy = neck ? head.y - neck.y : 0
    const angle = dx > 0 ? 0 : dx < 0 ? 180 : dy > 0 ? 90 : -90
    const size = c - pad * 2 + 2
    this.head.setPosition(x, y).setDisplaySize(size, size).setAngle(angle).setVisible(true)
    const reach = size / 2 + 3
    this.tongue
      ?.setPosition(x + dx * reach, y + dy * reach)
      .setDisplaySize(dx !== 0 ? 6 : 2, dy !== 0 ? 6 : 2)
  }

  private span(g: Phaser.GameObjects.Graphics, a?: Cell, b?: Cell, inset = 0): void {
    if (!a || !b) return
    const c = this.cell
    const x0 = Math.min(a.x, b.x)
    const y0 = Math.min(a.y, b.y)
    const w = Math.abs(a.x - b.x) + 1
    const h = Math.abs(a.y - b.y) + 1
    g.fillRect(
      this.board.x + x0 * c + inset,
      this.board.y + y0 * c + inset,
      w * c - inset * 2,
      h * c - inset * 2,
    )
  }

  private buildRivals(snap: SnakeSnapshot): void {
    const ids = Object.keys(snap.snakes).filter((id) => id !== this.selfId)
    if (ids.length === 0) return
    const area = this.rivalArea
    const labelH = this.compact ? 14 : 22
    const gap = this.compact ? 8 : 12
    const { cols, size } = fitGrid(
      ids.length,
      area.w,
      area.h,
      labelH,
      gap,
      this.compact ? 110 : 150,
    )
    if (size < 24) return
    const rows = Math.ceil(ids.length / cols)
    const usedW = cols * size + (cols - 1) * gap
    const usedH = rows * (size + labelH) + (rows - 1) * gap
    const x0 = area.x + (area.w - usedW) / 2
    const y0 = area.y + Math.max(0, (area.h - usedH) / 2)
    const font = this.compact ? 10 : 12
    const pixelFont = this.compact ? 8 : 16
    ids.forEach((id, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = x0 + col * (size + gap)
      const y = y0 + row * (size + labelH + gap) + labelH
      const color = this.state.colorOf(id)
      const maxChars = Math.max(3, Math.floor((size * 0.7 - 19) / (font * 0.6)))
      const icon = this.add
        .image(x, y - 2, ensureAvatarTexture(this, this.state.avatarOf(id), color, 1))
        .setOrigin(0, 1)
      this.add
        .text(x + 19, y - 3, this.state.nameOf(id).slice(0, maxChars), bodyStyle(font, color))
        .setOrigin(0, 1)
      const len = this.add
        .text(x + size, y - 3, '', headlineStyle(pixelFont, PALETTE.text))
        .setOrigin(1, 1)
      this.add.rectangle(x - 2, y - 2, size + 4, size + 4, shade(color, -0.5)).setOrigin(0)
      const gfx = this.add.graphics()
      const out = this.add
        .text(
          x + size / 2,
          y + size / 2,
          this.t('game.common.out'),
          headlineStyle(pixelFont, PALETTE.red, {
            stroke: '#10121c',
            strokeThickness: 3,
          }),
        )
        .setOrigin(0.5)
        .setDepth(5)
        .setVisible(false)
      this.rivals.push({ id, icon, gfx, out, len, x, y, size, dead: false })
    })
  }

  private renderRivals(snap: SnakeSnapshot, first: boolean): void {
    for (const rival of this.rivals) {
      const view = snap.snakes[rival.id]
      if (!view) continue
      const g = rival.gfx
      const grid = snap.grid
      const cs = rival.size / grid
      const color = view.alive ? this.state.colorOf(rival.id) : PALETTE.frame
      g.clear()
      g.fillStyle(PALETTE.panel, 1)
      g.fillRect(rival.x, rival.y, rival.size, rival.size)
      const food = snap.food[rival.id]
      if (food && view.alive) {
        g.fillStyle(PALETTE.red, 1)
        g.fillRect(rival.x + food.x * cs, rival.y + food.y * cs, Math.max(2, cs), Math.max(2, cs))
      }
      view.body.forEach((c, i) => {
        g.fillStyle(i === 0 ? shade(color, 0.4) : color, 1)
        g.fillRect(rival.x + c.x * cs, rival.y + c.y * cs, Math.max(2, cs - 1), Math.max(2, cs - 1))
      })
      rival.len
        .setText(String(view.len))
        .setColor(hexToCss(view.alive ? PALETTE.text : PALETTE.dim))
      if (!view.alive && !rival.dead) {
        rival.dead = true
        rival.icon.setTexture(
          ensureAvatarTexture(
            this,
            this.state.avatarOf(rival.id),
            this.state.colorOf(rival.id),
            1,
            'front',
            'ko',
          ),
        )
        rival.out.setVisible(true)
        if (!first) {
          this.sfx.pop()
          punch(this, rival.out, 0.4, 120)
        }
      }
    }
  }
}
