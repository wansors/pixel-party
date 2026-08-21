import type { ClientMsg, SudokuSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'

const BOX = 2

// Sudoku Race canvas. Renders this player's own 4x4 board: locked givens plus tappable blanks that
// cycle 0→1→2→3→4→0 on each tap. Alternating 2x2 box shading makes the sudoku structure readable at a
// glance; a live "N correct" counter (never per-cell) is the only feedback until the board is solved.
// Scene key === mini-game id.
export class SudokuRaceScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private cells: {
    rect: Phaser.GameObjects.Rectangle
    label: Phaser.GameObjects.Text
    baseColor: number
  }[] = []
  private built = false
  private prevCorrect = 0
  private prevDone = false

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
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.06, '', { fontFamily: 'monospace', fontSize: '24px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.status = this.add
      .text(cx, height * 0.12, '', { fontFamily: 'monospace', fontSize: '18px', color: '#9fb3c8' })
      .setOrigin(0.5)
  }

  private build(snap: SudokuSnapshot): void {
    const { width, height } = this.scale
    const cx = width / 2
    const area = Math.min(width * 0.85, height * 0.68)
    const cell = area / snap.size
    const startX = cx - area / 2 + cell / 2
    const startY = height * 0.22 + cell / 2
    for (let i = 0; i < snap.size * snap.size; i++) {
      const col = i % snap.size
      const row = Math.floor(i / snap.size)
      const x = startX + col * cell
      const y = startY + row * cell
      const box = (Math.floor(row / BOX) + Math.floor(col / BOX)) % 2
      const baseColor = box === 0 ? 0x1d2740 : 0x223257
      const rect = this.add
        .rectangle(x, y, cell - 3, cell - 3, baseColor)
        .setStrokeStyle(3, 0x3a4668)
      const label = this.add
        .text(x, y, '', {
          fontFamily: 'monospace',
          fontSize: `${Math.floor(cell * 0.45)}px`,
          color: '#e6edf3',
        })
        .setOrigin(0.5)
      if (!snap.given[i]) {
        rect.setInteractive({ useHandCursor: true })
        rect.on('pointerdown', () => this.tap(i, snap.size))
      }
      this.cells.push({ rect, label, baseColor })
    }
    this.built = true
  }

  private tap(index: number, size: number): void {
    const snap = this.state.state as SudokuSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const board = snap.boards[selfId]
    if (!board || board.done) return
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
      const value = given || board.grid[i] || 0
      cellEl.label.setText(value ? String(value) : '')
      cellEl.label.setColor(given ? '#6fa8ff' : board.done ? '#2a9d3f' : '#e6edf3')
      cellEl.rect.setFillStyle(board.done ? 0x14301f : given ? 0x101a30 : cellEl.baseColor)
    }
  }
}
