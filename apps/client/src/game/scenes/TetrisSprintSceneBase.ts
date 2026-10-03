import { type MiniGameId, PALETTE, type TetrisBoard, type TetrisSprintSnapshot } from '@pp/shared'
import type Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { addBanner, burst, flash, floatText, shake, showBanner } from '../fx'
import {
  bodyStyle,
  ensurePixelBlock,
  ensurePixelGrid,
  ensurePixelOrb,
  fitFontSize,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

type Action = 'left' | 'right' | 'rotate' | 'drop'

// Board values 1..4 are tetrisCore's SHAPES colors (I, O, T, S) — classic hues so pieces read at a
// glance. Topped-out boards turn to DEAD row by row.
const PIECE_COLORS: Record<number, number> = {
  1: PALETTE.cyan,
  2: PALETTE.amber,
  3: 0xb06bff,
  4: PALETTE.lime,
}
const DEAD = 9
const TOPPLE_ROW_MS = 45
const MAX_RIVALS = 9
const CLEAR_WORDS = ['', '', 'game.common.nice', 'game.common.great', 'game.common.perfect']

function kebabToCamel(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

// Clockwise "rotate" arrow, 12x12 (the ⟳ glyph isn't in the pixel font): a ring with a gap at the top
// right and an arrowhead pointing clockwise at the gap's end.
function rotateIconRows(): string[] {
  const inTri = (px: number, py: number, t: [number, number][]): boolean => {
    const [a, b, c] = t as [[number, number], [number, number], [number, number]]
    const s = (p: [number, number], q: [number, number], r: [number, number]): number =>
      (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
    const d1 = s([px, py], a, b)
    const d2 = s([px, py], b, c)
    const d3 = s([px, py], c, a)
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
  }
  const head: [number, number][] = [
    [6.2, 0],
    [6.2, 4.6],
    [9, 2.3],
  ]
  const rows: string[] = []
  for (let y = 0; y < 12; y++) {
    let row = ''
    for (let x = 0; x < 12; x++) {
      const dx = x + 0.5 - 6
      const dy = y + 0.5 - 6.4
      const d = Math.hypot(dx, dy)
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI
      const onRing = d >= 3 && d < 4.8 && !(deg > -88 && deg < -20)
      row += onRing || inTri(x + 0.5, y + 0.5, head) ? 'k' : '_'
    }
    rows.push(row)
  }
  return rows
}

interface ArcadeButton {
  orb: Phaser.GameObjects.Image
  icon: Phaser.GameObjects.Image | Phaser.GameObjects.Text
  y: number
  upKey: string
  downKey: string
}

interface RivalRow {
  // The rival's avatar (KO face once topped out).
  pip: Phaser.GameObjects.Image
  name: Phaser.GameObjects.Text
  lines: Phaser.GameObjects.Text
}

// Shared canvas for the two Tetris-style sprint games (line-clear-sprint, quick-tetris): both render
// only THIS player's own board (server-owned, falling piece already baked into `grid`) inside an arcade
// well, with a rivals' lines panel (and quick-tetris' target meter) beside it, and send move / rotate /
// drop inputs from the keyboard or four arcade buttons. Line clears, top-outs and finishing are derived
// from snapshot deltas. Subclasses only pick the scene key (=== mini-game id), which also names the
// i18n namespace.
export abstract class TetrisSprintSceneBase extends MiniGameScene<TetrisSprintSnapshot> {
  private readonly i18nNs: string
  private cells: Phaser.GameObjects.Image[] = []
  private cellPx = 0
  private well = { x: 0, y: 0, cell: 0, cols: 0, rows: 0 }
  private built = false
  private flashGfx?: Phaser.GameObjects.Graphics
  private meter?: Phaser.GameObjects.Graphics
  private meterRect = { x: 0, y: 0, w: 0, h: 0 }
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private readonly buttons = new Map<Action, ArcadeButton>()
  private rivalRows: RivalRow[] = []
  private rivalsKey = ''
  private prevGrid: number[] = []
  private lastTick = -1
  private lastLines = 0
  private toppedAt = 0
  private synced = false
  private wasTopped = false
  private wasDone = false
  private compact = false
  private controlsTop = 0

  constructor(sceneKey: MiniGameId, ...deps: SceneDeps) {
    super(sceneKey, ...deps)
    this.i18nNs = kebabToCamel(sceneKey)
  }

  override create(): void {
    super.create()
    this.built = false
    this.cells = []
    this.cellPx = 0
    this.buttons.clear()
    this.rivalRows = []
    this.rivalsKey = ''
    this.prevGrid = []
    this.lastTick = -1
    this.lastLines = 0
    this.toppedAt = 0
    this.synced = false
    this.wasTopped = false
    this.wasDone = false

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.buildButtons(width, height)

    this.banner = addBanner(this)
    this.subline = this.add
      .text(
        width / 2,
        0,
        '',
        headlineStyle(this.compact ? 8 : 16, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
          align: 'center',
        }),
      )
      .setOrigin(0.5)
      .setDepth(950)
      .setVisible(false)

    const bind: [string, Action][] = [
      ['LEFT', 'left'],
      ['RIGHT', 'right'],
      ['DOWN', 'drop'],
      ['SPACE', 'drop'],
      ['UP', 'rotate'],
    ]
    // Holding ◀ ▶ slides the piece; drop and rotate fire once per press (a held key would otherwise
    // hard-drop every repeat and top the board out).
    for (const [key, action] of bind) {
      this.onKey(key, () => this.act(action), { repeat: action === 'left' || action === 'right' })
    }
  }

  // Four round arcade buttons along the bottom: ◀ ▶ on the left, rotate + drop on the right.
  private buildButtons(width: number, height: number): void {
    const gap = this.compact ? 8 : 12
    const size = Math.round(this.compact ? Math.max(48, Math.min(72, (width - gap * 5) / 4.6)) : 64)
    const hintH = this.compact ? 0 : 26
    const y = height - hintH - size / 2 - (this.compact ? 10 : 8)
    this.controlsTop = y - size / 2 - 6
    const offset = Math.min(width * 0.25, 210)
    const pairGap = size / 2 + gap / 2
    const rotateKey = ensurePixelGrid(this, {
      key: 'pp-tetris-rotate-icon',
      rows: rotateIconRows(),
      legend: { k: PALETTE.bg },
    })
    const spots: [Action, number, number, string][] = [
      ['left', width / 2 - offset - pairGap, PALETTE.cyan, '◀'],
      ['right', width / 2 - offset + pairGap, PALETTE.cyan, '▶'],
      ['rotate', width / 2 + offset - pairGap, PALETTE.amber, ''],
      ['drop', width / 2 + offset + pairGap, PALETTE.magenta, '▼'],
    ]
    for (const [action, x, color, glyph] of spots) {
      const upKey = ensurePixelOrb(this, `pp-tetris-btn-${color.toString(16)}`, 16, color)
      const downKey = ensurePixelOrb(
        this,
        `pp-tetris-btn-${color.toString(16)}-down`,
        16,
        shade(color, -0.3),
      )
      this.add.ellipse(x, y + size * 0.42, size * 0.95, size * 0.26, 0x000000).setAlpha(0.4)
      const orb = this.add
        .image(x, y, upKey)
        .setDisplaySize(size, size)
        .setInteractive({ useHandCursor: true })
      orb.on('pointerdown', () => this.act(action))
      const icon = glyph
        ? this.add
            .text(x, y, glyph, headlineStyle(this.compact ? 16 : 24, PALETTE.bg))
            .setOrigin(0.5)
        : this.add.image(x, y, rotateKey).setDisplaySize(size * 0.44, size * 0.44)
      this.buttons.set(action, { orb, icon, y, upKey, downKey })
    }
    if (hintH > 0) {
      this.add
        .text(width / 2, height - hintH / 2, this.t(`game.${this.i18nNs}.hint`), bodyStyle(14))
        .setOrigin(0.5)
    }
  }

  private act(action: Action): void {
    this.sfx.click()
    if (action === 'rotate') this.sendInput({ kind: 'rotate' })
    else if (action === 'drop') this.sendInput({ kind: 'drop' })
    else this.sendInput({ kind: 'move', dir: action })
    if (action === 'drop') shake(this, 0.003, 70)
    const btn = this.buttons.get(action)
    if (!btn) return
    btn.orb.setTexture(btn.downKey).setY(btn.y + 3)
    btn.icon.setY(btn.y + 3)
    this.time.delayedCall(90, () => {
      btn.orb.setTexture(btn.upKey).setY(btn.y)
      btn.icon.setY(btn.y)
    })
  }

  private build(snap: TetrisSprintSnapshot): void {
    const { width } = this.scale
    const pad = this.compact ? 10 : 20
    const gap = this.compact ? 8 : 16
    const frame = 6
    const quick = snap.targetLines !== undefined
    const meterW = quick ? (this.compact ? 12 : 18) : 0
    const panelW = this.compact ? 100 : 200
    const availH = this.controlsTop - this.top - pad * 2 - frame * 2
    const availW = width - pad * 2 - frame * 2 - panelW - gap - (quick ? meterW + gap : 0)
    const cell = Math.max(8, Math.floor(Math.min(availH / snap.rows, availW / snap.cols, 48)))
    const boardW = cell * snap.cols
    const boardH = cell * snap.rows
    const groupW = boardW + frame * 2 + gap + (quick ? meterW + gap : 0) + panelW
    const x = Math.round((width - groupW) / 2 + frame)
    const y = Math.round(this.top + pad + frame + (availH - boardH) / 2)
    this.well = { x, y, cell, cols: snap.cols, rows: snap.rows }

    // Arcade well: beveled frame (lit top-left, shaded bottom-right) around a dotted dark floor.
    const g = this.add.graphics()
    g.fillStyle(shade(PALETTE.frame, -0.4), 1)
    g.fillRect(x - frame, y - frame, boardW + frame * 2, boardH + frame * 2)
    g.fillStyle(PALETTE.frameLit, 1)
    g.fillRect(x - frame, y - frame, boardW + frame, boardH + frame)
    g.fillStyle(PALETTE.frame, 1)
    g.fillRect(x - frame + 2, y - frame + 2, boardW + frame * 2 - 4, boardH + frame * 2 - 4)
    g.fillStyle(PALETTE.bg, 1)
    g.fillRect(x, y, boardW, boardH)
    g.fillStyle(PALETTE.panelAlt, 1)
    for (let r = 1; r < snap.rows; r++) {
      for (let c = 1; c < snap.cols; c++) g.fillRect(x + c * cell - 1, y + r * cell - 1, 2, 2)
    }

    this.cellPx = Math.max(6, cell - 2)
    for (const [value, color] of Object.entries(PIECE_COLORS)) {
      ensurePixelBlock(this, this.blockKey(Number(value)), this.cellPx, color)
    }
    ensurePixelBlock(this, this.blockKey(DEAD), this.cellPx, PALETTE.frame)
    for (let r = 0; r < snap.rows; r++) {
      for (let c = 0; c < snap.cols; c++) {
        this.cells.push(
          this.add
            .image(x + c * cell + cell / 2, y + r * cell + cell / 2, this.blockKey(1))
            .setVisible(false),
        )
      }
    }
    this.flashGfx = this.add.graphics().setDepth(20)

    let px = x + boardW + frame + gap
    if (quick) {
      this.meterRect = { x: px, y, w: meterW, h: boardH }
      this.meter = this.add.graphics()
      px += meterW + gap
    }
    this.buildRivals(px, y, panelW)

    this.banner?.setY(y + boardH * 0.42)
    this.subline?.setY(y + boardH * 0.42 + (this.compact ? 34 : 46))
    this.built = true
  }

  private buildRivals(x: number, y: number, w: number): void {
    const rowH = this.compact ? 22 : 30
    const font = this.compact ? 11 : 14
    for (let i = 0; i < MAX_RIVALS; i++) {
      const ry = y + i * rowH + rowH / 2
      this.rivalRows.push({
        pip: this.add
          .image(x, ry, ensureAvatarTexture(this, 'cat', PALETTE.dim, 1))
          .setOrigin(0, 0.5)
          .setVisible(false),
        name: this.add
          .text(x + 21, ry, '', bodyStyle(font, PALETTE.text))
          .setOrigin(0, 0.5)
          .setVisible(false),
        lines: this.add
          .text(x + w, ry, '', headlineStyle(this.compact ? 8 : 16, PALETTE.text))
          .setOrigin(1, 0.5)
          .setVisible(false),
      })
    }
  }

  private blockKey(value: number): string {
    return `pp-tetris-block-${value}-${this.cellPx}`
  }

  protected frame(snap: TetrisSprintSnapshot | null): void {
    if (!snap) return
    if (!this.built) this.build(snap)
    const board = snap.boards[this.selfId]
    if (board && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.onBoard(board, snap)
      this.renderRivals(snap)
    }
    if (board) this.renderGrid(board)
  }

  private onBoard(board: TetrisBoard, snap: TetrisSprintSnapshot): void {
    const ns = `game.${this.i18nNs}`
    this.hud?.setScore(
      snap.targetLines
        ? this.t(`${ns}.progress`, { n: board.linesCleared, target: snap.targetLines })
        : this.t(`${ns}.lines`, { n: board.linesCleared }),
    )
    this.drawMeter(board.linesCleared, snap.targetLines)
    const done = (board.doneAt ?? 0) > 0
    if (!this.synced) {
      // First snapshot of this (possibly restarted) scene: adopt the state without replaying fx.
      this.synced = true
      if (board.toppedOut) this.toppedAt = this.time.now - TOPPLE_ROW_MS * snap.rows
    } else {
      const cleared = board.linesCleared - this.lastLines
      if (cleared > 0) this.onClear(cleared, board.grid)
      if (board.toppedOut && !this.wasTopped) this.onToppedOut()
      if (done && !this.wasDone) this.onDone()
    }
    if (done) this.showEnd(this.t(`${ns}.win`), PALETTE.lime)
    else if (board.toppedOut) this.showEnd(this.t(`${ns}.toppedOut`), PALETTE.red)
    this.lastLines = board.linesCleared
    this.wasTopped = board.toppedOut
    this.wasDone = done
    this.prevGrid = [...board.grid]
  }

  private renderGrid(board: TetrisBoard): void {
    const { cols, rows } = this.well
    // After a top-out the stack greys out one row per TOPPLE_ROW_MS, bottom to top.
    const greyRows = board.toppedOut
      ? Math.floor((this.time.now - this.toppedAt) / TOPPLE_ROW_MS)
      : 0
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i]
      if (!cell) continue
      const v = board.grid[i] ?? 0
      if (v === 0 || PIECE_COLORS[v] === undefined) {
        cell.setVisible(false)
        continue
      }
      const row = Math.floor(i / cols)
      cell.setTexture(this.blockKey(row >= rows - greyRows ? DEAD : v)).setVisible(true)
    }
  }

  // The server doesn't say which rows went: the lowest row that changed is where the clear happened
  // (rows below a clear never move), so the flash sweeps up from there.
  private onClear(count: number, grid: number[]): void {
    const { x, y, cell, cols, rows } = this.well
    let lowest = rows - 1
    for (let r = rows - 1; r >= 0; r--) {
      const before = this.prevGrid.slice(r * cols, r * cols + cols).join(',')
      const after = grid.slice(r * cols, r * cols + cols).join(',')
      if (before !== after) {
        lowest = r
        break
      }
    }
    const g = this.flashGfx
    if (g) {
      g.clear().setAlpha(1)
      g.fillStyle(PALETTE.text, 0.85)
      for (let k = 0; k < count; k++) {
        const r = Math.max(0, lowest - k)
        g.fillRect(x, y + r * cell, cols * cell, cell)
        for (let b = 0; b < 3; b++) {
          burst(
            this,
            x + ((b + 0.5) / 3) * cols * cell,
            y + r * cell + cell / 2,
            PALETTE.amber,
            6,
            160,
          )
        }
      }
      this.tweens.killTweensOf(g)
      this.tweens.add({ targets: g, alpha: 0, duration: 260, ease: 'Quad.easeIn' })
    }
    const cx = x + (cols * cell) / 2
    const cy = y + Math.max(0, lowest - count + 1) * cell
    floatText(this, cx, cy, `+${count}`, PALETTE.lime, 24)
    const word = CLEAR_WORDS[Math.min(count, CLEAR_WORDS.length - 1)]
    if (word) floatText(this, cx, cy - 34, this.t(word), PALETTE.amber, 16)
    if (count >= 2) {
      this.sfx.correct()
      shake(this, 0.004 * count, 160)
    } else {
      this.sfx.coin()
    }
  }

  private onToppedOut(): void {
    this.toppedAt = this.time.now
    this.sfx.wrong()
    shake(this, 0.012, 260)
    flash(this, PALETTE.red, 160)
  }

  private onDone(): void {
    const { x, y, cell, cols, rows } = this.well
    this.sfx.coin()
    this.sfx.correct()
    flash(this, PALETTE.lime, 140)
    for (let i = 0; i < 4; i++) {
      burst(this, x + ((i + 0.5) / 4) * cols * cell, y + (rows * cell) / 3, PALETTE.amber, 14, 260)
    }
  }

  private showEnd(text: string, color: number): void {
    const banner = this.banner
    if (!banner) return
    banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
    showBanner(this, banner, text, color)
    this.subline?.setText(this.t('game.common.waiting')).setVisible(true)
  }

  // Quick Tetris' target meter: one segment per target line, filling bottom-up.
  private drawMeter(lines: number, target?: number): void {
    const g = this.meter
    if (!g || !target) return
    const { x, y, w, h } = this.meterRect
    const segGap = 3
    const segH = (h - segGap * (target - 1)) / target
    g.clear()
    for (let i = 0; i < target; i++) {
      const sy = y + h - (i + 1) * segH - i * segGap
      const lit = i < lines
      g.fillStyle(lit ? PALETTE.lime : PALETTE.panelAlt, 1)
      g.fillRect(x, sy, w, segH)
      if (lit) {
        g.fillStyle(shade(PALETTE.lime, 0.4), 1)
        g.fillRect(x, sy, w, 2)
      }
    }
  }

  // Rivals' live line counts (the snapshot's top-level `progress`), best first, in their colors.
  private renderRivals(snap: TetrisSprintSnapshot): void {
    const rivals = Object.entries(snap.progress)
      .filter(([id]) => id !== this.selfId)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_RIVALS)
    const key = rivals
      .map(([id, n]) => `${id}:${n}:${snap.boards[id]?.toppedOut}:${snap.boards[id]?.doneAt}`)
      .join('|')
    if (key === this.rivalsKey) return
    this.rivalsKey = key
    const maxChars = this.compact ? 7 : 14
    this.rivalRows.forEach((row, i) => {
      const entry = rivals[i]
      row.pip.setVisible(!!entry)
      row.name.setVisible(!!entry)
      row.lines.setVisible(!!entry)
      if (!entry) return
      const [id, n] = entry
      const color = this.state.colorOf(id)
      const board = snap.boards[id]
      const finished = (board?.doneAt ?? 0) > 0
      const alpha = board?.toppedOut ? 0.45 : 1
      const face = board?.toppedOut ? 'ko' : finished ? 'happy' : 'idle'
      row.pip
        .setTexture(ensureAvatarTexture(this, this.state.avatarOf(id), color, 1, 'front', face))
        .setAlpha(alpha)
      row.name
        .setText(`${finished ? '★' : ''}${this.state.nameOf(id).slice(0, maxChars)}`)
        .setColor(hexToCss(color))
        .setAlpha(alpha)
      row.lines.setText(String(n)).setAlpha(alpha)
    })
  }
}
