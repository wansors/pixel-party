import { PALETTE } from '@pp/shared'
import type { ClientMsg, SudokuSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import {
  addArcadeBackdrop,
  bodyStyle,
  ensurePixelBlock,
  headlineStyle,
  hexToCss,
} from '../pixelStyle'

const BOX = 2
const DONE_BG = 0x14301f
const LOCKED_BG = 0x101a30

// Sudoku Race canvas. Renders this player's own 4x4 board: locked givens plus tappable blanks that
// cycle 0→1→2→3→4→0 on each tap. Alternating 2x2 box shading makes the sudoku structure readable at a
// glance; a live "N correct" counter (never per-cell) is the only feedback until the board is solved.
// Scene key === mini-game id.
export class SudokuRaceScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private cells: {
    cell: Phaser.GameObjects.Image
    label: Phaser.GameObjects.Text
    baseKey: string
  }[] = []
  private built = false
  private prevCorrect = 0
  private prevDone = false
  private doneKey = ''
  private lockedKey = ''

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('sudoku-race')
  }

  create(): void {
    this.built = false
    this.cells = []
    this.prevCorrect = 0
    this.prevDone = false
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.06, '', headlineStyle(24, PALETTE.lime))
      .setOrigin(0.5)
    this.status = this.add.text(cx, height * 0.12, '', bodyStyle(18, PALETTE.dim)).setOrigin(0.5)
  }

  private build(snap: SudokuSnapshot): void {
    const { width, height } = this.scale
    const cx = width / 2
    const area = Math.min(width * 0.85, height * 0.68)
    const cell = area / snap.size
    const startX = cx - area / 2 + cell / 2
    const startY = height * 0.22 + cell / 2
    const sizePx = Math.max(1, Math.round(cell - 3))
    const box0Key = ensurePixelBlock(this, `pp-sudoku-box0-${sizePx}`, sizePx, PALETTE.panel)
    const box1Key = ensurePixelBlock(this, `pp-sudoku-box1-${sizePx}`, sizePx, PALETTE.panelAlt)
    this.doneKey = ensurePixelBlock(this, `pp-sudoku-done-${sizePx}`, sizePx, DONE_BG)
    this.lockedKey = ensurePixelBlock(this, `pp-sudoku-locked-${sizePx}`, sizePx, LOCKED_BG)
    for (let i = 0; i < snap.size * snap.size; i++) {
      const col = i % snap.size
      const row = Math.floor(i / snap.size)
      const x = startX + col * cell
      const y = startY + row * cell
      const box = (Math.floor(row / BOX) + Math.floor(col / BOX)) % 2
      const baseKey = box === 0 ? box0Key : box1Key
      const cellImg = this.add.image(x, y, baseKey).setDisplaySize(cell - 3, cell - 3)
      const label = this.add
        .text(x, y, '', bodyStyle(Math.floor(cell * 0.45), PALETTE.text))
        .setOrigin(0.5)
      if (!snap.given[i]) {
        cellImg.setInteractive({ useHandCursor: true })
        cellImg.on('pointerdown', () => this.tap(i, snap.size))
      }
      this.cells.push({ cell: cellImg, label, baseKey })
    }
    this.built = true
  }

  private tap(index: number, size: number): void {
    const snap = this.state.state as SudokuSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const board = snap.boards[selfId]
    if (!board || board.done || board.lockedMask[index]) return
    const value = ((board.grid[index] ?? 0) + 1) % (size + 1)
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'fill', index, value } })
  }

  override update(): void {
    const snap = this.state.state as SudokuSnapshot | null
    if (!snap) return
    if (!this.built) this.build(snap)
    const selfId = this.state.selfId ?? ''
    const board = snap.boards[selfId]
    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    if (!board) return
    if (board.done) {
      this.status?.setText(this.t('game.common.done'))
    } else {
      this.status?.setText(this.t('game.common.correct', { n: board.correctCount }))
    }
    if (board.correctCount > this.prevCorrect) this.sfx.correct()
    if (board.done && !this.prevDone) this.sfx.coin()
    this.prevCorrect = board.correctCount
    this.prevDone = board.done
    for (let i = 0; i < this.cells.length; i++) {
      const cellEl = this.cells[i]
      if (!cellEl) continue
      const given = snap.given[i] ?? 0
      const locked = board.lockedMask[i] ?? false
      const value = given || board.grid[i] || 0
      cellEl.label.setText(value ? String(value) : '')
      cellEl.label.setColor(
        given ? '#6fa8ff' : board.done || locked ? '#2a9d3f' : hexToCss(PALETTE.text),
      )
      cellEl.cell.setTexture(
        board.done ? this.doneKey : given || locked ? this.lockedKey : cellEl.baseKey,
      )
    }
  }
}
