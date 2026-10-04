import type { AvatarId } from '@pp/shared'
import type Phaser from 'phaser'
import { ensureAvatarTexture } from './avatars'
import { bodyStyle, hexToCss } from './pixelStyle'

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
// caller reserved (`maxRows * PlayerStrip.rowH(size)`); if a full room still doesn't fit at 8 px, the
// names are clipped ("PEPITO… 12" — the trailing stat is kept), so the strip never spills onto other
// content.
const ICON = 16
const ICON_GAP = 4
const MIN_FONT = 8
// Clipped names keep at least this many characters.
const MIN_NAME = 3

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
    // Reuse the chips already on screen (new text, color, face) and only create or destroy the
    // difference: a strip that changes several times a second must not churn display objects.
    for (const gone of this.chips.splice(chips.length)) {
      gone.icon?.destroy()
      gone.label.destroy()
    }
    chips.forEach((c, i) => {
      const text = c.avatar ? c.text : `■ ${c.text}`
      let view = this.chips[i]
      if (!view) {
        view = {
          label: this.scene.add
            .text(0, 0, text, bodyStyle(this.size, c.color, { fontStyle: 'bold' }))
            .setOrigin(0, 0.5),
        }
        this.chips[i] = view
      }
      view.label.setText(text).setColor(hexToCss(c.color)).setFontSize(this.size)
      view.label.setAlpha(c.dim ? 0.4 : 1)
      if (!c.avatar) {
        view.icon?.destroy()
        view.icon = undefined
        return
      }
      const face = ensureAvatarTexture(
        this.scene,
        c.avatar,
        c.color,
        1,
        'front',
        c.dim ? 'ko' : 'idle',
      )
      view.icon = (view.icon ?? this.scene.add.image(0, 0, face).setOrigin(0, 0.5))
        .setTexture(face)
        .setAlpha(c.dim ? 0.55 : 1)
    })
    // Fit the budget by arithmetic, then render once: the font is monospace, so a label's width scales
    // with its font size and its length — measured once here instead of re-rendering every label at
    // every candidate size.
    const texts = chips.map((c) => (c.avatar ? c.text : `■ ${c.text}`))
    const charW = this.chips.map((c, i) => c.label.width / Math.max(1, (texts[i] as string).length))
    const fits = (size: number, keep: number): boolean => {
      if (!Number.isFinite(this.maxRows)) return true
      const widths = this.chips.map(
        (c, i) =>
          (c.icon ? ICON + ICON_GAP : 0) +
          ((charW[i] as number) * clipName(texts[i] as string, keep).length * size) / this.size,
      )
      return (
        this.rowsFor(widths, size) * PlayerStrip.rowH(size) <=
        this.maxRows * PlayerStrip.rowH(this.size)
      )
    }
    const longest = Math.max(0, ...texts.map((t) => splitStat(t).name.length))
    let size = this.size
    while (size > MIN_FONT && !fits(size, longest)) size -= 1
    // Still too wide at the smallest font: clip the names, a character at a time.
    let keep = longest
    while (keep > MIN_NAME && !fits(size, keep)) keep -= 1
    if (keep < longest) {
      this.chips.forEach((c, i) => {
        c.label.setText(clipName(texts[i] as string, keep))
      })
    }
    this.layout(size)
  }

  // Where the i-th chip sits (its avatar, else its label), for effects anchored on a player's chip.
  positionOf(i: number): { x: number; y: number } | null {
    const c = this.chips[i]
    if (!c) return null
    if (c.icon) return { x: c.icon.x + ICON / 2, y: c.icon.y }
    return { x: c.label.x + c.label.width / 2, y: c.label.y }
  }

  // A chip's width: the icon (16 px, the avatar's own pixel grid) + a small gap + the label.
  private static width(c: ChipView): number {
    return (c.icon ? ICON + ICON_GAP : 0) + c.label.width
  }

  // Rows the chips need at a font size, given each chip's width at that size.
  private rowsFor(widths: readonly number[], size: number): number {
    const gap = size * 1.4
    let rows = 0
    let rowW = -1
    for (const w of widths) {
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

// "NAME 12" → name "NAME", stat " 12": a trailing token with a digit in it is the chip's stat.
function splitStat(text: string): { name: string; stat: string } {
  const cut = text.lastIndexOf(' ')
  return cut > 0 && /\d/.test(text.slice(cut))
    ? { name: text.slice(0, cut), stat: text.slice(cut) }
    : { name: text, stat: '' }
}

function clipName(text: string, keep: number): string {
  const { name, stat } = splitStat(text)
  return name.length > keep ? `${name.slice(0, keep)}…${stat}` : text
}
