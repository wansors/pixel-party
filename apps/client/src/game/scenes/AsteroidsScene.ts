import { ASTEROIDS, type AsteroidsShip, type AsteroidsSnapshot, PALETTE } from '@pp/shared'
import Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { addBanner, burst, flash, floatText, ring, shake, showBanner } from '../fx'
import { ensureBevelPanel, ensurePixelGrid, fitFontSize, headlineStyle, shade } from '../pixelStyle'
import { YouMarker } from '../playerMarks'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Asteroids Arena: one shared, wrapping starfield. Every ship is a bubble pod with its pilot's lobby
// avatar riding upright inside (a nose chevron on the rim shows the heading, a flame when thrusting, a
// ring while shielded). Rocks
// are lumpy pixel boulders in three sizes; bullets take their shooter's color. Everything is
// extrapolated from the snapshot's velocities between updates; your own heading is predicted from
// your held keys. ←/→ (A/D) turn, ↑/W thrust, SPACE fires — or the four hold buttons.

const W = ASTEROIDS.w
const H = ASTEROIDS.h

const wrap = (v: number, size: number): number => ((v % size) + size) % size

// A lumpy boulder: a disc whose edge wobbles with a few seeded sines, a dark rim and two craters.
function rockRows(cells: number, size: number): string[] {
  const rows: string[] = []
  const c = cells / 2
  for (let y = 0; y < cells; y++) {
    let row = ''
    for (let x = 0; x < cells; x++) {
      const dx = x + 0.5 - c
      const dy = y + 0.5 - c
      const ang = Math.atan2(dy, dx)
      const edge = c * (0.8 + 0.12 * Math.sin(ang * 3 + size) + 0.08 * Math.sin(ang * 5 + size * 2))
      const d = Math.hypot(dx, dy)
      if (d > edge) row += '_'
      else if (d > edge - 1.2) row += 'D'
      else if (
        Math.hypot(dx + c * 0.3, dy + c * 0.2) < c * 0.18 ||
        Math.hypot(dx - c * 0.25, dy - c * 0.3) < c * 0.12
      )
        row += 'C'
      else if (dx < -c * 0.2 && dy < -c * 0.2) row += 'L'
      else row += 'R'
    }
    rows.push(row)
  }
  return rows
}

interface ShipView {
  avatar: AvatarSprite
  alive: boolean
  kills: number
  // Smiling after a kill until then (scene time).
  cheerUntil: number
}

export class AsteroidsScene extends MiniGameScene<AsteroidsSnapshot> {
  private compact = false
  private arena = { x: 0, y: 0, scale: 1 }
  private clip?: Phaser.Display.Masks.GeometryMask
  private sky?: Phaser.GameObjects.Graphics
  private g?: Phaser.GameObjects.Graphics
  private rockKeys: string[] = []
  private rockImgs = new Map<number, Phaser.GameObjects.Image>()
  private ships = new Map<string, ShipView>()
  private shipPx = 0
  private marker?: YouMarker
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private buttons: {
    act: 'L' | 'R' | 'T' | 'F'
    img: Phaser.GameObjects.Image
    up: string
    down: string
    ptr: number
  }[] = []
  private keys = { left: false, right: false, thrust: false, fire: false }
  private sent = ''
  private sentAt = 0
  private lastTick = -1
  private snapAt = 0
  private prev?: AsteroidsSnapshot

  constructor(...deps: SceneDeps) {
    super('asteroids', ...deps)
  }

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.rockKeys = []
    this.rockImgs = new Map()
    this.ships = new Map()
    this.buttons = []
    this.keys = { left: false, right: false, thrust: false, fire: false }
    this.sent = ''
    this.sentAt = 0
    this.lastTick = -1
    this.snapAt = 0
    this.prev = undefined

    const stripSize = this.compact ? 11 : 13
    this.strip = new PlayerStrip(this, width / 2, this.top + 8, width - 24, stripSize, 2)
    const areaTop = this.top + 8 + PlayerStrip.rowH(stripSize) * 2

    // Controls: ◀ ▶ (turn) THRUST FIRE (hold).
    const btnH = this.compact ? 68 : 52
    const gap = this.compact ? 8 : 12
    const padW = Math.min(width - 16, 640)
    const turnW = (padW - gap * 3) * 0.18
    const bigW = (padW - gap * 3 - turnW * 2) / 2
    const btnY = height - (this.compact ? 12 : 14) - btnH / 2
    const x0 = width / 2 - padW / 2
    const specs = [
      { act: 'L' as const, w: turnW, label: '◀', color: PALETTE.frameLit },
      { act: 'R' as const, w: turnW, label: '▶', color: PALETTE.frameLit },
      { act: 'T' as const, w: bigW, label: this.t('game.asteroids.thrust'), color: PALETTE.cyan },
      { act: 'F' as const, w: bigW, label: this.t('game.asteroids.fire'), color: PALETTE.orange },
    ]
    let x = x0
    for (const spec of specs) {
      const up = ensureBevelPanel(this, spec.w, btnH, shade(spec.color, -0.2), 5, true)
      const down = ensureBevelPanel(this, spec.w, btnH, shade(spec.color, -0.55), 5, true)
      const cx = x + spec.w / 2
      const img = this.add.image(cx, btnY, up).setDepth(700).setInteractive()
      this.add
        .text(
          cx,
          btnY,
          spec.label,
          headlineStyle(
            fitFontSize(spec.label, spec.w - 12, this.compact ? 16 : 24),
            PALETTE.text,
            { stroke: '#10121c', strokeThickness: 4 },
          ),
        )
        .setOrigin(0.5)
        .setDepth(701)
      const button = { act: spec.act, img, up, down, ptr: -1 }
      img.on('pointerdown', (p: Phaser.Input.Pointer) => {
        button.ptr = p.id
      })
      this.buttons.push(button)
      x += spec.w + gap
    }
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      for (const b of this.buttons) if (b.ptr === p.id) b.ptr = -1
    })
    const kb = this.input.keyboard
    const bind = (names: string[], k: 'left' | 'right' | 'thrust' | 'fire'): void => {
      for (const n of names) {
        kb?.on(`keydown-${n}`, () => {
          this.keys[k] = true
        })
        kb?.on(`keyup-${n}`, () => {
          this.keys[k] = false
        })
      }
    }
    bind(['LEFT', 'A'], 'left')
    bind(['RIGHT', 'D'], 'right')
    bind(['UP', 'W'], 'thrust')
    bind(['SPACE'], 'fire')
    const release = (): void => {
      this.keys = { left: false, right: false, thrust: false, fire: false }
      for (const b of this.buttons) b.ptr = -1
    }
    this.game.events.on(Phaser.Core.Events.BLUR, release)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.game.events.off(Phaser.Core.Events.BLUR, release),
    )

    const areaBottom = btnY - btnH / 2 - 10
    const scale = Math.min((width - 16) / W, (areaBottom - areaTop) / H)
    this.arena = {
      x: Math.round((width - W * scale) / 2),
      y: Math.round(areaTop + (areaBottom - areaTop - H * scale) / 2),
      scale,
    }
    const shape = this.make.graphics({ x: 0, y: 0 }, false)
    shape.fillStyle(0xffffff, 1)
    shape.fillRect(this.arena.x, this.arena.y, W * scale, H * scale)
    this.clip = shape.createGeometryMask()
    this.sky = this.add.graphics().setDepth(1)
    this.paintSky()
    this.g = this.add.graphics().setDepth(40).setMask(this.clip)
    this.shipPx = avatarPx(Math.max(24, Math.round(ASTEROIDS.shipR * 2 * scale * 1.6)))
    this.marker = new YouMarker(this, this.compact ? 8 : 12, 60)
    for (let size = 1; size <= 3; size++) {
      const cells = Math.max(6, Math.round(((ASTEROIDS.rockR[size] ?? 0.03) * 2 * scale) / 3))
      this.rockKeys[size] = ensurePixelGrid(this, {
        key: `ast-rock-${size}-${cells}`,
        rows: rockRows(cells, size),
        legend: { R: 0x7d8496, L: 0xa7aec0, D: 0x454a5a, C: 0x5a6070 },
        pixelSize: 3,
      })
    }
    this.banner = addBanner(this)
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.arena.x + x * this.arena.scale, y: this.arena.y + y * this.arena.scale }
  }

  private paintSky(): void {
    const g = this.sky as Phaser.GameObjects.Graphics
    const { x, y, scale } = this.arena
    g.fillStyle(0x05060f, 1)
    g.fillRect(x, y, W * scale, H * scale)
    for (let i = 0; i < 110; i++) {
      const sx = x + ((i * 89) % 97) * ((W * scale) / 97)
      const sy = y + ((i * 47) % 83) * ((H * scale) / 83)
      g.fillStyle(i % 9 === 0 ? 0xffffff : i % 3 === 0 ? 0x8f9bd0 : 0x3c4470, 1)
      g.fillRect(Math.round(sx), Math.round(sy), i % 9 === 0 ? 2 : 1, i % 9 === 0 ? 2 : 1)
    }
    g.lineStyle(3, PALETTE.frameLit, 1)
    g.strokeRect(x, y, W * scale, H * scale)
  }

  private held(act: 'L' | 'R' | 'T' | 'F'): boolean {
    return this.buttons.some((b) => b.act === act && b.ptr !== -1)
  }

  private syncControls(time: number): { rot: -1 | 0 | 1; thrust: boolean; fire: boolean } {
    const left = this.keys.left || this.held('L')
    const right = this.keys.right || this.held('R')
    const rot: -1 | 0 | 1 = left === right ? 0 : left ? -1 : 1
    const thrust = this.keys.thrust || this.held('T')
    const fire = this.keys.fire || this.held('F')
    for (const b of this.buttons) {
      const on =
        (b.act === 'L' && left) ||
        (b.act === 'R' && right) ||
        (b.act === 'T' && thrust) ||
        (b.act === 'F' && fire)
      if (b.img.texture.key !== (on ? b.down : b.up)) b.img.setTexture(on ? b.down : b.up)
    }
    const key = `${rot}${thrust ? 1 : 0}${fire ? 1 : 0}`
    if ((key !== this.sent || time - this.sentAt > 300) && this.snap && !this.state.final) {
      this.sent = key
      this.sentAt = time
      this.sendInput({ kind: 'controls', rot, thrust, fire })
    }
    return { rot, thrust, fire }
  }

  protected frame(snap: AsteroidsSnapshot | null, time: number): void {
    const controls = this.syncControls(time)
    if (!snap) return
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.snapAt = time
      this.onSnapshot(snap)
    }
    const since = Math.min(0.3, (time - this.snapAt) / 1000)
    const g = this.g as Phaser.GameObjects.Graphics
    g.clear()
    this.paintRocks(snap, since, time)
    this.paintBullets(snap, since)
    this.paintShips(snap, since, time, controls.rot)
  }

  private paintRocks(snap: AsteroidsSnapshot, since: number, time: number): void {
    const seen = new Set<number>()
    for (const [id, x, y, vx, vy, size] of snap.rocks) {
      seen.add(id)
      let img = this.rockImgs.get(id)
      if (!img) {
        img = this.add.image(0, 0, this.rockKeys[size] ?? '').setDepth(20)
        if (this.clip) img.setMask(this.clip)
        this.rockImgs.set(id, img)
      }
      const p = this.toScreen(wrap(x + vx * since, W), wrap(y + vy * since, H))
      img
        .setPosition(Math.round(p.x), Math.round(p.y))
        .setRotation(id * 0.7 + (time / 1000) * (0.4 + (id % 3) * 0.2))
    }
    for (const [id, img] of this.rockImgs) {
      if (seen.has(id)) continue
      img.destroy()
      this.rockImgs.delete(id)
    }
  }

  private paintBullets(snap: AsteroidsSnapshot, since: number): void {
    const g = this.g as Phaser.GameObjects.Graphics
    for (const [x, y, vx, vy, owner] of snap.bullets) {
      const p = this.toScreen(wrap(x + vx * since, W), wrap(y + vy * since, H))
      const id = snap.ships[owner]?.id ?? ''
      g.fillStyle(this.state.colorOf(id, PALETTE.text), 1)
      g.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4)
    }
  }

  private paintShips(snap: AsteroidsSnapshot, since: number, time: number, myRot: number): void {
    const g = this.g as Phaser.GameObjects.Graphics
    for (const s of snap.ships) {
      let view = this.ships.get(s.id)
      if (!view) {
        const avatar = new AvatarSprite(
          this,
          this.state.avatarOf(s.id),
          this.state.colorOf(s.id),
          this.shipPx,
        )
        avatar.image.setDepth(50)
        if (this.clip) avatar.image.setMask(this.clip)
        view = { avatar, alive: s.alive, kills: s.kills, cheerUntil: 0 }
        this.ships.set(s.id, view)
      }
      if (s.kills > view.kills) view.cheerUntil = time + 900
      view.kills = s.kills
      view.avatar.image.setVisible(s.alive)
      if (!s.alive) {
        if (s.id === this.selfId) this.marker?.hide()
        continue
      }
      const rot = s.id === this.selfId ? myRot : s.rot
      const a = s.a + rot * ASTEROIDS.turn * since
      const p = this.toScreen(wrap(s.x + s.vx * since, W), wrap(s.y + s.vy * since, H))
      // The pilot rides upright in a bubble pod (leaning into turns); the nose chevron on the pod's
      // rim shows the heading.
      view.avatar.setExpression(time < view.cheerUntil ? 'happy' : 'idle').tick(time)
      view.avatar.image
        .setPosition(Math.round(p.x), Math.round(p.y))
        .setAngle(rot * 10)
        .setAlpha(s.shield ? (Math.floor(time / 100) % 2 ? 0.5 : 1) : 1)
      const color = this.state.colorOf(s.id)
      const r = this.shipPx * 0.62
      const cos = Math.cos(a)
      const sin = Math.sin(a)
      g.fillStyle(0x0b0f1f, 0.6)
      g.fillCircle(p.x, p.y, r)
      g.lineStyle(2, color, 0.9)
      g.strokeCircle(p.x, p.y, r)
      g.fillStyle(0xffffff, 0.35)
      g.fillCircle(p.x - r * 0.45, p.y - r * 0.45, Math.max(2, r * 0.14))
      // Nose chevron.
      g.fillStyle(color, 1)
      g.fillTriangle(
        p.x + cos * (r + 7),
        p.y + sin * (r + 7),
        p.x + cos * r - sin * 5,
        p.y + sin * r + cos * 5,
        p.x + cos * r + sin * 5,
        p.y + sin * r - cos * 5,
      )
      if (s.thrust) {
        g.fillStyle(Math.floor(time / 60) % 2 ? PALETTE.amber : PALETTE.orange, 1)
        const fl = r + 4 + (Math.floor(time / 60) % 2) * 4
        g.fillTriangle(
          p.x - cos * fl,
          p.y - sin * fl,
          p.x - cos * r - sin * 4,
          p.y - sin * r + cos * 4,
          p.x - cos * r + sin * 4,
          p.y - sin * r - cos * 4,
        )
      }
      if (s.shield) {
        g.lineStyle(2, color, 0.7)
        g.strokeCircle(p.x, p.y, r + 4)
      }
      if (s.id === this.selfId) this.marker?.place(p.x, p.y - r - 4, time)
    }
  }

  // Snapshot deltas: broken rocks, kills, deaths, respawns, scores.
  private onSnapshot(snap: AsteroidsSnapshot): void {
    const prev = this.prev
    this.prev = snap
    const me = snap.ships.find((s) => s.id === this.selfId)
    if (me) this.hud?.setScore(this.t('game.asteroids.score', { n: me.score }))
    this.strip?.set(
      [...snap.ships]
        .sort((a, b) => b.score - a.score)
        .map((s) => ({
          text: `${this.label(s.id)} ${s.score}`,
          avatar: this.state.avatarOf(s.id),
          color: this.state.colorOf(s.id),
          dim: !s.alive,
        })),
    )
    if (!prev || this.firstSnapshot) return
    const ids = new Set(snap.rocks.map((r) => r[0]))
    for (const [id, x, y, , , size] of prev.rocks) {
      if (ids.has(id)) continue
      const p = this.toScreen(x, y)
      burst(this, p.x, p.y, 0xa7aec0, 6 + size * 4, 120 + size * 40)
    }
    const prevById = new Map(prev.ships.map((s) => [s.id, s]))
    for (const s of snap.ships) {
      const before = prevById.get(s.id)
      if (!before) continue
      if (before.alive && !s.alive) this.boom(before, s.id === this.selfId)
      if (!before.alive && s.alive) {
        const p = this.toScreen(s.x, s.y)
        ring(this, p.x, p.y, this.state.colorOf(s.id), this.shipPx)
      }
      if (s.id === this.selfId && s.score > before.score) {
        const p = this.toScreen(s.x, s.y)
        const gain = s.score - before.score
        floatText(
          this,
          p.x,
          p.y - this.shipPx,
          `+${gain}`,
          s.kills > before.kills ? PALETTE.lime : PALETTE.amber,
          12,
        )
        if (s.kills > before.kills) this.sfx.coin()
        else this.sfx.pop()
      }
    }
    if (this.state.final && me && this.banner && !this.banner.visible) {
      const best = Math.max(...snap.ships.map((s) => s.score))
      const won = me.score === best && snap.ships.length > 1
      showBanner(
        this,
        this.banner,
        won ? this.t('game.common.youWin') : this.t('game.asteroids.final', { n: me.score }),
        won ? PALETTE.lime : PALETTE.amber,
      )
    }
  }

  private boom(s: AsteroidsShip, mine: boolean): void {
    const p = this.toScreen(s.x, s.y)
    burst(this, p.x, p.y, this.state.colorOf(s.id), 22, 240)
    ring(this, p.x, p.y, PALETTE.orange, this.shipPx * 1.4)
    if (mine) {
      this.sfx.wrong()
      flash(this, PALETTE.red, 200, 0.28)
      shake(this, 0.01, 200)
      floatText(
        this,
        p.x,
        p.y - this.shipPx,
        this.t('game.asteroids.boom'),
        PALETTE.red,
        this.compact ? 12 : 16,
      )
    } else this.sfx.pop()
  }
}
