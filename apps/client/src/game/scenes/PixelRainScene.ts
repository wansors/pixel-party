import { PALETTE, type PixelRainSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import { addBanner, burst, flash, floatText, punch, ring, shake, showBanner } from '../fx'
import { SnapshotInterpolator, lerp } from '../netcode/SnapshotInterpolator'
import { bodyStyle, ensurePixelGrid, fitFontSize, headlineStyle, shade } from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Mirrors the server's pixelRain.ts tuning: a block resolves against the avatar once its centre reaches
// HIT_Y and hits when that centre is within ±AVATAR_HALF (normalized x) of the avatar's centre. The
// slime is drawn exactly so wide that "the block visibly touches it" == "the server counts a hit".
const HIT_Y = 0.9
const AVATAR_HALF = 0.09
const NEAR_MISS = 0.05 // a landing this much outside the hit zone earns a "NICE!"
const KEY_SPEED = 1.3 // normalized widths per second with the arrow keys

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

// The player's slime: an 18x12 dome (half-width per row), outlined, shaded, with eyes that look the way
// it is sliding (-1 left, 0 ahead, 1 right) or crossed-out eyes once it has been squashed.
const SLIME_W = 18
const SLIME_HALF_WIDTHS = [3, 5, 6, 7, 8, 9, 9, 9, 9, 9, 9, 8]

function slimeRows(look: -1 | 0 | 1, dead: boolean): string[] {
  const inside = (x: number, y: number): boolean => {
    const hw = SLIME_HALF_WIDTHS[y]
    return hw !== undefined && x >= SLIME_W / 2 - hw && x < SLIME_W / 2 + hw
  }
  const grid: string[][] = SLIME_HALF_WIDTHS.map((_, y) =>
    Array.from({ length: SLIME_W }, (_, x): string => {
      if (!inside(x, y)) return '_'
      if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) {
        return 'o'
      }
      if (y >= 9) return 'd'
      if ((y === 2 && x >= 5 && x <= 7) || (y === 3 && x === 4)) return 'h'
      return 'b'
    }),
  )
  const put = (x: number, y: number, c: string): void => {
    const row = grid[y]
    if (row && row[x] !== undefined) row[x] = c
  }
  if (dead) {
    for (const cx of [5, 12]) {
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [0, 0],
        [-1, 1],
        [1, 1],
      ] as const) {
        put(cx + dx, 5 + dy, 'k')
      }
    }
    for (let x = 7; x <= 10; x++) put(x, 8, 'k')
  } else {
    for (const ex of [5, 11]) {
      for (let y = 4; y <= 6; y++) {
        for (let dx = 0; dx < 2; dx++) {
          const pupil = y >= 5 && (look === 0 || (look < 0 ? dx === 0 : dx === 1))
          put(ex + dx, y, pupil ? 'k' : 'w')
        }
      }
    }
    put(8, 8, 'k')
    put(9, 8, 'k')
  }
  return grid.map((row) => row.join(''))
}

interface Drop {
  block: Phaser.GameObjects.Image
  ghost: Phaser.GameObjects.Image
  shadow: Phaser.GameObjects.Rectangle
  color: number
  x: number
  y: number
}

// Pixel Rain canvas (Phase 5). The server owns the falling stream + eliminations; this renders the
// blocks smoothed through the snapshot interpolator (with a ground "shadow" telegraphing where each one
// lands) and the player's own slime locally (drag / ◀ ▶). A strip under the HUD shows who is still in.
export class PixelRainScene extends MiniGameScene<PixelRainSnapshot> {
  private avatar?: Phaser.GameObjects.Image
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private readonly drops = new Map<number, Drop>()
  private readonly interp = new SnapshotInterpolator<PixelRainSnapshot>(100)
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private roster = new Map<string, Phaser.GameObjects.Image>()
  private blockKeys: string[] = []
  private slimeKeys: string[] = []
  private deadKey = ''
  private lastTick = -1
  private avatarX = 0.5
  private renderedX = 0.5
  private lastSentX = -1
  private lastSentAt = 0
  private look: -1 | 0 | 1 = 0
  private alive = true
  private started = false
  private lastStanding = false
  private lastAlive: Record<string, boolean> = {}
  private selfColor = 0
  private compact = false
  // Layout: normalized y 0 → y0 (top of the sky), HIT_Y → y90 (block touching the slime's head).
  private y0 = 0
  private y90 = 0
  private groundY = 0
  private blockSize = 0
  private avatarScale = { x: 1, y: 1 }
  private rosterY = 0
  private rosterIcon = 0

  constructor(...deps: SceneDeps) {
    super('pixel-rain', ...deps)
  }

  override create(): void {
    super.create()
    this.interp.reset()
    this.lastTick = -1
    this.avatarX = 0.5
    this.renderedX = 0.5
    this.lastSentX = -1
    this.look = 0
    this.alive = true
    this.started = false
    this.lastStanding = false
    this.lastAlive = {}
    for (const d of this.drops.values()) this.destroyDrop(d)
    this.drops.clear()
    this.roster.clear()

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
    this.slimeKeys = ([-1, 0, 1] as const).map((look) => this.slimeKey(this.selfColor, look))
    this.deadKey = ensurePixelGrid(this, {
      key: 'pp-rain-slime-dead',
      rows: slimeRows(0, true),
      legend: this.slimeLegend(PALETTE.frame),
    })

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
    this.add
      .text(
        width / 2,
        height - groundH / 2,
        this.t('game.pixelRain.hint'),
        bodyStyle(this.compact ? 11 : 13, PALETTE.text),
      )
      .setOrigin(0.5)
      .setAlpha(0.75)

    // The slime: exactly as wide as the server's hit zone minus one block (see AVATAR_HALF above).
    this.blockSize = Math.max(20, Math.round(width * 0.06))
    const avatarW = Math.max(this.blockSize * 1.5, width * AVATAR_HALF * 2 - this.blockSize)
    const avatarH = avatarW * (SLIME_HALF_WIDTHS.length / SLIME_W)
    this.avatar = this.add
      .image(width / 2, this.groundY + 2, this.slimeKeys[1] ?? '')
      .setOrigin(0.5, 1)
      .setDisplaySize(avatarW, avatarH)
      .setDepth(30)
    this.avatarScale = { x: this.avatar.scaleX, y: this.avatar.scaleY }

    const rowH = this.compact ? 20 : 26
    this.rosterY = this.top + rowH / 2
    this.rosterIcon = rowH
    this.y0 = this.top + rowH + 6 + this.blockSize / 2
    this.y90 = this.groundY + 2 - avatarH - this.blockSize / 2

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

    this.cursors = this.input.keyboard?.createCursorKeys()
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.aim(p.x))
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.aim(p.x)
    })
  }

  private slimeLegend(color: number): Record<string, number> {
    return {
      o: shade(color, -0.6),
      b: color,
      h: shade(color, 0.45),
      d: shade(color, -0.25),
      w: PALETTE.text,
      k: PALETTE.bg,
    }
  }

  private slimeKey(color: number, look: -1 | 0 | 1): string {
    return ensurePixelGrid(this, {
      key: `pp-rain-slime-${color.toString(16)}-${look}`,
      rows: slimeRows(look, false),
      legend: this.slimeLegend(color),
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

  private aim(px: number): void {
    if (!this.alive) return
    this.avatarX = Phaser.Math.Clamp(px / this.scale.width, 0, 1)
  }

  private maybeSend(now: number): void {
    // Throttle move intents; only send on a meaningful change.
    if (now - this.lastSentAt < 60 || Math.abs(this.avatarX - this.lastSentX) < 0.01) return
    this.lastSentAt = now
    this.lastSentX = this.avatarX
    this.sendInput({ kind: 'move', x: this.avatarX })
  }

  private screenY(y: number): number {
    return this.y0 + (y / HIT_Y) * (this.y90 - this.y0)
  }

  protected frame(snap: PixelRainSnapshot | null, _time: number, delta: number): void {
    const now = this.time.now
    if (snap && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.interp.push(snap, now)
      this.onSnapshot(snap)
    }

    if (this.alive) {
      if (this.cursors?.left.isDown) this.avatarX -= (KEY_SPEED * delta) / 1000
      if (this.cursors?.right.isDown) this.avatarX += (KEY_SPEED * delta) / 1000
      this.avatarX = Phaser.Math.Clamp(this.avatarX, 0, 1)
      this.maybeSend(now)
    }
    this.renderAvatar(now)
    this.renderDrops(now)
  }

  private renderAvatar(now: number): void {
    const avatar = this.avatar
    if (!avatar) return
    avatar.setX(this.avatarX * this.scale.width)
    if (!this.alive) return
    // Movement since the last rendered frame (drag, taps or keys) decides where the eyes look.
    const moved = this.avatarX - this.renderedX
    this.renderedX = this.avatarX
    const look: -1 | 0 | 1 = moved < -0.0005 ? -1 : moved > 0.0005 ? 1 : this.look
    if (look !== this.look) {
      this.look = look
      avatar.setTexture(this.slimeKeys[look + 1] ?? '')
    }
    // Jelly wobble: squash/stretch around the base scale.
    const j = Math.sin(now / 150) * 0.035
    avatar.setScale(this.avatarScale.x * (1 + j), this.avatarScale.y * (1 - j))
  }

  // Discrete events (eliminations, last one standing) straight from the authoritative snapshot.
  private onSnapshot(snap: PixelRainSnapshot): void {
    const ids = Object.keys(snap.alive)
    if (this.roster.size === 0 && ids.length > 0) this.buildRoster(ids)
    const survivors = ids.filter((id) => snap.alive[id] !== false).length
    this.hud?.setScore(this.t('game.pixelRain.alive', { n: survivors, total: ids.length }))
    const meAlive = snap.alive[this.selfId] !== false

    if (!this.started) {
      // First snapshot of this (possibly restarted) scene: sync silently, no replayed eliminations.
      this.started = true
      this.lastAlive = { ...snap.alive }
      for (const id of ids) if (snap.alive[id] === false) this.markOut(id, false)
      if (meAlive) this.showDodge()
      else this.becomeOut(false)
      return
    }

    for (const id of ids) {
      if (this.lastAlive[id] === false || snap.alive[id] !== false) continue
      if (id === this.selfId) this.becomeOut(true)
      else this.markOut(id, true)
    }
    this.lastAlive = { ...snap.alive }

    if (meAlive && !this.lastStanding && ids.length > 1 && survivors === 1) {
      this.lastStanding = true
      this.sfx.coin()
      const text = this.t('game.pixelRain.lastStanding')
      const half = text.length * 8 + 4
      const width = this.scale.width
      const x = Phaser.Math.Clamp(this.avatar?.x ?? width / 2, half, Math.max(half, width - half))
      floatText(this, x, this.y90 - 20, text, PALETTE.lime, 16)
    }
  }

  private buildRoster(ids: string[]): void {
    const { width } = this.scale
    const h = this.rosterIcon * 0.8
    const w = Math.min(h * (SLIME_W / SLIME_HALF_WIDTHS.length), (width - 24) / ids.length - 6)
    const iconH = w * (SLIME_HALF_WIDTHS.length / SLIME_W)
    const step = w + 6
    const startX = width / 2 - ((ids.length - 1) * step) / 2
    ids.forEach((id, i) => {
      const icon = this.add
        .image(startX + i * step, this.rosterY, this.slimeKey(this.state.colorOf(id), 0))
        .setDisplaySize(w, iconH)
      if (id === this.selfId) {
        this.add.rectangle(icon.x, this.rosterY + iconH / 2 + 3, w, 2, PALETTE.text).setAlpha(0.8)
      }
      this.roster.set(id, icon)
    })
  }

  // A rival (or, on a silent resync, anyone) got squashed: grey out their roster icon.
  private markOut(id: string, withFx: boolean): void {
    const icon = this.roster.get(id)
    if (!icon) return
    icon.setTexture(this.deadKey).setAlpha(0.6)
    if (!withFx || id === this.selfId) return
    this.sfx.pop()
    punch(this, icon, 0.4, 120)
    burst(this, icon.x, icon.y, this.state.colorOf(id), 8, 120)
    floatText(this, icon.x, icon.y + this.rosterIcon, this.t('game.common.out'), PALETTE.red, 16)
  }

  private becomeOut(withFx: boolean): void {
    this.alive = false
    this.markOut(this.selfId, false)
    const avatar = this.avatar
    if (avatar) {
      avatar.setTexture(this.deadKey).setScale(this.avatarScale.x, this.avatarScale.y * 0.7)
      avatar.setAlpha(0.8)
    }
    if (withFx && avatar) {
      const cy = avatar.y - avatar.displayHeight / 2
      this.sfx.wrong()
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

  private renderDrops(now: number): void {
    const width = this.scale.width
    const sample = this.interp.sample(now)
    const live = new Set<number>()
    if (sample) {
      const fromById = new Map(sample.from.obstacles.map((o) => [o.id, o]))
      for (const o of sample.to.obstacles) {
        const prev = fromById.get(o.id)
        const nx = prev ? lerp(prev.x, o.x, sample.t) : o.x
        const ny = prev ? lerp(prev.y, o.y, sample.t) : o.y
        live.add(o.id)
        this.drawDrop(o.id, nx, ny, width)
      }
    }
    for (const [id, drop] of this.drops) {
      if (live.has(id)) continue
      this.drops.delete(id)
      this.landDrop(drop, width)
    }
  }

  private drawDrop(id: number, nx: number, ny: number, width: number): void {
    let drop = this.drops.get(id)
    if (!drop) {
      const color = BLOCK_COLORS[id % BLOCK_COLORS.length] ?? PALETTE.red
      const size = this.blockSize
      drop = {
        block: this.add
          .image(0, 0, this.blockKeys[id % this.blockKeys.length] ?? '')
          .setDisplaySize(size, size)
          .setDepth(20),
        ghost: this.add
          .image(0, 0, this.blockKeys[id % this.blockKeys.length] ?? '')
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

  // A block left the snapshot: it fell past the slime line. Finish its fall locally and shatter it.
  private landDrop(drop: Drop, width: number): void {
    drop.shadow.destroy()
    drop.ghost.destroy()
    if (drop.y < HIT_Y - 0.12) {
      drop.block.destroy()
      return
    }
    const x = drop.x * width
    if (this.alive) {
      const dx = Math.abs(drop.x - this.avatarX)
      if (dx > AVATAR_HALF && dx <= AVATAR_HALF + NEAR_MISS) {
        floatText(this, x, this.y90 - 10, this.t('game.common.nice'), PALETTE.lime, 16)
        ring(this, x, this.groundY, PALETTE.lime, this.blockSize)
      }
    }
    this.tweens.add({
      targets: drop.block,
      y: this.groundY - this.blockSize / 2,
      duration: 90,
      onComplete: () => {
        burst(this, x, this.groundY - 4, drop.color, 7, 150)
        drop.block.destroy()
      },
    })
  }

  private destroyDrop(drop: Drop): void {
    drop.block.destroy()
    drop.ghost.destroy()
    drop.shadow.destroy()
  }
}
