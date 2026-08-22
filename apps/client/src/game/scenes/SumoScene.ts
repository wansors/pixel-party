import { PALETTE } from '@pp/shared'
import type { ClientMsg, SumoBody, SumoSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { SnapshotInterpolator, lerp } from '../netcode/SnapshotInterpolator'
import { addArcadeBackdrop, ensurePixelOrb, headlineStyle } from '../pixelStyle'

const ORB_DIAMETER_CELLS = 12

// Sumo Push canvas (Phase 5). Shared arena: every sumo is rendered from the snapshot (interpolated by
// id); the player steers their own with a drag vector from the ring centre. Scene key === mini-game id.
export class SumoScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private ringGfx?: Phaser.GameObjects.Arc
  private readonly sprites = new Map<string, Phaser.GameObjects.Image>()
  private meOrbKey = ''
  private oppOrbKey = ''
  private readonly interp = new SnapshotInterpolator<SumoSnapshot>(100)
  private lastTick = -1
  private dir = { dx: 0, dy: 0 }
  private lastSentAt = 0
  private wasAlive = true

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('sumo-push')
  }

  create(): void {
    this.interp.reset()
    this.lastTick = -1
    this.dir = { dx: 0, dy: 0 }
    this.wasAlive = true
    for (const s of this.sprites.values()) s.destroy()
    this.sprites.clear()

    addArcadeBackdrop(this)
    this.meOrbKey = ensurePixelOrb(this, 'pp-sumo-orb-me', ORB_DIAMETER_CELLS, PALETTE.lime)
    this.oppOrbKey = ensurePixelOrb(this, 'pp-sumo-orb-opp', ORB_DIAMETER_CELLS, PALETTE.red)

    const { width, height } = this.scale
    const ringPx = Math.min(width, height) * 0.42
    this.ringGfx = this.add
      .circle(width / 2, height / 2, ringPx)
      .setStrokeStyle(4, PALETTE.dim)
      .setFillStyle(PALETTE.bg, 0.4)

    this.timer = this.add
      .text(width / 2, height * 0.05, '', headlineStyle(20, PALETTE.lime))
      .setOrigin(0.5)
    this.status = this.add
      .text(width / 2, height * 0.5, '', headlineStyle(30, PALETTE.red))
      .setOrigin(0.5)
      .setDepth(10)

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.steer(p))
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.steer(p)
    })
    this.input.on('pointerup', () => {
      this.dir = { dx: 0, dy: 0 }
      this.send({ type: 'MINIGAME_INPUT', input: { kind: 'move', dx: 0, dy: 0 } })
    })
  }

  private steer(p: Phaser.Input.Pointer): void {
    // Direction from the ring centre toward the pointer.
    this.dir = { dx: p.x - this.scale.width / 2, dy: p.y - this.scale.height / 2 }
  }

  override update(): void {
    const now = this.time.now
    const snap = this.state.state as SumoSnapshot | null
    if (snap && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.interp.push(snap, now)
    }
    if (now - this.lastSentAt > 60) {
      this.lastSentAt = now
      this.send({
        type: 'MINIGAME_INPUT',
        input: { kind: 'move', dx: this.dir.dx, dy: this.dir.dy },
      })
    }

    const { width, height } = this.scale
    const latest = this.interp.latest()
    if (latest) this.timer?.setText(`${Math.ceil(latest.remainingMs / 1000)}s`)

    const me = latest?.bodies.find((b) => b.id === (this.state.selfId ?? ''))
    if (me && !me.alive && this.wasAlive) {
      this.sfx.wrong()
      this.wasAlive = false
    }
    this.status?.setText(me && !me.alive ? 'OUT!' : '')

    this.renderBodies(now, width, height)
  }

  private renderBodies(now: number, width: number, height: number): void {
    const sample = this.interp.sample(now)
    const seen = new Set<string>()
    if (sample) {
      const fromById = new Map(sample.from.bodies.map((b) => [b.id, b]))
      for (const body of sample.to.bodies) {
        const prev = fromById.get(body.id)
        const x = (prev ? lerp(prev.x, body.x, sample.t) : body.x) * width
        const y = (prev ? lerp(prev.y, body.y, sample.t) : body.y) * height
        this.drawBody(body, x, y, Math.min(width, height))
        seen.add(body.id)
      }
    }
    for (const [id, sprite] of this.sprites) {
      if (!seen.has(id)) {
        sprite.destroy()
        this.sprites.delete(id)
      }
    }
  }

  private drawBody(body: SumoBody, x: number, y: number, minDim: number): void {
    const diameter = minDim * 0.1
    let sprite = this.sprites.get(body.id)
    if (!sprite) {
      const mine = body.id === (this.state.selfId ?? '')
      sprite = this.add.image(x, y, mine ? this.meOrbKey : this.oppOrbKey)
      this.sprites.set(body.id, sprite)
    }
    sprite
      .setPosition(x, y)
      .setDisplaySize(diameter, diameter)
      .setAlpha(body.alive ? 1 : 0.25)
  }
}
