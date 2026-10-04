import { PALETTE, type PixelRainSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import { AvatarSprite } from '../avatars'
import { addBanner, burst, flash, floatText, ring, shake, showBanner } from '../fx'
import { ServerClock } from '../netcode/ServerClock'
import {
  bodyStyle,
  ensurePixelGrid,
  fitFontSize,
  fitText,
  headlineStyle,
  shade,
} from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Mirrors the server's pixelRain.ts tuning: a block resolves against the avatar once its centre reaches
// HIT_Y and hits when that centre is within ±AVATAR_HALF (normalized x) of the avatar's centre. The
// avatar is drawn exactly so wide that "the block visibly touches it" == "the server counts a hit". It
// can't leave [AVATAR_MIN_X, AVATAR_MAX_X] (the kerbs) and slides at most MAX_SPEED widths per second.
const HIT_Y = 0.9
const AVATAR_HALF = 0.09
const AVATAR_MIN_X = 0.12
const AVATAR_MAX_X = 0.88
const MAX_SPEED = 1.6
const NEAR_MISS = 0.05 // a landing this much outside the hit zone earns a "NICE!"
// A moving pointer's target is sent at most this often (keys send every press/release at once).
const SEND_EVERY_MS = 33
// Blocks landing this close to you (normalized x) thud on the street — at most every THUD_EVERY_MS.
const THUD_NEAR = 0.3
const THUD_EVERY_MS = 120

// Block tint is cosmetic only (the server just sends ids): picked by id so everyone sees the same rain.
const BLOCK_COLORS = [PALETTE.red, PALETTE.magenta, PALETTE.orange, 0xb06bff]

// 8x8 beveled "pixel" block with a white glint.
const BLOCK_ROWS = [
  'oooooooo',
  'ohhhhhho',
  'ohbbbbdo',
  'ohbwbbdo',
  'ohbbbbdo',
  'ohbbbbdo',
  'oddddddo',
  'oooooooo',
]

interface Drop {
  block: Phaser.GameObjects.Image
  ghost: Phaser.GameObjects.Image
  shadow: Phaser.GameObjects.Rectangle
  color: number
  x: number
  y: number
}

// Pixel Rain canvas (Phase 5). The server owns the falling stream + eliminations; this renders the
// blocks on the server's clock (each falls linearly: the last snapshot is extrapolated, with a ground
// "shadow" telegraphing where each one lands) and the player's own avatar locally, sliding at the
// server's speed cap toward the same target the server has, so it stands where the server judges it.
// Steering: the mouse (the avatar follows the pointer; on touch, drag), or ◀ ▶ / A D — a held key
// heads for that kerb at full speed and letting go stops right there, so the keys move exactly as fast
// as the mouse. Falling blocks are pooled. A strip under the HUD shows who is still in.
export class PixelRainScene extends MiniGameScene<PixelRainSnapshot> {
  // You: your lobby avatar, looking the way you slide, wobbling like jelly.
  private avatar?: AvatarSprite
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private readonly drops = new Map<number, Drop>()
  private dropPool: Drop[] = []
  private readonly clock = new ServerClock()
  private steerKeys: { left: Phaser.Input.Keyboard.Key[]; right: Phaser.Input.Keyboard.Key[] } = {
    left: [],
    right: [],
  }
  private keySide = 0
  // Who is still in: avatar + name chips under the HUD (KO face once squashed).
  private strip?: PlayerStrip
  private rosterIds: string[] = []
  private blockKeys: string[] = []
  private lastTick = -1
  // Where you steer (sent to the server) and where the avatar is (sliding there at MAX_SPEED).
  private avatarX = 0.5
  private posX = 0.5
  private renderedX = 0.5
  // The server starts every target at 0.5: nothing is sent until the player actually steers (D28).
  private lastSentX = 0.5
  private lastSentAt = 0
  private movedAt = 0
  private alive = true
  // Joined after the round started (not in its snapshot): no avatar, just the rain and the strip.
  private spectating = false
  private started = false
  private lastStanding = false
  private thudAt = Number.NEGATIVE_INFINITY
  private lastAlive: Record<string, boolean> = {}
  private selfColor = 0
  private compact = false
  // Layout: normalized y 0 → y0 (top of the sky), HIT_Y → y90 (block touching the avatar's head).
  private y0 = 0
  private y90 = 0
  private groundY = 0
  private blockSize = 0
  private avatarScale = { x: 1, y: 1 }
  private rosterY = 0

  constructor(...deps: SceneDeps) {
    super('pixel-rain', ...deps)
  }

  override create(): void {
    super.create()
    this.clock.reset()
    this.lastTick = -1
    this.avatarX = 0.5
    this.posX = 0.5
    this.renderedX = 0.5
    this.lastSentX = 0.5
    this.alive = true
    this.spectating = false
    this.started = false
    this.lastStanding = false
    this.thudAt = Number.NEGATIVE_INFINITY
    this.lastAlive = {}
    for (const d of this.drops.values()) this.destroyDrop(d)
    this.drops.clear()
    this.dropPool = []
    this.keySide = 0
    this.lastSentAt = 0
    this.rosterIds = []

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.selfColor = this.state.colorOf(this.selfId, PALETTE.lime)
    this.blockKeys = BLOCK_COLORS.map((c, i) =>
      ensurePixelGrid(this, {
        key: `pp-rain-block-${i}`,
        rows: BLOCK_ROWS,
        legend: { o: shade(c, -0.55), h: shade(c, 0.4), b: c, d: shade(c, -0.25), w: PALETTE.text },
      }),
    )

    // Skyline silhouette behind the rain + a wet street along the bottom.
    const groundH = Math.max(20, Math.round(height * 0.05))
    this.groundY = height - groundH
    this.drawSkyline(width)
    this.add.rectangle(0, this.groundY, width, groundH, shade(PALETTE.panelAlt, -0.2)).setOrigin(0)
    this.add.rectangle(0, this.groundY, width, 3, PALETTE.frameLit).setOrigin(0)
    const puddles = this.add.graphics()
    puddles.fillStyle(PALETTE.cyan, 0.18)
    for (let x = 14, i = 0; x < width; x += 46 + ((i * 17) % 30), i++) {
      puddles.fillRect(x, this.groundY + 8 + (i % 2) * 5, 18 + (i % 3) * 8, 3)
    }
    const hint = this.add
      .text(
        width / 2,
        height - groundH / 2,
        this.t('game.pixelRain.hint'),
        bodyStyle(this.compact ? 11 : 13, PALETTE.text),
      )
      .setOrigin(0.5)
      .setAlpha(0.75)
    fitText(hint, width - 16, this.compact ? 11 : 13)

    // The avatar: exactly as wide as the server's hit zone minus one block (see AVATAR_HALF above).
    // Its size follows the hit zone, not the crisp avatar steps: the hit contract wins.
    this.blockSize = Math.max(20, Math.round(width * 0.06))
    const avatarW = Math.max(this.blockSize * 1.5, width * AVATAR_HALF * 2 - this.blockSize)
    this.avatar = new AvatarSprite(
      this,
      this.state.avatarOf(this.selfId),
      this.selfColor,
      Math.round(avatarW),
    )
    this.avatar.image
      .setOrigin(0.5, 1)
      .setPosition(width / 2, this.groundY + 2)
      .setDepth(30)
    this.avatarScale = { x: this.avatar.image.scaleX, y: this.avatar.image.scaleY }
    this.drawKerbs(width, avatarW)

    // A full room doesn't fit one row of chips on a phone: reserve two there.
    const stripFont = this.compact ? 11 : 13
    const stripRows = this.compact ? 2 : 1
    const rowH = PlayerStrip.rowH(stripFont)
    this.rosterY = this.top + 4 + rowH / 2
    this.strip = new PlayerStrip(this, width / 2, this.rosterY, width - 24, stripFont, stripRows)
    this.y0 = this.top + 4 + rowH * stripRows + 6 + this.blockSize / 2
    // Blocks resolve where they touch the top of the avatar's head (row 1 of its 16-row grid).
    this.y90 = this.groundY + 2 - avatarW * (15 / 16) - this.blockSize / 2

    this.banner = addBanner(this)
    this.subline = this.add
      .text(
        width / 2,
        height / 2 + (this.compact ? 34 : 46),
        '',
        headlineStyle(this.compact ? 8 : 16, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
          align: 'center',
        }),
      )
      .setOrigin(0.5)
      .setDepth(950)
      .setVisible(false)

    const kb = this.input.keyboard
    if (kb) {
      this.steerKeys = {
        left: [kb.addKey('LEFT'), kb.addKey('A')],
        right: [kb.addKey('RIGHT'), kb.addKey('D')],
      }
    }
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.aim(p.x))
    // A mouse steers by just moving over the street; a finger by dragging.
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown || !p.wasTouch) this.aim(p.x)
    })
  }

  // Dim, stable city silhouette (heights derived from the column index) so the sky isn't one flat fill.
  private drawSkyline(width: number): void {
    const g = this.add.graphics().setDepth(-10)
    const base = this.groundY
    const unit = Math.max(24, Math.round(width / 18))
    for (let x = 0, i = 0; x < width; x += unit, i++) {
      const floors = 4 + ((i * 7) % 5) * 2
      const h = floors * 12 + 6
      g.fillStyle(shade(PALETTE.bg, 0.07), 1)
      g.fillRect(x, base - h, unit - 4, h)
      g.fillStyle(PALETTE.amber, 0.22)
      for (let f = 0; f < floors; f++) {
        for (let c = 0, wx = x + 5; wx < x + unit - 12; c++, wx += 9) {
          if ((f * 5 + c * 3 + i) % 4 === 0) g.fillRect(wx, base - h + 6 + f * 12, 4, 5)
        }
      }
    }
  }

  // Low walls past the reachable street: the avatar stops at them (the blocks still rain over them).
  private drawKerbs(width: number, avatarW: number): void {
    const kerbW = Math.max(6, Math.round(AVATAR_MIN_X * width - avatarW / 2))
    const kerbH = Math.round(avatarW * 0.45)
    const g = this.add.graphics().setDepth(6)
    for (const x of [0, width - kerbW]) {
      g.fillStyle(shade(PALETTE.panelAlt, 0.15), 1)
      g.fillRect(x, this.groundY - kerbH, kerbW, kerbH)
      g.fillStyle(PALETTE.frameLit, 1)
      g.fillRect(x, this.groundY - kerbH, kerbW, 3)
      g.fillStyle(PALETTE.amber, 0.7)
      for (let y = this.groundY - kerbH + 8; y < this.groundY - 4; y += 12) {
        g.fillRect(x, y, kerbW, 4)
      }
    }
  }

  private aim(px: number): void {
    if (!this.alive || this.spectating) return
    this.avatarX = Phaser.Math.Clamp(px / this.scale.width, AVATAR_MIN_X, AVATAR_MAX_X)
  }

  // ◀ ▶ / A D: a held side steers for that kerb (the avatar slides at the speed cap, like the server's);
  // letting go stops on the spot. Sent the moment it changes.
  private steerKeysFrame(now: number): void {
    const down = (keys: Phaser.Input.Keyboard.Key[]): number => (keys.some((k) => k.isDown) ? 1 : 0)
    const side = down(this.steerKeys.right) - down(this.steerKeys.left)
    if (side === this.keySide) return
    this.keySide = side
    this.avatarX = side < 0 ? AVATAR_MIN_X : side > 0 ? AVATAR_MAX_X : this.posX
    this.maybeSend(now, true)
  }

  // Sends the steering target when it changed: key presses at once, a moving pointer at most every
  // SEND_EVERY_MS (its last position always goes out).
  private maybeSend(now: number, force = false): void {
    if (Math.abs(this.avatarX - this.lastSentX) < 0.002) return
    if (!force && now - this.lastSentAt < SEND_EVERY_MS) return
    this.lastSentAt = now
    this.lastSentX = this.avatarX
    this.sendInput({ kind: 'move', x: Math.round(this.avatarX * 1e4) / 1e4 })
  }

  private screenY(y: number): number {
    return this.y0 + (y / HIT_Y) * (this.y90 - this.y0)
  }

  protected frame(snap: PixelRainSnapshot | null, _time: number, delta: number): void {
    const now = this.time.now
    if (snap && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.clock.sync(snap.remainingMs, now)
      this.onSnapshot(snap)
    }

    if (this.alive && !this.spectating && !this.state.final) {
      this.steerKeysFrame(now)
      this.maybeSend(now)
      const reach = (MAX_SPEED * delta) / 1000
      this.posX += Phaser.Math.Clamp(this.avatarX - this.posX, -reach, reach)
    }
    this.renderAvatar(now)
    if (snap) this.renderDrops(snap, now)
  }

  private renderAvatar(now: number): void {
    const avatar = this.avatar
    if (!avatar) return
    avatar.image.setX(this.posX * this.scale.width)
    avatar.tick(now)
    if (!this.alive) return
    // Sliding turns the avatar sideways (facing the way it goes); standing still faces the rain.
    const moved = this.posX - this.renderedX
    this.renderedX = this.posX
    if (Math.abs(moved) > 0.0005) avatar.setPose('side').face(moved)
    else if (now - this.movedAt > 180) avatar.setPose('front').image.setFlipX(false)
    if (Math.abs(moved) > 0.0005) this.movedAt = now
    // Jelly wobble: squash/stretch around the base scale.
    const j = Math.sin(now / 150) * 0.035
    avatar.image.setScale(this.avatarScale.x * (1 + j), this.avatarScale.y * (1 - j))
  }

  // Discrete events (eliminations, last one standing) straight from the authoritative snapshot.
  private onSnapshot(snap: PixelRainSnapshot): void {
    const ids = Object.keys(snap.alive)
    if (this.rosterIds.length === 0) this.rosterIds = ids
    this.strip?.set(
      this.rosterIds.map((id) => ({
        text: this.label(id),
        avatar: this.state.avatarOf(id),
        color: this.state.colorOf(id),
        dim: snap.alive[id] === false,
      })),
    )
    const survivors = ids.filter((id) => snap.alive[id] !== false).length
    this.hud?.setScore(this.t('game.pixelRain.alive', { n: survivors, total: ids.length }))
    const meAlive = snap.alive[this.selfId] === true

    if (!this.started) {
      // First snapshot of this (possibly restarted) scene: sync silently, no replayed eliminations.
      this.started = true
      this.spectating = !(this.selfId in snap.alive)
      this.lastAlive = { ...snap.alive }
      for (const id of ids) if (snap.alive[id] === false) this.markOut(id, false)
      if (this.spectating) this.avatar?.image.setVisible(false)
      else if (meAlive) this.showDodge()
      else this.becomeOut(false)
      return
    }

    let rivalOut = false
    let selfOut = false
    for (const id of ids) {
      if (this.lastAlive[id] === false || snap.alive[id] !== false) continue
      if (id === this.selfId) {
        selfOut = true
        this.becomeOut(true)
      } else {
        rivalOut = true
        this.markOut(id, true)
      }
    }
    this.lastAlive = { ...snap.alive }
    // One sting per snapshot, however many got squashed (your own out has its own).
    if (rivalOut && !selfOut) this.sfx.eliminated()

    if (meAlive && !this.lastStanding && ids.length > 1 && survivors === 1) {
      this.lastStanding = true
      this.sfx.cheer()
      const text = this.t('game.pixelRain.lastStanding')
      const half = text.length * 8 + 4
      const width = this.scale.width
      const x = Phaser.Math.Clamp(this.posX * width, half, Math.max(half, width - half))
      floatText(this, x, this.y90 - 20, text, PALETTE.lime, 16)
    }
  }

  // A rival got squashed (their chip dims with a KO face on the next strip update): a pop on it.
  private markOut(id: string, withFx: boolean): void {
    if (!withFx || id === this.selfId) return
    const at = this.strip?.positionOf(this.rosterIds.indexOf(id))
    if (!at) return
    burst(this, at.x, at.y, this.state.colorOf(id), 8, 120)
    floatText(this, at.x, at.y + 20, this.t('game.common.out'), PALETTE.red, 16)
  }

  private becomeOut(withFx: boolean): void {
    this.alive = false
    this.markOut(this.selfId, false)
    const avatar = this.avatar?.image
    if (this.avatar && avatar) {
      // Squashed flat: KO face, greyed, pressed into the street.
      this.avatar.setPose('front').setExpression('ko')
      avatar.setFlipX(false).setTint(0x9aa0b8)
      avatar.setScale(this.avatarScale.x * 1.1, this.avatarScale.y * 0.7).setAlpha(0.85)
    }
    if (withFx && avatar) {
      const cy = avatar.y - avatar.displayHeight / 2
      // Flattened by a block.
      this.sfx.crash()
      this.sfx.eliminated()
      burst(this, avatar.x, cy, this.selfColor, 26, 300)
      burst(this, avatar.x, cy, PALETTE.text, 10, 200)
      shake(this, 0.012, 260)
      flash(this, PALETTE.red, 160)
    }
    this.showEnd(this.t('game.common.out'), PALETTE.red)
    this.subline?.setText(this.t('game.common.waiting')).setVisible(true)
  }

  // "DODGE!" slams in at the start of play and clears itself so it never hides the rain.
  private showDodge(): void {
    const banner = this.banner
    if (!banner) return
    const text = this.t('game.pixelRain.dodge')
    this.showEnd(text, PALETTE.amber)
    this.time.delayedCall(900, () => {
      if (banner.text !== text) return
      this.tweens.add({
        targets: banner,
        alpha: 0,
        duration: 250,
        onComplete: () => {
          if (banner.text === text) banner.setVisible(false).setAlpha(1)
        },
      })
    })
  }

  private showEnd(text: string, color: number): void {
    const banner = this.banner
    if (!banner) return
    banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
    showBanner(this, banner, text, color)
  }

  // Each block extrapolated from the last snapshot on the server clock (frozen on the final frame).
  private renderDrops(snap: PixelRainSnapshot, now: number): void {
    const width = this.scale.width
    const elapsed = this.state.final ? 0 : this.clock.since(snap.remainingMs, now)
    const live = new Set<number>()
    for (const o of snap.obstacles) {
      const y = o.y + elapsed / o.fallMs
      // Past the avatar line the server has judged it: finish the fall locally (below).
      if (y > 1) continue
      live.add(o.id)
      this.drawDrop(o.id, o.x, y, width)
    }
    for (const [id, drop] of this.drops) {
      if (live.has(id)) continue
      this.drops.delete(id)
      this.landDrop(drop, width)
    }
  }

  // A block from the pool (or a new one), dressed for `id`.
  private acquireDrop(id: number, nx: number, ny: number): Drop {
    const color = BLOCK_COLORS[id % BLOCK_COLORS.length] ?? PALETTE.red
    const key = this.blockKeys[id % this.blockKeys.length] ?? ''
    const size = this.blockSize
    const drop = this.dropPool.pop() ?? {
      block: this.add.image(0, 0, key).setDisplaySize(size, size).setDepth(20),
      ghost: this.add
        .image(0, 0, key)
        .setDisplaySize(size * 0.7, size * 0.7)
        .setAlpha(0.2)
        .setDepth(19),
      shadow: this.add
        .rectangle(0, this.groundY + 3, size, 4, color)
        .setOrigin(0.5, 0)
        .setDepth(5),
      color,
      x: nx,
      y: ny,
    }
    this.tweens.killTweensOf(drop.block)
    drop.block.setTexture(key).setDisplaySize(size, size).setVisible(true)
    drop.ghost
      .setTexture(key)
      .setDisplaySize(size * 0.7, size * 0.7)
      .setVisible(true)
    drop.shadow.setFillStyle(color).setVisible(true)
    drop.color = color
    return drop
  }

  private releaseDrop(drop: Drop): void {
    drop.block.setVisible(false)
    drop.ghost.setVisible(false)
    drop.shadow.setVisible(false)
    this.dropPool.push(drop)
  }

  private drawDrop(id: number, nx: number, ny: number, width: number): void {
    let drop = this.drops.get(id)
    if (!drop) {
      drop = this.acquireDrop(id, nx, ny)
      this.drops.set(id, drop)
    }
    drop.x = nx
    drop.y = ny
    const x = nx * width
    // The server keeps a block until y ≤ 1.0, past HIT_Y: never draw it sinking below the street.
    const y = Math.min(this.screenY(ny), this.groundY - this.blockSize / 2)
    drop.block.setPosition(x, y)
    drop.ghost.setPosition(x, y - this.blockSize * 0.95)
    // Landing telegraph: the ground marker grows and brightens as the block closes in.
    const closeness = Phaser.Math.Clamp(ny / HIT_Y, 0, 1)
    drop.shadow
      .setX(x)
      .setDisplaySize(this.blockSize * (0.3 + 0.7 * closeness), 4)
      .setAlpha(0.15 + 0.55 * closeness)
  }

  // A block left the snapshot: it fell past the avatar line. Finish its fall locally and shatter it.
  private landDrop(drop: Drop, width: number): void {
    drop.shadow.setVisible(false)
    drop.ghost.setVisible(false)
    if (drop.y < HIT_Y - 0.12) {
      this.releaseDrop(drop)
      return
    }
    const x = drop.x * width
    // A block that lands beside you (not on you: that's the server's call) thuds on the street.
    let thud = false
    if (this.alive && !this.spectating) {
      const dx = Math.abs(drop.x - this.posX)
      if (dx > AVATAR_HALF && dx <= AVATAR_HALF + NEAR_MISS) {
        // It whizzed right past.
        this.sfx.whoosh()
        floatText(this, x, this.y90 - 10, this.t('game.common.nice'), PALETTE.lime, 16)
        ring(this, x, this.groundY, PALETTE.lime, this.blockSize)
      } else if (dx > AVATAR_HALF && dx <= THUD_NEAR) {
        thud = true
      }
    }
    this.tweens.add({
      targets: drop.block,
      y: this.groundY - this.blockSize / 2,
      duration: 90,
      onComplete: () => {
        burst(this, x, this.groundY - 4, drop.color, 7, 150)
        this.releaseDrop(drop)
        if (thud && this.time.now - this.thudAt >= THUD_EVERY_MS) {
          this.thudAt = this.time.now
          this.sfx.land()
        }
      },
    })
  }

  private destroyDrop(drop: Drop): void {
    drop.block.destroy()
    drop.ghost.destroy()
    drop.shadow.destroy()
  }
}
