import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import type { AvatarId } from '@pp/shared'

// Preset 8x8 "monigote" sprites. Legend: '_' transparent · 'B' body (tinted with the player color) ·
// 'D' dark detail (outline / eyes). Kept tiny and self-hosted (rendered as crisp SVG rects, CSP-safe)
// so every player reads as color + avatar + name, never color alone (art-direction §6).
const SPRITES: Record<AvatarId, string[]> = {
  cat: [
    'B_____B_',
    'BB___BB_',
    'BBBBBBB_',
    'BDBBBDB_',
    'BBBBBBB_',
    'BDDDDDB_',
    '_BBBBB__',
    '__B_B___',
  ],
  dog: [
    'BB___BB_',
    'BBB_BBB_',
    '_BBBBB__',
    '_BDBDB__',
    '_BBBBB__',
    '_BDDDB__',
    '_BBBBB__',
    '__B_B___',
  ],
  fox: [
    'B_____B_',
    'BB___BB_',
    'BDB_BDB_',
    'BBBBBBB_',
    '_BBBBB__',
    '_BDBDB__',
    '__BBB___',
    '__B_B___',
  ],
  owl: [
    '_BBBBB__',
    'BB_B_BB_',
    'BDBBBDB_',
    'BBBBBBB_',
    'BBBBBBB_',
    '_BBBBB__',
    '_B_B_B__',
    '__B_B___',
  ],
  frog: [
    '_B___B__',
    'BDB_BDB_',
    'BBBBBBB_',
    'BBBBBBB_',
    '_BBBBB__',
    'BBBBBBB_',
    'B_BBB_B_',
    '________',
  ],
  bear: [
    'BB___BB_',
    'BBB_BBB_',
    '_BBBBB__',
    '_BDBDB__',
    '_BBBBB__',
    '_BBDBB__',
    '_BBBBB__',
    '__BBB___',
  ],
}

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
    const grid = SPRITES[this.avatar()] ?? SPRITES.cat
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
