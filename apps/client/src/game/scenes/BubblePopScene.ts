import type { BubblePopSnapshot, ClientMsg } from '@pp/shared'
import { PALETTE } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { addArcadeBackdrop, bodyStyle, ensurePixelOrb, headlineStyle } from '../pixelStyle'

// Color id 1..4 -> fill color. 0 (empty) is never rendered as a filled cell.
const COLOR_HEX: Record<number, number> = {
  1: PALETTE.red,
  2: PALETTE.cyan,
  3: PALETTE.lime,
  4: PALETTE.amber,
}
const EMPTY_COLOR = PALETTE.panel
const ORB_DIAMETER_CELLS = 10

function bubbleKey(colorId: number): string {
  return `pp-bubble-orb-${colorId}`
}

// Bubble Pop canvas. Renders this player's own grid: tap one of the COLS targets along the bottom edge
// to shoot the upcoming color up that column — no drag-aim, just "choose a column". Scene key === id.
export class BubblePopScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private previewSwatch?: Phaser.GameObjects.Image
  private cells: { bg: Phaser.GameObjects.Rectangle; orb: Phaser.GameObjects.Image }[] = []
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
    addArcadeBackdrop(this)
    this.built = false
    this.cells = []
    this.targets = []
    this.prevScore = 0
    this.prevDone = false
    for (const value of Object.keys(COLOR_HEX)) {
      const id = Number(value)
      ensurePixelOrb(this, bubbleKey(id), ORB_DIAMETER_CELLS, COLOR_HEX[id] as number)
    }
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.06, '', headlineStyle(24, PALETTE.lime))
      .setOrigin(0.5)
    this.status = this.add.text(cx, height * 0.12, '', bodyStyle(18)).setOrigin(0.5)
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
      const bg = this.add
        .rectangle(x, y, cell - 3, cell - 3, EMPTY_COLOR)
        .setStrokeStyle(2, PALETTE.frame)
      const orb = this.add
        .image(x, y, bubbleKey(1))
        .setDisplaySize(cell - 6, cell - 6)
        .setVisible(false)
      this.cells.push({ bg, orb })
    }
    const targetY = startY + area.h + cell * 0.6
    for (let col = 0; col < snap.cols; col++) {
      const x = startX + col * cell
      const target = this.add
        .rectangle(x, targetY, cell - 6, cell * 0.5, PALETTE.panelAlt)
        .setStrokeStyle(2, PALETTE.frameLit)
        .setInteractive({ useHandCursor: true })
      target.on('pointerdown', () => this.shoot(col))
      this.targets.push(target)
    }
    this.previewSwatch = this.add
      .image(cx, targetY + cell * 0.9, bubbleKey(1))
      .setDisplaySize(cell * 0.6, cell * 0.6)
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
      const cellEl = this.cells[i]
      if (!cellEl) continue
      const value = board.grid[i] ?? 0
      cellEl.orb.setVisible(value > 0 && COLOR_HEX[value] !== undefined)
      if (value && COLOR_HEX[value] !== undefined) cellEl.orb.setTexture(bubbleKey(value))
    }
    if (COLOR_HEX[board.nextColor] !== undefined) {
      this.previewSwatch?.setTexture(bubbleKey(board.nextColor))
    }
    for (const target of this.targets) {
      target.setVisible(!board.done)
    }
  }
}
