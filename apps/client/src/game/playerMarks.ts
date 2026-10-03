import { PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { headlineStyle } from './pixelStyle'

// The cues that tell players apart on the canvas, shared by every scene so "which one is me?" always
// reads the same way (art-direction §6).

const OUTLINE = '#10121c'

// Name tag over/next to a character: the player's name (or YOU) in their identity color, outlined.
export function nameTagStyle(size: number, color: number): Phaser.Types.GameObjects.Text.TextStyle {
  return headlineStyle(size, color, { stroke: OUTLINE, strokeThickness: Math.max(2, size / 4) })
}

// The standard "this is you" cue: an amber ▼ with a dark outline, bobbing over your own character.
export class YouMarker {
  readonly text: Phaser.GameObjects.Text

  constructor(scene: Phaser.Scene, size = 12, depth = 800) {
    this.text = scene.add
      .text(0, 0, '▼', headlineStyle(size, PALETTE.amber, { stroke: OUTLINE, strokeThickness: 3 }))
      .setOrigin(0.5, 1)
      .setDepth(depth)
      .setVisible(false)
  }

  // Shows the marker just above `top` (the top edge of your character), centered on x.
  place(x: number, top: number, time: number): void {
    const bob = Math.round(Math.sin(time / 170) * 2)
    this.text.setPosition(Math.round(x), Math.round(top - 2 + bob)).setVisible(true)
  }

  hide(): void {
    this.text.setVisible(false)
  }
}
