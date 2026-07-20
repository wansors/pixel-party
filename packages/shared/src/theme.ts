// Single source of truth for the retro classic-arcade palette (see docs/art-direction.md §2). Colors
// are given as 0xRRGGBB numbers for the Phaser canvas; `hexToCss` / the *_CSS arrays expose the same
// values to the Angular shell (which also mirrors them as CSS custom properties in styles.scss).

export const PALETTE = {
  bg: 0x10121c,
  panel: 0x1b1e2e,
  panelAlt: 0x252a40,
  frame: 0x3a3f66,
  frameLit: 0x5b62a6,
  text: 0xeef1f7,
  dim: 0x7b88a8,
  magenta: 0xff3e7f,
  cyan: 0x29d3f2,
  lime: 0x8be94b,
  amber: 0xffcf4b,
  orange: 0xff7b3d,
  red: 0xff5252,
} as const

export const hexToCss = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`

// Reserved player hues — highly distinct and high-contrast so rows stay readable side by side. A room
// hands these out in order; paired everywhere with the player's avatar + name (never color alone).
export const PLAYER_COLORS: readonly string[] = [
  '#ff3e7f',
  '#29d3f2',
  '#8be94b',
  '#ffcf4b',
  '#ff7b3d',
  '#b06bff',
  '#4be3c3',
  '#ff5252',
  '#5b8cff',
  '#f062d0',
]

// Preset pixel-avatar sprite ids (the "monigote" set). Sprite grids live client-side.
export const AVATARS = ['cat', 'dog', 'fox', 'owl', 'frog', 'bear'] as const
export type AvatarId = (typeof AVATARS)[number]
