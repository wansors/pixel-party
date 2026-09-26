import { PALETTE, type PixelDashSnapshot } from '@pp/shared'
import type Phaser from 'phaser'
import { burst, floatText, punch, ring, shake } from '../fx'
import { SnapshotInterpolator, lerp } from '../netcode/SnapshotInterpolator'
import { bodyStyle, ensurePixelGrid, ensurePixelOrb, headlineStyle, shade } from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Mirrors the server's pixelDash.ts: an obstacle's `t` is its time-to-arrival over LEAD_MS (1 = just
// entering from the right, 0 = at the runner). Obstacles are drawn so t = 0 lands exactly on the runner.
const LEAD_MS = 1200
// The server's jump window (TOL_MS = 220) in `t` units, with a little margin: an obstacle further out
// than this cannot have been cleared yet.
const CLEAR_WINDOW_T = 0.19
const JUMP_UP_MS = 190
const RUN_FRAME_MS = 90
const STREAK_EVERY = 5

// Runner, 12x14 cells, facing right: a cap in the player's color, face, shirt, then one of three leg
// poses (two run strides + a tucked jump).
const RUNNER_TOP = [
  '____cccc____',
  '___cccccccc_',
  '___ssssks___',
  '___sssssss__',
  '____ssss____',
  '___bbbbbb___',
  '__bbbbbbbss_',
  '_ssbbbbbb___',
  '___bbbbbb___',
  '___dddddd___',
]
const RUNNER_LEGS: Record<'run1' | 'run2' | 'jump', string[]> = {
  run1: ['___ll__ll___', '__ll____ll__', '_ll______ll_', 'ee________ee'],
  run2: ['____llll____', '____l_l_____', '____l_l_____', '___ee_ee____'],
  jump: ['__llllllll__', '__l______l__', '_ee______ee_', '____________'],
}

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
// obstacles rushing in from the right (smoothed through the snapshot interpolator) over a parallax
// scrolling world, and the player's own runner locally. Tap anywhere / Space sends a JUMP and hops the
// runner; clears and stumbles come back from the snapshot and get their own feedback.
export class PixelDashScene extends MiniGameScene<PixelDashSnapshot> {
  private runner?: Phaser.GameObjects.Image
  private button?: Phaser.GameObjects.Image
  private buttonKey = ''
  private buttonDownKey = ''
  private layers: { sprite: Phaser.GameObjects.TileSprite; factor: number }[] = []
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>()
  private readonly interp = new SnapshotInterpolator<PixelDashSnapshot>(100)
  private runKeys: string[] = []
  private jumpKey = ''
  private obstacleKeys: string[] = []
  private lastTick = -1
  private lastScore = -1
  private streak = 0
  private jumping = false
  private crashing = false
  private seenIds = new Map<number, number>() // obstacle id → last seen t
  // Obstacles already in the jump window on the first snapshot: their clear may predate the score
  // baseline, so their passing is booked silently instead of reading as a stumble.
  private baselineIds = new Set<number>()
  private passed = 0
  private clearedSince = 0
  private misses = 0
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
    this.interp.reset()
    this.lastTick = -1
    this.lastScore = -1
    this.streak = 0
    this.jumping = false
    this.crashing = false
    this.seenIds = new Map()
    this.baselineIds = new Set()
    this.passed = 0
    this.clearedSince = 0
    this.misses = 0
    this.layers = []
    for (const s of this.sprites.values()) s.destroy()
    this.sprites.clear()

    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const color = this.state.colorOf(this.selfId, PALETTE.amber)
    const legend = {
      c: shade(color, 0.25),
      s: 0xf2c29b,
      k: PALETTE.bg,
      b: color,
      d: shade(color, -0.45),
      l: PALETTE.frame,
      e: PALETTE.text,
    }
    const hex = color.toString(16)
    this.runKeys = (['run1', 'run2'] as const).map((pose) =>
      ensurePixelGrid(this, {
        key: `pp-dash-runner-${hex}-${pose}`,
        rows: [...RUNNER_TOP, ...RUNNER_LEGS[pose]],
        legend,
      }),
    )
    this.jumpKey = ensurePixelGrid(this, {
      key: `pp-dash-runner-${hex}-jump`,
      rows: [...RUNNER_TOP, ...RUNNER_LEGS.jump],
      legend,
    })
    this.obstacleKeys = OBSTACLES.map((o, i) =>
      ensurePixelGrid(this, { key: `pp-dash-obstacle-${i}`, rows: o.rows, legend: o.legend }),
    )

    const playH = height - this.top
    this.groundY = Math.round(this.top + playH * (compact ? 0.6 : 0.64))
    this.runnerX = Math.round(width * (compact ? 0.22 : 0.18))
    this.runnerH = Math.round(Math.max(36, Math.min(96, (this.groundY - this.top) * 0.24)))
    this.obstacleH = Math.round(this.runnerH * 0.55)
    this.speed = (width + this.obstacleH - this.runnerX) / LEAD_MS

    this.buildWorld(width, height)

    this.runner = this.add
      .image(this.runnerX, this.groundY, this.runKeys[0] ?? '')
      .setOrigin(0.5, 1)
      .setDisplaySize(this.runnerH * (12 / 14), this.runnerH)
      .setDepth(30)

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
    this.add
      .text(
        width / 2,
        Math.min(height - 12, by + d / 2 + 18),
        this.t('game.pixelDash.hint'),
        bodyStyle(compact ? 12 : 15, PALETTE.text),
      )
      .setOrigin(0.5)
      .setAlpha(0.8)
      .setDepth(6)

    this.input.on('pointerdown', () => this.jump())
    for (const key of ['SPACE', 'UP', 'W']) this.onKey(key, () => this.jump())
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
    this.sendInput({ kind: 'jump' })
    this.sfx.click()
    if (this.button) {
      this.button.setTexture(this.buttonDownKey)
      punch(this, this.button, -0.08, 60)
      this.time.delayedCall(80, () => this.button?.setTexture(this.buttonKey))
    }
    const runner = this.runner
    if (this.jumping || this.crashing || !runner) return
    this.jumping = true
    runner.setTexture(this.jumpKey)
    this.tweens.add({
      targets: runner,
      y: this.groundY - this.runnerH * 1.3,
      duration: JUMP_UP_MS,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.jumping = false
        runner.setY(this.groundY)
        burst(this, runner.x, this.groundY - 2, 0x8a7a6a, 5, 70)
      },
    })
  }

  protected frame(snap: PixelDashSnapshot | null, _time: number, delta: number): void {
    const now = this.time.now
    if (snap && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.interp.push(snap, now)
      this.onSnapshot(snap)
    }
    const moving = snap !== null && snap.remainingMs > 0
    if (moving) {
      for (const layer of this.layers) {
        layer.sprite.tilePositionX += (this.speed * delta * layer.factor) / layer.sprite.tileScaleX
      }
    }
    if (this.runner && !this.jumping && !this.crashing && moving) {
      this.runner.setTexture(this.runKeys[Math.floor(now / RUN_FRAME_MS) % 2] ?? '')
    }
    this.renderObstacles(now)
  }

  // Clears come straight from our score; a stumble is an obstacle that left the track while our clear
  // count did not keep up (the server resolves both before an obstacle drops out of the snapshot).
  private onSnapshot(snap: PixelDashSnapshot): void {
    const score = snap.scores[this.selfId] ?? 0
    this.hud?.setScore(this.t('game.common.pts', { n: score }))
    if (this.lastScore < 0) {
      this.lastScore = score
      for (const o of snap.obstacles) if (o.t <= CLEAR_WINDOW_T) this.baselineIds.add(o.id)
    } else if (score > this.lastScore) {
      this.clearedSince += score - this.lastScore
      this.lastScore = score
      this.onClear()
    }

    const current = new Map(snap.obstacles.map((o) => [o.id, o.t]))
    let quiet = false
    for (const [id, t] of this.seenIds) {
      if (current.has(id) || t >= 0.3) continue
      this.passed++
      if (this.baselineIds.delete(id)) quiet = true
    }
    this.seenIds = current
    const misses = this.passed - this.clearedSince
    if (quiet) this.misses = Math.max(this.misses, misses)
    else if (misses > this.misses) {
      this.misses = misses
      this.onCrash()
    }
  }

  private onClear(): void {
    this.sfx.correct()
    this.streak++
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
    const runner = this.runner
    this.streak = 0
    this.sfx.wrong()
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
    if (!runner || this.crashing) return
    // Stumble: the runner trips forward, blinks and gets back up.
    this.crashing = true
    this.tweens.killTweensOf(runner)
    this.jumping = false
    runner.setY(this.groundY).setTexture(this.runKeys[1] ?? '')
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

  private renderObstacles(now: number): void {
    const sample = this.interp.sample(now)
    const live = new Set<number>()
    if (sample) {
      const fromById = new Map(sample.from.obstacles.map((o) => [o.id, o]))
      for (const o of sample.to.obstacles) {
        const prev = fromById.get(o.id)
        const tv = prev ? lerp(prev.t, o.t, sample.t) : o.t
        this.drawObstacle(o.id, this.runnerX + tv * this.speed * LEAD_MS)
        live.add(o.id)
      }
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
