import { AVATARS, type AvatarId } from '@pp/shared'
import type Phaser from 'phaser'
import { ensurePixelGrid } from './pixelStyle'

// The preset 8x8 "monigote" avatar sprites — the single source for both the Angular chrome
// (PixelAvatarComponent) and the Phaser scenes, so a player looks like the avatar they picked in the
// lobby inside every mini-game (art-direction §6). Legend: '_' transparent · 'B' body (tinted with the
// player color) · 'D' dark detail (outline / eyes).
export const AVATAR_SPRITES: Readonly<Record<AvatarId, readonly string[]>> = {
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

// Dark detail ink (eyes/mouth) shared by every avatar.
export const AVATAR_DARK = 0x141126

// Narrows an untrusted roster value (it travels as a plain string) to a known avatar id.
export function toAvatarId(value: string | undefined): AvatarId {
  return (AVATARS as readonly string[]).includes(value ?? '') ? (value as AvatarId) : 'cat'
}

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
