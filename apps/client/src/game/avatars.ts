import type { AvatarId } from '@pp/shared'
import type Phaser from 'phaser'
import { AVATAR_DARK, AVATAR_SPRITES } from './avatarSprites'
import { ensurePixelGrid } from './pixelStyle'

export { AVATAR_DARK, AVATAR_SPRITES, toAvatarId } from './avatarSprites'

// Generates (and caches) a Phaser texture of `avatar` tinted in the player's identity color. `pixel` is
// the size of one sprite pixel in texture pixels; scale the image with setDisplaySize as needed.
export function ensureAvatarTexture(
  scene: Phaser.Scene,
  avatar: AvatarId,
  color: number,
  pixel = 4,
): string {
  return ensurePixelGrid(scene, {
    key: `pp-avatar-${avatar}-${color.toString(16)}-${pixel}`,
    rows: AVATAR_SPRITES[avatar] ?? AVATAR_SPRITES.cat,
    legend: { B: color, D: AVATAR_DARK },
    pixelSize: pixel,
  })
}
