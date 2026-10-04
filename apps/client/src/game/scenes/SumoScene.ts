import {
  PALETTE,
  SUMO,
  type SumoBody,
  type SumoSnapshot,
  sumoAim,
  sumoDash,
  sumoStep,
} from '@pp/shared'
import type Phaser from 'phaser'
import { AvatarSprite, type AvatarWarmSpec, avatarPx } from '../avatars'
import { addBanner, burst, flash, floatText, punch, ring, shake, showBanner } from '../fx'
import { ServerClock } from '../netcode/ServerClock'
import {
  bodyStyle,
  ensurePixelGrid,
  ensurePixelOrb,
  fitFontSize,
  fitText,
  headlineStyle,
} from '../pixelStyle'
import { addShadow, nameTagStyle, type Shadow, YouMarker } from '../playerMarks'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Bodies are circles of radius PLAYER_R in the normalized arena (ring centred at 0.5, 0.5; its radius
// arrives in the snapshot). Contact = centres closer than 2·PLAYER_R.
const PLAYER_R = SUMO.playerR
const DEFAULT_RING = SUMO.ringR
const CONTACT = PLAYER_R * 2 * 1.3
const IMPACT_COOLDOWN_MS = 400
// Other wrestlers' shoves are heard quietly, and at most this often across the whole ring.
const RIVAL_BUMP_EVERY_MS = 150
// The server's dash cooldown, plus a little so a press it would still refuse is never sent.
const DASH_COOLDOWN_MS = SUMO.dashCooldownMs + 50
// A pointer's push direction is sent at most this often (keys send every change at once).
const SEND_EVERY_MS = 33
// The physics runs forward from the last snapshot in the server's tick steps, but never further than
// this (a stalled connection freezes the arena instead of letting it drift).
const TICK_MS = 50
const MAX_AHEAD_MS = 300
// A snapshot that disagrees with the prediction is blended in over ~SMOOTH_MS (a big jump snaps).
const SMOOTH_MS = 90
const SNAP_DIST = 0.2
// Avatar textures every wrestler can need, generated a few per frame at the start (not mid-shove).
const WARM: readonly AvatarWarmSpec[] = [
  ['front', 'idle', 0],
  ['side', 'idle', 0],
  ['back', 'idle', 0],
  ['front', 'blink', 0],
  ['side', 'blink', 0],
  ['back', 'blink', 0],
  ['front', 'hurt', 0],
  ['side', 'hurt', 0],
  ['front', 'ko', 0],
  ['side', 'ko', 0],
]

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
  shadow: Shadow
  label: Phaser.GameObjects.Text
  color: number
  px: number
  py: number
  out: boolean
  // Wincing after a clash until then (scene time).
  hurtUntil: number
}

// Sumo Push canvas (Phase 5). Shared arena on a pixel dohyo drawn to the server's exact ring size,
// which shrinks over the round. Every wrestler is drawn where the shared physics (@pp/shared sumo) puts
// them NOW: the last snapshot stepped forward on the server's clock — your own with the push you hold
// right now (and a dash the moment you press it), the others with their last push — and corrections
// from each new snapshot are blended in. The player steers with the arrow keys / WASD or by holding the
// mouse (a finger) where they want to push, and dashes with SPACE / ENTER or the DASH button (a second
// finger on touch). Shoves, dashes, ring-outs and the last one standing come from snapshot deltas.
export class SumoScene extends MiniGameScene<SumoSnapshot> {
  private dohyo?: Phaser.GameObjects.Image
  private shadow?: Phaser.GameObjects.Rectangle
  private arrow?: Phaser.GameObjects.Graphics
  private marker?: YouMarker
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private readonly steerKeys: Record<
    'up' | 'down' | 'left' | 'right',
    Phaser.Input.Keyboard.Key[]
  > = { up: [], down: [], left: [], right: [] }
  private readonly bodies = new Map<string, Rikishi>()
  private readonly clock = new ServerClock()
  private prevSnap?: SumoSnapshot
  // The latest snapshot, the bodies stepped forward from it (reused every frame) and the per-body
  // correction still being blended in.
  private base?: SumoSnapshot
  private sim: SumoBody[] = []
  private readonly offsets = new Map<string, { x: number; y: number }>()
  private dashSeq = 0
  private localDash?: { seq: number; at: number }
  private pairDist = new Map<string, number>()
  private impactAt = new Map<string, number>()
  private rivalBumpAt = Number.NEGATIVE_INFINITY
  private lastTick = -1
  private dir = { dx: 0, dy: 0 }
  // Where the held pointer is (and which pointer steers): every frame the push direction is re-aimed
  // from the player's own wrestler toward it, so "hold where you want to go" keeps working as the
  // wrestler moves.
  private aim?: { x: number; y: number }
  private arrowDrawn = false
  private steerPointer = -1
  private keyDriven = false
  private lastSentAt = 0
  // The server starts everyone not pushing: nothing goes out until the player steers (D28).
  private sentDir = '0,0'
  // The DASH button: its orb (the touch target) and the whole button (shadow + orb + label).
  private dashBtn?: Phaser.GameObjects.Image
  private dashUi?: Phaser.GameObjects.Container
  private dashReadyAt = 0
  private dashReady = true
  // Joined after the round started (not in its snapshot): watch only.
  private spectating = false
  private synced = false
  private wasAlive = true
  private won = false
  private compact = false
  private ringR: number = DEFAULT_RING
  private arena = { cx: 0, cy: 0, size: 0 }

  constructor(...deps: SceneDeps) {
    super('sumo-push', ...deps)
  }

  override create(): void {
    super.create()
    this.clock.reset()
    this.prevSnap = undefined
    this.base = undefined
    this.sim = []
    this.offsets.clear()
    this.dashSeq = 0
    this.localDash = undefined
    this.pairDist = new Map()
    this.impactAt = new Map()
    this.rivalBumpAt = Number.NEGATIVE_INFINITY
    this.lastTick = -1
    this.dir = { dx: 0, dy: 0 }
    this.aim = undefined
    this.arrowDrawn = false
    this.steerPointer = -1
    this.keyDriven = false
    this.sentDir = '0,0'
    this.dashReadyAt = 0
    this.dashReady = true
    this.spectating = false
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

    this.arrow = this.add.graphics().setDepth(25).setVisible(false)
    this.marker = new YouMarker(this, 16, 40)

    const hint = this.add
      .text(
        width / 2,
        height - hintH / 2,
        this.t('game.sumoPush.hint'),
        bodyStyle(this.compact ? 11 : 14, PALETTE.dim),
      )
      .setOrigin(0.5)
    fitText(hint, width - 16, this.compact ? 11 : 14)

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

    this.buildDashButton(width, height, hintH, pad)
    const kb = this.input.keyboard
    if (kb) {
      const pairs: [keyof typeof this.steerKeys, string, string][] = [
        ['up', 'UP', 'W'],
        ['down', 'DOWN', 'S'],
        ['left', 'LEFT', 'A'],
        ['right', 'RIGHT', 'D'],
      ]
      for (const [dir, a, b] of pairs) this.steerKeys[dir] = [kb.addKey(a), kb.addKey(b)]
      kb.addKeys('SPACE,ENTER')
    }
    this.onKey('SPACE', () => this.dash())
    this.onKey('ENTER', () => this.dash())
    // Steer with one finger, dash with another.
    this.input.addPointer(1)
    this.input.on(
      'pointerdown',
      (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (this.dashBtn && over.includes(this.dashBtn)) return
        this.steerPointer = p.id
        this.steer(p)
      },
    )
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown && p.id === this.steerPointer) this.steer(p)
    })
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.id !== this.steerPointer) return
      this.steerPointer = -1
      this.aim = undefined
      this.dir = { dx: 0, dy: 0 }
    })
  }

  // A round DASH button in the bottom-right corner (Space does the same); greyed while it recharges.
  private buildDashButton(width: number, height: number, hintH: number, pad: number): void {
    const d = this.compact ? 64 : 80
    const shadow = this.add.ellipse(0, d * 0.42, d * 0.95, d * 0.26, 0x000000).setAlpha(0.4)
    this.dashBtn = this.add
      .image(0, 0, ensurePixelOrb(this, 'pp-sumo-dash', 16, PALETTE.magenta))
      .setDisplaySize(d, d)
      .setInteractive({ useHandCursor: true })
    this.dashBtn.on('pointerdown', () => this.dash())
    const label = this.add
      .text(
        0,
        0,
        this.t('game.sumoPush.dash'),
        bodyStyle(this.compact ? 11 : 13, PALETTE.bg, { fontStyle: 'bold' }),
      )
      .setOrigin(0.5)
    this.dashUi = this.add
      .container(width - pad - d / 2, height - hintH - pad - d / 2, [shadow, this.dashBtn, label])
      .setDepth(40)
  }

  // Charge toward where you push (the server ignores a dash with no direction, or still recharging).
  private dash(): void {
    const now = this.time.now
    if (this.spectating || !this.wasAlive || now < this.dashReadyAt || !this.hasDir()) return
    this.pushDir(now, true)
    const seq = ++this.dashSeq
    this.sendInput({ kind: 'dash', seq })
    // Predicted from this frame on: the wrestler launches now, not when the snapshot says so.
    this.localDash = { seq, at: now }
    this.dashReadyAt = now + DASH_COOLDOWN_MS
    this.setDashReady(false)
    this.sfx.whoosh()
    const me = this.bodies.get(this.selfId)
    if (me) {
      burst(this, me.px, me.py, 0xe6cf9f, 10, 140)
      ring(this, me.px, me.py, me.color, this.arena.size * PLAYER_R * 2)
      shake(this, 0.004, 90)
    }
  }

  private setDashReady(ready: boolean): void {
    if (ready === this.dashReady || !this.dashUi) return
    this.dashReady = ready
    this.dashUi.setAlpha(ready ? 1 : 0.4)
    if (ready && this.dashBtn) punch(this, this.dashBtn, 0.12, 90)
  }

  // Sends the push direction when it changes (a unit vector, rounded so jitter doesn't spam), never as
  // a heartbeat: an idle player sends nothing. Keys send at once; a moving pointer at most every
  // SEND_EVERY_MS.
  private pushDir(now: number, force = false): void {
    const mag = Math.hypot(this.dir.dx, this.dir.dy)
    const dx = mag > 0 ? Math.round((this.dir.dx / mag) * 20) / 20 : 0
    const dy = mag > 0 ? Math.round((this.dir.dy / mag) * 20) / 20 : 0
    const key = `${dx},${dy}`
    const throttled = !force && !this.keyDriven && now - this.lastSentAt < SEND_EVERY_MS
    if (key === this.sentDir || throttled) return
    this.sentDir = key
    this.lastSentAt = now
    this.sendInput({ kind: 'move', dx, dy })
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

  protected frame(snap: SumoSnapshot | null, _time: number, delta: number): void {
    const now = this.time.now
    // Steering first, so this frame's prediction already pushes the way the keys say.
    const down = (dir: keyof typeof this.steerKeys): number =>
      this.steerKeys[dir].some((k) => k.isDown) ? 1 : 0
    const kx = down('right') - down('left')
    const ky = down('down') - down('up')
    if (kx !== 0 || ky !== 0) {
      this.dir = { dx: kx, dy: ky }
      this.keyDriven = true
    } else if (this.keyDriven) {
      this.dir = { dx: 0, dy: 0 }
      this.pushDir(now, true)
      this.keyDriven = false
    } else if (this.aim) {
      this.dir = this.aimFromSelf(this.aim)
    }
    if (!this.spectating && this.wasAlive) this.pushDir(now)
    if (!this.dashReady && now >= this.dashReadyAt) this.setDashReady(true)

    if (snap && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.clock.sync(snap.remainingMs, now)
      this.rebase(snap, now)
      this.onSnapshot(snap, now)
    }
    this.renderBodies(now, delta)
  }

  // A new snapshot becomes the base. Where it disagrees with what's on screen, the difference becomes a
  // correction that fades out (the wrestler glides there instead of jumping).
  private rebase(snap: SumoSnapshot, now: number): void {
    const before = this.base ? this.simulate(this.base, now) : []
    const shown = new Map(before.map((b) => [b.id, { x: b.x, y: b.y }]))
    const dash = this.localDash
    const taken = (snap.bodies.find((b) => b.id === this.selfId)?.dash ?? 0) >= (dash?.seq ?? 0)
    if (dash && (taken || now - dash.at > 1000)) this.localDash = undefined
    this.base = snap
    for (const b of this.simulate(snap, now)) {
      const was = shown.get(b.id)
      const off = this.offsets.get(b.id) ?? { x: 0, y: 0 }
      if (was) {
        off.x += was.x - b.x
        off.y += was.y - b.y
      }
      if (Math.hypot(off.x, off.y) > SNAP_DIST) {
        off.x = 0
        off.y = 0
      }
      this.offsets.set(b.id, off)
    }
  }

  // The base snapshot stepped forward to `now` with the shared physics: the own wrestler pushes the
  // way the player steers right now (and dashes at the moment they pressed), everyone else keeps
  // their last push. Reuses the same body objects every frame.
  private simulate(snap: SumoSnapshot, now: number): SumoBody[] {
    const sim = this.sim
    sim.length = snap.bodies.length
    snap.bodies.forEach((b, i) => {
      const c = sim[i] ?? ({} as SumoBody)
      Object.assign(c, b)
      sim[i] = c
    })
    const me = sim.find((b) => b.id === this.selfId)
    if (me?.alive && this.wasAlive && !this.spectating)
      Object.assign(me, sumoAim(this.dir.dx, this.dir.dy))
    if (this.state.final) return sim
    const elapsed = Math.min(MAX_AHEAD_MS, this.clock.since(snap.remainingMs, now))
    const dash = this.localDash
    let dashAt = dash && me && me.dash < dash.seq ? this.clock.since(snap.remainingMs, dash.at) : -1
    for (let t = 0; t < elapsed; t += TICK_MS) {
      if (dashAt >= 0 && dashAt <= t && me) {
        sumoDash(me)
        dashAt = -1
      }
      sumoStep(sim, Math.min(TICK_MS, elapsed - t))
    }
    if (dashAt >= 0 && me) sumoDash(me)
    return sim
  }

  // Discrete events per fresh snapshot: shoves (a pair's distance dips into contact), ring-outs, the
  // last one standing.
  private onSnapshot(snap: SumoSnapshot, now: number): void {
    const alive = snap.bodies.filter((b) => b.alive)
    this.hud?.setScore(
      this.t('game.sumoPush.alive', { n: alive.length, total: snap.bodies.length }),
    )
    const prevById = new Map((this.prevSnap?.bodies ?? []).map((b) => [b.id, b]))
    this.prevSnap = snap
    const me = snap.bodies.find((b) => b.id === this.selfId)

    if (!this.synced) {
      this.synced = true
      this.warmAvatars(
        snap.bodies.map((b) => b.id),
        WARM,
      )
      this.spectating = !me
      if (this.spectating) {
        this.wasAlive = false
        this.dashUi?.setVisible(false)
      }
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
    for (const b of alive) {
      // Your own dash already got its feedback the moment you pressed.
      if (b.id !== this.selfId && b.dashing && !prevById.get(b.id)?.dashing) this.onDash(b)
    }

    let rivalOut = false
    for (const b of snap.bodies) {
      const before = prevById.get(b.id)
      if (!before?.alive || b.alive) continue
      if (b.id === this.selfId) this.becomeOut(b, true)
      else {
        rivalOut = true
        this.ringOut(b)
      }
    }
    // One sting per snapshot, however many went over the bales (your own out has its own).
    if (rivalOut && me?.alive !== false) this.sfx.eliminated()

    if (me?.alive && !this.won && snap.bodies.length > 1 && alive.length === 1) {
      this.won = true
      this.sfx.cheer()
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
      this.sfx.hit()
      shake(this, 0.006, 120)
    } else if (now - this.rivalBumpAt >= RIVAL_BUMP_EVERY_MS) {
      this.rivalBumpAt = now
      this.sfx.quiet(() => this.sfx.hit(0.7), 0.35)
    }
  }

  // Someone charges: a dust streak behind them (and a whoosh when it's you).
  private onDash(b: SumoBody): void {
    const body = this.bodies.get(b.id)
    if (!body) return
    burst(this, body.px, body.py, 0xe6cf9f, 10, 140)
    ring(this, body.px, body.py, body.color, this.arena.size * PLAYER_R * 2)
    if (b.id === this.selfId) shake(this, 0.004, 90)
  }

  private ringOut(b: SumoBody): void {
    const body = this.bodyOf(b)
    body.out = true
    const p = this.toScreen(b.x, b.y)
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
    this.dashUi?.setVisible(false)
    if (withFx) {
      const p = this.toScreen(b.x, b.y)
      // Shoved over the bales and down onto the clay.
      this.sfx.hit(1.4)
      this.sfx.eliminated()
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

  private renderBodies(now: number, delta: number): void {
    const base = this.base
    if (!base) return
    if (base.ring !== this.ringR) {
      this.ringR = base.ring
      this.fitDohyo()
    }
    const sim = this.simulate(base, now)
    const fade = Math.exp(-delta / SMOOTH_MS)
    const radius = this.arena.size * PLAYER_R
    let selfDrawn = false
    for (const b of sim) {
      const off = this.offsets.get(b.id)
      if (off) {
        off.x *= fade
        off.y *= fade
      }
      const p = this.toScreen(b.x + (off?.x ?? 0), b.y + (off?.y ?? 0))
      const body = this.bodyOf(b)
      const mine = b.id === this.selfId
      if (!body.out) {
        // Face the push direction (own wrestler) or the direction of travel.
        if (mine && this.hasDir()) body.avatar.faceMotion(this.dir.dx, this.dir.dy, 0)
        else body.avatar.faceMotion(b.vx, b.vy, 0.05)
        body.avatar.setExpression(now < body.hurtUntil ? 'hurt' : 'idle').tick(now)
        body.shadow.setPosition(p.x, p.y + radius * 0.85)
      }
      body.px = p.x
      body.py = p.y
      body.avatar.image.setPosition(p.x, p.y)
      body.label.setPosition(p.x, p.y + radius + 4)
      if (mine && !body.out) {
        this.drawSelfCues(p, radius, body.color, now)
        selfDrawn = true
      }
    }
    if (!selfDrawn) this.arrow?.setVisible(false)
  }

  private hasDir(): boolean {
    return this.dir.dx !== 0 || this.dir.dy !== 0
  }

  // "That's you" marker bobbing overhead + an arrow showing where you are shoving (drawn once,
  // pointing right, then just moved and turned every frame).
  private drawSelfCues(p: { x: number; y: number }, radius: number, color: number, now: number) {
    if (this.wasAlive) this.marker?.place(p.x, p.y - radius - 2, now)
    else this.marker?.hide()
    const g = this.arrow
    if (!g) return
    if (!this.hasDir()) {
      g.setVisible(false)
      return
    }
    if (!this.arrowDrawn) {
      this.arrowDrawn = true
      const s = radius * 0.5
      g.clear()
      g.lineStyle(4, color, 0.9)
      g.lineBetween(radius * 1.2, 0, radius * 2.1, 0)
      g.fillStyle(color, 0.9)
      g.fillTriangle(radius * 2.1 + s, 0, radius * 2.1, s * 0.8, radius * 2.1, -s * 0.8)
    }
    g.setPosition(p.x, p.y).setRotation(Math.atan2(this.dir.dy, this.dir.dx)).setVisible(true)
  }
}
