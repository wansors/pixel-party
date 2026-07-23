import type { ClientMsg, PixelRainObstacle, PixelRainSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { SnapshotInterpolator, lerp } from '../netcode/SnapshotInterpolator'

// Pixel Rain canvas. The server owns the falling stream + eliminations; this renders the obstacles
// smoothed through the snapshot interpolator (netcode hardening) and the player's own avatar locally.
// Scene key === mini-game id.
export class PixelRainScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private avatar?: Phaser.GameObjects.Rectangle
  private readonly sprites = new Map<number, Phaser.GameObjects.Rectangle>()
  private readonly interp = new SnapshotInterpolator<PixelRainSnapshot>(100)
  private lastTick = -1
  private avatarX = 0.5
  private lastSentX = -1
  private lastSentAt = 0
  private wasAlive = true

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('pixel-rain')
  }

  create(): void {
    this.interp.reset()
    this.lastTick = -1
    this.avatarX = 0.5
    this.lastSentX = -1
    this.wasAlive = true
    for (const s of this.sprites.values()) s.destroy()
    this.sprites.clear()

    const { width, height } = this.scale
    this.timer = this.add
      .text(width / 2, height * 0.06, '', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#06d6a0',
      })
      .setOrigin(0.5)
    this.status = this.add
      .text(width / 2, height * 0.12, 'DODGE!', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#9fb3c8',
      })
      .setOrigin(0.5)

    this.avatar = this.add
      .rectangle(width / 2, height * 0.9, width * 0.14, height * 0.04, 0x06d6a0)
      .setStrokeStyle(3, 0x11181f)

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.aim(p.x))
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.aim(p.x)
    })
  }

  private aim(px: number): void {
    this.avatarX = Phaser.Math.Clamp(px / this.scale.width, 0, 1)
  }

  private maybeSend(now: number): void {
    // Throttle move intents; only send on a meaningful change.
    if (now - this.lastSentAt < 60 || Math.abs(this.avatarX - this.lastSentX) < 0.01) return
    this.lastSentAt = now
    this.lastSentX = this.avatarX
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'move', x: this.avatarX } })
  }

  override update(_time: number, _delta: number): void {
    const now = this.time.now
    const snap = this.state.state as PixelRainSnapshot | null
    if (snap && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.interp.push(snap, now)
    }

    const { width, height } = this.scale
    const latest = this.interp.latest()
    const selfId = this.state.selfId ?? ''
    const alive = latest ? latest.alive[selfId] !== false : true

    if (alive) this.maybeSend(now)

    if (this.avatar) {
      this.avatar.setPosition(this.avatarX * width, height * 0.9)
      this.avatar.setFillStyle(alive ? 0x06d6a0 : 0x555f6b)
    }

    if (latest) {
      this.timer?.setText(`${Math.ceil(latest.remainingMs / 1000)}s`)
      if (alive) {
        this.status?.setText('DODGE!')
        this.status?.setColor('#9fb3c8')
      } else {
        if (this.wasAlive) this.sfx.wrong()
        this.status?.setText('OUT')
        this.status?.setColor('#e63946')
      }
      this.wasAlive = alive
    }

    this.renderObstacles(now, width, height)
  }

  private renderObstacles(now: number, width: number, height: number): void {
    const sample = this.interp.sample(now)
    const seen = new Set<number>()
    if (sample) {
      const fromById = new Map(sample.from.obstacles.map((o) => [o.id, o]))
      for (const obstacle of sample.to.obstacles) {
        const prev = fromById.get(obstacle.id)
        const x = (prev ? lerp(prev.x, obstacle.x, sample.t) : obstacle.x) * width
        const y = (prev ? lerp(prev.y, obstacle.y, sample.t) : obstacle.y) * height
        this.drawObstacle(obstacle, x, y, Math.min(width, height))
        seen.add(obstacle.id)
      }
    }
    // Retire sprites for obstacles no longer on screen.
    for (const [id, sprite] of this.sprites) {
      if (!seen.has(id)) {
        sprite.destroy()
        this.sprites.delete(id)
      }
    }
  }

  private drawObstacle(obstacle: PixelRainObstacle, x: number, y: number, minDim: number): void {
    const size = minDim * 0.07
    let sprite = this.sprites.get(obstacle.id)
    if (!sprite) {
      sprite = this.add.rectangle(x, y, size, size, 0xe63946).setStrokeStyle(3, 0x11181f)
      this.sprites.set(obstacle.id, sprite)
    }
    sprite.setPosition(x, y)
  }
}
