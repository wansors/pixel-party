import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import type { AvatarId } from '@pp/shared'
import { AVATAR_SPRITES } from '../../game/avatarSprites'

// Preset 8x8 "monigote" sprite (grids in game/avatarSprites.ts, shared with the Phaser scenes), rendered as
// crisp SVG rects (self-hosted, CSP-safe) so every player reads as color + avatar + name, never color
// alone (art-direction §6).

interface Cell {
  x: number
  y: number
  fill: string
}

const DARK = '#141126'

// <app-pixel-avatar [avatar]="'cat'" [color]="'#ff3e7f'" [size]="32" />
@Component({
  selector: 'app-pixel-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 8 8"
      shape-rendering="crispEdges"
      class="pixel-avatar"
      role="img"
      [attr.aria-label]="avatar()"
    >
      @for (c of cells(); track $index) {
        <rect [attr.x]="c.x" [attr.y]="c.y" width="1" height="1" [attr.fill]="c.fill" />
      }
    </svg>
  `,
  styles: `
    .pixel-avatar {
      image-rendering: pixelated;
      display: block;
    }
  `,
})
export class PixelAvatarComponent {
  readonly avatar = input<AvatarId>('cat')
  readonly color = input<string>('#ff3e7f')
  readonly size = input<number>(32)

  readonly cells = computed<Cell[]>(() => {
    const grid = AVATAR_SPRITES[this.avatar()] ?? AVATAR_SPRITES.cat
    const body = this.color()
    const out: Cell[] = []
    grid.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]
        if (ch === 'B') out.push({ x, y, fill: body })
        else if (ch === 'D') out.push({ x, y, fill: DARK })
      }
    })
    return out
  })
}
