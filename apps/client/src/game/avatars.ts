import type { AvatarId } from '@pp/shared'
import type Phaser from 'phaser'
import {
  AVATAR_SIZE,
  type AvatarExpression,
  type AvatarPose,
  avatarPalette,
  avatarPixels,
} from './avatarSprites'

export type { AvatarExpression, AvatarPose } from './avatarSprites'
export { AVATAR_SIZE, toAvatarId } from './avatarSprites'

// Generates (and caches) a Phaser texture of `avatar` in the player's identity color, in a pose (front,
// side facing right — flip it to face left — or back) and with an expression (idle, blink, happy, hurt,
// KO). `pixel` is the size of one sprite pixel in texture pixels; scale the image with setDisplaySize.
export function ensureAvatarTexture(
  scene: Phaser.Scene,
  avatar: AvatarId,
  color: number,
  pixel = 4,
  pose: AvatarPose = 'front',
  expression: AvatarExpression = 'idle',
): string {
  const key = `pp-avatar-${avatar}-${pose}-${expression}-${color.toString(16)}-${pixel}`
  if (scene.textures.exists(key)) return key
  const palette = avatarPalette(color)
  const g = scene.make.graphics({ x: 0, y: 0 }, false)
  avatarPixels(avatar, pose, expression).forEach((row, y) => {
    row.forEach((role, x) => {
      if (!role) return
      g.fillStyle(palette[role], 1)
      g.fillRect(x * pixel, y * pixel, pixel, pixel)
    })
  })
  g.generateTexture(key, AVATAR_SIZE * pixel, AVATAR_SIZE * pixel)
  g.destroy()
  return key
}

// Display sizes that keep a 16×16 avatar crisp: every sprite pixel covers the same number of screen
// pixels (24 is the one half-step, for small UI). avatarPx gives the largest one that fits the room a
// layout has (never below 16).
const AVATAR_STEPS = [16, 24, 32, 48, 64, 80, 96, 112, 128] as const

export function avatarPx(maxPx: number): number {
  let best: number = AVATAR_STEPS[0]
  for (const step of AVATAR_STEPS) if (step <= maxPx) best = step
  return best
}

const BLINK_EVERY_MS = 3400
const BLINK_MS = 140

// A player's avatar on the canvas: one Image whose texture follows the pose (front, side — flipped to
// face left — or back), the expression (happy, hurt, KO…) and an idle blink, so every scene animates
// the cast the same way. Tween/position `image` as usual; call tick() once per frame.
export class AvatarSprite {
  readonly image: Phaser.GameObjects.Image
  private pose: AvatarPose
  private expression: AvatarExpression = 'idle'
  // Players blink at different moments (derived from the identity color, stable across frames).
  private readonly blinkOffset: number

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly avatar: AvatarId,
    private readonly color: number,
    size: number,
    pose: AvatarPose = 'front',
  ) {
    this.pose = pose
    this.blinkOffset = (color % 997) * 37
    this.image = scene.add.image(0, 0, this.textureFor(pose, 'idle')).setDisplaySize(size, size)
  }

  setPose(pose: AvatarPose): this {
    this.pose = pose
    return this
  }

  // Side view faces right; a negative dx turns it to face left (0 keeps the current facing).
  face(dx: number): this {
    if (dx !== 0) this.image.setFlipX(dx < 0)
    return this
  }

  // Top-down facing from a motion vector (screen axes): back when moving up, front when moving down,
  // side (flipped as needed) when moving sideways. Small or diagonal-ish moves keep the current facing,
  // so the sprite doesn't flicker between views.
  faceMotion(dx: number, dy: number, still = 0.25): this {
    const ax = Math.abs(dx)
    const ay = Math.abs(dy)
    if (Math.max(ax, ay) < still) return this
    if (ax > ay * 1.3) return this.setPose('side').face(dx)
    if (ay > ax * 1.3) {
      this.image.setFlipX(false)
      return this.setPose(dy < 0 ? 'back' : 'front')
    }
    return this
  }

  setExpression(expression: AvatarExpression): this {
    this.expression = expression
    return this
  }

  // Applies the pose, the expression and the idle blink (call once per frame). A face that has to read
  // (happy, hurt, KO) turns a back view around to the front.
  tick(time: number): void {
    const blink =
      this.expression === 'idle' && (time + this.blinkOffset) % BLINK_EVERY_MS < BLINK_MS
    const pose = this.pose === 'back' && this.expression !== 'idle' ? 'front' : this.pose
    const key = this.textureFor(pose, blink ? 'blink' : this.expression)
    if (this.image.texture.key !== key) this.image.setTexture(key)
  }

  destroy(): void {
    this.image.destroy()
  }

  private textureFor(pose: AvatarPose, expression: AvatarExpression): string {
    return ensureAvatarTexture(this.scene, this.avatar, this.color, 4, pose, expression)
  }
}
