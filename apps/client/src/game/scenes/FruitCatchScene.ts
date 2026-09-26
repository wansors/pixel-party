import { type FruitCatchSnapshot, type FruitItem, PALETTE } from '@pp/shared'
import Phaser from 'phaser'
import { burst, flash, floatText, ring, shake } from '../fx'
import { SnapshotInterpolator, lerp } from '../netcode/SnapshotInterpolator'
import { bodyStyle, ensurePixelGrid, shade } from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Mirrors the server's fruitCatch.ts tuning: items resolve at CATCH_Y, the basket catches within
// ±BASKET_HALF of its centre (normalized x). The basket is drawn exactly that wide so what you see is
// what scores.
const CATCH_Y = 0.9
const BASKET_HALF = 0.12
const KEY_SPEED = 1.3 // normalized widths per second with the arrow keys

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

// Fruit Catch canvas (Phase 5). The server owns the falling stream + scoring; this renders the items
// smoothed through the snapshot interpolator and the player's own basket locally (drag / ◀ ▶).
export class FruitCatchScene extends MiniGameScene<FruitCatchSnapshot> {
  private basket?: Phaser.GameObjects.Image
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>()
  private readonly seen = new Map<number, Seen>()
  private readonly interp = new SnapshotInterpolator<FruitCatchSnapshot>(100)
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private fruitKeys: string[] = []
  private bombKeys: string[] = []
  private lastTick = -1
  private basketX = 0.5
  private lastSentX = -1
  private lastSentAt = 0
  private lastScore = 0
  private lastCombo = 0
  // Screen mapping of the play field: normalized y 0 → skyTop, CATCH_Y → the basket's rim.
  private skyTop = 0
  private rimY = 0

  constructor(...deps: SceneDeps) {
    super('fruit-catch', ...deps)
  }

  override create(): void {
    super.create()
    this.interp.reset()
    this.lastTick = -1
    this.basketX = 0.5
    this.lastSentX = -1
    this.lastScore = 0
    this.lastCombo = 0
    for (const s of this.sprites.values()) s.destroy()
    this.sprites.clear()
    this.seen.clear()

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
    this.skyTop = this.top
    this.rimY = groundY - 2 - basketH

    this.add
      .text(
        width / 2,
        height - groundH / 2,
        this.t('game.fruitCatch.hint'),
        bodyStyle(12, PALETTE.text),
      )
      .setOrigin(0.5)
      .setAlpha(0.8)
      .setDepth(21)

    this.cursors = this.input.keyboard?.createCursorKeys()
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.aim(p.x))
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.aim(p.x)
    })
  }

  private aim(px: number): void {
    this.basketX = Phaser.Math.Clamp(px / this.scale.width, 0, 1)
  }

  private maybeSend(now: number): void {
    // Throttle move intents; only send on a meaningful change.
    if (now - this.lastSentAt < 60 || Math.abs(this.basketX - this.lastSentX) < 0.01) return
    this.lastSentAt = now
    this.lastSentX = this.basketX
    this.sendInput({ kind: 'move', x: this.basketX })
  }

  private screenY(y: number): number {
    return this.skyTop + (y / CATCH_Y) * (this.rimY - this.skyTop)
  }

  protected frame(snap: FruitCatchSnapshot | null, _time: number, delta: number): void {
    const now = this.time.now
    if (snap && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.interp.push(snap, now)
    }

    if (this.cursors?.left.isDown) this.basketX -= (KEY_SPEED * delta) / 1000
    if (this.cursors?.right.isDown) this.basketX += (KEY_SPEED * delta) / 1000
    this.basketX = Phaser.Math.Clamp(this.basketX, 0, 1)
    this.maybeSend(now)

    const { width } = this.scale
    this.basket?.setX(this.basketX * width)

    const latest = this.interp.latest()
    if (latest) this.trackScore(latest)
    this.renderItems(now, width)
  }

  private trackScore(latest: FruitCatchSnapshot): void {
    const myScore = latest.scores[this.selfId] ?? 0
    const combo = latest.combos[this.selfId] ?? 0
    this.hud?.setScore(this.t('game.common.pts', { n: myScore }))
    const bx = this.basket?.x ?? 0
    // First snapshot (fresh round or relayout restart): adopt the score without a "+N" pop.
    if (this.firstSnapshot) {
      this.lastScore = myScore
      this.lastCombo = combo
    }
    if (myScore > this.lastScore) {
      this.sfx.coin()
      floatText(this, bx, this.rimY - 10, `+${myScore - this.lastScore}`, PALETTE.lime)
      if (combo >= 3 && combo > this.lastCombo && combo % 3 === 0) {
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

  private renderItems(now: number, width: number): void {
    const sample = this.interp.sample(now)
    const current = new Map<number, Seen>()
    if (sample) {
      const fromById = new Map(sample.from.items.map((i) => [i.id, i]))
      const size = Math.min(width, this.scale.height) * 0.075
      for (const item of sample.to.items) {
        const prev = fromById.get(item.id)
        const nx = prev ? lerp(prev.x, item.x, sample.t) : item.x
        const ny = prev ? lerp(prev.y, item.y, sample.t) : item.y
        current.set(item.id, { x: nx, y: ny, kind: item.kind })
        this.drawItem(item, nx * width, this.screenY(ny), size, now)
      }
    }
    // Items that vanished near the catch line just resolved: play the catch / bomb / splat feedback.
    for (const [id, last] of this.seen) {
      if (current.has(id) || last.y < CATCH_Y - 0.12) continue
      this.resolveFx(id, last, width)
    }
    this.seen.clear()
    for (const [id, s] of current) this.seen.set(id, s)

    for (const [id, sprite] of this.sprites) {
      if (!current.has(id)) {
        sprite.destroy()
        this.sprites.delete(id)
      }
    }
  }

  private resolveFx(id: number, item: Seen, width: number): void {
    const x = item.x * width
    const caught = Math.abs(item.x - this.basketX) <= BASKET_HALF
    if (item.kind === 'bomb') {
      if (!caught) return
      this.sfx.wrong()
      burst(this, x, this.rimY, PALETTE.orange, 26, 320)
      burst(this, x, this.rimY, PALETTE.red, 14, 200)
      shake(this, 0.014, 260)
      flash(this, PALETTE.red, 160)
      floatText(this, x, this.rimY - 40, this.t('game.fruitCatch.bomb'), PALETTE.red, 22)
      return
    }
    if (caught) {
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
      sprite = this.add.image(x, y, key)
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
