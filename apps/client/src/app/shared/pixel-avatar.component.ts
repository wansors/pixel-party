import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core'
import type { AvatarId } from '@pp/shared'
import {
  AVATAR_SIZE,
  type AvatarExpression,
  type AvatarPose,
  avatarPalette,
  avatarPixels,
} from '../../game/avatarSprites'

// Preset 16x16 "monigote" sprite (grids in game/avatarSprites.ts, shared with the Phaser scenes), rendered
// as crisp SVG rects (self-hosted, CSP-safe) so every player reads as color + avatar + name, never color
// alone (art-direction §6). Same pixels, outline and shading as in every mini-game.

interface Cell {
  x: number
  y: number
  w: number
  fill: string
}

function parseColor(value: string): number {
  const hex = /^#?([0-9a-f]{6})$/i.exec(value.trim())?.[1]
  return hex ? Number.parseInt(hex, 16) : 0xff3e7f
}

function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

const BLINK_EVERY_MS = 3400
const BLINK_MS = 140

// <app-pixel-avatar [avatar]="'cat'" [color]="'#ff3e7f'" [size]="32" [blinks]="true" />
@Component({
  selector: 'app-pixel-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.viewBox]="viewBox"
      shape-rendering="crispEdges"
      class="pixel-avatar"
      role="img"
      [attr.aria-label]="avatar()"
    >
      @for (c of cells(); track $index) {
        <rect [attr.x]="c.x" [attr.y]="c.y" [attr.width]="c.w" height="1" [attr.fill]="c.fill" />
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
  readonly pose = input<AvatarPose>('front')
  readonly expression = input<AvatarExpression>('idle')
  // Idle avatars blink now and then, like in the mini-games (off by default: long lists stay still).
  readonly blinks = input(false)

  private readonly blinking = signal(false)

  protected readonly viewBox = `0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}`

  constructor() {
    // Timers only run for avatars that blink; a random phase so a row of them doesn't blink in unison.
    effect((onCleanup) => {
      if (!this.blinks()) return
      let timer: ReturnType<typeof setTimeout> | undefined
      const schedule = (delay: number): void => {
        timer = setTimeout(() => {
          this.blinking.set(true)
          timer = setTimeout(() => {
            this.blinking.set(false)
            schedule(BLINK_EVERY_MS - BLINK_MS)
          }, BLINK_MS)
        }, delay)
      }
      schedule(Math.random() * BLINK_EVERY_MS)
      onCleanup(() => {
        clearTimeout(timer)
        this.blinking.set(false)
      })
    })
  }

  // One rect per horizontal run of same-colored pixels (≈3× fewer DOM nodes than one per pixel).
  readonly cells = computed<Cell[]>(() => {
    const palette = avatarPalette(parseColor(this.color()))
    const out: Cell[] = []
    const expression = this.blinking() && this.expression() === 'idle' ? 'blink' : this.expression()
    avatarPixels(this.avatar(), this.pose(), expression).forEach((row, y) => {
      let x = 0
      while (x < row.length) {
        const role = row[x]
        let end = x + 1
        while (end < row.length && row[end] === role) end++
        if (role) out.push({ x, y, w: end - x, fill: toCss(palette[role]) })
        x = end
      }
    })
    return out
  })
}
