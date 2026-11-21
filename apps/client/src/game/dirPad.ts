import { PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { ensurePixelBlock, headlineStyle, shade } from './pixelStyle'

const GLYPH = ['▲', '▶', '▼', '◀'] as const

// An on-screen four-way pad (arrow-key layout: ▲ on top, ◀ ▼ ▶ below) for the grid games that move
// one press at a time (Road Hop, Munch Maze). Directions are 0 up, 1 right, 2 down, 3 left. A press
// calls `onPress` at once; `flash` shows a key going down (call it for keyboard presses too, so the pad
// mirrors the keys). Its buttons are interactive objects, so a scene-wide pointer handler can skip
// presses that land on them (`currentlyOver` non-empty).
export class DirPad {
  private readonly keys = new Map<
    number,
    { img: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; y: number }
  >()
  private readonly up: string
  private readonly down: string

  // Width and height of a pad with `btn`-px keys and `gap`-px gaps.
  static size(btn: number, gap: number): { w: number; h: number } {
    return { w: btn * 3 + gap * 2, h: btn * 2 + gap }
  }

  constructor(
    private readonly scene: Phaser.Scene,
    cx: number,
    cy: number,
    btn: number,
    gap: number,
    compact: boolean,
    onPress: (dir: number) => void,
    depth = 50,
  ) {
    this.up = ensurePixelBlock(scene, 'pp-dirpad-key', 16, PALETTE.panelAlt)
    this.down = ensurePixelBlock(scene, 'pp-dirpad-key-down', 16, shade(PALETTE.panelAlt, -0.35))
    const step = btn + gap
    const top = cy - (btn * 2 + gap) / 2 + btn / 2
    const spots: [number, number, number][] = [
      [0, cx, top],
      [3, cx - step, top + step],
      [2, cx, top + step],
      [1, cx + step, top + step],
    ]
    for (const [dir, x, y] of spots) {
      const img = scene.add
        .image(x, y, this.up)
        .setDisplaySize(btn, btn)
        .setDepth(depth)
        .setInteractive({ useHandCursor: true })
      img.on('pointerdown', () => onPress(dir))
      const label = scene.add
        .text(x, y, GLYPH[dir] as string, headlineStyle(compact ? 16 : 24, PALETTE.text))
        .setOrigin(0.5)
        .setDepth(depth + 1)
      this.keys.set(dir, { img, label, y })
    }
  }

  flash(dir: number): void {
    const key = this.keys.get(dir)
    if (!key) return
    key.img.setTexture(this.down).setY(key.y + 2)
    key.label.setY(key.y + 2).setColor('#ffcf4b')
    this.scene.time.delayedCall(90, () => {
      key.img.setTexture(this.up).setY(key.y)
      key.label.setY(key.y).setColor('#eef1f7')
    })
  }
}
