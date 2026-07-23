import type { ClientMsg, PixelDashObstacle, PixelDashSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { SnapshotInterpolator, lerp } from '../netcode/SnapshotInterpolator'

// Pixel Dash canvas. The server owns the seeded obstacle track + scoring; this renders the obstacles
// approaching from the right (smoothed through the snapshot interpolator) and the player's own runner
// locally. Tapping anywhere sends a JUMP and hops the runner. Scene key === mini-game id.
export class PixelDashScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private score?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private runner?: Phaser.GameObjects.Rectangle
  private readonly sprites = new Map<number, Phaser.GameObjects.Rectangle>()
  private readonly interp = new SnapshotInterpolator<PixelDashSnapshot>(100)
  private lastTick = -1
  private lastScore = 0
  private jumping = false

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('pixel-dash')
  }

  create(): void {
    this.interp.reset()
    this.lastTick = -1
    this.lastScore = 0
    this.jumping = false
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
    this.score = this.add
      .text(width / 2, height * 0.12, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#9fb3c8',
      })
      .setOrigin(0.5)
    this.status = this.add
      .text(width / 2, height * 0.18, 'Tap to jump!', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#f4c20d',
      })
      .setOrigin(0.5)

    // Ground line + runner near the left/bottom.
    this.add.rectangle(width / 2, height * 0.86, width, 4, 0x11181f)
    this.runner = this.add
      .rectangle(width * 0.16, this.groundY(), width * 0.05, width * 0.05, 0xffd166)
      .setStrokeStyle(3, 0x11181f)

    this.input.on('pointerdown', () => this.jump())
  }

  private groundY(): number {
    return this.scale.height * 0.86 - this.scale.width * 0.025
  }

  private jump(): void {
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'jump' } })
    this.sfx.click()
    if (this.jumping || !this.runner) return
    this.jumping = true
    const top = this.groundY() - this.scale.height * 0.16
    this.tweens.add({
      targets: this.runner,
      y: top,
      duration: 180,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.jumping = false
      },
    })
  }

  override update(_time: number, _delta: number): void {
    const now = this.time.now
    const snap = this.state.state as PixelDashSnapshot | null
    if (snap && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.interp.push(snap, now)
    }

    const { width, height } = this.scale
    const latest = this.interp.latest()
    if (latest) {
      const selfId = this.state.selfId ?? ''
      const myScore = latest.scores[selfId] ?? 0
      if (myScore > this.lastScore) this.sfx.correct()
      this.lastScore = myScore
      this.timer?.setText(`${Math.ceil(latest.remainingMs / 1000)}s`)
      this.score?.setText(this.t('game.common.pts', { n: myScore }))
    }

    this.renderObstacles(now, width, height)
  }

  private renderObstacles(now: number, width: number, height: number): void {
    const sample = this.interp.sample(now)
    const seen = new Set<number>()
    if (sample) {
      const fromById = new Map(sample.from.obstacles.map((o) => [o.id, o]))
      for (const o of sample.to.obstacles) {
        const prev = fromById.get(o.id)
        const tv = prev ? lerp(prev.t, o.t, sample.t) : o.t
        this.drawObstacle(o, tv * width, Math.min(width, height))
        seen.add(o.id)
      }
    }
    // Retire sprites for obstacles that have passed off-screen.
    for (const [id, sprite] of this.sprites) {
      if (!seen.has(id)) {
        sprite.destroy()
        this.sprites.delete(id)
      }
    }
  }

  private drawObstacle(o: PixelDashObstacle, x: number, minDim: number): void {
    const size = minDim * 0.06
    let sprite = this.sprites.get(o.id)
    if (!sprite) {
      sprite = this.add
        .rectangle(x, this.groundY(), size, size, 0xe63946)
        .setStrokeStyle(3, 0x11181f)
      this.sprites.set(o.id, sprite)
    }
    sprite.setPosition(x, this.groundY())
  }
}
