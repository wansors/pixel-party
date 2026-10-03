import { PALETTE, type SumoBody, type SumoSnapshot } from '@pp/shared'
import type Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { addBanner, burst, flash, floatText, ring, shake, showBanner } from '../fx'
import { SnapshotInterpolator, lerp } from '../netcode/SnapshotInterpolator'
import { bodyStyle, ensurePixelGrid, fitFontSize, headlineStyle } from '../pixelStyle'
import { YouMarker, addShadow, nameTagStyle } from '../playerMarks'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Mirrors the server's sumo.ts: bodies are circles of radius PLAYER_R in the normalized arena (ring
// centred at 0.5, 0.5; its radius arrives in the snapshot). Contact = centres closer than 2·PLAYER_R.
const PLAYER_R = 0.05
const DEFAULT_RING = 0.42
const CONTACT = PLAYER_R * 2 * 1.3
const IMPACT_COOLDOWN_MS = 400

// Order-independent id for a pair of wrestlers (per-pair contact / cooldown tracking).
function pairKey(a: SumoBody, b: SumoBody): string {
  return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
}

// The dohyo texture: a square clay platform (DOHYO_CELLS wide) whose straw-bale ring starts exactly at
// RING_CELLS from the centre, so scaling the texture to the snapshot's ring radius lines the bales up
// with the server's ring-out line.
const DOHYO_CELLS = 80
const RING_CELLS = 35

function dohyoRows(): string[] {
  const rows: string[] = []
  const c = DOHYO_CELLS / 2
  for (let y = 0; y < DOHYO_CELLS; y++) {
    let row = ''
    for (let x = 0; x < DOHYO_CELLS; x++) {
      const dx = x + 0.5 - c
      const dy = y + 0.5 - c
      const d = Math.hypot(dx, dy)
      if (x < 2 || y < 2) row += 'e'
      else if (x >= DOHYO_CELLS - 2 || y >= DOHYO_CELLS - 2) row += 'E'
      else if (d >= RING_CELLS && d < RING_CELLS + 2.6) {
        // Straw bales: 40 segments with a dark tie between each.
        const turn = ((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * 40
        row += turn - Math.floor(turn) < 0.14 ? 'T' : d < RING_CELLS + 1.2 ? 't' : 'u'
      } else if (d < RING_CELLS) {
        const startLine = Math.abs(Math.abs(dx) - 5.5) < 0.1 && Math.abs(dy) < 3.5
        row += startLine ? 'w' : (x * 7 + y * 13) % 23 === 0 ? 'S' : 's'
      } else {
        row += (x * 5 + y * 11) % 29 === 0 ? 'C' : 'c'
      }
    }
    rows.push(row)
  }
  return rows
}

// A wrestler is the player's lobby avatar on a shadow, facing where it shoves or travels.
interface Rikishi {
  avatar: AvatarSprite
  shadow: Phaser.GameObjects.Ellipse
  label: Phaser.GameObjects.Text
  color: number
  px: number
  py: number
  out: boolean
  // Wincing after a clash until then (scene time).
  hurtUntil: number
}

// Sumo Push canvas (Phase 5). Shared arena: every wrestler is rendered from the snapshot (interpolated
// by id) on a pixel dohyo drawn to the server's exact ring size; the player steers their own with a
// drag vector from the ring centre (or the arrow keys). Shoves, ring-outs and the last one standing
// are derived from snapshot deltas.
export class SumoScene extends MiniGameScene<SumoSnapshot> {
  private dohyo?: Phaser.GameObjects.Image
  private shadow?: Phaser.GameObjects.Rectangle
  private arrow?: Phaser.GameObjects.Graphics
  private marker?: YouMarker
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private readonly bodies = new Map<string, Rikishi>()
  private readonly interp = new SnapshotInterpolator<SumoSnapshot>(100)
  private prevSnap?: SumoSnapshot
  private pairDist = new Map<string, number>()
  private impactAt = new Map<string, number>()
  private wrestlerKeys = new Map<number, string>()
  private lastTick = -1
  private dir = { dx: 0, dy: 0 }
  // Where the held pointer is: every frame the push direction is re-aimed from the player's own
  // wrestler toward it, so "hold where you want to go" keeps working as the wrestler moves.
  private aim?: { x: number; y: number }
  private keyDriven = false
  private lastSentAt = 0
  private synced = false
  private wasAlive = true
  private won = false
  private compact = false
  private ringR = DEFAULT_RING
  private arena = { cx: 0, cy: 0, size: 0 }

  constructor(...deps: SceneDeps) {
    super('sumo-push', ...deps)
  }

  override create(): void {
    super.create()
    this.interp.reset()
    this.prevSnap = undefined
    this.pairDist = new Map()
    this.impactAt = new Map()
    this.lastTick = -1
    this.dir = { dx: 0, dy: 0 }
    this.aim = undefined
    this.keyDriven = false
    this.synced = false
    this.wasAlive = true
    this.won = false
    this.ringR = DEFAULT_RING
    for (const b of this.bodies.values()) {
      b.avatar.destroy()
      b.shadow.destroy()
      b.label.destroy()
    }
    this.bodies.clear()

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    const hintH = this.compact ? 22 : 28
    const pad = this.compact ? 8 : 16
    const size = Math.min(width - pad * 2, height - this.top - hintH - pad * 2)
    this.arena = {
      cx: width / 2,
      cy: this.top + pad + (height - this.top - hintH - pad * 2) / 2,
      size,
    }

    const dohyoKey = ensurePixelGrid(this, {
      key: 'pp-sumo-dohyo',
      rows: dohyoRows(),
      legend: {
        e: 0xd9b27f,
        E: 0x7a5234,
        c: 0xb5875a,
        C: 0x9c7049,
        t: 0xd8c27a,
        u: 0xb09a58,
        T: 0x6e5a2e,
        s: 0xe6cf9f,
        S: 0xcfb682,
        w: PALETTE.text,
      },
      pixelSize: 2,
    })
    // Platform shadow + the dohyo itself (sized once the snapshot's ring radius is known).
    this.shadow = this.add
      .rectangle(this.arena.cx + 6, this.arena.cy + 8, 10, 10, 0x000000)
      .setAlpha(0.35)
    this.dohyo = this.add.image(this.arena.cx, this.arena.cy, dohyoKey)
    this.fitDohyo()

    this.arrow = this.add.graphics().setDepth(25)
    this.marker = new YouMarker(this, 16, 40)

    this.add
      .text(
        width / 2,
        height - hintH / 2,
        this.t('game.sumoPush.hint'),
        bodyStyle(this.compact ? 11 : 14, PALETTE.dim),
      )
      .setOrigin(0.5)

    this.banner = addBanner(this)
    this.subline = this.add
      .text(
        width / 2,
        height / 2 + (this.compact ? 34 : 46),
        '',
        headlineStyle(this.compact ? 8 : 16, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setDepth(950)
      .setVisible(false)

    this.cursors = this.input.keyboard?.createCursorKeys()
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.steer(p))
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.steer(p)
    })
    this.input.on('pointerup', () => {
      this.aim = undefined
      this.dir = { dx: 0, dy: 0 }
      this.sendInput({ kind: 'move', dx: 0, dy: 0 })
    })
  }

  // Scales the dohyo so its bale ring sits exactly on the snapshot's ring radius.
  private fitDohyo(): void {
    const side = this.ringR * this.arena.size * (DOHYO_CELLS / RING_CELLS)
    this.dohyo?.setDisplaySize(side, side)
    this.shadow?.setDisplaySize(side, side)
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    const { cx, cy, size } = this.arena
    return { x: cx + (x - 0.5) * size, y: cy + (y - 0.5) * size }
  }

  private steer(p: Phaser.Input.Pointer): void {
    this.aim = { x: p.x, y: p.y }
    this.keyDriven = false
  }

  // Push direction toward the held pointer, measured from the player's own wrestler (ring centre
  // until it's on screen).
  private aimFromSelf(aim: { x: number; y: number }): { dx: number; dy: number } {
    const me = this.bodies.get(this.selfId)
    const ox = me && !me.out ? me.px : this.arena.cx
    const oy = me && !me.out ? me.py : this.arena.cy
    return { dx: aim.x - ox, dy: aim.y - oy }
  }

  protected frame(snap: SumoSnapshot | null): void {
    const now = this.time.now
    if (snap && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.interp.push(snap, now)
      this.onSnapshot(snap, now)
    }

    const kx = (this.cursors?.right.isDown ? 1 : 0) - (this.cursors?.left.isDown ? 1 : 0)
    const ky = (this.cursors?.down.isDown ? 1 : 0) - (this.cursors?.up.isDown ? 1 : 0)
    if (kx !== 0 || ky !== 0) {
      this.dir = { dx: kx, dy: ky }
      this.keyDriven = true
    } else if (this.keyDriven) {
      this.dir = { dx: 0, dy: 0 }
      this.keyDriven = false
    } else if (this.aim) {
      this.dir = this.aimFromSelf(this.aim)
    }
    if (now - this.lastSentAt > 60) {
      this.lastSentAt = now
      this.sendInput({ kind: 'move', dx: this.dir.dx, dy: this.dir.dy })
    }

    this.renderBodies(now)
  }

  // Discrete events per fresh snapshot: shoves (a pair's distance dips into contact), ring-outs, the
  // last one standing.
  private onSnapshot(snap: SumoSnapshot, now: number): void {
    if (snap.ring !== this.ringR) {
      this.ringR = snap.ring
      this.fitDohyo()
    }
    const alive = snap.bodies.filter((b) => b.alive)
    this.hud?.setScore(
      this.t('game.sumoPush.alive', { n: alive.length, total: snap.bodies.length }),
    )
    const prevById = new Map((this.prevSnap?.bodies ?? []).map((b) => [b.id, b]))
    this.prevSnap = snap
    const me = snap.bodies.find((b) => b.id === this.selfId)

    if (!this.synced) {
      this.synced = true
      for (const b of snap.bodies) {
        if (b.alive) continue
        const body = this.bodyOf(b)
        body.out = true
        body.avatar.setExpression('ko').tick(0)
        body.avatar.image.setAlpha(0.35)
        body.shadow.setVisible(false)
        body.label.setAlpha(0.4)
      }
      if (me && !me.alive) this.becomeOut(me, false)
      // Baseline the pair distances (and an already-won ring), so the next snapshot doesn't read
      // wrestlers already in contact as a fresh shove, or replay the win.
      for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
          const a = alive[i] as SumoBody
          const b = alive[j] as SumoBody
          this.pairDist.set(pairKey(a, b), Math.hypot(a.x - b.x, a.y - b.y))
        }
      }
      if (me?.alive && snap.bodies.length > 1 && alive.length === 1) {
        this.won = true
        this.showEnd(this.t('game.common.youWin'), PALETTE.lime)
      }
      return
    }

    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        this.checkImpact(alive[i] as SumoBody, alive[j] as SumoBody, now)
      }
    }

    for (const b of snap.bodies) {
      const before = prevById.get(b.id)
      if (!before?.alive || b.alive) continue
      if (b.id === this.selfId) this.becomeOut(b, true)
      else this.ringOut(b)
    }

    if (me?.alive && !this.won && snap.bodies.length > 1 && alive.length === 1) {
      this.won = true
      this.sfx.coin()
      this.showEnd(this.t('game.common.youWin'), PALETTE.lime)
    }
  }

  private checkImpact(a: SumoBody, b: SumoBody, now: number): void {
    const key = pairKey(a, b)
    const d = Math.hypot(a.x - b.x, a.y - b.y)
    const before = this.pairDist.get(key) ?? Number.POSITIVE_INFINITY
    this.pairDist.set(key, d)
    if (d >= CONTACT || before < CONTACT) return
    if (now - (this.impactAt.get(key) ?? Number.NEGATIVE_INFINITY) < IMPACT_COOLDOWN_MS) return
    this.impactAt.set(key, now)
    for (const id of [a.id, b.id]) {
      const body = this.bodies.get(id)
      if (body) body.hurtUntil = this.time.now + 350
    }
    const p = this.toScreen((a.x + b.x) / 2, (a.y + b.y) / 2)
    burst(this, p.x, p.y, PALETTE.text, 8, 160)
    burst(this, p.x, p.y, 0xe6cf9f, 6, 120)
    if (a.id === this.selfId || b.id === this.selfId) {
      this.sfx.pop()
      shake(this, 0.006, 120)
    }
  }

  private ringOut(b: SumoBody): void {
    const body = this.bodyOf(b)
    body.out = true
    const p = this.toScreen(b.x, b.y)
    this.sfx.pop()
    burst(this, p.x, p.y, body.color, 16, 220)
    ring(this, p.x, p.y, body.color, this.arena.size * PLAYER_R * 2)
    floatText(this, p.x, p.y - 20, this.t('game.common.out'), PALETTE.red, 16)
    this.fallOff(body)
  }

  private becomeOut(b: SumoBody, withFx: boolean): void {
    const body = this.bodyOf(b)
    body.out = true
    this.wasAlive = false
    this.marker?.hide()
    if (withFx) {
      const p = this.toScreen(b.x, b.y)
      this.sfx.wrong()
      burst(this, p.x, p.y, body.color, 26, 300)
      shake(this, 0.014, 260)
      flash(this, PALETTE.red, 160)
      this.fallOff(body)
    }
    this.showEnd(this.t('game.common.out'), PALETTE.red)
    this.subline?.setText(this.t('game.common.waiting')).setVisible(true)
  }

  // Tumbling off the platform: KO face, the wrestler shrinks a little, tips over and fades.
  private fallOff(body: Rikishi): void {
    const img = body.avatar.image
    body.avatar.setExpression('ko').tick(0)
    body.shadow.setVisible(false)
    this.tweens.add({
      targets: img,
      scaleX: img.scaleX * 0.75,
      scaleY: img.scaleY * 0.75,
      alpha: 0.35,
      angle: 90,
      duration: 320,
      ease: 'Quad.easeIn',
    })
    body.label.setAlpha(0.4)
  }

  private showEnd(text: string, color: number): void {
    const banner = this.banner
    if (!banner) return
    banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
    showBanner(this, banner, text, color)
  }

  private bodyOf(b: SumoBody): Rikishi {
    let body = this.bodies.get(b.id)
    if (!body) {
      const color = this.state.colorOf(b.id, PALETTE.red)
      const d = avatarPx(this.arena.size * PLAYER_R * 2 * 1.3)
      const mine = b.id === this.selfId
      const p = this.toScreen(b.x, b.y)
      const avatar = new AvatarSprite(this, this.state.avatarOf(b.id), color, d)
      avatar.image.setPosition(p.x, p.y).setDepth(mine ? 31 : 30)
      // Everyone starts facing the centre of the ring.
      avatar.faceMotion(0.5 - b.x, 0.5 - b.y, 0)
      body = {
        avatar,
        shadow: addShadow(this, d, 29),
        label: this.add
          .text(
            p.x,
            p.y,
            mine ? this.t('game.common.you') : this.state.nameOf(b.id),
            nameTagStyle(this.compact ? 8 : 10, color),
          )
          .setOrigin(0.5, 0)
          .setDepth(32),
        color,
        px: p.x,
        py: p.y,
        out: false,
        hurtUntil: 0,
      }
      this.bodies.set(b.id, body)
    }
    return body
  }

  private renderBodies(now: number): void {
    const sample = this.interp.sample(now)
    this.arrow?.clear()
    if (!sample) return
    const fromById = new Map(sample.from.bodies.map((b) => [b.id, b]))
    const radius = this.arena.size * PLAYER_R
    for (const b of sample.to.bodies) {
      const prev = fromById.get(b.id)
      const nx = prev ? lerp(prev.x, b.x, sample.t) : b.x
      const ny = prev ? lerp(prev.y, b.y, sample.t) : b.y
      const p = this.toScreen(nx, ny)
      const body = this.bodyOf(b)
      const mine = b.id === this.selfId
      if (!body.out) {
        // Face the push direction (own wrestler) or the direction of travel.
        if (mine && this.hasDir()) body.avatar.faceMotion(this.dir.dx, this.dir.dy, 0)
        else body.avatar.faceMotion(p.x - body.px, p.y - body.py, 0.6)
        body.avatar.setExpression(now < body.hurtUntil ? 'hurt' : 'idle').tick(now)
        body.shadow.setPosition(p.x, p.y + radius * 0.85)
      }
      body.px = p.x
      body.py = p.y
      body.avatar.image.setPosition(p.x, p.y)
      body.label.setPosition(p.x, p.y + radius + 4)
      if (mine && !body.out) this.drawSelfCues(p, radius, body.color, now)
    }
  }

  private hasDir(): boolean {
    return this.dir.dx !== 0 || this.dir.dy !== 0
  }

  // "That's you" marker bobbing overhead + an arrow showing where you are shoving.
  private drawSelfCues(p: { x: number; y: number }, radius: number, color: number, now: number) {
    if (this.wasAlive) this.marker?.place(p.x, p.y - radius - 2, now)
    else this.marker?.hide()
    const g = this.arrow
    if (!g || !this.hasDir()) return
    const a = Math.atan2(this.dir.dy, this.dir.dx)
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const tipX = p.x + ux * radius * 2.1
    const tipY = p.y + uy * radius * 2.1
    const baseX = p.x + ux * radius * 1.2
    const baseY = p.y + uy * radius * 1.2
    g.lineStyle(4, color, 0.9)
    g.lineBetween(baseX, baseY, tipX, tipY)
    g.fillStyle(color, 0.9)
    const s = radius * 0.5
    g.fillTriangle(
      tipX + ux * s,
      tipY + uy * s,
      tipX - uy * s * 0.8,
      tipY + ux * s * 0.8,
      tipX + uy * s * 0.8,
      tipY - ux * s * 0.8,
    )
  }
}
