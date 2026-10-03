import { AVATARS, type AvatarId } from '@pp/shared'

// The preset 8x8 "monigote" avatar sprites — the single source for both the Angular chrome
// (PixelAvatarComponent) and the Phaser scenes (game/avatars.ts), so a player is drawn the same in every
// mini-game as in the lobby (art-direction §6). Pure data with no Phaser import: the join screen's
// avatar picker must not pull the game engine into the initial bundle. Legend: '_' transparent ·
// 'B' body (tinted with the player color) · 'D' dark detail (outline / eyes).
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
