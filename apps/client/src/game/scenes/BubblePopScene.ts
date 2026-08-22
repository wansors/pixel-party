import type { BubblePopSnapshot, ClientMsg } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'

// Color id 1..4 -> fill color. 0 (empty) is never rendered as a filled cell.
const COLOR_HEX: Record<number, number> = {
  1: 0xff5252,
  2: 0x5b8cff,
  3: 0x8be94b,
  4: 0xffcf4b,
}
const EMPTY_COLOR = 0x1d2740

// Bubble Pop canvas. Renders this player's own grid: tap one of the COLS targets along the bottom edge
// to shoot the upcoming color up that column — no drag-aim, just "choose a column". Scene key === id.
export class BubblePopScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private previewSwatch?: Phaser.GameObjects.Arc
  private cells: Phaser.GameObjects.Rectangle[] = []
  private targets: Phaser.GameObjects.Rectangle[] = []
  private built = false
  private prevScore = 0
  private prevDone = false

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('bubble-pop')
  }

  create(): void {
    this.built = false
    this.cells = []
    this.targets = []
    this.prevScore = 0
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

  private build(snap: BubblePopSnapshot): void {
    const { width, height } = this.scale
    const cx = width / 2
    const gridWidth = width * 0.85
    const gridHeight = height * 0.6
    const cell = Math.min(gridWidth / snap.cols, gridHeight / snap.rows)
    const area = { w: cell * snap.cols, h: cell * snap.rows }
    const startX = cx - area.w / 2 + cell / 2
    const startY = height * 0.18 + cell / 2
    for (let i = 0; i < snap.rows * snap.cols; i++) {
      const col = i % snap.cols
      const row = Math.floor(i / snap.cols)
      const x = startX + col * cell
      const y = startY + row * cell
      const rect = this.add
        .rectangle(x, y, cell - 3, cell - 3, EMPTY_COLOR)
        .setStrokeStyle(2, 0x3a4668)
      this.cells.push(rect)
    }
    const targetY = startY + area.h + cell * 0.6
    for (let col = 0; col < snap.cols; col++) {
      const x = startX + col * cell
      const target = this.add
        .rectangle(x, targetY, cell - 6, cell * 0.5, 0x2a3a5c)
        .setStrokeStyle(2, 0x4a5a8c)
        .setInteractive({ useHandCursor: true })
      target.on('pointerdown', () => this.shoot(col))
      this.targets.push(target)
    }
    this.previewSwatch = this.add.circle(cx, targetY + cell * 0.9, cell * 0.3, EMPTY_COLOR)
    this.built = true
  }

  private shoot(col: number): void {
    const snap = this.state.state as BubblePopSnapshot | null
    if (!snap) return
    const board = snap.boards[this.state.selfId ?? '']
    if (!board || board.done) return
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'shoot', col } })
  }

  override update(): void {
    const snap = this.state.state as BubblePopSnapshot | null
    if (!snap) return
    if (!this.built) this.build(snap)
    const board = snap.boards[this.state.selfId ?? '']
    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    if (!board) return
    if (board.done) {
      this.status?.setText(this.t('game.common.done'))
    } else {
      this.status?.setText(this.t('game.bubblePop.score', { n: board.score }))
    }
    if (board.score > this.prevScore) this.sfx.pop()
    if (board.done && !this.prevDone) this.sfx.coin()
    this.prevScore = board.score
    this.prevDone = board.done
    for (let i = 0; i < this.cells.length; i++) {
      const rect = this.cells[i]
      if (!rect) continue
      const value = board.grid[i] ?? 0
      rect.setFillStyle(value ? (COLOR_HEX[value] ?? EMPTY_COLOR) : EMPTY_COLOR)
    }
    this.previewSwatch?.setFillStyle(COLOR_HEX[board.nextColor] ?? EMPTY_COLOR)
    for (const target of this.targets) {
      target.setVisible(!board.done)
    }
  }
}
