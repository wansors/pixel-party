import {
  type MiniGameId,
  PALETTE,
  TETRIS,
  type TetrisBoard,
  type TetrisLock,
  type TetrisShapeAt,
  type TetrisSprintInput,
  type TetrisSprintSnapshot,
  type TetrisState,
  tetrisApply,
  tetrisCells,
  tetrisDecodeBoard,
  tetrisFall,
  tetrisLandingY,
  tetrisSpawn,
} from '@pp/shared'
import type Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { addBanner, burst, flash, floatText, shake, showBanner } from '../fx'
import { ServerClock } from '../netcode/ServerClock'
import {
  bodyStyle,
  ensurePixelBlock,
  ensurePixelGrid,
  ensurePixelOrb,
  fitFontSize,
  fitText,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

type Action = 'left' | 'right' | 'rotate' | 'drop'
type Side = 'left' | 'right'

// Board values 1..7 are the shapes I, O, T, S, Z, J, L (index + 1) in their classic hues, so a piece
// reads at a glance. Topped-out boards turn to DEAD row by row.
const PIECE_COLORS: Record<number, number> = {
  1: PALETTE.cyan,
  2: PALETTE.amber,
  3: 0xb06bff,
  4: PALETTE.lime,
  5: PALETTE.red,
  6: 0x5b8cff,
  7: PALETTE.orange,
}
const DEAD = 9
const TOPPLE_ROW_MS = 45
// Keyboard feel, like a real Tetris and the same on every machine (the OS key repeat is ignored): a
// held ◀ ▶ moves once, waits DAS_MS, then auto-shifts every ARR_MS; a held ↓ soft-drops every
// SOFT_MS (and, after locking a piece, waits for a fresh press so it doesn't run into the next one).
const DAS_MS = 150
const ARR_MS = 45
const SOFT_MS = 40
// Inputs the server never acknowledged within this long are taken as lost and stop being replayed.
const PENDING_TTL_MS = 2000
const MAX_AHEAD_MS = 1000
const NEXT_SHOWN = 2
// A lock this soon after a hard drop is that drop's: its thud already played.
const DROP_LOCK_MS = 150
// Standings rows beside the well: as tall as fits (between these bounds), everyone if they fit, else
// the top ones plus yourself.
const ROW_MIN = 16
const CLEAR_WORDS = ['', '', 'game.common.nice', 'game.common.great', 'game.common.perfect']

const KEYS: Record<'left' | 'right' | 'soft', string[]> = {
  left: ['LEFT', 'A'],
  right: ['RIGHT', 'D'],
  soft: ['DOWN', 'S'],
}

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
  // The player's avatar (KO face while topped out).
  pip: Phaser.GameObjects.Image
  name: Phaser.GameObjects.Text
  lines: Phaser.GameObjects.Text
}

// The last snapshot of this player's own board, ready to predict from.
interface Base {
  board: TetrisBoard
  state: TetrisState
  shapeAt: TetrisShapeAt
  remainingMs: number
}

interface Pending {
  seq: number
  input: TetrisSprintInput
  at: number // scene time it was sent
}

// Shared canvas for the two Tetris-style sprint games (line-clear-sprint, quick-tetris): THIS player's
// own board inside an arcade well, with a NEXT preview and the live standings beside it (plus
// quick-tetris' target meter). The board is predicted locally with the shared engine (@pp/shared
// tetrisSprint): every move, turn, drop, gravity step and lock shows on the frame it happens, and each
// snapshot (the server's word) is the new base the unacknowledged inputs are replayed on. Controls:
// ◀ ▶ / A D move (auto-shift when held), ↑ / W / X turn, Z turn back, ↓ / S soft drop, SPACE / ENTER
// hard drop, or the four arcade buttons. Line clears, top-outs (final in quick-tetris; a penalty and a
// fresh board in line-clear-sprint) and finishing get their feedback. Subclasses only pick the scene
// key (=== mini-game id), which also names the i18n namespace.
export abstract class TetrisSprintSceneBase extends MiniGameScene<TetrisSprintSnapshot> {
  private readonly i18nNs: string
  private readonly clock = new ServerClock()
  private cells: Phaser.GameObjects.Image[] = []
  private shownCells: number[] = []
  private ghosts: Phaser.GameObjects.Image[] = []
  private nextCells: Phaser.GameObjects.Image[] = []
  private nextKey = ''
  private cellPx = 0
  private well = { x: 0, y: 0, cell: 0, cols: 0, rows: 0 }
  private nextBox = { x: 0, y: 0, w: 0, cell: 0 }
  private built = false
  private flashGfx?: Phaser.GameObjects.Graphics
  private meter?: Phaser.GameObjects.Graphics
  private meterRect = { x: 0, y: 0, w: 0, h: 0 }
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private readonly buttons = new Map<Action, ArcadeButton>()
  private rivalRows: RivalRow[] = []
  private rivalsKey = ''
  private panel = { x: 0, y: 0, w: 0, h: 0 }
  private base?: Base
  private pending: Pending[] = []
  private seq = 0
  private lastTick = -1
  // What the screen shows (the prediction), for feedback on changes.
  private shownLines = -1
  private scoreText = ''
  private toppedAt = 0
  private synced = false
  private wasTopped = false
  private wasDone = false
  private serverLines = 0
  private compact = false
  private controlsTop = 0
  private targetLines = 0
  // Held keys (and held ◀ ▶ arcade buttons): the side auto-shifting and when it next moves.
  private keys: Record<'left' | 'right' | 'soft', Phaser.Input.Keyboard.Key[]> = {
    left: [],
    right: [],
    soft: [],
  }
  private shiftSide?: Side
  private shiftAt = 0
  private padSide?: Side
  private softAt = 0
  private softArmed = false
  // Cells ever locked into the stack, as the screen has shown them (filled cells + cleared lines ×
  // cols — it only grows, whichever snapshot the prediction stands on): a rise is a piece locking.
  private lockedMax = -1
  private droppedAt = Number.NEGATIVE_INFINITY
  // Everyone else's board as last seen (topped out / done), for the room's big moments.
  private rivalEnds = new Map<string, { topped: boolean; done: boolean }>()

  constructor(sceneKey: MiniGameId, ...deps: SceneDeps) {
    super(sceneKey, ...deps)
    this.i18nNs = kebabToCamel(sceneKey)
  }

  override create(): void {
    super.create()
    this.clock.reset()
    this.built = false
    this.cells = []
    this.shownCells = []
    this.ghosts = []
    this.nextCells = []
    this.nextKey = ''
    this.cellPx = 0
    this.buttons.clear()
    this.rivalRows = []
    this.rivalsKey = ''
    this.base = undefined
    this.pending = []
    this.seq = 0
    this.lastTick = -1
    this.shownLines = -1
    this.scoreText = ''
    this.toppedAt = 0
    this.synced = false
    this.wasTopped = false
    this.wasDone = false
    this.serverLines = 0
    this.targetLines = 0
    this.shiftSide = undefined
    this.padSide = undefined
    this.softArmed = false
    this.lockedMax = -1
    this.droppedAt = Number.NEGATIVE_INFINITY
    this.rivalEnds = new Map()

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

    // Held keys come from Phaser Key objects: they block the page from scrolling and reset when the
    // window loses focus, so a piece never keeps sliding on its own.
    const kb = this.input.keyboard
    if (kb) {
      for (const [k, names] of Object.entries(KEYS) as [keyof typeof KEYS, string[]][]) {
        this.keys[k] = names.map((n) => kb.addKey(n))
      }
      kb.addKeys('UP,W,X,Z,SPACE,ENTER')
    }
    this.onKey('LEFT', () => this.startShift('left'))
    this.onKey('A', () => this.startShift('left'))
    this.onKey('RIGHT', () => this.startShift('right'))
    this.onKey('D', () => this.startShift('right'))
    for (const key of ['DOWN', 'S']) this.onKey(key, () => this.startSoft())
    for (const key of ['UP', 'W', 'X']) this.onKey(key, () => this.act('rotate'))
    this.onKey('Z', () => this.act('rotate', 'ccw'))
    for (const key of ['SPACE', 'ENTER']) this.onKey(key, () => this.act('drop'))
    this.input.on('pointerup', () => {
      this.padSide = undefined
    })
  }

  // Four round arcade buttons along the bottom: ◀ ▶ on the left (hold to slide), rotate + drop on the
  // right.
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
      orb.on('pointerdown', () => {
        if (action === 'left' || action === 'right') {
          this.padSide = action
          this.startShift(action)
        } else {
          this.act(action)
        }
      })
      const icon = glyph
        ? this.add
            .text(x, y, glyph, headlineStyle(this.compact ? 16 : 24, PALETTE.bg))
            .setOrigin(0.5)
        : this.add.image(x, y, rotateKey).setDisplaySize(size * 0.44, size * 0.44)
      this.buttons.set(action, { orb, icon, y, upKey, downKey })
    }
    if (hintH > 0) {
      const hint = this.add
        .text(width / 2, height - hintH / 2, this.t(`game.${this.i18nNs}.hint`), bodyStyle(14))
        .setOrigin(0.5)
      fitText(hint, width - 16, 14)
    }
  }

  // Whether this player can act on their board right now (as far as the screen knows).
  private canAct(): boolean {
    const base = this.base
    if (!base || this.state.final) return false
    if (base.board.toppedOut || (base.board.doneAt ?? 0) > 0) return false
    return !(this.targetLines > 0 && this.shownLines >= this.targetLines)
  }

  // ◀ ▶ pressed: one step now, auto-shift after DAS_MS while held.
  private startShift(side: Side): void {
    this.shiftSide = side
    this.shiftAt = this.time.now + DAS_MS
    this.act(side)
  }

  private startSoft(): void {
    this.softArmed = true
    this.softAt = this.time.now + SOFT_MS
    this.act('soft')
  }

  private held(side: 'left' | 'right' | 'soft'): boolean {
    return this.keys[side].some((k) => k.isDown) || (side !== 'soft' && this.padSide === side)
  }

  // Auto-shift and soft-drop repeats for the held keys, on the scene clock.
  private repeatHeld(now: number): void {
    if (this.shiftSide && !this.held(this.shiftSide)) {
      // Let go of one side while still holding the other: that one takes over, after a fresh DAS.
      const other: Side = this.shiftSide === 'left' ? 'right' : 'left'
      this.shiftSide = this.held(other) ? other : undefined
      this.shiftAt = now + DAS_MS
    }
    for (let n = 0; this.shiftSide && now >= this.shiftAt && n < TETRIS.cols; n++) {
      this.shiftAt += ARR_MS
      this.act(this.shiftSide, undefined, true)
    }
    if (!this.held('soft')) this.softArmed = false
    for (let n = 0; this.softArmed && now >= this.softAt && n < TETRIS.rows; n++) {
      this.softAt += SOFT_MS
      this.act('soft', undefined, true)
    }
  }

  // One player input: applied to the prediction at once (the next render shows it) and sent with a
  // sequence number for the server to acknowledge.
  private act(action: Action | 'soft', dir?: 'ccw', repeat = false): void {
    if (!this.canAct()) return
    const seq = ++this.seq
    const input: TetrisSprintInput =
      action === 'rotate'
        ? dir
          ? { kind: 'rotate', dir, seq }
          : { kind: 'rotate', seq }
        : action === 'drop'
          ? { kind: 'drop', seq }
          : action === 'soft'
            ? { kind: 'soft', seq }
            : { kind: 'move', dir: action, seq }
    // A soft drop on the stack locks the piece: stop repeating until a fresh press.
    if (action === 'soft') {
      const s = this.predict(this.time.now)
      if (s?.current && tetrisLandingY(s.board, s.current) === s.current.y) this.softArmed = false
    }
    this.pending.push({ seq, input, at: this.time.now })
    this.sendInput(input)
    if (repeat) return
    if (action === 'drop') {
      // Slammed to the floor: the thud is the lock.
      this.sfx.land()
      this.droppedAt = this.time.now
      shake(this, 0.003, 70)
    } else if (action === 'rotate') this.sfx.flip()
    else this.sfx.tick()
    const btn = action === 'soft' ? undefined : this.buttons.get(action)
    if (!btn) return
    btn.orb.setTexture(btn.downKey).setY(btn.y + 3)
    btn.icon.setY(btn.y + 3)
    this.time.delayedCall(90, () => {
      btn.orb.setTexture(btn.upKey).setY(btn.y)
      btn.icon.setY(btn.y)
    })
  }

  // The board as this player sees it now: the last snapshot, plus gravity since then on the server's
  // clock, with the unacknowledged inputs replayed in between at the moments they were made.
  // `locks` collects the locks the replay went through (for the line-clear flash).
  private predict(now: number, locks?: TetrisLock[]): TetrisState | null {
    const base = this.base
    if (!base) return null
    const s: TetrisState = {
      ...base.state,
      board: [...base.state.board],
      current: base.state.current ? { ...base.state.current } : null,
    }
    const frozen = this.state.final || base.board.toppedOut || (base.board.doneAt ?? 0) > 0
    if (frozen) return s
    // Capped: a stalled connection freezes the piece instead of letting gravity run away with it.
    const elapsed = Math.min(MAX_AHEAD_MS, this.clock.since(base.remainingMs, now))
    const done = (): boolean => this.targetLines > 0 && s.linesCleared >= this.targetLines
    let t = 0
    for (const p of this.pending) {
      if (done()) return s
      const at = Math.min(elapsed, this.clock.since(base.remainingMs, p.at))
      if (at > t) {
        for (const l of tetrisFall(s, at - t, base.shapeAt)) locks?.push(l)
        t = at
      }
      if (done()) return s
      const lock = tetrisApply(s, p.input, base.shapeAt)
      if (lock) locks?.push(lock)
    }
    if (!done() && elapsed > t) {
      for (const l of tetrisFall(s, elapsed - t, base.shapeAt)) locks?.push(l)
    }
    return s
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
    const cell = Math.max(8, Math.floor(Math.min(availH / snap.rows, availW / snap.cols, 64)))
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
    // The ghost (where a hard drop lands) under the piece: a dim block.
    for (let i = 0; i < 4; i++) {
      this.ghosts.push(this.add.image(0, 0, this.blockKey(1)).setAlpha(0.22).setVisible(false))
    }
    for (let r = 0; r < snap.rows; r++) {
      for (let c = 0; c < snap.cols; c++) {
        this.cells.push(
          this.add
            .image(x + c * cell + cell / 2, y + r * cell + cell / 2, this.blockKey(1))
            .setVisible(false),
        )
        this.shownCells.push(0)
      }
    }
    this.flashGfx = this.add.graphics().setDepth(20)

    let px = x + boardW + frame + gap
    if (quick) {
      this.meterRect = { x: px, y, w: meterW, h: boardH }
      this.meter = this.add.graphics()
      px += meterW + gap
    }
    // NEXT box on top of the panel (the next two pieces, the second smaller), standings below it.
    const nextCell = Math.max(6, Math.min(Math.floor(cell * 0.6), Math.floor(panelW / 9), 28))
    const labelSize = this.compact ? 8 : 16
    this.add
      .text(px, y, this.t(`game.${this.i18nNs}.next`), headlineStyle(labelSize, PALETTE.dim))
      .setOrigin(0, 0)
    const boxY = y + labelSize + 8
    const boxH = nextCell * 2 + 12 + Math.round(nextCell * 0.7) * 2 + 8
    const box = this.add.graphics()
    box.fillStyle(PALETTE.panel, 1)
    box.fillRect(px, boxY, panelW, boxH)
    box.lineStyle(2, PALETTE.frame, 1)
    box.strokeRect(px, boxY, panelW, boxH)
    this.nextBox = { x: px, y: boxY + 6, w: panelW, cell: nextCell }
    ensurePixelBlock(this, this.nextBlockKey(1), nextCell, PIECE_COLORS[1] as number)
    for (let i = 0; i < 4 * NEXT_SHOWN; i++) {
      this.nextCells.push(this.add.image(0, 0, this.nextBlockKey(1)).setVisible(false))
    }
    const standingsY = boxY + boxH + gap
    this.panel = { x: px, y: standingsY, w: panelW, h: Math.max(ROW_MIN, y + boardH - standingsY) }

    this.banner?.setY(y + boardH * 0.42)
    this.subline?.setY(y + boardH * 0.42 + (this.compact ? 34 : 46))
    this.built = true
  }

  // One row per player that fits the panel's height (built once the player count is known).
  private buildRivals(count: number): void {
    const { x, y, w, h } = this.panel
    const rowH = Math.max(ROW_MIN, Math.min(this.compact ? 22 : 30, Math.floor(h / count)))
    const rows = Math.max(1, Math.min(count, Math.floor(h / rowH)))
    const small = this.compact || rowH < 22
    const font = small ? 11 : 14
    for (let i = 0; i < rows; i++) {
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
          .text(x + w, ry, '', headlineStyle(small ? 8 : 16, PALETTE.text))
          .setOrigin(1, 0.5)
          .setVisible(false),
      })
    }
  }

  private blockKey(value: number): string {
    return `pp-tetris-block-${value}-${this.cellPx}`
  }

  private nextBlockKey(value: number): string {
    return `pp-tetris-next-${value}-${this.nextBox.cell}`
  }

  protected frame(snap: TetrisSprintSnapshot | null): void {
    if (!snap) return
    if (!this.built) this.build(snap)
    const now = this.time.now
    // A spectator (joined mid-round) has no board of their own: just the standings.
    const board = snap.boards[this.selfId]
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.clock.sync(snap.remainingMs, now)
      this.targetLines = snap.targetLines ?? 0
      if (board) this.onBoard(board, snap)
      this.renderRivals(snap)
      this.watchRivals(snap)
    }
    if (!board || !this.base) return
    this.repeatHeld(now)
    const locks: TetrisLock[] = []
    const s = this.predict(now, locks)
    if (!s) return
    const cleared = this.shownLines >= 0 && s.linesCleared > this.shownLines
    this.onLines(s.linesCleared, locks)
    this.lockFx(s, cleared)
    this.renderGrid(s)
    this.renderNext(s)
  }

  // A fresh snapshot of this player's board: the new prediction base, plus the server-only events.
  private onBoard(board: TetrisBoard, snap: TetrisSprintSnapshot): void {
    const ns = `game.${this.i18nNs}`
    const { state, shapeAt } = tetrisDecodeBoard(board)
    this.base = { board, state, shapeAt, remainingMs: snap.remainingMs }
    const now = this.time.now
    this.pending = this.pending.filter((p) => p.seq > board.ack && now - p.at < PENDING_TTL_MS)
    const done = (board.doneAt ?? 0) > 0
    // Line Clear Sprint restarts a topped-out board (minus a few lines); in Quick Tetris it's final.
    const restarts = snap.topOutPenalty !== undefined
    if (!this.synced) {
      // First snapshot of this (possibly restarted) scene: adopt the state without replaying fx, and
      // carry on numbering inputs after the ones the server has already seen.
      this.synced = true
      this.seq = Math.max(this.seq, board.ack)
      this.shownLines = board.linesCleared
      if (board.toppedOut) this.toppedAt = this.time.now - TOPPLE_ROW_MS * snap.rows
    } else {
      if (board.toppedOut && !this.wasTopped)
        this.onToppedOut(this.serverLines - board.linesCleared, restarts)
      if (!board.toppedOut && this.wasTopped) this.onRestart()
      if (done && !this.wasDone) this.onDone()
    }
    if (board.toppedOut || done) {
      this.pending = []
      this.shiftSide = undefined
      this.softArmed = false
    }
    if (done) this.showEnd(this.t(`${ns}.win`), PALETTE.lime, true)
    else if (board.toppedOut) this.showEnd(this.t(`${ns}.toppedOut`), PALETTE.red, !restarts)
    this.wasTopped = board.toppedOut
    this.wasDone = done
    this.serverLines = board.linesCleared
  }

  // A piece settled into the stack (gravity or a soft drop on it): a tight click. A hard drop already
  // thudded, and a lock that clears lines rings the clear instead.
  private lockFx(s: TetrisState, cleared: boolean): void {
    let locked = s.linesCleared * TETRIS.cols
    for (const v of s.board) if (v !== 0) locked++
    const fresh = this.lockedMax >= 0 && locked > this.lockedMax
    this.lockedMax = Math.max(this.lockedMax, locked)
    if (!fresh || cleared || this.time.now - this.droppedAt < DROP_LOCK_MS) return
    this.sfx.lock()
  }

  // The rest of the room: a board finishing, or (quick-tetris) topping out for good — one quieter
  // sound each per snapshot, however many happen at once.
  private watchRivals(snap: TetrisSprintSnapshot): void {
    const primed = this.rivalEnds.size > 0
    let out = false
    let finished = false
    for (const [id, board] of Object.entries(snap.boards)) {
      if (id === this.selfId) continue
      const now = { topped: board.toppedOut, done: (board.doneAt ?? 0) > 0 }
      const was = this.rivalEnds.get(id)
      if (primed && was) {
        if (now.topped && !was.topped && snap.topOutPenalty === undefined) out = true
        if (now.done && !was.done) finished = true
      }
      this.rivalEnds.set(id, now)
    }
    if (out) this.sfx.quiet(() => this.sfx.eliminated(), 0.6)
    if (finished) this.sfx.quiet(() => this.sfx.cheer(), 0.5)
  }

  // The shown line count moved: a clear (flash + pop), or a top-out penalty (just the number).
  private onLines(lines: number, locks: TetrisLock[]): void {
    if (lines !== this.shownLines) {
      const gained = lines - this.shownLines
      if (gained > 0 && this.shownLines >= 0) {
        const rows = [...locks].reverse().find((l) => l.rows.length > 0)?.rows ?? []
        this.onClear(gained, rows)
      }
      this.shownLines = lines
    }
    const key = `${lines}/${this.targetLines}`
    if (key === this.scoreText) return
    this.scoreText = key
    const ns = `game.${this.i18nNs}`
    this.hud?.setScore(
      this.targetLines
        ? this.t(`${ns}.progress`, { n: lines, target: this.targetLines })
        : this.t(`${ns}.lines`, { n: lines }),
    )
    this.drawMeter(lines, this.targetLines)
  }

  // Board + falling piece + ghost, touching only the cells that changed.
  private renderGrid(s: TetrisState): void {
    const { x, y, cell, cols, rows } = this.well
    const grid = s.board
    const piece = s.current
    const pieceCells = new Map<number, number>()
    if (piece) {
      for (const c of tetrisCells(piece)) {
        const cx = piece.x + c.x
        const cy = piece.y + c.y
        if (cy >= 0 && cy < rows && cx >= 0 && cx < cols)
          pieceCells.set(cy * cols + cx, piece.shape + 1)
      }
    }
    // After a top-out (the server's word) the stack greys out one row per TOPPLE_ROW_MS, bottom up.
    const topped = this.base?.board.toppedOut === true
    const greyRows = topped ? Math.floor((this.time.now - this.toppedAt) / TOPPLE_ROW_MS) : 0
    for (let i = 0; i < this.cells.length; i++) {
      const raw = pieceCells.get(i) ?? grid[i] ?? 0
      const v = raw !== 0 && Math.floor(i / cols) >= rows - greyRows && topped ? DEAD : raw
      if (v === this.shownCells[i]) continue
      this.shownCells[i] = v
      const img = this.cells[i]
      if (!img) continue
      if (v === 0 || (v !== DEAD && PIECE_COLORS[v] === undefined)) img.setVisible(false)
      else img.setTexture(this.blockKey(v)).setVisible(true)
    }
    // Ghost: where the piece lands, wherever it doesn't overlap the piece itself.
    const landing = piece ? tetrisLandingY(grid, piece) : 0
    const ghostCells = piece && landing !== piece.y ? tetrisCells(piece) : []
    for (let i = 0; i < this.ghosts.length; i++) {
      const g = this.ghosts[i]
      const c = ghostCells[i]
      if (!g) continue
      if (!c || !piece || landing + c.y < 0) {
        g.setVisible(false)
        continue
      }
      const gx = piece.x + c.x
      const gy = landing + c.y
      g.setTexture(this.blockKey(piece.shape + 1))
        .setPosition(x + gx * cell + cell / 2, y + gy * cell + cell / 2)
        .setVisible(!pieceCells.has(gy * cols + gx))
    }
  }

  // The NEXT box: the next two pieces in the queue (the shapes after the one falling now).
  private renderNext(s: TetrisState): void {
    const base = this.base
    if (!base) return
    const shapes: (number | undefined)[] = []
    for (let k = 1; k <= NEXT_SHOWN; k++) shapes.push(base.shapeAt(s.queueIndex + k))
    const key = shapes.join(',')
    if (key === this.nextKey) return
    this.nextKey = key
    const { x, y, w, cell } = this.nextBox
    let top = y
    shapes.forEach((shape, k) => {
      const size = k === 0 ? cell : Math.round(cell * 0.7)
      const piece = shape === undefined ? null : tetrisSpawn(shape)
      const cells = piece ? tetrisCells(piece) : []
      const minX = Math.min(...cells.map((c) => c.x))
      const maxX = Math.max(...cells.map((c) => c.x))
      const minY = Math.min(...cells.map((c) => c.y))
      const left = x + (w - (maxX - minX + 1) * size) / 2
      for (let i = 0; i < 4; i++) {
        const img = this.nextCells[k * 4 + i]
        const c = cells[i]
        if (!img) continue
        if (!c || shape === undefined) {
          img.setVisible(false)
          continue
        }
        const tex = this.nextBlockKey(shape + 1)
        ensurePixelBlock(this, tex, cell, PIECE_COLORS[shape + 1] as number)
        img
          .setTexture(tex)
          .setDisplaySize(size - 2, size - 2)
          .setPosition(left + (c.x - minX) * size + size / 2, top + (c.y - minY) * size + size / 2)
          .setVisible(true)
      }
      top += size * 2 + 12
    })
  }

  // Flash the rows that went (the lowest first) and pop "+n" with a word for multi-line clears.
  private onClear(count: number, rows: number[]): void {
    const { x, y, cell, cols } = this.well
    const lowest = rows.length ? Math.max(...rows) : this.well.rows - 1
    const g = this.flashGfx
    if (g) {
      g.clear().setAlpha(1)
      g.fillStyle(PALETTE.text, 0.85)
      const flashRows = rows.length ? rows : [lowest]
      for (const r of flashRows) {
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
    // The longer the clear, the longer the arpeggio.
    this.sfx.lineClear(count)
    if (count >= 2) shake(this, 0.004 * count, 160)
  }

  // `lost`: lines the top-out cost (Line Clear Sprint's penalty), shown over the crumbling stack.
  // `restarts`: the board comes back (Line Clear Sprint); in Quick Tetris a top-out is out.
  private onToppedOut(lost = 0, restarts = false): void {
    this.toppedAt = this.time.now
    this.sfx.crash()
    if (restarts) this.sfx.hurt()
    else this.sfx.eliminated()
    shake(this, 0.012, 260)
    flash(this, PALETTE.red, 160)
    if (lost <= 0) return
    const { x, y, cell, cols, rows } = this.well
    floatText(this, x + (cols * cell) / 2, y + (rows * cell) / 2, `-${lost}`, PALETTE.red, 24)
  }

  // A topped-out board came back empty (Line Clear Sprint): clear the banner and go again.
  private onRestart(): void {
    this.banner?.setVisible(false)
    this.subline?.setVisible(false)
    // The emptied board starts its own count of locked cells.
    this.lockedMax = -1
    this.sfx.go()
    const { x, y, cell, cols } = this.well
    burst(this, x + (cols * cell) / 2, y + cell, PALETTE.cyan, 12, 200)
  }

  private onDone(): void {
    const { x, y, cell, cols, rows } = this.well
    this.sfx.cheer()
    this.sfx.coin()
    flash(this, PALETTE.lime, 140)
    for (let i = 0; i < 4; i++) {
      burst(this, x + ((i + 0.5) / 4) * cols * cell, y + (rows * cell) / 3, PALETTE.amber, 14, 260)
    }
  }

  // `waiting`: the board is done for the round (adds the "waiting for the others" line).
  private showEnd(text: string, color: number, waiting: boolean): void {
    const banner = this.banner
    if (!banner || (banner.visible && banner.text === text)) return
    banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
    showBanner(this, banner, text, color)
    if (waiting) this.subline?.setText(this.t('game.common.waiting')).setVisible(true)
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

  // Live standings (the snapshot's top-level `progress`), best first, in each player's color — everyone
  // when they fit beside the well, else the leaders plus yourself in the last row.
  private renderRivals(snap: TetrisSprintSnapshot): void {
    if (this.rivalRows.length === 0) this.buildRivals(Object.keys(snap.progress).length)
    const ranked = Object.entries(snap.progress).sort((a, b) => b[1] - a[1])
    const rows = this.rivalRows.length
    let shown = ranked.slice(0, rows)
    const mine = ranked.find(([id]) => id === this.selfId)
    if (mine && !shown.includes(mine)) shown = [...shown.slice(0, rows - 1), mine]
    const key = shown
      .map(([id, n]) => `${id}:${n}:${snap.boards[id]?.toppedOut}:${snap.boards[id]?.doneAt}`)
      .join('|')
    if (key === this.rivalsKey) return
    this.rivalsKey = key
    const maxChars = this.compact ? 7 : 14
    this.rivalRows.forEach((row, i) => {
      const entry = shown[i]
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
        .setText(`${finished ? '★' : ''}${this.label(id).slice(0, maxChars)}`)
        .setColor(hexToCss(id === this.selfId ? PALETTE.amber : color))
        .setAlpha(alpha)
      row.lines.setText(String(n)).setAlpha(alpha)
    })
  }
}
