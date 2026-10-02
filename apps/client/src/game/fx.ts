import { PALETTE } from '@pp/shared'
import Phaser from 'phaser'
import { headlineStyle, hexToCss, shade } from './pixelStyle'

// Shared "game feel" kit for mini-game scenes (art-direction.md §4: screen-shake on big moments, sprite
// flashes on hits, floating pixel "+10" pops, pixel confetti). Every helper is fire-and-forget: it owns
// the objects it spawns and destroys them when done, so scenes never have to track them. All motion is
// short and snappy — feedback, never decoration that competes with the game.

const PIXEL_KEY = 'pp-fx-pixel'

// A single white 4x4 texel, tinted per particle — one texture serves every burst color.
function ensurePixelTexture(scene: Phaser.Scene): string {
  if (!scene.textures.exists(PIXEL_KEY)) {
    const g = scene.make.graphics({ x: 0, y: 0 })
    g.fillStyle(0xffffff, 1)
    g.fillRect(0, 0, 4, 4)
    g.generateTexture(PIXEL_KEY, 4, 4)
    g.destroy()
  }
  return PIXEL_KEY
}

// Floating score/label pop ("+1", "MISS", "x3 COMBO") that rises and fades out.
export function floatText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  color: number = PALETTE.amber,
  size = 20,
): void {
  const label = scene.add
    .text(x, y, text, headlineStyle(size, color, { stroke: '#10121c', strokeThickness: 4 }))
    .setOrigin(0.5)
    .setDepth(900)
  // Keep pops fully on screen near the edges (a "+1" at a basket hugging the wall, say).
  const half = label.width / 2 + 4
  label.setX(Phaser.Math.Clamp(x, half, Math.max(half, scene.scale.width - half)))
  scene.tweens.add({
    targets: label,
    y: y - size * 2.4,
    alpha: { from: 1, to: 0 },
    duration: 750,
    ease: 'Cubic.easeOut',
    onComplete: () => label.destroy(),
  })
}

// Exploding shower of square pixels (hits, pops, catches, confetti). `count` pixels fly out radially
// with a little gravity, in `color` plus a lighter highlight tint.
export function burst(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number = PALETTE.amber,
  count = 12,
  speed = 220,
): void {
  const key = ensurePixelTexture(scene)
  const emitter = scene.add.particles(x, y, key, {
    speed: { min: speed * 0.4, max: speed },
    angle: { min: 0, max: 360 },
    lifespan: { min: 280, max: 560 },
    gravityY: speed * 1.4,
    scale: { start: 1.4, end: 0.4 },
    alpha: { start: 1, end: 0 },
    tint: [color, shade(color, 0.45), color],
    emitting: false,
  })
  emitter.setDepth(850)
  emitter.explode(count)
  scene.time.delayedCall(700, () => emitter.destroy())
}

// Expanding hollow ring — a "ping" for correct taps, landings, catches.
export function ring(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number = PALETTE.lime,
  radius = 40,
): void {
  const circle = scene.add
    .circle(x, y, radius * 0.3)
    .setStrokeStyle(4, color)
    .setDepth(840)
  scene.tweens.add({
    targets: circle,
    radius,
    alpha: { from: 1, to: 0 },
    duration: 360,
    ease: 'Quad.easeOut',
    onComplete: () => circle.destroy(),
  })
}

// Camera shake for big moments (a bomb, a knock-out, a wrong answer). Intensity is a fraction of the
// viewport (Phaser's convention); keep it small so text stays readable.
export function shake(scene: Phaser.Scene, intensity = 0.008, durationMs = 180): void {
  scene.cameras.main.shake(durationMs, intensity)
}

// Full-screen color wash (hit feedback / GO moment). A translucent overlay that fades out — unlike the
// camera's flash, which starts on a fully opaque frame and blinds the player on frequent events.
export function flash(
  scene: Phaser.Scene,
  color: number = PALETTE.text,
  durationMs = 160,
  alpha = 0.4,
): void {
  const { width, height } = scene.scale
  const wash = scene.add
    .rectangle(0, 0, width, height, color, alpha)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(990)
  scene.tweens.add({
    targets: wash,
    alpha: 0,
    duration: durationMs,
    ease: 'Quad.easeOut',
    onComplete: () => wash.destroy(),
  })
}

// Punchy scale bounce on any scalable object (buttons, counters, sprites) — reads as "that registered".
// Base scale is captured from the target so objects sized with setDisplaySize keep their size.
export function punch(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject,
  amount = 0.18,
  durationMs = 90,
): void {
  const sx = target.getData('pp-base-sx') ?? target.scaleX
  const sy = target.getData('pp-base-sy') ?? target.scaleY
  target.setData('pp-base-sx', sx).setData('pp-base-sy', sy)
  scene.tweens.killTweensOf(target)
  target.setScale(sx, sy)
  scene.tweens.add({
    targets: target,
    scaleX: sx * (1 + amount),
    scaleY: sy * (1 + amount),
    duration: durationMs,
    yoyo: true,
    ease: 'Quad.easeOut',
    onComplete: () => target.setScale(sx, sy),
  })
}

// The elimination moment (Squid-style rounds): a burst in the player's color, a red ring, a slammed
// rotated stamp ("ELIMINATED!") over the spot and a small shake — being out is part of the show. The
// sound sting is the scene's call (`sfx.eliminated()`), so several simultaneous outs play it once.
export function eliminate(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number,
  text: string,
  size = 16,
): void {
  burst(scene, x, y, color, 24, 280)
  ring(scene, x, y, PALETTE.red, 56)
  shake(scene, 0.006, 160)
  const stamp = scene.add
    .text(x, y, text, headlineStyle(size, PALETTE.red, { stroke: '#10121c', strokeThickness: 6 }))
    .setOrigin(0.5)
    .setDepth(905)
    .setAngle(-8)
    .setScale(2.2)
    .setAlpha(0)
  // Keep the stamp fully on screen next to the edges.
  const half = stamp.width / 2 + 4
  stamp.setX(Phaser.Math.Clamp(x, half, Math.max(half, scene.scale.width - half)))
  scene.tweens.chain({
    targets: stamp,
    tweens: [
      { scale: 1, alpha: 1, duration: 160, ease: 'Back.easeOut' },
      { alpha: 0, y: y - size, delay: 900, duration: 300, ease: 'Quad.easeIn' },
    ],
    onComplete: () => stamp.destroy(),
  })
}

// Big centered banner ("YOU WIN!", "OUT!", "LOCKED IN") that slams in and stays until replaced or
// hidden (32 px, 24 px on phones; showBanner shrinks it further to fit). Returns the text so the scene
// can update/hide it; call once per scene and reuse.
export function addBanner(scene: Phaser.Scene, depth = 950): Phaser.GameObjects.Text {
  const { width, height } = scene.scale
  const size = Math.min(width, height) < 520 ? 24 : 32
  return scene.add
    .text(
      width / 2,
      height / 2,
      '',
      headlineStyle(size, PALETTE.amber, {
        stroke: '#10121c',
        strokeThickness: 8,
        align: 'center',
      }),
    )
    .setOrigin(0.5)
    .setDepth(depth)
    .setVisible(false)
}

// Shows (or updates) a banner with a slam-in pop the first time a given text appears.
export function showBanner(
  scene: Phaser.Scene,
  banner: Phaser.GameObjects.Text,
  text: string,
  color: number = PALETTE.amber,
): void {
  const changed = !banner.visible || banner.text !== text
  banner.setText(text).setColor(hexToCss(color)).setVisible(true)
  if (!changed) return
  // Shrink (in 8 px steps, the pixel font's crisp sizes) until the text fits 92% of the screen width.
  const maxW = scene.scale.width * 0.92
  const base = banner.getData('pp-base-size') ?? Number.parseInt(String(banner.style.fontSize), 10)
  banner.setData('pp-base-size', base)
  let size = base
  banner.setFontSize(size)
  while (banner.width > maxW && size > 16) {
    size -= 8
    banner.setFontSize(size)
  }
  scene.tweens.killTweensOf(banner)
  banner.setScale(1.8).setAlpha(0)
  scene.tweens.add({
    targets: banner,
    scale: 1,
    alpha: 1,
    duration: 180,
    ease: 'Back.easeOut',
  })
}
