import { PALETTE } from '@pp/shared'
import type { ClientMsg, FruitCatchSnapshot, FruitItem } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { SnapshotInterpolator, lerp } from '../netcode/SnapshotInterpolator'
import { addArcadeBackdrop, bodyStyle, ensurePixelOrb, headlineStyle } from '../pixelStyle'

const FRUIT_ORB_DIAMETER = 10

// Fruit Catch canvas (Phase 5). The server owns the falling stream + scoring; this renders the items
// smoothed through the snapshot interpolator (netcode hardening) and the player's own basket locally.
// Scene key === mini-game id.
export class FruitCatchScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private score?: Phaser.GameObjects.Text
  private basket?: Phaser.GameObjects.Rectangle
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>()
  private fruitOrbKey = ''
  private bombOrbKey = ''
  private readonly interp = new SnapshotInterpolator<FruitCatchSnapshot>(100)
  private lastTick = -1
  private basketX = 0.5
  private lastSentX = -1
  private lastSentAt = 0
  private lastScore = 0

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('fruit-catch')
  }

  create(): void {
    this.interp.reset()
    this.lastTick = -1
    this.basketX = 0.5
    this.lastSentX = -1
    this.lastScore = 0
    for (const s of this.sprites.values()) s.destroy()
    this.sprites.clear()

    addArcadeBackdrop(this)
    this.fruitOrbKey = ensurePixelOrb(this, 'pp-fruit-item', FRUIT_ORB_DIAMETER, PALETTE.red)
    this.bombOrbKey = ensurePixelOrb(this, 'pp-fruit-bomb', FRUIT_ORB_DIAMETER, PALETTE.frame)

    const { width, height } = this.scale
    this.timer = this.add
      .text(width / 2, height * 0.06, '', headlineStyle(24, PALETTE.lime))
      .setOrigin(0.5)
    this.score = this.add
      .text(width / 2, height * 0.12, '', bodyStyle(16, PALETTE.dim))
      .setOrigin(0.5)

    this.basket = this.add
      .rectangle(width / 2, height * 0.9, width * 0.18, height * 0.035, PALETTE.amber)
      .setStrokeStyle(3, PALETTE.bg)

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
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'move', x: this.basketX } })
  }

  override update(_time: number, _delta: number): void {
    const now = this.time.now
    const snap = this.state.state as FruitCatchSnapshot | null
    if (snap && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.interp.push(snap, now)
    }

    this.maybeSend(now)

    const { width, height } = this.scale
    this.basket?.setPosition(this.basketX * width, height * 0.9)

    const latest = this.interp.latest()
    if (latest) {
      const selfId = this.state.selfId ?? ''
      const myScore = latest.scores[selfId] ?? 0
      if (myScore > this.lastScore) this.sfx.coin()
      this.lastScore = myScore
      this.timer?.setText(`${Math.ceil(latest.remainingMs / 1000)}s`)
      this.score?.setText(this.t('game.common.pts', { n: myScore }))
    }

    this.renderItems(now, width, height)
  }

  private renderItems(now: number, width: number, height: number): void {
    const sample = this.interp.sample(now)
    const seen = new Set<number>()
    if (sample) {
      const fromById = new Map(sample.from.items.map((i) => [i.id, i]))
      for (const item of sample.to.items) {
        const prev = fromById.get(item.id)
        const x = (prev ? lerp(prev.x, item.x, sample.t) : item.x) * width
        const y = (prev ? lerp(prev.y, item.y, sample.t) : item.y) * height
        this.drawItem(item, x, y, Math.min(width, height))
        seen.add(item.id)
      }
    }
    // Retire sprites for items no longer on screen.
    for (const [id, sprite] of this.sprites) {
      if (!seen.has(id)) {
        sprite.destroy()
        this.sprites.delete(id)
      }
    }
  }

  private drawItem(item: FruitItem, x: number, y: number, minDim: number): void {
    const diameter = minDim * 0.07
    let sprite = this.sprites.get(item.id)
    if (!sprite) {
      sprite = this.add.image(x, y, item.kind === 'bomb' ? this.bombOrbKey : this.fruitOrbKey)
      this.sprites.set(item.id, sprite)
    }
    sprite.setPosition(x, y).setDisplaySize(diameter, diameter)
  }
}
