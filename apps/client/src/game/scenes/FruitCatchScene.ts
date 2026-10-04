import { type FruitCatchSnapshot, type FruitItem, PALETTE } from '@pp/shared'
import Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { burst, flash, floatText, ring, shake } from '../fx'
import { ServerClock } from '../netcode/ServerClock'
import { bodyStyle, ensurePixelGrid, fitText, shade } from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Mirrors the server's fruitCatch.ts tuning: items resolve at CATCH_Y, the basket catches within
// ±BASKET_HALF of its centre (normalized x) and slides toward its target at most BASKET_SPEED widths
// per second. The basket is drawn exactly that wide, sliding the same way, so what you see is what
// scores.
const CATCH_Y = 0.9
const BASKET_HALF = 0.12
const BASKET_SPEED = 1.8
// A moving pointer's target is sent at most this often (keys send every press/release at once).
const SEND_EVERY_MS = 33
// A score rise this soon after a catch rang at the rim is that catch's confirmation.
const CONFIRM_MS = 600
// Two coins this close together are the same catch (heard from the snapshot, then seen at the rim).
const SAME_CATCH_MS = 120

// Fruit variety is cosmetic only (the server just says "fruit"): picked by item id, so every player
// sees the same apple as the same apple.
const FRUIT_COLORS = [PALETTE.red, PALETTE.orange, PALETTE.lime, 0xb06bff]

// Builds a 10x12 pixel grid: round body with an outline + highlight, plus a stem and a leaf on top.
function fruitRows(): string[] {
  const rows: string[] = ['____sl____', '____sll___']
  const r = 5
  for (let y = 0; y < 10; y++) {
    let row = ''
    for (let x = 0; x < 10; x++) {
      const dx = x + 0.5 - r
      const dy = y + 0.5 - r
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > r) row += '_'
      else if (d > r - 1.1) row += 'o'
      else if (dx < -1 && dy < -1 && d < r * 0.7) row += 'h'
      else row += 'b'
    }
    rows.push(row)
  }
  return rows
}

// Classic cartoon bomb: dark body with a hot red rim (reads clearly against the dark sky, unlike any
// fruit), a fuse curling up to the right and a spark at its tip. Two frames alternate the spark color.
function bombRows(): string[] {
  const rows: string[] = ['________S_', '_______f__', '______f___']
  const r = 5
  for (let y = 0; y < 10; y++) {
    let row = ''
    for (let x = 0; x < 10; x++) {
      const dx = x + 0.5 - r
      const dy = y + 0.5 - r
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > r) row += y === 0 && x === 6 ? 'f' : '_'
      else if (d > r - 1.1) row += 'R'
      else if (dx < -1 && dy < -1 && d < r * 0.55) row += 'w'
      else row += 'b'
    }
    rows.push(row)
  }
  return rows
}

// A woven basket, 24x7 cells: light rim on top, alternating weave below, tapering at the bottom.
function basketRows(): string[] {
  const rows: string[] = []
  for (let y = 0; y < 7; y++) {
    const inset = y >= 5 ? y - 4 : 0
    let row = ''
    for (let x = 0; x < 24; x++) {
      if (x < inset || x >= 24 - inset) row += '_'
      else if (y === 0) row += 'h'
      else if (x === inset || x === 23 - inset || y === 6) row += 'o'
      else row += (x + y) % 3 === 0 ? 'd' : 'b'
    }
    rows.push(row)
  }
  return rows
}

interface Seen {
  x: number
  y: number
  kind: FruitItem['kind']
}

// Fruit Catch canvas (Phase 5). The server owns the falling stream + scoring; this renders the items on
// the server's clock (each falls linearly, so the last snapshot is extrapolated: an item touches the rim
// when the server resolves it) and the player's own basket locally, sliding at the server's speed cap
// toward the same target. Steering: the mouse (the basket follows the pointer; on touch, drag), or
// ◀ ▶ / A D — a held key heads for that side at full speed, letting go stops on the spot. Item sprites
// are pooled.
export class FruitCatchScene extends MiniGameScene<FruitCatchSnapshot> {
  private basket?: Phaser.GameObjects.Image
  // You: your lobby avatar standing in the basket, peeking over the rim (facing the way you move;
  // happy on a catch, hurt on a bomb).
  private catcher?: AvatarSprite
  private lastBasketX = 0.5
  private movedAt = 0
  private faceUntil = 0
  private face: 'happy' | 'hurt' = 'happy'
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>()
  private spritePool: Phaser.GameObjects.Image[] = []
  private readonly seen = new Map<number, Seen>()
  // Items already resolved on screen (they reached the rim), so a snapshot still carrying one doesn't
  // replay its catch.
  private readonly resolved = new Set<number>()
  private readonly clock = new ServerClock()
  private steerKeys: { left: Phaser.Input.Keyboard.Key[]; right: Phaser.Input.Keyboard.Key[] } = {
    left: [],
    right: [],
  }
  private keySide = 0
  // Where the basket is (sliding toward `basketX`, the target, at BASKET_SPEED).
  private posX = 0.5
  private fruitKeys: string[] = []
  private bombKeys: string[] = []
  private lastTick = -1
  private basketX = 0.5
  // The server starts every target at 0.5: nothing is sent until the player actually steers (D28).
  private lastSentX = 0.5
  private lastSentAt = 0
  private lastScore = 0
  private lastCombo = 0
  // When a catch last sounded at the rim (the score that confirms it then stays quiet).
  private caughtAt = Number.NEGATIVE_INFINITY
  // Joined after the round started (not in its snapshot): no basket, just the rain of fruit.
  private spectating = false
  // Screen mapping of the play field: normalized y 0 → skyTop, CATCH_Y → the basket's rim.
  private skyTop = 0
  private rimY = 0

  constructor(...deps: SceneDeps) {
    super('fruit-catch', ...deps)
  }

  override create(): void {
    super.create()
    this.clock.reset()
    this.lastTick = -1
    this.basketX = 0.5
    this.posX = 0.5
    this.keySide = 0
    this.lastSentAt = 0
    this.spritePool = []
    this.lastSentX = 0.5
    this.lastScore = 0
    this.lastCombo = 0
    this.caughtAt = Number.NEGATIVE_INFINITY
    this.spectating = false
    for (const s of this.sprites.values()) s.destroy()
    this.sprites.clear()
    this.seen.clear()
    this.resolved.clear()

    const { width, height } = this.scale
    const selfColor = this.state.colorOf(this.selfId, PALETTE.amber)
    this.fruitKeys = FRUIT_COLORS.map((c, i) =>
      ensurePixelGrid(this, {
        key: `pp-fruit-${i}`,
        rows: fruitRows(),
        legend: { o: shade(c, -0.55), b: c, h: shade(c, 0.45), s: 0x7a4a26, l: PALETTE.lime },
      }),
    )
    this.bombKeys = [PALETTE.amber, PALETTE.red].map((spark, i) =>
      ensurePixelGrid(this, {
        key: `pp-fruit-bomb-${i}`,
        rows: bombRows(),
        legend: { R: PALETTE.red, b: 0x3a3d56, w: 0x9aa2cc, f: 0xc9a36b, S: spark },
      }),
    )
    const basketKey = ensurePixelGrid(this, {
      key: `pp-fruit-basket-${selfColor.toString(16)}`,
      rows: basketRows(),
      legend: {
        h: shade(selfColor, 0.4),
        b: selfColor,
        d: shade(selfColor, -0.3),
        o: shade(selfColor, -0.6),
      },
    })

    // Ground strip with grass tufts along the bottom; the basket rests on it.
    const groundH = Math.max(18, height * 0.05)
    const groundY = height - groundH
    this.add.rectangle(0, groundY, width, groundH, 0x1d3a24).setOrigin(0, 0)
    const tufts = this.add.graphics()
    tufts.fillStyle(PALETTE.lime, 0.6)
    for (let x = 6; x < width; x += 22) tufts.fillRect(x, groundY - 3, 4, 3)
    this.add.rectangle(0, groundY, width, 3, shade(PALETTE.lime, -0.35)).setOrigin(0, 0)

    const basketW = width * BASKET_HALF * 2
    const basketH = basketW * (7 / 24)
    this.basket = this.add
      .image(width / 2, groundY - 2, basketKey)
      .setOrigin(0.5, 1)
      .setDisplaySize(basketW, basketH)
      .setDepth(20)
    const catcherPx = avatarPx(basketH * 1.5)
    this.catcher = new AvatarSprite(this, this.state.avatarOf(this.selfId), selfColor, catcherPx)
    this.catcher.image
      .setOrigin(0.5, 1)
      .setPosition(width / 2, groundY - 2 - basketH * 0.5)
      .setDepth(19)
    this.lastBasketX = 0.5
    this.movedAt = 0
    this.faceUntil = 0
    this.skyTop = this.top
    this.rimY = groundY - 2 - basketH

    const hint = this.add
      .text(
        width / 2,
        height - groundH / 2,
        this.t('game.fruitCatch.hint'),
        bodyStyle(Math.min(width, height) < 520 ? 12 : 15, PALETTE.text),
      )
      .setOrigin(0.5)
      .setAlpha(0.8)
      .setDepth(21)
    fitText(hint, width - 16, Math.min(width, height) < 520 ? 12 : 15)

    const kb = this.input.keyboard
    if (kb) {
      this.steerKeys = {
        left: [kb.addKey('LEFT'), kb.addKey('A')],
        right: [kb.addKey('RIGHT'), kb.addKey('D')],
      }
    }
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.aim(p.x))
    // A mouse steers by just moving over the field; a finger by dragging.
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown || !p.wasTouch) this.aim(p.x)
    })
  }

  private aim(px: number): void {
    if (this.spectating) return
    this.basketX = Phaser.Math.Clamp(px / this.scale.width, 0, 1)
  }

  // ◀ ▶ / A D: a held side steers for that edge at the speed cap; letting go stops on the spot.
  private steerKeysFrame(now: number): void {
    const down = (keys: Phaser.Input.Keyboard.Key[]): number => (keys.some((k) => k.isDown) ? 1 : 0)
    const side = down(this.steerKeys.right) - down(this.steerKeys.left)
    if (side === this.keySide) return
    this.keySide = side
    this.basketX = side < 0 ? 0 : side > 0 ? 1 : this.posX
    this.maybeSend(now, true)
  }

  // Sends the steering target when it changed: key presses at once, a moving pointer at most every
  // SEND_EVERY_MS (its last position always goes out).
  private maybeSend(now: number, force = false): void {
    if (Math.abs(this.basketX - this.lastSentX) < 0.002) return
    if (!force && now - this.lastSentAt < SEND_EVERY_MS) return
    this.lastSentAt = now
    this.lastSentX = this.basketX
    this.sendInput({ kind: 'move', x: Math.round(this.basketX * 1e4) / 1e4 })
  }

  private screenY(y: number): number {
    return this.skyTop + (y / CATCH_Y) * (this.rimY - this.skyTop)
  }

  protected frame(snap: FruitCatchSnapshot | null, _time: number, delta: number): void {
    const now = this.time.now
    if (snap && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.clock.sync(snap.remainingMs, now)
      this.spectating = !(this.selfId in snap.scores)
      this.basket?.setVisible(!this.spectating)
      this.catcher?.image.setVisible(!this.spectating)
      if (!this.spectating) this.trackScore(snap)
    }

    if (this.spectating) {
      if (snap) this.renderItems(snap, now, this.scale.width)
      return
    }
    if (!this.state.final) {
      this.steerKeysFrame(now)
      this.maybeSend(now)
      const reach = (BASKET_SPEED * delta) / 1000
      this.posX += Phaser.Math.Clamp(this.basketX - this.posX, -reach, reach)
    }

    const { width } = this.scale
    this.basket?.setX(this.posX * width)
    const catcher = this.catcher
    if (catcher) {
      const moved = this.posX - this.lastBasketX
      this.lastBasketX = this.posX
      if (Math.abs(moved) > 0.0005) {
        catcher.setPose('side').face(moved)
        this.movedAt = now
      } else if (now - this.movedAt > 180) {
        catcher.setPose('front').image.setFlipX(false)
      }
      catcher.setExpression(now < this.faceUntil ? this.face : 'idle').tick(now)
      catcher.image.setX(this.posX * width)
    }

    if (snap) this.renderItems(snap, now, width)
  }

  private trackScore(snap: FruitCatchSnapshot): void {
    const myScore = snap.scores[this.selfId] ?? 0
    const combo = snap.combos[this.selfId] ?? 0
    this.hud?.setScore(this.t('game.common.pts', { n: myScore }))
    const bx = this.basket?.x ?? 0
    // First snapshot (fresh round or relayout restart): adopt the score without a "+N" pop.
    if (this.firstSnapshot) {
      this.lastScore = myScore
      this.lastCombo = combo
    }
    if (myScore > this.lastScore) {
      // A catch the rim already rang for stays quiet; one the screen didn't call still gets its coin.
      if (this.time.now - this.caughtAt > CONFIRM_MS) {
        this.sfx.coin()
        this.caughtAt = this.time.now
      }
      floatText(this, bx, this.rimY - 10, `+${myScore - this.lastScore}`, PALETTE.lime)
      if (combo >= 3 && combo > this.lastCombo && combo % 3 === 0) {
        this.sfx.lineClear(Math.min(4, combo / 3))
        floatText(
          this,
          bx,
          this.rimY - 44,
          this.t('game.common.combo', { n: combo }),
          PALETTE.amber,
          16,
        )
      }
    } else if (myScore < this.lastScore) {
      floatText(this, bx, this.rimY - 10, `-${this.lastScore - myScore}`, PALETTE.red)
    }
    this.lastScore = myScore
    this.lastCombo = combo
  }

  // Each item extrapolated from the last snapshot on the server clock (frozen on the final frame). One
  // reaching the rim resolves right there — the same moment the server judges it against your basket.
  private renderItems(snap: FruitCatchSnapshot, now: number, width: number): void {
    const elapsed = this.state.final ? 0 : this.clock.since(snap.remainingMs, now)
    const size = Math.min(width, this.scale.height) * 0.075
    const current = new Map<number, Seen>()
    for (const item of snap.items) {
      if (this.resolved.has(item.id)) continue
      const y = item.y + elapsed / item.fallMs
      if (y >= CATCH_Y) {
        this.resolved.add(item.id)
        if (!this.firstSnapshot) this.resolveFx(item.id, { x: item.x, y, kind: item.kind }, width)
        continue
      }
      current.set(item.id, { x: item.x, y, kind: item.kind })
      this.drawItem(item, item.x * width, this.screenY(y), size, now)
    }
    // An item the server resolved a hair before our clock got it to the rim: same feedback.
    for (const [id, last] of this.seen) {
      if (current.has(id) || this.resolved.has(id) || last.y < CATCH_Y - 0.12) continue
      this.resolved.add(id)
      this.resolveFx(id, last, width)
    }
    this.seen.clear()
    for (const [id, s] of current) this.seen.set(id, s)

    for (const [id, sprite] of this.sprites) {
      if (!current.has(id)) {
        sprite.setVisible(false)
        this.spritePool.push(sprite)
        this.sprites.delete(id)
      }
    }
  }

  private resolveFx(id: number, item: Seen, width: number): void {
    if (this.spectating) return
    const x = item.x * width
    const caught = Math.abs(item.x - this.posX) <= BASKET_HALF
    if (item.kind === 'bomb') {
      if (!caught) return
      this.face = 'hurt'
      this.faceUntil = this.time.now + 700
      this.sfx.explosion()
      this.sfx.hurt()
      burst(this, x, this.rimY, PALETTE.orange, 26, 320)
      burst(this, x, this.rimY, PALETTE.red, 14, 200)
      shake(this, 0.014, 260)
      flash(this, PALETTE.red, 160)
      floatText(this, x, this.rimY - 40, this.t('game.fruitCatch.bomb'), PALETTE.red, 22)
      return
    }
    if (caught) {
      // Rung the moment it drops in (the snapshot's +N then confirms it silently) — unless that
      // snapshot got here first and already rang for it.
      if (this.time.now - this.caughtAt > SAME_CATCH_MS) this.sfx.coin()
      this.caughtAt = this.time.now
      this.face = 'happy'
      this.faceUntil = this.time.now + 350
      const color = FRUIT_COLORS[id % FRUIT_COLORS.length] ?? PALETTE.red
      burst(this, x, this.rimY, color, 10, 160)
      ring(this, x, this.rimY, PALETTE.lime, 36)
    } else {
      burst(this, x, this.rimY + 8, PALETTE.dim, 6, 90)
    }
  }

  private drawItem(item: FruitItem, x: number, y: number, size: number, now: number): void {
    let sprite = this.sprites.get(item.id)
    if (!sprite) {
      const key =
        item.kind === 'bomb'
          ? (this.bombKeys[0] ?? '')
          : (this.fruitKeys[item.id % this.fruitKeys.length] ?? '')
      sprite = (this.spritePool.pop() ?? this.add.image(x, y, key)).setTexture(key).setVisible(true)
      this.sprites.set(item.id, sprite)
    }
    sprite.setPosition(x, y).setDisplaySize(size, size * (sprite.frame.height / sprite.frame.width))
    if (item.kind === 'bomb') {
      // Flickering fuse spark + a slow wobble so bombs read as "alive" and dangerous.
      sprite.setTexture(this.bombKeys[Math.floor(now / 110) % 2] ?? '')
      sprite.setAngle(Math.sin(now / 90 + item.id) * 8)
    } else {
      sprite.setAngle(Math.sin(now / 260 + item.id) * 6)
    }
  }
}
