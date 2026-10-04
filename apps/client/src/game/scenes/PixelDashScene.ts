import { PALETTE, type PixelDashSnapshot } from '@pp/shared'
import type Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { burst, floatText, punch, ring, shake } from '../fx'
import { ServerClock } from '../netcode/ServerClock'
import {
  bodyStyle,
  ensurePixelGrid,
  ensurePixelOrb,
  fitText,
  headlineStyle,
  shade,
} from '../pixelStyle'
import { addShadow, type Shadow } from '../playerMarks'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Mirrors the server's pixelDash.ts: an obstacle's `t` is its time-to-arrival over LEAD_MS (1 = just
// entering from the right, 0 = at the runner). Obstacles are drawn so t = 0 lands exactly on the runner.
// A jump is AIR_MS in the air (it clears an obstacle arriving meanwhile, LATE_MS of grace included);
// the runner can jump again LAND_MS after landing, WASTED_MS later still after a jump that cleared
// nothing. The server waits a little less, so a jump this scene allows is never refused.
const LEAD_MS = 1200
const AIR_MS = 380
const LATE_MS = 60
const LAND_MS = 150
const WASTED_MS = 400
const JUMP_UP_MS = AIR_MS / 2
const RUN_FRAME_MS = 90
const STREAK_EVERY = 5

// Three cosmetic obstacle looks (the server only sends ids): crate, traffic cone, rock.
const OBSTACLES: { rows: string[]; legend: Record<string, number> }[] = [
  {
    rows: [
      'oooooooooo',
      'obbbbbbbbo',
      'obdbbbbdbo',
      'obbdbbdbbo',
      'obbbddbbbo',
      'obbbddbbbo',
      'obbdbbdbbo',
      'obdbbbbdbo',
      'obbbbbbbbo',
      'oooooooooo',
    ],
    legend: { o: 0x3b2414, b: 0xb07a3c, d: 0x7a4a26 },
  },
  {
    rows: [
      '____rr____',
      '____rr____',
      '___rwwr___',
      '___rrrr___',
      '__rrrrrr__',
      '__wwwwww__',
      '_rrrrrrrr_',
      '_rrrrrrrr_',
      'oooooooooo',
      'oooooooooo',
    ],
    legend: { r: PALETTE.orange, w: PALETTE.text, o: PALETTE.frame },
  },
  {
    rows: [
      '___oooo___',
      '__oggggo__',
      '_ogghgggo_',
      '_ogggggdo_',
      'ogghggggdo',
      'ogggggggdo',
      'ogggggdddo',
      'oggddddddo',
      'oddddddddo',
      'oooooooooo',
    ],
    legend: { o: 0x2a2d44, g: 0x8a93b8, h: 0xc9cfe6, d: 0x5b6285 },
  },
]

// Pixel Dash canvas (Phase 5). The server owns the seeded obstacle track + scoring; this renders the
// obstacles rushing in from the right on the server's clock (each approaches linearly, so the last
// snapshot is extrapolated: an obstacle reaches the runner when the server judges it) over a parallax
// scrolling world, and the player's own runner locally. Tap anywhere / Space sends a JUMP and hops the
// runner, unless it's still in the air or landing (the button greys out meanwhile); clears and stumbles
// come back from the snapshot and get their own feedback.
export class PixelDashScene extends MiniGameScene<PixelDashSnapshot> {
  // You: your lobby avatar in side view, running right (bob + lean instead of leg frames).
  private runner?: AvatarSprite
  private shadow?: Shadow
  private hurtUntil = 0
  private button?: Phaser.GameObjects.Image
  private buttonKey = ''
  private buttonDownKey = ''
  private layers: { sprite: Phaser.GameObjects.TileSprite; factor: number }[] = []
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>()
  private readonly clock = new ServerClock()
  private obstacleKeys: string[] = []
  private lastTick = -1
  private lastScore = -1
  private lastStumbles = 0
  private streak = 0
  private jumping = false
  private crashing = false
  // Footfalls: the stride frame last heard, and which foot is next.
  private stride = -1
  private foot = 0
  // Scene time when the runner may jump again (in the air / landing until then).
  private readyAt = 0
  private ready = true
  // Joined after the round started (not in its snapshot): the track runs, but there's no runner.
  private spectating = false
  private runnerX = 0
  private groundY = 0
  private runnerH = 0
  private obstacleH = 0
  private speed = 0 // px per ms, identical for obstacles and the ground layer

  constructor(...deps: SceneDeps) {
    super('pixel-dash', ...deps)
  }

  override create(): void {
    super.create()
    this.clock.reset()
    this.lastTick = -1
    this.lastScore = -1
    this.lastStumbles = 0
    this.streak = 0
    this.jumping = false
    this.crashing = false
    this.stride = -1
    this.foot = 0
    this.readyAt = 0
    this.ready = true
    this.spectating = false
    this.layers = []
    for (const s of this.sprites.values()) s.destroy()
    this.sprites.clear()

    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    this.obstacleKeys = OBSTACLES.map((o, i) =>
      ensurePixelGrid(this, { key: `pp-dash-obstacle-${i}`, rows: o.rows, legend: o.legend }),
    )

    const playH = height - this.top
    this.groundY = Math.round(this.top + playH * (compact ? 0.6 : 0.64))
    this.runnerX = Math.round(width * (compact ? 0.22 : 0.18))
    this.runnerH = avatarPx(Math.max(32, Math.min(128, (this.groundY - this.top) * 0.26)))
    this.obstacleH = Math.round(this.runnerH * 0.55)
    this.speed = (width + this.obstacleH - this.runnerX) / LEAD_MS

    this.buildWorld(width, height)

    this.shadow = addShadow(this, this.runnerH, 29).setPosition(this.runnerX, this.groundY - 1)
    this.runner = new AvatarSprite(
      this,
      this.state.avatarOf(this.selfId),
      this.state.colorOf(this.selfId, PALETTE.amber),
      this.runnerH,
      'side',
    )
    this.runner.image.setOrigin(0.5, 1).setPosition(this.runnerX, this.groundY).setDepth(30)
    this.hurtUntil = 0

    // A big arcade JUMP button in the dirt: the obvious "what do I do" (tapping anywhere works too).
    const below = height - this.groundY
    const d = Math.round(Math.min(width * 0.34, below * 0.5, 150))
    this.buttonKey = ensurePixelOrb(this, 'pp-dash-button', 18, PALETTE.lime)
    this.buttonDownKey = ensurePixelOrb(this, 'pp-dash-button-down', 18, shade(PALETTE.lime, -0.3))
    const by = this.groundY + below * 0.46
    this.add.ellipse(width / 2, by + d * 0.4, d * 0.95, d * 0.26, 0x000000).setAlpha(0.35)
    this.button = this.add
      .image(width / 2, by, this.buttonKey)
      .setDisplaySize(d, d)
      .setDepth(5)
    this.add
      .text(
        width / 2,
        by,
        '▲',
        headlineStyle(Math.max(16, Math.round((d * 0.3) / 8) * 8), PALETTE.bg),
      )
      .setOrigin(0.5)
      .setDepth(6)
    const hint = this.add
      .text(
        width / 2,
        Math.min(height - 12, by + d / 2 + 18),
        this.t('game.pixelDash.hint'),
        bodyStyle(compact ? 12 : 15, PALETTE.text),
      )
      .setOrigin(0.5)
      .setAlpha(0.8)
      .setDepth(6)
    fitText(hint, width - 16, compact ? 12 : 15)

    this.input.on('pointerdown', () => this.jump())
    // Captured so SPACE / the arrows never scroll the page.
    this.input.keyboard?.addKeys('SPACE,UP,W,ENTER')
    for (const key of ['SPACE', 'UP', 'W', 'ENTER']) this.onKey(key, () => this.jump())
  }

  // Far mountains, mid hills and the ground strip — tile sprites scrolled at 12%, 40% and 100% of the
  // obstacle speed so obstacles look planted on the ground.
  private buildWorld(width: number, height: number): void {
    const far = this.worldTexture('pp-dash-far', 240, 80, (g) => {
      g.fillStyle(shade(PALETTE.panelAlt, 0.05), 1)
      for (const [x, w, h] of [
        [0, 120, 64],
        [90, 100, 44],
        [170, 90, 72],
      ] as const) {
        for (let row = 0; row < h; row += 4) {
          const half = (w / 2) * (row / h)
          g.fillRect(x + w / 2 - half, 80 - h + row, half * 2, 4)
        }
      }
      g.fillStyle(PALETTE.dim, 0.5)
      g.fillRect(56, 16, 8, 4)
      g.fillRect(52, 20, 16, 4)
      g.fillRect(211, 8, 8, 4)
      g.fillRect(207, 12, 16, 4)
    })
    const mid = this.worldTexture('pp-dash-mid', 160, 36, (g) => {
      g.fillStyle(0x1d3a24, 1)
      for (const [cx, r] of [
        [20, 18],
        [62, 26],
        [118, 20],
        [150, 14],
      ] as const) {
        for (let y = 0; y < r; y += 4) {
          const half = Math.sqrt(r * r - (r - y) * (r - y))
          g.fillRect(cx - half, 36 - r + y, half * 2, 4)
        }
      }
    })
    // Grass-topped strip (scrolls with the obstacles) over a plain dirt texture (scrolls too).
    const grass = this.worldTexture('pp-dash-grass', 64, 16, (g) => {
      g.fillStyle(0x3a2a22, 1)
      g.fillRect(0, 0, 64, 16)
      g.fillStyle(shade(PALETTE.lime, -0.3), 1)
      g.fillRect(0, 0, 64, 8)
      g.fillStyle(PALETTE.lime, 1)
      g.fillRect(0, 0, 64, 4)
      g.fillRect(12, 4, 4, 4)
      g.fillRect(40, 4, 4, 4)
    })
    const dirt = this.worldTexture('pp-dash-dirt', 64, 64, (g) => {
      g.fillStyle(0x3a2a22, 1)
      g.fillRect(0, 0, 64, 64)
      g.fillStyle(0x4a362b, 1)
      for (const [x, y] of [
        [8, 6],
        [36, 18],
        [52, 40],
        [20, 50],
        [4, 30],
      ] as const) {
        g.fillRect(x, y, 8, 4)
      }
    })
    const farH = Math.round(Math.min(160, (this.groundY - this.top) * 0.45))
    this.layers.push({
      sprite: this.add
        .tileSprite(0, this.groundY - farH, width, farH, far)
        .setOrigin(0)
        .setTileScale(farH / 80)
        .setDepth(-5),
      factor: 0.12,
    })
    const midH = Math.round(farH * 0.4)
    this.layers.push({
      sprite: this.add
        .tileSprite(0, this.groundY - midH, width, midH, mid)
        .setOrigin(0)
        .setTileScale(midH / 36)
        .setDepth(-4),
      factor: 0.4,
    })
    this.layers.push({
      sprite: this.add
        .tileSprite(0, this.groundY + 16, width, height - this.groundY - 16, dirt)
        .setOrigin(0)
        .setDepth(-3),
      factor: 1,
    })
    this.layers.push({
      sprite: this.add.tileSprite(0, this.groundY, width, 16, grass).setOrigin(0).setDepth(-3),
      factor: 1,
    })
  }

  private worldTexture(
    key: string,
    w: number,
    h: number,
    draw: (g: Phaser.GameObjects.Graphics) => void,
  ): string {
    if (!this.textures.exists(key)) {
      const g = this.make.graphics({ x: 0, y: 0 })
      draw(g)
      g.generateTexture(key, w, h)
      g.destroy()
    }
    return key
  }

  private jump(): void {
    const now = this.time.now
    if (this.spectating || now < this.readyAt) return
    this.sendInput({ kind: 'jump' })
    this.sfx.jump()
    // Airborne until now + AIR_MS: does an obstacle arrive meanwhile? (The server judges it the same.)
    const wasted = !this.obstacleTimes(now).some(
      (t) => t * LEAD_MS >= -LATE_MS && t * LEAD_MS <= AIR_MS,
    )
    this.readyAt = now + AIR_MS + LAND_MS + (wasted ? WASTED_MS : 0)
    this.setReady(false)
    if (this.button) {
      this.button.setTexture(this.buttonDownKey)
      punch(this, this.button, -0.08, 60)
    }
    const runner = this.runner?.image
    if (!runner) return
    // Back up from a stumble mid-animation: the jump wins.
    this.tweens.killTweensOf(runner)
    runner.setAlpha(1)
    this.crashing = false
    this.jumping = true
    runner.setAngle(-8)
    this.tweens.add({
      targets: runner,
      y: this.groundY - this.runnerH * 1.3,
      duration: JUMP_UP_MS,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.jumping = false
        runner.setY(this.groundY).setAngle(0)
        burst(this, runner.x, this.groundY - 2, 0x8a7a6a, 5, 70)
        this.sfx.land()
        if (wasted) this.onWastedLanding()
      },
    })
  }

  // Landed from a jump over nothing: a clumsy wobble, and the button stays grey a while longer.
  private onWastedLanding(): void {
    const runner = this.runner?.image
    if (!runner || this.crashing) return
    this.sfx.tick()
    this.hurtUntil = this.time.now + 400
    floatText(
      this,
      this.runnerX,
      this.groundY - this.runnerH * 1.4,
      this.t('game.pixelDash.wasted'),
      PALETTE.dim,
      16,
    )
    this.tweens.add({
      targets: runner,
      angle: { from: 0, to: 14 },
      duration: 90,
      yoyo: true,
      repeat: 1,
    })
  }

  // The JUMP button greys out while the runner can't jump, and pops back when it can.
  private setReady(ready: boolean): void {
    if (ready === this.ready || !this.button) return
    this.ready = ready
    this.button.setTexture(ready ? this.buttonKey : this.buttonDownKey).setAlpha(ready ? 1 : 0.55)
    if (ready) punch(this, this.button, 0.08, 80)
  }

  // Every obstacle's time-to-arrival right now (in `t` units), on the server clock.
  private obstacleTimes(now: number): number[] {
    const snap = this.snap
    if (!snap) return []
    const shift = this.state.final ? 0 : this.clock.since(snap.remainingMs, now) / LEAD_MS
    return snap.obstacles.map((o) => o.t - shift)
  }

  protected frame(snap: PixelDashSnapshot | null, _time: number, delta: number): void {
    const now = this.time.now
    if (snap && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.clock.sync(snap.remainingMs, now)
      this.onSnapshot(snap)
    }
    if (!this.ready && now >= this.readyAt) this.setReady(true)
    const moving = snap !== null && snap.remainingMs > 0
    if (moving) {
      for (const layer of this.layers) {
        layer.sprite.tilePositionX += (this.speed * delta * layer.factor) / layer.sprite.tileScaleX
      }
    }
    const runner = this.runner
    if (runner) {
      // Running: a stride bob and a forward lean; happy in the air, wincing after a stumble.
      runner
        .setExpression(now < this.hurtUntil ? 'hurt' : this.jumping ? 'happy' : 'idle')
        .tick(now)
      if (!this.jumping && !this.crashing && moving) {
        const stride = Math.floor(now / RUN_FRAME_MS) % 2
        runner.image.setY(this.groundY - stride * Math.max(2, this.runnerH / 16)).setAngle(4)
        // A footfall each time the runner comes down (every other stride frame), left-right.
        if (stride === 0 && this.stride === 1 && !this.spectating) this.sfx.step(this.foot++)
        this.stride = stride
      } else {
        this.stride = -1
      }
      const lift = (this.groundY - runner.image.y) / (this.runnerH * 1.6)
      this.shadow?.setScale(Math.max(0.4, 1 - lift), 1)
    }
    if (snap) this.renderObstacles(snap, now)
  }

  // Clears and stumbles come straight from our own counters in the snapshot.
  private onSnapshot(snap: PixelDashSnapshot): void {
    const score = snap.scores[this.selfId] ?? 0
    const stumbles = snap.stumbles[this.selfId] ?? 0
    if (this.lastScore < 0) {
      // First snapshot of this (possibly restarted) scene: adopt the counters without replaying them.
      this.spectating = !(this.selfId in snap.scores)
      if (this.spectating) {
        this.runner?.image.setVisible(false)
        this.shadow?.setVisible(false)
        this.button?.setAlpha(0.3)
      }
      this.lastScore = score
      this.lastStumbles = stumbles
      if (!this.spectating) this.hud?.setScore(this.t('game.common.pts', { n: score }))
      return
    }
    this.hud?.setScore(this.t('game.common.pts', { n: score }))
    if (score > this.lastScore) this.onClear()
    if (stumbles > this.lastStumbles) this.onCrash()
    this.lastScore = score
    this.lastStumbles = stumbles
  }

  private onClear(): void {
    this.streak++
    // Every STREAK_EVERY-th clear in a row rings the combo instead of the coin.
    if (this.streak % STREAK_EVERY === 0)
      this.sfx.lineClear(Math.min(4, this.streak / STREAK_EVERY))
    else this.sfx.coin()
    const x = this.runnerX
    const y = this.groundY - this.runnerH * 1.6
    floatText(this, x, y, '+1', PALETTE.lime, 16)
    ring(this, x, this.groundY - this.runnerH / 2, PALETTE.lime, this.runnerH * 0.8)
    if (this.streak % STREAK_EVERY === 0) {
      floatText(
        this,
        x + this.runnerH,
        y - 26,
        this.t('game.common.combo', { n: this.streak }),
        PALETTE.amber,
        16,
      )
      burst(this, x, y, PALETTE.amber, 14, 200)
    }
  }

  private onCrash(): void {
    const runner = this.runner?.image
    this.streak = 0
    // Straight into it.
    this.sfx.hit()
    this.sfx.hurt()
    shake(this, 0.01, 220)
    floatText(
      this,
      this.runnerX,
      this.groundY - this.runnerH * 1.6,
      this.t('game.common.miss'),
      PALETTE.red,
      16,
    )
    burst(
      this,
      this.runnerX + this.runnerH * 0.3,
      this.groundY - this.runnerH * 0.4,
      PALETTE.text,
      10,
      180,
    )
    // Already back in the air for the next one (the stumble report trails the obstacle): no trip.
    if (!runner || this.crashing || this.jumping) return
    // Stumble: the runner trips forward, blinks and gets back up.
    this.crashing = true
    this.hurtUntil = this.time.now + 900
    this.tweens.killTweensOf(runner)
    runner.setY(this.groundY)
    this.tweens.add({
      targets: runner,
      angle: { from: 0, to: 70 },
      duration: 140,
      yoyo: true,
      hold: 160,
      onComplete: () => {
        runner.setAngle(0)
        this.crashing = false
      },
    })
    this.tweens.add({
      targets: runner,
      alpha: { from: 1, to: 0.25 },
      duration: 70,
      yoyo: true,
      repeat: 3,
      onComplete: () => runner.setAlpha(1),
    })
  }

  // Each obstacle extrapolated from the last snapshot on the server clock (frozen on the final frame).
  private renderObstacles(snap: PixelDashSnapshot, now: number): void {
    const shift = this.state.final ? 0 : this.clock.since(snap.remainingMs, now) / LEAD_MS
    const live = new Set<number>()
    for (const o of snap.obstacles) {
      const x = this.runnerX + (o.t - shift) * this.speed * LEAD_MS
      if (x < -this.obstacleH) continue
      this.drawObstacle(o.id, x)
      live.add(o.id)
    }
    // Retire sprites for obstacles that have passed off-screen.
    for (const [id, sprite] of this.sprites) {
      if (!live.has(id)) {
        sprite.destroy()
        this.sprites.delete(id)
      }
    }
  }

  private drawObstacle(id: number, x: number): void {
    let sprite = this.sprites.get(id)
    if (!sprite) {
      sprite = this.add
        .image(x, this.groundY, this.obstacleKeys[id % this.obstacleKeys.length] ?? '')
        .setOrigin(0.5, 1)
        .setDisplaySize(this.obstacleH, this.obstacleH)
        .setDepth(20)
      this.sprites.set(id, sprite)
    }
    sprite.setX(x)
  }
}
