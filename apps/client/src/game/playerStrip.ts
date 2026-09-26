import type Phaser from 'phaser'
import { bodyStyle } from './pixelStyle'

// One player's entry in a PlayerStrip: label (name + stat), identity color, dimmed when out/idle.
export interface PlayerChip {
  text: string
  color: number
  dim?: boolean
}

// Wrapping, centered row(s) of "■ NAME 12" chips — one per player in their identity color — showing
// how everyone else is doing at a glance. Rebuilt only when the chip set actually changes. With
// `maxRows`, the font shrinks (down to 8 px) until the chips fit that many rows of the space the
// caller reserved (`maxRows * PlayerStrip.rowH(size)`), so long names never spill onto other content.
export class PlayerStrip {
  private chips: Phaser.GameObjects.Text[] = []
  private key = ''

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly cx: number,
    private readonly y: number,
    private readonly maxW: number,
    private readonly size: number,
    private readonly maxRows = Number.POSITIVE_INFINITY,
  ) {}

  static rowH(size: number): number {
    return Math.round(size * 1.7)
  }

  set(chips: readonly PlayerChip[]): void {
    const key = chips.map((c) => `${c.text}|${c.color}|${c.dim ? 1 : 0}`).join(';')
    if (key === this.key) return
    this.key = key
    for (const c of this.chips) c.destroy()
    this.chips = chips.map((c) =>
      this.scene.add
        .text(0, 0, `■ ${c.text}`, bodyStyle(this.size, c.color, { fontStyle: 'bold' }))
        .setOrigin(0, 0.5)
        .setAlpha(c.dim ? 0.4 : 1),
    )
    let size = this.size
    const budget = Number.isFinite(this.maxRows) ? this.maxRows * PlayerStrip.rowH(this.size) : 0
    while (
      size > 8 &&
      Number.isFinite(this.maxRows) &&
      this.rowsAt(size) * PlayerStrip.rowH(size) > budget
    ) {
      size -= 1
    }
    this.layout(size)
  }

  // Rows needed at a font size (sets the chips' size as a side effect).
  private rowsAt(size: number): number {
    for (const t of this.chips) t.setFontSize(size)
    const gap = size * 1.4
    let rows = 0
    let rowW = -1
    for (const t of this.chips) {
      if (rowW < 0 || rowW + gap + t.width > this.maxW) {
        rows++
        rowW = t.width
      } else rowW += gap + t.width
    }
    return rows
  }

  private layout(size: number): void {
    for (const t of this.chips) t.setFontSize(size)
    const gap = size * 1.4
    let row: Phaser.GameObjects.Text[] = []
    let rowW = 0
    let y = this.y
    const flush = (): void => {
      let x = this.cx - rowW / 2
      for (const t of row) {
        t.setPosition(Math.round(x), y)
        x += t.width + gap
      }
      y += PlayerStrip.rowH(size)
      row = []
      rowW = 0
    }
    for (const t of this.chips) {
      if (row.length > 0 && rowW + gap + t.width > this.maxW) flush()
      rowW = row.length > 0 ? rowW + gap + t.width : t.width
      row.push(t)
    }
    if (row.length > 0) flush()
  }
}
