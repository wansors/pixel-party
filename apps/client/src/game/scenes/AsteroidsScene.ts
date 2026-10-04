import {
  ASTEROIDS,
  type AsteroidsShip,
  type AsteroidsSnapshot,
  asteroidsFly,
  PALETTE,
} from '@pp/shared'
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
// extrapolated from the snapshot's velocities between updates. Your own ship is PREDICTED: it turns,
// thrusts and drifts on your held keys with the server's own flight step (shared), easing onto the
// server's view; the gun clicks and flashes at its nose the moment it fires. A ship whose pilot hasn't
// touched the controls yet is a faded ghost (nothing hits it).
// ←/→ (A/D) turn, ↑/W thrust, SPACE (also Z/J) fires — hold it for auto-fire — or the four hold
// buttons.

const W = ASTEROIDS.w
const H = ASTEROIDS.h
// Time constant of the ease from your predicted ship onto the server's (position and heading).
const CORRECT_TAU_MS = 220
// Shortest offset on a wrapping axis, and between two angles.
const wrapDelta = (d: number, size: number): number => d - size * Math.round(d / size)
const angleDelta = (d: number): number => d - Math.PI * 2 * Math.round(d / (Math.PI * 2))

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
  // The bubble pod (baked per color: drawing a dozen circles every frame is the costly part).
  pod: Phaser.GameObjects.Image
  alive: boolean
  kills: number
  // Smiling after a kill until then (scene time).
  cheerUntil: number
}

export class AsteroidsScene extends MiniGameScene<AsteroidsSnapshot> {
  private compact = false
  private arena = { x: 0, y: 0, scale: 1 }
  private sky?: Phaser.GameObjects.Graphics
  private g?: Phaser.GameObjects.Graphics
  // Everything in the sky lives in ONE masked container (rocks, then bullets/chevrons, then pods, then
  // pilots): a geometry mask per object costs a stencil pass each — dozens a frame.
  private rockLayer?: Phaser.GameObjects.Container
  private podLayer?: Phaser.GameObjects.Container
  private pilotLayer?: Phaser.GameObjects.Container
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
  // Controls go out only once the player has pressed something (an untouched ship stays parked).
  private touched = false
  private syncedRot: -1 | 0 | 1 = 0
  private sent = ''
  private sentAt = 0
  private lastTick = -1
  private snapAt = 0
  private lastFrameAt = 0
  private prev?: AsteroidsSnapshot
  // Your ship, predicted; when your gun may fire next; until when its muzzle flash shows.
  private pred?: { x: number; y: number; vx: number; vy: number; a: number }
  private nextShotAt = 0
  private muzzleUntil = 0
  // Other ships blowing up are heard at most this often (a pile-up is one blast), and softer unless
  // you shot them down.
  private lastBlastAt = Number.NEGATIVE_INFINITY
  private killedOne = false
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
    this.touched = false
    this.sent = ''
    this.sentAt = 0
    this.lastTick = -1
    this.snapAt = 0
    this.lastFrameAt = 0
    this.prev = undefined
    this.pred = undefined
    this.nextShotAt = 0
    this.muzzleUntil = 0
    this.lastBlastAt = Number.NEGATIVE_INFINITY

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
        this.touched = true
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
          this.touched = true
        })
        kb?.on(`keyup-${n}`, () => {
          this.keys[k] = false
        })
      }
    }
    bind(['LEFT', 'A'], 'left')
    bind(['RIGHT', 'D'], 'right')
    bind(['UP', 'W'], 'thrust')
    bind(['SPACE', 'Z', 'J', 'ENTER'], 'fire')
    const release = (): void => {
      this.keys = { left: false, right: false, thrust: false, fire: false }
      for (const b of this.buttons) b.ptr = -1
    }
    this.game.events.on(Phaser.Core.Events.BLUR, release)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.game.events.off(Phaser.Core.Events.BLUR, release),
    )

    let areaBottom = btnY - btnH / 2 - 10
    // The keys, named once above the controls (phones get the buttons alone).
    if (!this.compact) {
      const hint = this.t('game.asteroids.hint')
      const hintText = this.add
        .text(
          width / 2,
          areaBottom,
          hint,
          headlineStyle(fitFontSize(hint, width - 32, 16), PALETTE.dim),
        )
        .setOrigin(0.5, 1)
        .setDepth(600)
      areaBottom = hintText.y - hintText.height - 8
    }
    const scale = Math.min((width - 16) / W, (areaBottom - areaTop) / H)
    this.arena = {
      x: Math.round((width - W * scale) / 2),
      y: Math.round(areaTop + (areaBottom - areaTop - H * scale) / 2),
      scale,
    }
    const clip = this.make.graphics({ x: 0, y: 0 }, false)
    clip.fillStyle(0xffffff, 1)
    clip.fillRect(this.arena.x, this.arena.y, W * scale, H * scale)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => clip.destroy())
    this.sky = this.add.graphics().setDepth(1)
    this.paintSky()
    this.g = this.add.graphics()
    this.rockLayer = this.add.container(0, 0)
    this.podLayer = this.add.container(0, 0)
    this.pilotLayer = this.add.container(0, 0)
    const field = this.add
      .container(0, 0, [this.rockLayer, this.g, this.podLayer, this.pilotLayer])
      .setDepth(40)
      .enableFilters()
    // Clipped to the arena by a Mask filter; the rectangle never changes, so it's captured once.
    const mask = field.filters?.internal.addMask(clip)
    if (mask) mask.autoUpdate = false
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
    this.syncedRot = rot
    const key = `${rot}${thrust ? 1 : 0}${fire ? 1 : 0}`
    const flying = this.snap?.ships.some((s) => s.id === this.selfId) ?? false
    if (
      this.touched &&
      flying &&
      (key !== this.sent || time - this.sentAt > 300) &&
      !this.state.final
    ) {
      this.sent = key
      this.sentAt = time
      this.sendInput({ kind: 'controls', rot, thrust, fire })
    }
    return { rot, thrust, fire }
  }

  protected frame(snap: AsteroidsSnapshot | null, time: number): void {
    const dt = this.lastFrameAt ? Math.min(100, time - this.lastFrameAt) : 0
    this.lastFrameAt = time
    const controls = this.syncControls(time)
    if (!snap) return
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.snapAt = time
      this.onSnapshot(snap)
    }
    const since = Math.min(0.3, (time - this.snapAt) / 1000)
    this.predict(snap, controls, since, time, dt)
    const g = this.g as Phaser.GameObjects.Graphics
    g.clear()
    this.paintRocks(snap, since, time)
    this.paintBullets(snap, since)
    this.paintShips(snap, since, time)
  }

  // Your ship: flown locally on the held keys with the server's own step, then eased onto where the
  // server has it (its snapshot run on with ITS held controls) — so the ship answers at once and never
  // drifts away from the truth. A respawn (or a big disagreement) snaps.
  private predict(
    snap: AsteroidsSnapshot,
    controls: { rot: -1 | 0 | 1; thrust: boolean; fire: boolean },
    since: number,
    time: number,
    dt: number,
  ): void {
    const me = snap.ships.find((s) => s.id === this.selfId)
    if (!me?.alive || this.state.final) {
      this.pred = undefined
      return
    }
    const server = { x: me.x, y: me.y, vx: me.vx, vy: me.vy, a: me.a }
    for (let left = since; left > 0; left -= 0.05)
      asteroidsFly(server, me.rot, me.thrust, Math.min(0.05, left))
    const p = this.pred
    if (!p || Math.hypot(wrapDelta(server.x - p.x, W), wrapDelta(server.y - p.y, H)) > 0.2) {
      this.pred = server
      return
    }
    const live = !me.idle || controls.rot !== 0 || controls.thrust || controls.fire
    if (live) asteroidsFly(p, controls.rot, controls.thrust, dt / 1000)
    const k = 1 - Math.exp(-dt / CORRECT_TAU_MS)
    p.x = wrap(p.x + wrapDelta(server.x - p.x, W) * k, W)
    p.y = wrap(p.y + wrapDelta(server.y - p.y, H) * k, H)
    p.vx += (server.vx - p.vx) * k
    p.vy += (server.vy - p.vy) * k
    p.a += angleDelta(server.a - p.a) * k
    // The gun: fires at its cadence while held (the server checks the same 4-in-flight limit).
    const idx = snap.ships.indexOf(me)
    const flying = snap.bullets.filter((b) => b[4] === idx).length
    if (controls.fire && time >= this.nextShotAt && flying < ASTEROIDS.maxBullets) {
      this.nextShotAt = time + ASTEROIDS.fireMs
      this.muzzleUntil = time + 70
      this.sfx.shoot()
    }
  }

  private paintRocks(snap: AsteroidsSnapshot, since: number, time: number): void {
    const seen = new Set<number>()
    for (const [id, x, y, vx, vy, size] of snap.rocks) {
      seen.add(id)
      let img = this.rockImgs.get(id)
      if (!img) {
        img = this.add.image(0, 0, this.rockKeys[size] ?? '').setDepth(20)
        this.rockLayer?.add(img)
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

  private paintShips(snap: AsteroidsSnapshot, since: number, time: number): void {
    const g = this.g as Phaser.GameObjects.Graphics
    // A pilot who left the round is gone from the sky.
    for (const [id, view] of this.ships) {
      if (snap.ships.some((s) => s.id === id)) continue
      view.avatar.destroy()
      view.pod.destroy()
      this.ships.delete(id)
      if (id === this.selfId) this.marker?.hide()
    }
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
        const pod = this.add.image(0, 0, this.ensurePod(this.state.colorOf(s.id))).setDepth(45)
        this.podLayer?.add(pod)
        this.pilotLayer?.add(avatar.image)
        view = { avatar, pod, alive: s.alive, kills: s.kills, cheerUntil: 0 }
        this.ships.set(s.id, view)
      }
      if (s.kills > view.kills) view.cheerUntil = time + 900
      view.kills = s.kills
      view.avatar.image.setVisible(s.alive)
      view.pod.setVisible(s.alive)
      if (!s.alive) {
        if (s.id === this.selfId) this.marker?.hide()
        continue
      }
      const mine = s.id === this.selfId ? this.pred : undefined
      const rot = s.id === this.selfId ? this.syncedRot : s.rot
      const a = mine ? mine.a : s.a + rot * ASTEROIDS.turn * since
      const p = mine
        ? this.toScreen(mine.x, mine.y)
        : this.toScreen(wrap(s.x + s.vx * since, W), wrap(s.y + s.vy * since, H))
      // The pilot rides upright in a bubble pod (leaning into turns); the nose chevron on the pod's
      // rim shows the heading.
      view.avatar.setExpression(time < view.cheerUntil ? 'happy' : 'idle').tick(time)
      view.avatar.image
        .setPosition(Math.round(p.x), Math.round(p.y))
        .setAngle(rot * 10)
        .setAlpha(s.idle ? 0.35 : s.shield ? (Math.floor(time / 100) % 2 ? 0.5 : 1) : 1)
      const color = this.state.colorOf(s.id)
      const r = this.shipPx * 0.62
      const cos = Math.cos(a)
      const sin = Math.sin(a)
      view.pod.setPosition(Math.round(p.x), Math.round(p.y)).setAlpha(s.idle ? 0.4 : 1)
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
      if (mine && time < this.muzzleUntil) {
        g.fillStyle(0xffffff, 1)
        g.fillRect(Math.round(p.x + cos * (r + 8)) - 3, Math.round(p.y + sin * (r + 8)) - 3, 6, 6)
      }
      if (mine ? this.keys.thrust || this.held('T') : s.thrust) {
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

  // A ship's bubble pod in a pilot's color: dark glass, colored rim, a glint.
  private ensurePod(color: number): string {
    const r = Math.round(this.shipPx * 0.62)
    const key = `ast-pod-${color.toString(16)}-${r}`
    if (this.textures.exists(key)) return key
    const size = r * 2 + 4
    const c = size / 2
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(0x0b0f1f, 0.6)
    g.fillCircle(c, c, r)
    g.lineStyle(2, color, 0.9)
    g.strokeCircle(c, c, r)
    g.fillStyle(0xffffff, 0.35)
    g.fillCircle(c - r * 0.45, c - r * 0.45, Math.max(2, r * 0.14))
    g.generateTexture(key, size, size)
    g.destroy()
    return key
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
          dim: !s.alive || s.idle,
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
    const meBefore = prevById.get(this.selfId)
    this.killedOne = !!me && !!meBefore && me.kills > meBefore.kills
    for (const s of snap.ships) {
      const before = prevById.get(s.id)
      if (!before) continue
      if (before.alive && !s.alive) this.boom(before, s.id === this.selfId)
      if (!before.alive && s.alive) {
        const p = this.toScreen(s.x, s.y)
        ring(this, p.x, p.y, this.state.colorOf(s.id), this.shipPx)
        // Back in the fight, shield up.
        if (s.id === this.selfId) this.sfx.powerUp()
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
        // A ship you shot down blows up in boom() (this is the bounty); a rock you broke bursts here.
        if (s.kills > before.kills) this.sfx.coin()
        else this.sfx.explosion()
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
      this.sfx.explosion()
      this.sfx.hurt()
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
    } else if (this.killedOne) {
      this.killedOne = false
      this.sfx.explosion()
    } else if (this.time.now - this.lastBlastAt >= 250) {
      this.lastBlastAt = this.time.now
      this.sfx.quiet(() => this.sfx.explosion(), 0.4)
    }
  }
}
