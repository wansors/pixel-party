import { PALETTE, TEAMS, type TeamId } from '@pp/shared'
import Phaser from 'phaser'

// Shared "classic pixel-art arcade" rendering kit for mini-game scenes (see docs/art-direction.md).
// Every scene currently draws flat Phaser primitives (Rectangle/Circle/plain text) in colors that
// drifted from packages/shared/src/theme.ts's PALETTE — this file is the one place that turns those
// primitives into chunky, outlined, shaded pixel-art textures and ties text/colors back to PALETTE.

// --- Font -------------------------------------------------------------------------------------------

// Self-hosted "Press Start 2P"-style pixel font (see styles.scss @font-face, art-direction.md §3).
export const PIXEL_FONT = 'PixelArcade, monospace'

let fontReady: Promise<void> | undefined

// Canvas text only picks up a webfont once the browser has actually finished loading it — call this
// once (GameClient.boot does) before the first scene renders PIXEL_FONT text, or the first frame falls
// back to the browser's default serif until the swap happens.
export function ensurePixelFontLoaded(): Promise<void> {
  if (!fontReady) {
    fontReady =
      typeof document === 'undefined' || !('fonts' in document)
        ? Promise.resolve()
        : document.fonts
            .load('16px PixelArcade')
            .then(() => undefined)
            .catch(() => undefined)
  }
  return fontReady
}

// Phaser's Text#setColor re-rasterizes the text's canvas texture on EVERY call, even when the color
// didn't change — and scenes restate their status colors every frame. Installed once at boot
// (GameClient): skip the redraw when the color is unchanged. Same return value (the Text) either way.
let textColorGuardInstalled = false
export function installTextColorGuard(): void {
  if (textColorGuardInstalled) return
  textColorGuardInstalled = true
  type StyleProto = { color: unknown; parent: unknown; setColor(color: unknown): unknown }
  const proto = Phaser.GameObjects.TextStyle?.prototype as unknown as StyleProto | undefined
  if (!proto) return
  const original = proto.setColor
  proto.setColor = function (this: StyleProto, color: unknown): unknown {
    return this.color === color ? this.parent : original.call(this, color)
  }
}

export function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`
}

// Headline/HUD text — big numbers, timers, prompts, banners. Chunky pixel font.
export function headlineStyle(
  size: number,
  color: string | number = PALETTE.text,
  extra: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: PIXEL_FONT,
    fontSize: `${size}px`,
    color: typeof color === 'number' ? hexToCss(color) : color,
    ...extra,
  }
}

// Body/hint text — rules, small print, per-player boards. Press Start 2P reads poorly at small sizes
// and on long lines, so this stays plain monospace (art-direction §3: "legibility wins over theme for
// instructions").
export function bodyStyle(
  size: number,
  color: string | number = PALETTE.dim,
  extra: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: 'monospace',
    fontSize: `${size}px`,
    color: typeof color === 'number' ? hexToCss(color) : color,
    ...extra,
  }
}

// --- Color shading ------------------------------------------------------------------------------------

// Lightens (amount > 0) or darkens (amount < 0) a 0xRRGGBB color, amount in [-1, 1]. Used to derive the
// dark outline / light highlight of a base color for 2-tone pixel-art shading.
export function shade(hex: number, amount: number): number {
  const r = (hex >> 16) & 0xff
  const g = (hex >> 8) & 0xff
  const b = hex & 0xff
  const f = (c: number): number =>
    Math.max(0, Math.min(255, Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))))
  return (f(r) << 16) | (f(g) << 8) | f(b)
}

// --- Arcade backdrop ----------------------------------------------------------------------------------

const BACKDROP_KEY = 'pp-backdrop-tile'

// Subtle repeating pixel dot-grid sat behind a scene's own visuals (depth -1000) so the canvas never
// reads as one flat fill color — call once from create(), in any order relative to the rest of the
// scene's setup. Purely decorative: never obstructs readability (single dim dot every 8px).
export function addArcadeBackdrop(scene: Phaser.Scene): void {
  if (!scene.textures.exists(BACKDROP_KEY)) {
    const size = 8
    const g = scene.make.graphics({ x: 0, y: 0 })
    g.fillStyle(PALETTE.bg, 1)
    g.fillRect(0, 0, size, size)
    g.fillStyle(shade(PALETTE.bg, 0.15), 1)
    g.fillRect(0, 0, 1, 1)
    g.generateTexture(BACKDROP_KEY, size, size)
    g.destroy()
  }
  const { width, height } = scene.scale
  const tile = scene.add
    .tileSprite(0, 0, width, height, BACKDROP_KEY)
    .setOrigin(0, 0)
    .setDepth(-1000)
  const onResize = (gameSize: Phaser.Structs.Size): void => {
    tile.setSize(gameSize.width, gameSize.height)
  }
  scene.scale.on('resize', onResize)
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.scale.off('resize', onResize))
}

// --- Pixel-grid sprites (ASCII-art texture generator) --------------------------------------------------

export interface PixelGridSpec {
  readonly key: string
  readonly rows: readonly string[]
  readonly legend: Readonly<Record<string, number>>
  readonly pixelSize?: number
}

// Generates (and caches by key) a texture from an ASCII pixel-grid + color legend — the same DSL as
// PixelAvatarComponent's "monigote" sprites ('_' = transparent, any other char = a legend color).
// Returns the texture key so callers can `scene.add.image(x, y, key)` immediately.
export function ensurePixelGrid(scene: Phaser.Scene, spec: PixelGridSpec): string {
  const { key, rows, legend, pixelSize = 4 } = spec
  if (scene.textures.exists(key)) return key
  const w = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const g = scene.make.graphics({ x: 0, y: 0 })
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = legend[row[x] ?? '_']
      if (color === undefined) continue
      g.fillStyle(color, 1)
      g.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize)
    }
  })
  g.generateTexture(key, w * pixelSize, rows.length * pixelSize)
  g.destroy()
  return key
}

// --- Procedural chunky orb (ball/fruit/bubble/bomb base) ------------------------------------------------

// Generates (and caches by key) a round, outlined, 2-tone-shaded pixel-art orb: dark rim, base fill,
// light highlight in the upper-left quadrant — the "classic pixel ball" used across many mini-games
// (Pong/Sumo balls, Fruit Catch/Pixel Rain drops, Bubble Pop bubbles, Bomb Relay body, coins, dice…).
export function ensurePixelOrb(
  scene: Phaser.Scene,
  key: string,
  diameterCells: number,
  baseColor: number,
  pixelSize = 4,
): string {
  if (scene.textures.exists(key)) return key
  const r = diameterCells / 2
  const dark = shade(baseColor, -0.55)
  const light = shade(baseColor, 0.4)
  const g = scene.make.graphics({ x: 0, y: 0 })
  for (let y = 0; y < diameterCells; y++) {
    for (let x = 0; x < diameterCells; x++) {
      const dx = x + 0.5 - r
      const dy = y + 0.5 - r
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > r) continue
      const rim = dist > r - 1.1
      const highlight = !rim && dx < -r * 0.1 && dy < -r * 0.1 && dist < r * 0.6
      g.fillStyle(rim ? dark : highlight ? light : baseColor, 1)
      g.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize)
    }
  }
  g.generateTexture(key, diameterCells * pixelSize, diameterCells * pixelSize)
  g.destroy()
  return key
}

// --- Procedural beveled block (Tetris-style / generic tile) ---------------------------------------------

// Generates (and caches by key) a square pixel-art tile with a classic 90s beveled edge: light border on
// top/left, dark border on bottom/right, flat base fill in the center.
export function ensurePixelBlock(
  scene: Phaser.Scene,
  key: string,
  sizePx: number,
  baseColor: number,
  bevelPx = Math.max(2, Math.round(sizePx / 8)),
): string {
  if (scene.textures.exists(key)) return key
  const dark = shade(baseColor, -0.5)
  const light = shade(baseColor, 0.45)
  const g = scene.make.graphics({ x: 0, y: 0 })
  g.fillStyle(dark, 1)
  g.fillRect(0, 0, sizePx, sizePx)
  g.fillStyle(light, 1)
  g.fillRect(0, 0, sizePx - bevelPx, sizePx - bevelPx)
  g.fillStyle(baseColor, 1)
  g.fillRect(bevelPx, bevelPx, sizePx - bevelPx * 2, sizePx - bevelPx * 2)
  g.generateTexture(key, sizePx, sizePx)
  g.destroy()
  return key
}

// --- Beveled panel at its exact size (buttons, cards, answer tiles, signs) ------------------------------

// ensurePixelBlock is square and gets stretched by setDisplaySize — stretching its bevel with it. This
// generates (and caches) a panel at its real pixel size so the bevel stays one crisp width: light
// top/left edge, dark bottom/right edge, flat center. `outline` adds a dark 2 px rim with clipped
// corners (the chunkier "card" look).
export function ensureBevelPanel(
  scene: Phaser.Scene,
  width: number,
  height: number,
  color: number,
  bevel = 4,
  outline = false,
): string {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const key = `pp-bevel-${color.toString(16)}-${w}x${h}-${bevel}${outline ? '-o' : ''}`
  if (scene.textures.exists(key)) return key
  const g = scene.make.graphics({ x: 0, y: 0 })
  const o = outline ? 2 : 0
  if (outline) {
    g.fillStyle(shade(color, -0.65), 1)
    g.fillRect(o, 0, w - o * 2, h)
    g.fillRect(0, o, w, h - o * 2)
  }
  g.fillStyle(shade(color, -0.45), 1)
  g.fillRect(o, o, w - o * 2, h - o * 2)
  g.fillStyle(shade(color, 0.4), 1)
  g.fillRect(o, o, w - o * 2 - bevel, h - o * 2 - bevel)
  g.fillStyle(color, 1)
  g.fillRect(o + bevel, o + bevel, w - o * 2 - bevel * 2, h - o * 2 - bevel * 2)
  g.generateTexture(key, w, h)
  g.destroy()
  return key
}

// --- Fitting pixel-font text --------------------------------------------------------------------------

// Shrinks `text` to the largest crisp pixel-font size that fits `maxWidth`: `maxSize` first, then
// multiples of 8 down to 16, then 12 and 8 (Press Start 2P smears at in-between sizes).
export function fitText(text: Phaser.GameObjects.Text, maxWidth: number, maxSize: number): void {
  const sizes = [maxSize]
  for (let s = Math.floor((maxSize - 1) / 8) * 8; s >= 16; s -= 8) sizes.push(s)
  sizes.push(12, 8)
  for (const size of sizes) {
    text.setFontSize(size)
    if (text.width <= maxWidth) return
  }
}

// Pure estimate for a string that isn't on screen yet: Press Start 2P is ~1 em per glyph, so the
// crisp size (multiple of 8, at least 8, at most `maxSize`) whose line fits `maxWidth`.
export function fitFontSize(text: string, maxWidth: number, maxSize: number): number {
  const fit = Math.floor(maxWidth / Math.max(1, text.length) / 8) * 8
  return Math.max(8, Math.min(maxSize, fit))
}

// A team's hue as 0xRRGGBB for the canvas (TEAMS carries CSS strings for the Angular shell).
export function teamColor(team: TeamId): number {
  return Number.parseInt((TEAMS.find((t) => t.id === team)?.color ?? '#7b88a8').slice(1), 16)
}

// --- Playing card -------------------------------------------------------------------------------------

export const CARD_FACE = 0xf4f1e8
export const CARD_INK = PALETTE.bg

// Pixel playing card body (Higher or Lower, Match Pairs) (w x h px, `ps` = art pixel): stepped corners, dark outline, a shaded edge,
// and either a plain face with a thin inner frame or a patterned back.
export function ensureCardTexture(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  ps: number,
  back: boolean,
): string {
  if (scene.textures.exists(key)) return key
  const g = scene.make.graphics({ x: 0, y: 0 })
  const face = back ? PALETTE.frame : CARD_FACE
  g.fillStyle(CARD_INK, 1)
  g.fillRect(ps * 2, 0, w - ps * 4, h)
  g.fillRect(ps, ps, w - ps * 2, h - ps * 2)
  g.fillRect(0, ps * 2, w, h - ps * 4)
  g.fillStyle(face, 1)
  g.fillRect(ps * 2, ps, w - ps * 4, h - ps * 2)
  g.fillRect(ps, ps * 2, w - ps * 2, h - ps * 4)
  g.fillStyle(shade(face, -0.2), 1)
  g.fillRect(ps * 2, h - ps * 2, w - ps * 4, ps)
  g.fillRect(w - ps * 2, ps * 2, ps, h - ps * 4)
  if (back) {
    // Magenta border band around a diamond lattice.
    g.fillStyle(PALETTE.magenta, 1)
    g.fillRect(ps * 3, ps * 3, w - ps * 6, h - ps * 6)
    g.fillStyle(PALETTE.frame, 1)
    g.fillRect(ps * 4, ps * 4, w - ps * 8, h - ps * 8)
    g.fillStyle(PALETTE.frameLit, 1)
    for (let y = 4; y < h / ps - 4; y++) {
      for (let x = 4; x < w / ps - 4; x++) {
        if ((x + y) % 4 === 0 || (x - y + 400) % 4 === 0) g.fillRect(x * ps, y * ps, ps, ps)
      }
    }
  } else {
    g.fillStyle(shade(CARD_FACE, -0.12), 1)
    g.fillRect(ps * 3, ps * 3, w - ps * 6, ps)
    g.fillRect(ps * 3, h - ps * 4, w - ps * 6, ps)
    g.fillRect(ps * 3, ps * 3, ps, h - ps * 6)
    g.fillRect(w - ps * 4, ps * 3, ps, h - ps * 6)
  }
  g.generateTexture(key, w, h)
  g.destroy()
  return key
}
