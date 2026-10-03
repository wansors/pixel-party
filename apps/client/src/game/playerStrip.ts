import type { AvatarId } from '@pp/shared'
import type Phaser from 'phaser'
import { ensureAvatarTexture } from './avatars'
import { bodyStyle } from './pixelStyle'

// One player's entry in a PlayerStrip: label (name + stat), identity color, dimmed when out/idle. With
// `avatar` the chip leads with the player's avatar (KO face when dimmed), else with a ■ in their color.
export interface PlayerChip {
  text: string
  color: number
  avatar?: AvatarId
  dim?: boolean
}

interface ChipView {
  icon?: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
}

// Wrapping, centered row(s) of "🐱 NAME 12" chips — one per player in their identity color — showing
// how everyone else is doing at a glance. Rebuilt only when the chip set actually changes. With
// `maxRows`, the font shrinks (down to 8 px) until the chips fit that many rows of the space the
// caller reserved (`maxRows * PlayerStrip.rowH(size)`), so long names never spill onto other content.
const ICON = 16
const ICON_GAP = 4

export class PlayerStrip {
  private chips: ChipView[] = []
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
    const key = chips.map((c) => `${c.text}|${c.color}|${c.avatar}|${c.dim ? 1 : 0}`).join(';')
    if (key === this.key) return
    this.key = key
    for (const c of this.chips) {
      c.icon?.destroy()
      c.label.destroy()
    }
    this.chips = chips.map((c) => {
      const label = this.scene.add
        .text(
          0,
          0,
          c.avatar ? c.text : `■ ${c.text}`,
          bodyStyle(this.size, c.color, { fontStyle: 'bold' }),
        )
        .setOrigin(0, 0.5)
        .setAlpha(c.dim ? 0.4 : 1)
      if (!c.avatar) return { label }
      const icon = this.scene.add
        .image(
          0,
          0,
          ensureAvatarTexture(this.scene, c.avatar, c.color, 1, 'front', c.dim ? 'ko' : 'idle'),
        )
        .setOrigin(0, 0.5)
        .setAlpha(c.dim ? 0.55 : 1)
      return { icon, label }
    })
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

  // A chip's width: the icon (16 px, the avatar's own pixel grid) + a small gap + the label.
  private static width(c: ChipView): number {
    return (c.icon ? ICON + ICON_GAP : 0) + c.label.width
  }

  // Rows needed at a font size (sets the chips' size as a side effect).
  private rowsAt(size: number): number {
    for (const c of this.chips) c.label.setFontSize(size)
    const gap = size * 1.4
    let rows = 0
    let rowW = -1
    for (const c of this.chips) {
      const w = PlayerStrip.width(c)
      if (rowW < 0 || rowW + gap + w > this.maxW) {
        rows++
        rowW = w
      } else rowW += gap + w
    }
    return rows
  }

  private layout(size: number): void {
    for (const c of this.chips) c.label.setFontSize(size)
    const gap = size * 1.4
    let row: ChipView[] = []
    let rowW = 0
    let y = this.y
    const flush = (): void => {
      let x = Math.round(this.cx - rowW / 2)
      for (const c of row) {
        c.icon?.setPosition(x, Math.round(y))
        c.label.setPosition(x + (c.icon ? ICON + ICON_GAP : 0), y)
        x += Math.round(PlayerStrip.width(c) + gap)
      }
      y += PlayerStrip.rowH(size)
      row = []
      rowW = 0
    }
    for (const c of this.chips) {
      const w = PlayerStrip.width(c)
      if (row.length > 0 && rowW + gap + w > this.maxW) flush()
      rowW = row.length > 0 ? rowW + gap + w : w
      row.push(c)
    }
    if (row.length > 0) flush()
  }
}
