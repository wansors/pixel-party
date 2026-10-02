import { PALETTE, PANG, type PangArena, type PangSnapshot } from '@pp/shared'
import type Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { addBanner, burst, eliminate, flash, floatText, shake, showBanner } from '../fx'
import {
  bodyStyle,
  ensureBevelPanel,
  ensurePixelOrb,
  fitFontSize,
  headlineStyle,
  shade,
} from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Pang (Buster Bros): your own arena — a night skyline, a brick floor and the same seeded waves of
// bouncing balloons everyone else gets. Walk with ←/→ (A/D) and fire the harpoon with SPACE/↑ (or the
// three buttons); a hit splits a balloon into two smaller ones. Between snapshots the scene runs the
// same balloon physics as the server (shared PANG constants), so they fly smoothly. On wide screens
// everyone else's arena shows as a live thumbnail on the right.

interface SimBalloon {
  x: number
  y: number
  vx: number
  vy: number
  size: number
}

const BALLOON_COLORS = [0, PALETTE.lime, PALETTE.amber, PALETTE.orange, PALETTE.red]

// Advances balloons with the server's rules (gravity, walls, a fixed bounce height per size).
function stepBalloons(balloons: SimBalloon[], dt: number): void {
  for (const b of balloons) {
    const r = PANG.radius[b.size] ?? 0.03
    b.vy += PANG.gravity * dt
    b.x += b.vx * dt
    b.y += b.vy * dt
    if (b.x - r < 0) {
      b.x = r
      b.vx = Math.abs(b.vx)
    } else if (b.x + r > PANG.w) {
      b.x = PANG.w - r
      b.vx = -Math.abs(b.vx)
    }
    if (b.y + r > PANG.h) {
      b.y = PANG.h - r
      b.vy = -Math.sqrt(2 * PANG.gravity * (PANG.bounceH[b.size] ?? 0.2))
    } else if (b.y - r < 0) {
      b.y = r
      b.vy = Math.abs(b.vy)
    }
  }
}

export class PangScene extends MiniGameScene<PangSnapshot> {
  private compact = false
  private wide = false
  private arena = { x: 0, y: 0, scale: 1 }
  private sky?: Phaser.GameObjects.Graphics
  private harpoonG?: Phaser.GameObjects.Graphics
  private minis?: Phaser.GameObjects.Graphics
  private miniBoxes: { x: number; y: number; w: number; h: number }[] = []
  private miniLabels: Phaser.GameObjects.Text[] = []
  private balloonImgs: Phaser.GameObjects.Image[] = []
  private balloonKeys: string[] = []
  private avatar?: Phaser.GameObjects.Image
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private bannerUntil = 0
  private prompt?: Phaser.GameObjects.Text
  private buttons: {
    act: 'L' | 'R' | 'F'
    img: Phaser.GameObjects.Image
    up: string
    down: string
  }[] = []
  // Simulation: per arena, the balloons as last synced (advanced locally between snapshots).
  private sims = new Map<string, SimBalloon[]>()
  private lastTick = -1
  private snapAt = 0
  private lastFrameAt = 0
  private held = { left: false, right: false, leftPtr: -1, rightPtr: -1 }
  private sentDir = 0
  private mine?: PangArena

  constructor(...deps: SceneDeps) {
    super('pang', ...deps)
  }

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.wide = !this.compact && width >= 900
    this.balloonImgs = []
    this.balloonKeys = []
    this.miniBoxes = []
    this.miniLabels = []
    this.buttons = []
    this.sims = new Map()
    this.lastTick = -1
    this.snapAt = 0
    this.lastFrameAt = 0
    this.held = { left: false, right: false, leftPtr: -1, rightPtr: -1 }
    this.sentDir = 0
    this.mine = undefined
    this.bannerUntil = 0

    // Controls: ◀ FIRE ▶ along the bottom.
    const btnH = this.compact ? 72 : 52
    const gap = this.compact ? 8 : 12
    const padW = Math.min(width - 16, 560)
    const sideW = (padW - gap * 2) * 0.28
    const fireW = padW - gap * 2 - sideW * 2
    const btnY = height - (this.compact ? 12 : 14) - btnH / 2
    const mk = (act: 'L' | 'R' | 'F', x: number, w: number, label: string, color: number): void => {
      const up = ensureBevelPanel(this, w, btnH, color, 5, true)
      const down = ensureBevelPanel(this, w, btnH, shade(color, -0.45), 5, true)
      const img = this.add.image(x, btnY, up).setDepth(700).setInteractive()
      this.add
        .text(
          x,
          btnY,
          label,
          headlineStyle(fitFontSize(label, w - 16, this.compact ? 16 : 24), PALETTE.text, {
            stroke: '#10121c',
            strokeThickness: 4,
          }),
        )
        .setOrigin(0.5)
        .setDepth(701)
      this.buttons.push({ act, img, up, down })
      img.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (act === 'F') {
          this.fire()
          img.setTexture(down)
          this.time.delayedCall(90, () => img.setTexture(up))
        } else if (act === 'L') this.held.leftPtr = p.id
        else this.held.rightPtr = p.id
      })
    }
    const x0 = width / 2 - padW / 2
    mk('L', x0 + sideW / 2, sideW, '◀', PALETTE.frameLit)
    mk('F', width / 2, fireW, this.t('game.pang.fire'), PALETTE.orange)
    mk('R', x0 + padW - sideW / 2, sideW, '▶', PALETTE.frameLit)
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.id === this.held.leftPtr) this.held.leftPtr = -1
      if (p.id === this.held.rightPtr) this.held.rightPtr = -1
    })
    const kb = this.input.keyboard
    for (const [k, side] of [
      ['LEFT', 'left'],
      ['A', 'left'],
      ['RIGHT', 'right'],
      ['D', 'right'],
    ] as const) {
      kb?.on(`keydown-${k}`, () => {
        this.held[side] = true
      })
      kb?.on(`keyup-${k}`, () => {
        this.held[side] = false
      })
    }
    for (const k of ['SPACE', 'UP', 'W']) this.onKey(k, () => this.fire())
    // Losing focus drops held keys (their key-up would never arrive).
    const release = (): void => {
      this.held = { left: false, right: false, leftPtr: -1, rightPtr: -1 }
    }
    this.game.events.on('blur', release)
    this.events.once('shutdown', () => this.game.events.off('blur', release))

    // Layout: the strip (narrow screens) or the thumbnails column (wide), then the arena.
    let areaTop = this.top + 6
    if (!this.wide) {
      const stripSize = this.compact ? 11 : 13
      this.strip = new PlayerStrip(this, width / 2, areaTop + 4, width - 24, stripSize, 2)
      areaTop += PlayerStrip.rowH(stripSize) * 2 + 4
    } else this.strip = undefined
    const promptSize = this.compact ? 12 : 16
    this.prompt = this.add
      .text(width / 2, btnY - btnH / 2 - 8, '', headlineStyle(promptSize, PALETTE.amber))
      .setOrigin(0.5, 1)
      .setDepth(600)
    const areaBottom = this.prompt.y - promptSize - 14
    const areaLeft = 8
    const areaRight = this.wide ? Math.round(width * 0.7) : width - 8
    const scale = Math.min((areaRight - areaLeft) / PANG.w, (areaBottom - areaTop) / PANG.h)
    this.arena = {
      x: Math.round(areaLeft + (areaRight - areaLeft - PANG.w * scale) / 2),
      y: Math.round(areaTop + (areaBottom - areaTop - PANG.h * scale) / 2),
      scale,
    }
    this.sky = this.add.graphics().setDepth(1)
    this.paintBackdrop()
    this.harpoonG = this.add.graphics().setDepth(40)
    this.minis = this.add.graphics().setDepth(5)
    // Balloon textures per size, at their exact on-screen diameter.
    for (let size = 1; size <= 4; size++) {
      const d = Math.max(4, Math.round(((PANG.radius[size] ?? 0.03) * 2 * scale) / 3))
      this.balloonKeys[size] = ensurePixelOrb(
        this,
        `pang-balloon-${size}-${d}`,
        d,
        BALLOON_COLORS[size] ?? PALETTE.red,
        3,
      )
    }
    this.banner = addBanner(this)
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    const { x: ax, y: ay, scale } = this.arena
    return { x: ax + x * scale, y: ay + y * scale }
  }

  // Night sky bands, a skyline silhouette with lit windows and a brick floor.
  private paintBackdrop(): void {
    const g = this.sky as Phaser.GameObjects.Graphics
    const { x, y, scale } = this.arena
    const w = PANG.w * scale
    const h = PANG.h * scale
    const bands = [0x14183a, 0x1b2150, 0x262a66, 0x33357a]
    bands.forEach((c, i) => {
      g.fillStyle(c, 1)
      g.fillRect(x, y + (i * h) / bands.length, w, h / bands.length + 1)
    })
    for (let i = 0; i < 14; i++) {
      const bw = w / 14
      const bh = h * (0.18 + ((i * 37) % 23) / 60)
      const bx = x + i * bw
      g.fillStyle(0x0f1028, 1)
      g.fillRect(Math.round(bx), Math.round(y + h - bh), Math.ceil(bw), Math.ceil(bh))
      for (let k = 0; k < 6; k++) {
        if ((i * 7 + k * 3) % 4 !== 0) continue
        g.fillStyle(PALETTE.amber, 0.5)
        g.fillRect(
          Math.round(bx + 4 + ((k * 13) % Math.max(1, bw - 8))),
          Math.round(y + h - bh + 6 + k * 9),
          3,
          3,
        )
      }
    }
    const brickH = Math.max(6, Math.round(scale * 0.02))
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c * 18 < w; c++) {
        g.fillStyle(r % 2 === c % 2 ? 0x8a4b2a : 0x6e3a20, 1)
        g.fillRect(
          Math.round(x + c * 18 - (r % 2) * 9),
          Math.round(y + h + r * brickH),
          17,
          brickH - 1,
        )
      }
    }
    g.lineStyle(3, PALETTE.frameLit, 1)
    g.strokeRect(x, y, w, h)
  }

  private fire(): void {
    if (!this.snap || this.state.final || !this.mine || this.mine.out || this.mine.harpoon !== null)
      return
    this.sendInput({ kind: 'fire' })
    this.sfx.click()
  }

  private syncDir(): void {
    const left = this.held.left || this.held.leftPtr !== -1
    const right = this.held.right || this.held.rightPtr !== -1
    const dir = left === right ? 0 : left ? -1 : 1
    for (const b of this.buttons) {
      if (b.act === 'F') continue
      const on = (b.act === 'L' && dir === -1) || (b.act === 'R' && dir === 1)
      if (b.img.texture.key !== (on ? b.down : b.up)) b.img.setTexture(on ? b.down : b.up)
    }
    if (dir === this.sentDir || this.state.final || !this.snap) return
    this.sentDir = dir
    this.sendInput({ kind: 'move', dir })
  }

  protected frame(snap: PangSnapshot | null, time: number): void {
    const dt = Math.min(0.05, (time - (this.lastFrameAt || time)) / 1000)
    this.lastFrameAt = time
    if (!snap) return
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.snapAt = time
      this.onSnapshot(snap)
    } else for (const sim of this.sims.values()) stepBalloons(sim, dt)
    this.syncDir()
    this.paintOwn(time)
    this.paintMinis(snap)
    if (this.banner?.visible && time > this.bannerUntil && !this.state.final)
      this.banner.setVisible(false)
  }

  private onSnapshot(snap: PangSnapshot): void {
    const prev = this.mine
    const mine = snap.arenas.find((a) => a.id === this.selfId)
    this.mine = mine
    for (const a of snap.arenas) {
      this.sims.set(
        a.id,
        a.balloons.map(([x, y, size, vx, vy]) => ({ x, y, size, vx, vy })),
      )
    }
    if (mine) {
      this.hud?.setScore(this.t('game.pang.pops', { n: mine.pops }))
      this.hud?.setCenter(this.t('game.pang.wave', { n: mine.wave + 1 }))
      if (prev && !this.firstSnapshot) this.react(prev, mine)
      const prompt = mine.out ? this.t('game.common.spectating') : this.t('game.pang.hint')
      if (this.prompt && this.prompt.text !== prompt) {
        this.prompt.setText(prompt)
        this.prompt.setFontSize(fitFontSize(prompt, this.scale.width - 24, this.compact ? 12 : 16))
      }
    }
    this.strip?.set(
      snap.arenas.map((a) => ({
        text: `${this.label(a.id)} ${a.pops} ${a.out ? '✗' : '♥'.repeat(a.lives)}`,
        color: this.state.colorOf(a.id),
        dim: a.out,
      })),
    )
    if (this.state.final && mine && this.banner && !this.banner.visible) {
      const best = Math.max(...snap.arenas.map((a) => a.pops))
      const won = mine.pops === best && snap.arenas.length > 1
      showBanner(
        this,
        this.banner,
        won ? this.t('game.common.youWin') : this.t('game.pang.popped', { n: mine.pops }),
        won ? PALETTE.lime : PALETTE.amber,
      )
    }
  }

  // Own-arena events: pops, hits, a cleared wave, game over.
  private react(prev: PangArena, mine: PangArena): void {
    const size = this.compact ? 12 : 16
    if (mine.pops > prev.pops) {
      // Where the harpoon tip was when it struck.
      const tip = this.toScreen(
        prev.harpoonX ?? mine.x,
        Math.max(0.02, (prev.harpoon ?? PANG.h) - 0.05),
      )
      burst(this, tip.x, tip.y, PALETTE.red, 14, 220)
      floatText(this, tip.x, tip.y, `+${mine.pops - prev.pops}`, PALETTE.amber, size)
      this.sfx.pop()
    }
    if (mine.lives < prev.lives) {
      const p = this.toScreen(mine.x, PANG.h - PANG.playerH)
      if (mine.out) {
        eliminate(this, p.x, p.y, this.state.colorOf(mine.id), this.t('game.common.out'), size)
        this.sfx.eliminated()
      } else {
        floatText(this, p.x, p.y - 10, '-♥', PALETTE.red, size)
        this.sfx.wrong()
      }
      flash(this, PALETTE.red, 200, 0.28)
      shake(this, 0.008, 160)
    }
    if (mine.wave > prev.wave) {
      this.sfx.coin()
      showBanner(
        this,
        this.banner as Phaser.GameObjects.Text,
        this.t('game.pang.waveUp', { n: mine.wave + 1 }),
        PALETTE.lime,
      )
      this.bannerUntil = this.time.now + 1100
    }
  }

  private paintOwn(time: number): void {
    const mine = this.mine
    const sim = mine ? (this.sims.get(mine.id) ?? []) : []
    // Balloons (pooled images).
    sim.forEach((b, i) => {
      let img = this.balloonImgs[i]
      if (!img) {
        img = this.add.image(0, 0, this.balloonKeys[4] ?? '').setDepth(30)
        this.balloonImgs.push(img)
      }
      const key = this.balloonKeys[b.size] ?? ''
      if (img.texture.key !== key) img.setTexture(key)
      const p = this.toScreen(b.x, b.y)
      img.setPosition(Math.round(p.x), Math.round(p.y)).setVisible(true)
    })
    for (let i = sim.length; i < this.balloonImgs.length; i++)
      this.balloonImgs[i]?.setVisible(false)
    if (!mine) return
    // The player: dead-reckoned along the floor with the held direction.
    const since = (time - this.snapAt) / 1000
    const x = mine.out
      ? mine.x
      : Math.max(
          PANG.playerHalfW,
          Math.min(PANG.w - PANG.playerHalfW, mine.x + this.sentDir * PANG.walk * since),
        )
    const floor = this.toScreen(x, PANG.h)
    const avatarPx = Math.max(20, Math.round(PANG.playerH * this.arena.scale * 1.15))
    if (!this.avatar) {
      const key = ensureAvatarTexture(
        this,
        this.state.avatarOf(mine.id),
        this.state.colorOf(mine.id),
        4,
      )
      this.avatar = this.add
        .image(0, 0, key)
        .setOrigin(0.5, 1)
        .setDisplaySize(avatarPx, avatarPx)
        .setDepth(50)
    }
    this.avatar.setPosition(Math.round(floor.x), Math.round(floor.y))
    this.avatar.setAlpha(mine.out ? 0.3 : mine.shielded ? (Math.floor(time / 90) % 2 ? 0.3 : 1) : 1)
    this.avatar.setAngle(mine.out ? 90 : 0)
    // The harpoon: a zigzag wire from the floor up to the arrowhead.
    const g = this.harpoonG as Phaser.GameObjects.Graphics
    g.clear()
    if (mine.harpoon !== null && mine.harpoonX !== null) {
      const tipY = Math.max(0, mine.harpoon - PANG.harpoonSpeed * since)
      const base = this.toScreen(mine.harpoonX, PANG.h)
      const tip = this.toScreen(mine.harpoonX, tipY)
      g.lineStyle(2, 0xd8dce8, 1)
      g.beginPath()
      g.moveTo(base.x, base.y)
      for (let yy = base.y, k = 0; yy > tip.y; yy -= 6, k++) g.lineTo(base.x + (k % 2 ? 3 : -3), yy)
      g.lineTo(tip.x, tip.y)
      g.strokePath()
      g.fillStyle(0xd8dce8, 1)
      g.fillTriangle(tip.x, tip.y - 8, tip.x - 5, tip.y + 2, tip.x + 5, tip.y + 2)
    }
  }

  // Everyone else's arena, live, as thumbnails (wide screens only).
  private paintMinis(snap: PangSnapshot): void {
    const g = this.minis
    if (!g || !this.wide) return
    const others = snap.arenas.filter((a) => a.id !== this.selfId)
    const { width } = this.scale
    const colX = Math.round(width * 0.7) + 12
    const colW = width - colX - 10
    const cols = others.length > 4 ? 2 : 1
    const rows = Math.max(1, Math.ceil(others.length / cols))
    const labelH = 22
    // As big as the column allows, but every row (thumbnail + its label) must fit the arena's height.
    const availH = PANG.h * this.arena.scale
    const boxH = Math.floor(
      Math.min(((colW - (cols - 1) * 8) / cols) * PANG.h, availH / rows - labelH),
    )
    const boxW = Math.round(boxH / PANG.h)
    if (this.miniBoxes.length !== others.length) {
      this.miniBoxes = others.map((_, i) => ({
        x: colX + (i % cols) * (boxW + 8),
        y: this.arena.y + Math.floor(i / cols) * (boxH + labelH),
        w: boxW,
        h: boxH,
      }))
      for (const l of this.miniLabels) l.destroy()
      this.miniLabels = this.miniBoxes.map((b) =>
        this.add
          .text(b.x, b.y + b.h + 2, '', bodyStyle(11, PALETTE.text, { fontStyle: 'bold' }))
          .setDepth(6),
      )
    }
    g.clear()
    others.forEach((a, i) => {
      const box = this.miniBoxes[i]
      if (!box) return
      const s = box.w / PANG.w
      g.fillStyle(a.out ? 0x15172a : 0x1b2150, 1)
      g.fillRect(box.x, box.y, box.w, box.h)
      g.lineStyle(2, this.state.colorOf(a.id), a.out ? 0.4 : 1)
      g.strokeRect(box.x, box.y, box.w, box.h)
      for (const b of this.sims.get(a.id) ?? []) {
        g.fillStyle(BALLOON_COLORS[b.size] ?? PALETTE.red, 1)
        g.fillCircle(
          box.x + b.x * s,
          box.y + b.y * s,
          Math.max(1.5, (PANG.radius[b.size] ?? 0.03) * s),
        )
      }
      g.fillStyle(this.state.colorOf(a.id), 1)
      g.fillRect(box.x + a.x * s - 3, box.y + box.h - 7, 6, 7)
      if (a.harpoon !== null && a.harpoonX !== null) {
        g.lineStyle(1, 0xd8dce8, 1)
        g.lineBetween(
          box.x + a.harpoonX * s,
          box.y + box.h,
          box.x + a.harpoonX * s,
          box.y + a.harpoon * s,
        )
      }
      const label = this.miniLabels[i]
      const text = `${this.label(a.id)} · ${a.pops} ${a.out ? '✗' : '♥'.repeat(a.lives)}`
      if (label && label.text !== text) label.setText(text).setColor(a.out ? '#7b88a8' : '#eef1f7')
    })
  }
}
