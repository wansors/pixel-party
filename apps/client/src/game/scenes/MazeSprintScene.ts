import { type MazeSprintSnapshot, PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { AvatarSprite, avatarPx, ensureAvatarTexture } from '../avatars'
import { addBanner, burst, flash, floatText, punch, showBanner } from '../fx'
import {
  bodyStyle,
  ensurePixelBlock,
  ensurePixelGrid,
  fitFontSize,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { YouMarker } from '../playerMarks'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

type Dir = 'up' | 'down' | 'left' | 'right'

// Wall bits per cell, as in the wire contract: 1 = North, 2 = East, 4 = South, 8 = West.
const DIR_BIT: Record<Dir, number> = { up: 1, right: 2, down: 4, left: 8 }
const DIR_STEP: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}
const GLYPH: Record<Dir, string> = { up: '▲', down: '▼', left: '◀', right: '▶' }
const MOVE_MS = 90
// After our last key press, snapshots may not include that move yet: keep the local guess meanwhile.
const PREDICT_HOLD_MS = 150
// Walking pace, the same on every machine: a held key or pad button steps every STEP_MS after a first
// HOLD_DELAY_MS (the OS key repeat is ignored), and a press faster than that waits its turn. The server
// drops steps under 90 ms apart, so this pace never loses one.
const STEP_MS = 100
const HOLD_DELAY_MS = 220
// Rival progress bars: row height bounds (two columns when one doesn't fit a full room).
const BAR_ROW_MAX = 24
const BAR_ROW_MIN = 16

// Checkered finish flag on a pole, 8x10 cells.
const FLAG_ROWS = [
  'pkwkwk__',
  'pwkwkw__',
  'pkwkwk__',
  'pwkwkw__',
  'p_______',
  'p_______',
  'p_______',
  'p_______',
  'pp______',
  'ppp_____',
]

// A player in the maze: their lobby avatar, facing the way it last stepped.
interface Token {
  avatar: AvatarSprite
  img: Phaser.GameObjects.Image
  cell: number
  slot: number
  movedAt: number
}

interface PadKey {
  img: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  y: number
}

// One player's row in the progress panel: their avatar and name; the bar is drawn on a shared Graphics.
interface BarRow {
  icon: Phaser.GameObjects.Image
  name: Phaser.GameObjects.Text
}

// Maze Sprint canvas. Renders the ONE shared maze (identical for everyone, drawn once as chunky
// beveled walls) with your lobby avatar in it, the finish flag in the exit cell and a breadcrumb trail
// of where you have been. Rivals show as progress bars (steps left to the exit) beside the maze — their
// spots would give the path away — and step into the maze once you finish. Movement is
// server-validated: keys and the arcade D-pad just send an intent, at a fixed pace. A wall bump is
// predicted locally from the same wall data for instant feedback; the token itself only moves when the
// snapshot says so.
export class MazeSprintScene extends MiniGameScene<MazeSprintSnapshot> {
  private built = false
  private trail?: Phaser.GameObjects.Graphics
  private marker?: YouMarker
  private flag?: Phaser.GameObjects.Image
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private readonly tokens = new Map<string, Token>()
  private readonly pad = new Map<Dir, PadKey>()
  private readonly keys = new Map<Dir, Phaser.Input.Keyboard.Key[]>()
  private readonly barRows = new Map<string, BarRow>()
  private barsGfx?: Phaser.GameObjects.Graphics
  private barsKey = ''
  private panel = { x: 0, y: 0, w: 0, h: 0 }
  private padKey = ''
  private padDownKey = ''
  private area = { x: 0, y: 0, size: 0 }
  private cell = 0
  private gridSize = 9
  private walls: number[] = []
  private exitIndex = 0
  private visited = new Set<number>()
  private predicted = 0
  private lastMoveAt = Number.NEGATIVE_INFINITY
  // Pacing: the direction held (key or pad), a press waiting for the next step slot, and the slots.
  private heldDir?: Dir
  private padHeld?: Dir
  private queuedDir?: Dir
  private nextStepAt = 0
  private repeatAt = 0
  private lastTick = -1
  private done = false
  // Rivals' tokens are in the maze (after you finish, or when just watching).
  private revealed = false
  // Joined after the round started (not in its snapshot): watch only.
  private spectating = false
  private synced = false
  private finished = new Set<string>()
  private selfColor = 0
  private compact = false

  constructor(...deps: SceneDeps) {
    super('maze-sprint', ...deps)
  }

  override create(): void {
    super.create()
    this.built = false
    this.tokens.clear()
    this.pad.clear()
    this.keys.clear()
    this.barRows.clear()
    this.barsKey = ''
    this.visited = new Set()
    this.predicted = 0
    this.lastMoveAt = Number.NEGATIVE_INFINITY
    this.heldDir = undefined
    this.padHeld = undefined
    this.queuedDir = undefined
    this.nextStepAt = 0
    this.repeatAt = 0
    this.lastTick = -1
    this.done = false
    this.revealed = false
    this.spectating = false
    this.synced = false
    this.finished = new Set()

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.selfColor = this.state.colorOf(this.selfId, PALETTE.lime)
    const pad = this.compact ? 12 : 20
    const hintH = this.compact ? 20 : 26
    const btn = Math.round(this.compact ? Math.max(48, Math.min(64, width * 0.16)) : 64)
    const gap = this.compact ? 6 : 8
    const dpadW = btn * 3 + gap * 2
    const dpadH = btn * 2 + gap
    const landscape = width > height * 1.1
    let dpadX: number
    let dpadY: number
    if (landscape) {
      // Maze on the left; a column on the right with the rivals' bars over the D-pad.
      const colW = Math.max(dpadW, this.compact ? 160 : 260)
      const size = Math.min(height - this.top - hintH - pad * 2, width - colW - pad * 3)
      this.area = { x: pad + (width - colW - pad * 3 - size) / 2, y: this.top + pad, size }
      const colX = width - pad - colW
      dpadX = colX + colW / 2
      dpadY = this.area.y + size - dpadH / 2
      this.panel = { x: colX, y: this.area.y, w: colW, h: size - dpadH - pad }
    } else {
      // Maze on top, the rivals' bars under it, the D-pad at the bottom.
      const panelH = this.compact ? 6 * BAR_ROW_MIN : 6 * BAR_ROW_MAX
      const size = Math.min(width - pad * 2, height - this.top - hintH - dpadH - panelH - pad * 4)
      this.area = { x: (width - size) / 2, y: this.top + pad, size }
      this.panel = { x: pad, y: this.area.y + size + pad, w: width - pad * 2, h: panelH }
      dpadX = width / 2
      dpadY = (this.panel.y + panelH + height - hintH) / 2
    }
    this.buildPad(dpadX, dpadY, btn, gap)
    this.barsGfx = this.add.graphics()

    this.add
      .text(
        width / 2,
        height - hintH / 2,
        this.t('game.mazeSprint.hint'),
        bodyStyle(this.compact ? 11 : 14, PALETTE.dim),
      )
      .setOrigin(0.5)

    this.banner = addBanner(this)
    this.banner.setY(this.area.y + this.area.size / 2)
    this.subline = this.add
      .text(
        width / 2,
        this.area.y + this.area.size / 2 + (this.compact ? 34 : 46),
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
    for (const [key, dir] of keys) {
      this.onKey(key, () => this.press(dir))
      const held = this.input.keyboard?.addKey(key)
      if (held) this.keys.set(dir, [...(this.keys.get(dir) ?? []), held])
    }
    this.input.on('pointerup', () => {
      this.padHeld = undefined
    })
  }

  // Arcade D-pad: beveled keys with a pressed (darker, sunk) state, ≥ 48 px on phones.
  private buildPad(cx: number, cy: number, btn: number, gap: number): void {
    this.padKey = ensurePixelBlock(this, 'pp-maze-key', 16, PALETTE.panelAlt)
    this.padDownKey = ensurePixelBlock(this, 'pp-maze-key-down', 16, shade(PALETTE.panelAlt, -0.35))
    const step = btn + gap
    const top = cy - (btn * 2 + gap) / 2 + btn / 2
    const spots: [Dir, number, number][] = [
      ['up', cx, top],
      ['left', cx - step, top + step],
      ['down', cx, top + step],
      ['right', cx + step, top + step],
    ]
    for (const [dir, x, y] of spots) {
      const img = this.add
        .image(x, y, this.padKey)
        .setDisplaySize(btn, btn)
        .setInteractive({ useHandCursor: true })
      img.on('pointerdown', () => {
        this.padHeld = dir
        this.press(dir)
      })
      img.on('pointerout', () => {
        if (this.padHeld === dir) this.padHeld = undefined
      })
      const label = this.add
        .text(x, y, GLYPH[dir], headlineStyle(this.compact ? 16 : 24, PALETTE.text))
        .setOrigin(0.5)
      this.pad.set(dir, { img, label, y })
    }
  }

  private pressKey(dir: Dir): void {
    const key = this.pad.get(dir)
    if (!key) return
    key.img.setTexture(this.padDownKey).setY(key.y + 2)
    key.label.setY(key.y + 2).setColor('#ffcf4b')
    this.time.delayedCall(90, () => {
      key.img.setTexture(this.padKey).setY(key.y)
      key.label.setY(key.y).setColor('#eef1f7')
    })
  }

  // A key or pad press: step now if the pace allows, else as soon as it does; holding it repeats.
  private press(dir: Dir): void {
    this.pressKey(dir)
    if (this.spectating) return
    const now = this.time.now
    this.heldDir = dir
    this.repeatAt = now + HOLD_DELAY_MS
    if (now >= this.nextStepAt) this.move(dir)
    else this.queuedDir = dir
  }

  // Paced steps: a press that came early, then the held direction's repeats.
  private pace(now: number): void {
    const held = this.heldDir
    if (held && this.padHeld !== held && !this.keys.get(held)?.some((k) => k.isDown)) {
      this.heldDir = undefined
    }
    if (now < this.nextStepAt) return
    if (this.queuedDir) {
      this.move(this.queuedDir)
      this.queuedDir = undefined
    } else if (this.heldDir && now >= this.repeatAt) {
      this.pressKey(this.heldDir)
      this.move(this.heldDir)
    }
  }

  private move(dir: Dir): void {
    this.nextStepAt = this.time.now + STEP_MS
    this.sendInput({ kind: 'move', dir })
    if (!this.built || this.done) {
      this.sfx.click()
      return
    }
    const next = this.neighbor(this.predicted, dir)
    this.lastMoveAt = this.time.now
    if (next === null) {
      this.sfx.tick()
      this.bump(dir)
      return
    }
    this.sfx.click()
    this.predicted = next
  }

  // The cell one step from `from` in `dir`, or null if a wall (or the maze edge) blocks it.
  private neighbor(from: number, dir: Dir): number | null {
    if ((this.walls[from] ?? 15) & DIR_BIT[dir]) return null
    const { dx, dy } = DIR_STEP[dir]
    const col = (from % this.gridSize) + dx
    const row = Math.floor(from / this.gridSize) + dy
    if (col < 0 || row < 0 || col >= this.gridSize || row >= this.gridSize) return null
    return row * this.gridSize + col
  }

  // Wall bump: the own token nudges into the wall and springs back.
  private bump(dir: Dir): void {
    const token = this.tokens.get(this.selfId)
    if (!token) return
    const { x, y } = this.tokenPos(token.cell, 0)
    const { dx, dy } = DIR_STEP[dir]
    this.tweens.killTweensOf(token.img)
    token.img.setPosition(x, y)
    this.tweens.add({
      targets: token.img,
      x: x + dx * this.cell * 0.18,
      y: y + dy * this.cell * 0.18,
      duration: 50,
      yoyo: true,
    })
  }

  private build(snap: MazeSprintSnapshot): void {
    this.gridSize = snap.size
    this.walls = [...snap.walls]
    this.exitIndex = snap.exitIndex
    this.cell = Math.floor(this.area.size / snap.size)
    const size = this.cell * snap.size
    this.area.x = Math.round(this.area.x + (this.area.size - size) / 2)
    this.area.size = size
    const { x: ax, y: ay } = this.area
    const c = this.cell
    const g = this.add.graphics()

    // Floor: a subtle checkerboard, the start cell tinted lime, the exit cell amber.
    g.fillStyle(PALETTE.bg, 1)
    g.fillRect(ax - 6, ay - 6, size + 12, size + 12)
    for (let i = 0; i < snap.size * snap.size; i++) {
      const col = i % snap.size
      const row = Math.floor(i / snap.size)
      const tint =
        i === 0
          ? shade(PALETTE.lime, -0.7)
          : i === snap.exitIndex
            ? shade(PALETTE.amber, -0.6)
            : (row + col) % 2 === 0
              ? PALETTE.panel
              : shade(PALETTE.panel, 0.05)
      g.fillStyle(tint, 1)
      g.fillRect(ax + col * c, ay + row * c, c, c)
    }

    // Walls: chunky bars with a drop shadow and a lit top edge, drawn in two passes.
    const wt = Math.max(3, Math.round(c * 0.14))
    const bars: [number, number, number, number][] = []
    for (let i = 0; i < snap.walls.length; i++) {
      const mask = snap.walls[i] ?? 0
      const x0 = ax + (i % snap.size) * c
      const y0 = ay + Math.floor(i / snap.size) * c
      if (mask & 1) bars.push([x0 - wt / 2, y0 - wt / 2, c + wt, wt])
      if (mask & 4) bars.push([x0 - wt / 2, y0 + c - wt / 2, c + wt, wt])
      if (mask & 8) bars.push([x0 - wt / 2, y0 - wt / 2, wt, c + wt])
      if (mask & 2) bars.push([x0 + c - wt / 2, y0 - wt / 2, wt, c + wt])
    }
    g.fillStyle(0x000000, 0.45)
    for (const [x, y, w, h] of bars) g.fillRect(x + 2, y + 3, w, h)
    g.fillStyle(PALETTE.frameLit, 1)
    for (const [x, y, w, h] of bars) g.fillRect(x, y, w, h)
    g.fillStyle(shade(PALETTE.frameLit, 0.35), 1)
    for (const [x, y, w] of bars) g.fillRect(x, y, w, Math.max(1, Math.floor(wt / 3)))

    this.trail = this.add.graphics().setDepth(5)
    const exit = this.cellCenter(snap.exitIndex)
    const glow = this.add.rectangle(exit.x, exit.y, c - wt, c - wt, PALETTE.amber, 0.25).setDepth(4)
    this.tweens.add({ targets: glow, alpha: 0.05, duration: 600, yoyo: true, repeat: -1 })
    const flagKey = ensurePixelGrid(this, {
      key: 'pp-maze-flag',
      rows: FLAG_ROWS,
      legend: { p: PALETTE.amber, k: PALETTE.bg, w: PALETTE.text },
    })
    this.flag = this.add
      .image(exit.x + c * 0.08, exit.y, flagKey)
      .setDisplaySize(c * 0.5, c * 0.62)
      .setDepth(6)
    this.marker = new YouMarker(this, c < 40 ? 8 : 12, 25)
    this.built = true
  }

  private cellCenter(index: number): { x: number; y: number } {
    const col = index % this.gridSize
    const row = Math.floor(index / this.gridSize)
    return {
      x: this.area.x + col * this.cell + this.cell / 2,
      y: this.area.y + row * this.cell + this.cell / 2,
    }
  }

  // Rivals sharing a cell fan out into its corners (slot 1..4); the own token (slot 0) stays centred.
  private tokenPos(cell: number, slot: number): { x: number; y: number } {
    const { x, y } = this.cellCenter(cell)
    if (slot === 0) return { x, y }
    const k = this.cell * 0.2
    const corner = (slot - 1) % 4
    return { x: x + (corner % 2 === 0 ? -k : k), y: y + (corner < 2 ? -k : k) }
  }

  protected frame(snap: MazeSprintSnapshot | null, time: number): void {
    if (!snap) return
    if (!this.built) this.build(snap)
    this.pace(this.time.now)
    this.flag?.setAngle(Math.sin(time / 300) * 4)
    for (const [id, token] of this.tokens) {
      token.avatar
        .walk(time - token.movedAt < MOVE_MS, time, MOVE_MS / 2)
        .setExpression(this.finished.has(id) ? 'happy' : 'idle')
        .tick(time)
    }
    const mine = this.tokens.get(this.selfId)
    if (mine) this.marker?.place(mine.img.x, mine.img.y - mine.img.displayHeight / 2, time)
    if (this.state.tick === this.lastTick) return
    this.lastTick = this.state.tick
    if (!this.synced) {
      // Watching a race you're not in: there's nothing to hide.
      this.spectating = !(this.selfId in snap.pos)
      this.revealed = this.spectating
      for (const key of this.spectating ? this.pad.values() : []) {
        key.img.setVisible(false)
        key.label.setVisible(false)
      }
    }
    if (!this.spectating) {
      this.hud?.setScore(this.t('game.mazeSprint.steps', { n: snap.progress[this.selfId] ?? 0 }))
    }
    this.trackFinishes(snap)
    this.syncTokens(snap)
    this.renderBars(snap)
  }

  private syncTokens(snap: MazeSprintSnapshot): void {
    const mySnapPos = snap.pos[this.selfId]
    if (mySnapPos !== undefined && this.time.now - this.lastMoveAt > PREDICT_HOLD_MS) {
      this.predicted = mySnapPos
    }
    const others = Object.keys(snap.pos).filter((id) => id !== this.selfId)
    const ids = this.selfId in snap.pos ? [...others, this.selfId] : others
    ids.forEach((id, i) => {
      const cell = snap.pos[id] ?? 0
      const mine = id === this.selfId
      // While you race, rivals stay off the maze (their spots would show you the way).
      if (!mine && !this.revealed) return
      const slot = mine ? 0 : (i % 4) + 1
      let token = this.tokens.get(id)
      if (!token) {
        const d = avatarPx(Math.max(16, this.cell * (mine ? 0.8 : 0.5)))
        const { x, y } = this.tokenPos(cell, slot)
        const avatar = new AvatarSprite(this, this.state.avatarOf(id), this.state.colorOf(id), d)
        avatar.image
          .setPosition(x, y)
          .setAlpha(mine ? 1 : 0.85)
          .setDepth(mine ? 20 : 15)
        token = { avatar, img: avatar.image, cell, slot, movedAt: Number.NEGATIVE_INFINITY }
        this.tokens.set(id, token)
        if (mine) this.markVisited(cell)
        return
      }
      if (token.cell === cell) return
      const from = this.cellCenter(token.cell)
      const to = this.cellCenter(cell)
      token.avatar.faceMotion(to.x - from.x, to.y - from.y, 0)
      token.movedAt = this.time.now
      token.cell = cell
      const { x, y } = this.tokenPos(cell, slot)
      this.tweens.killTweensOf(token.img)
      this.tweens.add({ targets: token.img, x, y, duration: MOVE_MS, ease: 'Quad.easeOut' })
      if (mine) this.markVisited(cell)
    })
  }

  // Breadcrumbs: a small dot in the player's color on every cell they have stepped on.
  private markVisited(cell: number): void {
    if (this.visited.has(cell) || !this.trail) return
    this.visited.add(cell)
    const { x, y } = this.cellCenter(cell)
    const s = Math.max(3, Math.round(this.cell * 0.12))
    this.trail.fillStyle(this.selfColor, 0.35)
    this.trail.fillRect(x - s / 2, y - s / 2, s, s)
  }

  private trackFinishes(snap: MazeSprintSnapshot): void {
    const exit = this.cellCenter(this.exitIndex)
    const finishers = Object.entries(snap.doneAt)
      .filter(([, at]) => at > 0)
      .sort((a, b) => a[1] - b[1])
    const first = !this.synced
    this.synced = true
    finishers.forEach(([id], i) => {
      if (this.finished.has(id)) return
      this.finished.add(id)
      if (id === this.selfId) {
        this.done = true
        this.revealed = true
        this.onFinish(i + 1, !first)
      } else if (!first) {
        this.sfx.pop()
        burst(this, exit.x, exit.y, this.state.colorOf(id), 12, 160)
      }
    })
  }

  // Everyone's progress as bars (steps done out of the start's distance to the exit), finishers first,
  // then whoever is closest. One column, or two when a full room wouldn't fit the panel.
  private renderBars(snap: MazeSprintSnapshot): void {
    const g = this.barsGfx
    if (!g || snap.startDist <= 0) return
    const ids = Object.keys(snap.pos).sort((a, b) => {
      const da = snap.doneAt[a] ?? 0
      const db = snap.doneAt[b] ?? 0
      if (da > 0 !== db > 0) return da > 0 ? -1 : 1
      return da > 0 ? da - db : (snap.dist[a] ?? 0) - (snap.dist[b] ?? 0)
    })
    const key = ids.map((id) => `${id}:${snap.dist[id]}:${snap.doneAt[id]}`).join('|')
    if (key === this.barsKey) return
    this.barsKey = key
    const { x, y, w, h } = this.panel
    const cols = h / ids.length >= BAR_ROW_MIN || w < 300 ? 1 : 2
    const perCol = Math.ceil(ids.length / cols)
    const rowH = Math.max(10, Math.min(BAR_ROW_MAX, Math.floor(h / perCol)))
    const gap = 12
    const colW = (w - gap * (cols - 1)) / cols
    const icon = Math.min(16, rowH - 2)
    const nameW = Math.min(colW * 0.35, 96)
    const font = Math.max(8, Math.min(this.compact ? 11 : 13, rowH - 6))
    g.clear()
    ids.forEach((id, i) => {
      const rx = x + Math.floor(i / perCol) * (colW + gap)
      const cy = y + (i % perCol) * rowH + rowH / 2
      const color = this.state.colorOf(id)
      const done = (snap.doneAt[id] ?? 0) > 0
      let row = this.barRows.get(id)
      if (!row) {
        row = {
          icon: this.add.image(0, 0, ensureAvatarTexture(this, this.state.avatarOf(id), color, 1)),
          name: this.add
            .text(0, 0, '', bodyStyle(font, color, { fontStyle: 'bold' }))
            .setOrigin(0, 0.5),
        }
        this.barRows.set(id, row)
      }
      row.icon
        .setTexture(
          ensureAvatarTexture(
            this,
            this.state.avatarOf(id),
            color,
            1,
            'front',
            done ? 'happy' : 'idle',
          ),
        )
        .setDisplaySize(icon, icon)
        .setPosition(rx + icon / 2, cy)
      const label = `${done ? '★' : ''}${this.label(id)}`
      row.name
        .setFontSize(font)
        .setText(label)
        .setColor(hexToCss(id === this.selfId ? PALETTE.amber : color))
      for (let n = label.length - 1; n > 2 && row.name.width > nameW; n--) {
        row.name.setText(`${label.slice(0, n)}…`)
      }
      row.name.setPosition(rx + icon + 4, cy)
      const bx = rx + icon + 8 + nameW
      const bw = Math.max(8, colW - (bx - rx))
      const bh = Math.max(4, Math.round(rowH * 0.45))
      const progress = done ? 1 : 1 - (snap.dist[id] ?? snap.startDist) / snap.startDist
      g.fillStyle(PALETTE.panelAlt, 1)
      g.fillRect(bx, cy - bh / 2, bw, bh)
      g.fillStyle(done ? PALETTE.amber : color, 1)
      g.fillRect(bx, cy - bh / 2, Math.round(bw * Math.max(0, Math.min(1, progress))), bh)
    })
  }

  private onFinish(place: number, withFx: boolean): void {
    const exit = this.cellCenter(this.exitIndex)
    if (withFx) {
      this.sfx.coin()
      burst(this, exit.x, exit.y, PALETTE.amber, 24, 280)
      burst(this, exit.x, exit.y, this.selfColor, 18, 220)
      flash(this, PALETTE.lime, 140)
      floatText(this, exit.x, exit.y - this.cell * 0.4, `#${place}`, PALETTE.amber, 24)
      const token = this.tokens.get(this.selfId)
      if (token) punch(this, token.img, 0.4, 140)
    }
    const banner = this.banner
    if (banner) {
      const text = this.t('game.common.finished')
      banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
      showBanner(this, banner, text, PALETTE.lime)
    }
    this.subline?.setText(this.t('game.common.waiting')).setVisible(true)
  }
}
