import { PALETTE, type SudokuBoard, type SudokuSnapshot } from '@pp/shared'
import type Phaser from 'phaser'
import { addBanner, burst, floatText, punch, ring, shake, showBanner } from '../fx'
import { bodyStyle, ensureBevelPanel, fitText, headlineStyle, hexToCss, shade } from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const OPEN_COLOR = PALETTE.frame
const GIVEN_COLOR = shade(PALETTE.panel, -0.35)
const WRONG_COLOR = shade(PALETTE.red, -0.55)
const LOCKED_COLOR = shade(PALETTE.lime, -0.7)
const KEY_COLOR = shade(PALETTE.cyan, -0.4)
const CLEAR_COLOR = shade(PALETTE.red, -0.35)
const PRESS_PX = 4
// The strip shows the leaders, always including you (you take the last chip when you're further back);
// a wide canvas fits a full room.
const MAX_CHIPS = 6
const MAX_CHIPS_WIDE = 12
// The everyone strip (PlayerStrip) rebuilds every chip from scratch on any change — new Text objects,
// each measuring its font again — which cost a frame per snapshot once a full room was playing. It
// follows the standings at most twice a second; your own progress in the HUD stays immediate.
const STRIP_EVERY_MS = 500
// A rival solving their board gets a crowd cheer, at most this often.
const CHEER_EVERY_MS = 1500

type CellLook = 'given' | 'open' | 'wrong' | 'locked'

// Digit color per cell look: givens steel-blue, locked lime, wrong entries pale red.
const INK: Readonly<Record<CellLook, number>> = {
  given: 0x8fb4ff,
  open: PALETTE.text,
  wrong: 0xffb3b3,
  locked: PALETTE.lime,
}

interface Cell {
  image: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  x: number
  y: number
  look: CellLook | ''
}

// Rows, columns and boxes of a size x size board whose every cell is settled (a given, or locked in).
function completeUnits(given: readonly number[], locked: readonly boolean[], size: number): number {
  const boxH = Math.max(1, Math.floor(Math.sqrt(size)))
  const boxW = Math.max(1, Math.round(size / boxH))
  const settled = (r: number, c: number): boolean =>
    (given[r * size + c] ?? 0) > 0 || (locked[r * size + c] ?? false)
  let units = 0
  for (let k = 0; k < size; k++) {
    let row = true
    let col = true
    let box = true
    for (let j = 0; j < size; j++) {
      row &&= settled(k, j)
      col &&= settled(j, k)
      const r = Math.floor(k / (size / boxW)) * boxH + Math.floor(j / boxW)
      const c = (k % (size / boxW)) * boxW + (j % boxW)
      box &&= settled(r, c)
    }
    units += Number(row) + Number(col) + Number(box)
  }
  return units
}

interface Key {
  shadow: Phaser.GameObjects.Image
  face: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  y: number
}

// Sudoku Race canvas. This player's own 4x4 board on a framed panel (2x2 boxes set apart by wider
// gutters). Select a cell (click/tap, or arrows / WASD — the first open cell starts selected), then
// enter a digit on the number pad (or keys 1-4; ← / Backspace / Delete / 0 clears). The server locks a
// correct digit (lime) and answers a wrong one (it stays on the board, red) with a short input
// cooldown: the pad greys out behind a draining red bar, with a buzz and a shake, so guessing is
// visibly slower than solving. Givens are steel-blue and fixed.
export class SudokuRaceScene extends MiniGameScene<SudokuSnapshot> {
  private cells: Cell[] = []
  private keys: Key[] = []
  private keyValues: number[] = []
  private prompt?: Phaser.GameObjects.Text
  private rule?: Phaser.GameObjects.Text
  private cooldownLabel?: Phaser.GameObjects.Text
  private cooldownBar?: Phaser.GameObjects.Graphics
  private caret?: Phaser.GameObjects.Rectangle
  private peers?: Phaser.GameObjects.Graphics
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private looks: Record<CellLook, string> = { given: '', open: '', wrong: '', locked: '' }
  private boardTop = 0
  private boardBottom = 0
  private padTop = 0
  private barBox = { x: 0, y: 0, w: 0, h: 0 }
  private promptSize = 0
  private cellSize = 0
  private compact = false
  private selected = -1
  private drawnPeers = -2
  private lastTick = -1
  private cooldownEndsAt = 0
  private cooldownTotal = 0
  private lastCooldownMs = 0
  private prevLocked: boolean[] = []
  private prevCorrect = 0
  private finished = false
  // The last snapshot whose boards were drawn, and the pad state last drawn.
  private drawnSnap?: SudokuSnapshot
  private stripAt = 0
  private padKey = ''
  // Players already seen done (cheered once), and when the last cheer played.
  private readonly finishers = new Set<string>()
  private cheerAt = Number.NEGATIVE_INFINITY

  constructor(...deps: SceneDeps) {
    super('sudoku-race', ...deps)
  }

  override create(): void {
    super.create()
    this.cells = []
    this.keys = []
    this.keyValues = []
    this.selected = -1
    this.drawnPeers = -2
    this.lastTick = -1
    this.cooldownEndsAt = 0
    this.cooldownTotal = 0
    this.lastCooldownMs = 0
    this.prevLocked = []
    this.prevCorrect = 0
    this.finished = false
    this.drawnSnap = undefined
    this.stripAt = 0
    this.padKey = ''
    this.finishers.clear()
    this.cheerAt = Number.NEGATIVE_INFINITY
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    const compact = this.compact
    const cx = width / 2
    this.promptSize = compact ? 16 : 24
    this.prompt = this.add
      .text(
        cx,
        this.top + (compact ? 10 : 14) + this.promptSize / 2,
        '',
        headlineStyle(this.promptSize, PALETTE.amber, { stroke: '#10121c', strokeThickness: 6 }),
      )
      .setOrigin(0.5)
      .setDepth(5)
    this.boardTop = this.top + this.promptSize + (compact ? 24 : 32)
    // Keyboard screens: the keys, named under the prompt.
    if (!compact) {
      this.add
        .text(cx, this.boardTop - 14, this.t('game.sudokuRace.keys'), bodyStyle(16))
        .setOrigin(0.5, 0)
      this.boardTop += 22
    }

    // Bottom-up: chip strip, rule line, number pad, cooldown bar; the board gets the rest.
    const chipSize = compact ? 11 : width >= 1400 && height >= 860 ? 16 : 13
    // Two rows on a phone, and on a wide canvas showing the whole room (one row would make the strip
    // shrink its font step by step on every rebuild).
    const stripRows = width < 600 || width >= 1400 ? 2 : 1
    const stripTop = height - (compact ? 12 : 18) - stripRows * PlayerStrip.rowH(chipSize)
    this.strip = new PlayerStrip(
      this,
      cx,
      stripTop + PlayerStrip.rowH(chipSize) / 2,
      width - 32,
      chipSize,
      stripRows,
    )
    const ruleY = stripTop - (compact ? 14 : 18)
    this.rule = this.add
      .text(cx, ruleY, '', bodyStyle(compact ? 12 : 15, PALETTE.dim, { align: 'center' }))
      .setOrigin(0.5)
    const keyH = compact ? 64 : 72
    this.padTop = ruleY - (compact ? 16 : 20) - keyH
    const barH = compact ? 8 : 10
    const barY = this.padTop - (compact ? 16 : 20) - barH
    this.cooldownBar = this.add.graphics().setDepth(6)
    this.cooldownLabel = this.add
      .text(cx, barY - 4, '', bodyStyle(compact ? 13 : 16, PALETTE.red, { fontStyle: 'bold' }))
      .setOrigin(0.5, 1)
      .setDepth(6)
    this.barBox = { x: 0, y: barY, w: 0, h: barH }
    this.boardBottom = barY - (compact ? 28 : 34)
    this.peers = this.add.graphics().setDepth(2)
    this.banner = addBanner(this).setFontSize(compact ? 24 : 32)

    const kb = this.input.keyboard
    kb?.on('keydown', (e: KeyboardEvent) => this.handleKey(e))
  }

  // Board + pad are laid out once, from the first snapshot's size.
  private build(snap: SudokuSnapshot): void {
    const { width } = this.scale
    const cx = width / 2
    const n = snap.size
    const box = Math.max(1, Math.round(Math.sqrt(n)))
    // A big canvas (1080p) gets a bigger board; laptops and phones keep the old cap.
    const cap = width >= 1400 && this.scale.height >= 860 ? 680 : 520
    const side = Math.floor(Math.min(width - 32, this.boardBottom - this.boardTop, cap))
    const pad = Math.max(8, Math.round(side * 0.035))
    const inner = Math.max(3, Math.round(side * 0.012))
    const gutter = Math.max(8, Math.round(side * 0.035))
    const boxes = Math.ceil(n / box)
    const cell = Math.floor((side - pad * 2 - inner * (n - boxes) - gutter * (boxes - 1)) / n)
    const boardW = cell * n + inner * (n - boxes) + gutter * (boxes - 1) + pad * 2
    const top = this.boardTop + Math.max(0, (this.boardBottom - this.boardTop - boardW) / 2)
    const left = cx - boardW / 2
    this.cellSize = cell
    this.add
      .image(cx, top + boardW / 2, ensureBevelPanel(this, boardW, boardW, PALETTE.panel, 6, true))
      .setDepth(0)
    this.looks = {
      given: ensureBevelPanel(this, cell, cell, GIVEN_COLOR, 0, true),
      open: ensureBevelPanel(this, cell, cell, OPEN_COLOR, 4, true),
      wrong: ensureBevelPanel(this, cell, cell, WRONG_COLOR, 4, true),
      locked: ensureBevelPanel(this, cell, cell, LOCKED_COLOR, 0, true),
    }
    const offset = (i: number): number =>
      pad + i * cell + (i - Math.floor(i / box)) * inner + Math.floor(i / box) * gutter
    const font = Math.max(16, Math.floor((cell * 0.46) / 8) * 8)
    for (let i = 0; i < n * n; i++) {
      const x = left + offset(i % n) + cell / 2
      const y = top + offset(Math.floor(i / n)) + cell / 2
      const image = this.add.image(x, y, this.looks.open).setDepth(1)
      image.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.select(i, true))
      const label = this.add
        .text(x, y, '', headlineStyle(font, PALETTE.text))
        .setOrigin(0.5)
        .setDepth(3)
      this.cells.push({ image, label, x, y, look: '' })
    }
    this.caret = this.add
      .rectangle(0, 0, cell + 8, cell + 8)
      .setStrokeStyle(4, PALETTE.amber)
      .setDepth(4)
      .setVisible(false)

    // Number pad: 1..n plus a clear key.
    this.keyValues = [...Array.from({ length: n }, (_, i) => i + 1), 0]
    const count = this.keyValues.length
    const gap = this.compact ? 8 : 12
    const contentW = Math.min(width - 32, 560)
    const kw = Math.floor(Math.min(this.compact ? 88 : 96, (contentW - gap * (count - 1)) / count))
    const kh = this.compact ? 64 : 72
    const padW = kw * count + gap * (count - 1)
    const shadowKey = ensureBevelPanel(this, kw, kh, shade(PALETTE.bg, -0.5), 0, true)
    this.keyValues.forEach((value, i) => {
      const x = cx - padW / 2 + kw / 2 + i * (kw + gap)
      const y = this.padTop + kh / 2
      const color = value === 0 ? CLEAR_COLOR : KEY_COLOR
      const shadow = this.add.image(x, y + PRESS_PX, shadowKey)
      const face = this.add
        .image(x, y, ensureBevelPanel(this, kw, kh, color, 4, true))
        .setInteractive({ useHandCursor: true })
      face.on('pointerdown', () => this.enter(value))
      const label = this.add
        .text(
          x,
          y,
          value === 0 ? '←' : String(value),
          headlineStyle(this.compact ? 24 : 32, PALETTE.text, {
            stroke: '#10121c',
            strokeThickness: 6,
          }),
        )
        .setOrigin(0.5)
      this.keys.push({ shadow, face, label, y })
    })
    this.barBox = { ...this.barBox, x: cx - padW / 2, w: padW }
    if (this.rule) {
      this.rule.setText(this.t('game.sudokuRace.rule', { n }))
      fitText(this.rule, width - 32, this.compact ? 12 : 15)
    }
  }

  private board(): SudokuBoard | undefined {
    return this.snap?.boards[this.selfId]
  }

  private editable(board: SudokuBoard, i: number): boolean {
    return !board.done && !board.given[i] && !board.lockedMask[i]
  }

  private select(index: number, byTap: boolean): void {
    const board = this.board()
    const cell = this.cells[index]
    if (!board || !cell) return
    if (!this.editable(board, index)) {
      if (byTap) {
        this.sfx.tick()
        this.wiggle(cell)
      }
      return
    }
    if (index !== this.selected) this.sfx.click()
    this.selected = index
    punch(this, cell.image, 0.08, 60)
  }

  // First editable cell at or after `from` (wrapping), or -1 when none is left.
  private nextEditable(from: number): number {
    const board = this.board()
    if (!board) return -1
    const total = this.cells.length
    for (let k = 0; k < total; k++) {
      const i = (((from + k) % total) + total) % total
      if (this.editable(board, i)) return i
    }
    return -1
  }

  private coolingDown(): boolean {
    return this.time.now < this.cooldownEndsAt
  }

  private enter(value: number): void {
    const board = this.board()
    const key = this.keys[this.keyValues.indexOf(value)]
    if (!board || board.done || this.snap?.remainingMs === 0) return
    if (this.selected < 0 || this.coolingDown()) {
      // Pad is locked: a dull tick + a shake of the pad instead of an input.
      this.sfx.tick()
      for (const k of this.keys) this.wiggleObjs([k.face, k.label], k.face.x)
      return
    }
    if (value === 0 && !board.grid[this.selected]) return
    this.sfx.click()
    if (key) {
      for (const o of [key.face, key.label]) o.setY(key.y + PRESS_PX)
      this.time.delayedCall(90, () => {
        for (const o of [key.face, key.label]) o.setY(key.y)
      })
    }
    this.sendInput({ kind: 'fill', index: this.selected, value })
  }

  private handleKey(e: KeyboardEvent): void {
    const n = this.snap?.size ?? 0
    const digit = Number(e.key)
    // Arrows may repeat (cursor travel); a held digit must not keep re-entering itself.
    if (e.repeat && !e.key.startsWith('Arrow') && !/^[wasd]$/i.test(e.key)) return
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      a: [-1, 0],
      d: [1, 0],
      w: [0, -1],
      s: [0, 1],
    }
    const dir = arrows[e.key] ?? arrows[e.key.toLowerCase()]
    if (Number.isInteger(digit) && digit >= 1 && digit <= n) this.enter(digit)
    else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') this.enter(0)
    else if (dir) {
      e.preventDefault()
      this.move(dir[0], dir[1])
    }
  }

  // Arrow keys: walk from the selection to the next editable cell in that direction (or stay put).
  private move(dx: number, dy: number): void {
    const snap = this.snap
    const board = this.board()
    if (!snap || !board) return
    const n = snap.size
    const start = Math.max(0, this.selected)
    let col = start % n
    let row = Math.floor(start / n)
    for (let k = 0; k < n; k++) {
      col += dx
      row += dy
      if (col < 0 || col >= n || row < 0 || row >= n) return
      if (this.editable(board, row * n + col)) {
        this.select(row * n + col, false)
        return
      }
    }
  }

  private wiggle(cell: Cell): void {
    this.wiggleObjs([cell.image, cell.label], cell.x)
  }

  private wiggleObjs(
    objs: (Phaser.GameObjects.Image | Phaser.GameObjects.Text)[],
    x: number,
  ): void {
    for (const o of objs) {
      this.tweens.killTweensOf(o)
      o.setX(x)
    }
    this.tweens.add({
      targets: objs,
      x: x + 5,
      duration: 40,
      yoyo: true,
      repeat: 2,
      onComplete: () => {
        for (const o of objs) o.setX(x)
      },
    })
  }

  protected frame(snap: SudokuSnapshot | null, time: number): void {
    if (!snap) return
    const fresh = this.cells.length === 0
    if (fresh) this.build(snap)
    const me = this.selfId
    const board = snap.boards[me]
    const blanks = snap.blanksCount
    // Boards only change with a snapshot; the pad's cooldown bar and the caret animate in between.
    const changed = snap !== this.drawnSnap
    this.drawnSnap = snap
    if (changed) this.trackFinishers(snap)
    if (changed && (this.time.now >= this.stripAt || this.state.final)) {
      this.stripAt = this.time.now + STRIP_EVERY_MS
      const ranked = Object.entries(snap.boards).sort(
        (a, b) => b[1].correctCount - a[1].correctCount,
      )
      const shown = ranked.slice(0, this.scale.width >= 1400 ? MAX_CHIPS_WIDE : MAX_CHIPS)
      const mine = ranked.find(([id]) => id === me)
      if (mine && !shown.includes(mine)) shown[shown.length - 1] = mine
      this.strip?.set(
        shown.map(([id, b]) => {
          const name = this.label(id).slice(0, 10).toUpperCase()
          // The ✓ hugs the count, so a clipped name never cuts the stat.
          const text = `${name} ${b.correctCount}/${blanks}${b.done ? '✓' : ''}`
          return { text, avatar: this.state.avatarOf(id), color: this.state.colorOf(id) }
        }),
      )
    }
    if (!board) {
      // A spectator (not in this round): an empty board to look at, nothing to fill.
      if (fresh && this.prompt) {
        this.prompt.setText(this.t('game.common.waiting'))
        fitText(this.prompt, this.scale.width - 32, this.promptSize)
        for (const k of this.keys) for (const o of [k.shadow, k.face, k.label]) o.setAlpha(0.35)
      }
      return
    }
    this.hud?.setScore(`${board.correctCount}/${blanks}`)

    // Cooldown: re-anchored to local time on every fresh snapshot so the bar drains smoothly between
    // server ticks. A jump up in the remaining time is a new penalty (a wrong digit just landed).
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      if (board.cooldownMs > this.lastCooldownMs + 150) {
        this.cooldownTotal = board.cooldownMs
        if (!fresh) this.onWrong()
      }
      this.cooldownEndsAt = board.cooldownMs > 0 ? this.time.now + board.cooldownMs : 0
      this.lastCooldownMs = board.cooldownMs
    }

    if (changed) {
      const unitsBefore = completeUnits(board.given, this.prevLocked, snap.size)
      this.renderCells(board, fresh)
      // A digit locking in clicks into place; one that completes a row, column or box pays out like
      // a line clear (the solving digit is the finish's moment — onSolved).
      if (board.correctCount > this.prevCorrect && !fresh && !board.done) {
        const units = completeUnits(board.given, board.lockedMask, snap.size) - unitsBefore
        if (units > 0) this.sfx.lineClear(Math.min(4, units))
        else this.sfx.lock()
      }
      this.prevCorrect = board.correctCount
    }

    // Once the selected cell locks (or the board changes under it), hop to the next open cell. A fresh
    // board starts on its first open cell, so the digit keys work from the first press.
    if (this.selected < 0 ? fresh : !this.editable(board, this.selected)) {
      this.selected = this.nextEditable(this.selected + 1)
    }

    if (board.done && !this.finished) this.onSolved(fresh)
    this.renderPad(board, time)
    this.renderSelection(snap, time)
  }

  private renderCells(board: SudokuBoard, fresh: boolean): void {
    this.cells.forEach((cell, i) => {
      const given = board.given[i] ?? 0
      const value = given || board.grid[i] || 0
      const locked = board.lockedMask[i] ?? false
      let look: CellLook = 'open'
      if (given) look = 'given'
      else if (locked || board.done) look = 'locked'
      else if (value) look = 'wrong'
      cell.label.setText(value ? String(value) : '')
      if (look === cell.look) return
      cell.look = look
      cell.image.setTexture(this.looks[look])
      cell.label.setColor(hexToCss(INK[look]))
      if (fresh || look !== 'locked' || this.prevLocked[i] || board.done) return
      ring(this, cell.x, cell.y, PALETTE.lime, this.cellSize * 0.7)
      burst(this, cell.x, cell.y, PALETTE.lime, 10, 180)
      floatText(this, cell.x, cell.y, '+1', PALETTE.lime, 16)
      punch(this, cell.label, 0.3, 90)
    })
    this.prevLocked = [...board.lockedMask]
  }

  private renderPad(board: SudokuBoard, time: number): void {
    const cooling = this.coolingDown()
    const idle = board.done || this.selected < 0
    const key = `${cooling}:${idle}`
    if (key !== this.padKey) {
      this.padKey = key
      for (const k of this.keys) {
        const alpha = cooling ? 0.35 : idle ? 0.5 : 1
        for (const o of [k.shadow, k.face, k.label]) o.setAlpha(alpha)
        if (cooling) k.face.setTint(0x9a9a9a)
        else k.face.clearTint()
      }
      if (!cooling) {
        this.cooldownBar?.clear()
        this.cooldownLabel?.setText('')
      }
    }
    const g = this.cooldownBar
    if (!g || !cooling) return
    g.clear()
    const { x, y, w, h } = this.barBox
    const frac = Math.max(
      0,
      Math.min(1, (this.cooldownEndsAt - this.time.now) / Math.max(1, this.cooldownTotal)),
    )
    g.fillStyle(PALETTE.panelAlt, 1)
    g.fillRect(x, y, w, h)
    g.fillStyle(Math.floor(time / 120) % 2 ? PALETTE.red : shade(PALETTE.red, 0.25), 1)
    g.fillRect(x, y, Math.round(w * frac), h)
    this.cooldownLabel?.setText(this.t('game.sudokuRace.cooldown'))
  }

  private renderSelection(snap: SudokuSnapshot, time: number): void {
    const cell = this.cells[this.selected]
    const done = this.finished
    this.caret?.setVisible(!!cell && !done)
    if (cell && !done) {
      this.caret?.setPosition(cell.x, cell.y).setAlpha(Math.floor(time / 260) % 2 ? 1 : 0.45)
    }
    const text = done
      ? this.t('game.common.waiting')
      : this.t(cell ? 'game.sudokuRace.pickDigit' : 'game.sudokuRace.pickCell')
    if (this.prompt && this.prompt.text !== text) {
      this.prompt.setText(text).setColor(hexToCss(done ? PALETTE.lime : PALETTE.amber))
      fitText(this.prompt, this.scale.width - 32, this.promptSize)
    }
    // Faint row + column guide through the selected cell.
    const target = done ? -1 : this.selected
    if (target === this.drawnPeers || !this.peers) return
    this.drawnPeers = target
    this.peers.clear()
    if (target < 0) return
    const n = snap.size
    this.peers.fillStyle(PALETTE.text, 0.06)
    for (let i = 0; i < n * n; i++) {
      const c = this.cells[i]
      if (!c || i === target) continue
      if (i % n === target % n || Math.floor(i / n) === Math.floor(target / n)) {
        this.peers.fillRect(
          c.x - this.cellSize / 2,
          c.y - this.cellSize / 2,
          this.cellSize,
          this.cellSize,
        )
      }
    }
  }

  private onWrong(): void {
    this.sfx.wrong()
    shake(this, 0.006, 160)
    const cell = this.cells[this.selected]
    if (!cell) return
    floatText(this, cell.x, cell.y, this.t('game.common.wrong'), PALETTE.red, 16)
    this.wiggle(cell)
  }

  // A rival solving their board cheers (throttled); the first snapshot only learns who is done.
  private trackFinishers(snap: SudokuSnapshot): void {
    for (const [id, b] of Object.entries(snap.boards)) {
      if (!b.done || this.finishers.has(id)) continue
      this.finishers.add(id)
      if (this.firstSnapshot || id === this.selfId) continue
      if (this.time.now - this.cheerAt < CHEER_EVERY_MS) continue
      this.cheerAt = this.time.now
      this.sfx.cheer()
    }
  }

  private onSolved(fresh: boolean): void {
    this.finished = true
    if (!fresh) {
      // Solved: the crowd roars.
      this.sfx.cheer()
      this.sfx.coin()
      this.cheerAt = this.time.now
    }
    const { width, height } = this.scale
    burst(this, width / 2, height / 2, PALETTE.lime, 30, 320)
    burst(this, width / 2, height / 2, PALETTE.amber, 20, 260)
    if (this.banner) showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.lime)
  }
}
