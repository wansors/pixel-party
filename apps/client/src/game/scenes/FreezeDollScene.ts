import {
  FREEZE_DOLL_SWEEP,
  type FreezeDollMode,
  type FreezeDollRunner,
  type FreezeDollSnapshot,
  type FreezeDollStatus,
  PALETTE,
  freezeDollMove,
  freezeDollSpeed,
  freezeDollSweepAt,
} from '@pp/shared'
import Phaser from 'phaser'
import { type AvatarExpression, AvatarSprite, avatarPx, ensureAvatarTexture } from '../avatars'
import {
  addBanner,
  burst,
  eliminate,
  flash,
  floatText,
  punch,
  shake,
  showBanner,
  speechBubble,
} from '../fx'
import {
  ensureBevelPanel,
  ensurePixelGrid,
  fitFontSize,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { type Shadow, YouMarker, addShadow } from '../playerMarks'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Freeze Doll ("Red Light, Green Light"): a giant pixel doll at the top of the field, one lane per
// player below her, everyone drawn as their lobby avatar. While she faces away a chant plays (a note
// per step — the spacing is the tempo tell, and the bar under her fills as it goes); a head twitch
// comes before every turn (sometimes a fake-out); facing the field, her laser sweeps across the lanes
// (from a different lane each time, wrapping round at the edge) and any lane it has reached is watched
// until she looks away. Hold WALK (↑ / W / SPACE) or RUN (SHIFT) — or the two big buttons — to move;
// the server judges every hit. Your own runner is predicted with the server's physics (shared), so it
// sets off and glides to a stop the moment you press or let go, easing onto the server's position.

const CHANT_STEPS = 8
// Your own footsteps: a slow beat walking, a quick one running (nobody else's are heard).
const WALK_STEP_MS = 300
const RUN_STEP_MS = 170
// Other runners reaching the line get the crowd at most this often.
const CHEER_GAP_MS = 1500
// Rivals' moments play at this fraction of the volume (yours stay full), so a full room stays readable.
const RIVAL_LEVEL = 0.5
// Time constant of the ease from your predicted runner onto the server's position.
const CORRECT_TAU_MS = 200
const HEART_ROWS = ['_RR_RR_', 'RRRRRRR', 'RRRRRRR', '_RRRRR_', '__RRR__', '___R___']

// The doll, 14×18: hair H (+ highlight h), skin S, eyes E, mouth M, collar W, dress D (+ shade d), shoes K.
const DOLL_FRONT = [
  '____HHHHHH____',
  '__HHHhhHHHHH__',
  '_HHHSSSSSSHHH_',
  '_HHSSSSSSSSHH_',
  'HHSSEESSEESSHH',
  'HHSSEESSEESSHH',
  '_HSSSSSSSSSSH_',
  '__SSSSMMSSSS__',
  '___SSSSSSSS___',
  '____WWWWWW____',
  '___DDDWWDDD___',
  '__DDDDDDDDDD__',
  '_DDDDDDDDDDDD_',
  '_DDdDDDDDDdDD_',
  'DDDDDDDDDDDDDD',
  'DdDDDDDDDDDDdD',
  '___SS____SS___',
  '___KK____KK___',
]
const DOLL_BACK = [
  '_HH_HHHHHH_HH_',
  'HHHHHhhHHHHHHH',
  '_HHHHHHHHHHHH_',
  '_HHHHHhHHHHHH_',
  'HHHHHHHHHHHHHH',
  'HHHHHHHHHhHHHH',
  '_HHHHHHHHHHHH_',
  '__HHHHHHHHHH__',
  '___SSSSSSSS___',
  '____WWWWWW____',
  '___DDDDDDDD___',
  '__DDDDDDDDDD__',
  '_DDDDDDDDDDDD_',
  '_DDdDDDDDDdDD_',
  'DDDDDDDDDDDDDD',
  'DdDDDDDDDDDDdD',
  '___SS____SS___',
  '___KK____KK___',
]
const DOLL_LEGEND = (eyes: number): Record<string, number> => ({
  H: 0x3b2a1a,
  h: 0x6b4a2a,
  S: 0xf2c49b,
  E: eyes,
  M: 0xc0392b,
  W: 0xf4f1e8,
  D: PALETTE.orange,
  d: shade(PALETTE.orange, -0.3),
  K: 0x2a2234,
})

// The face a runner turns to the camera in each state (none = back view, walking to the doll).
const FACES: Partial<Record<FreezeDollStatus, AvatarExpression>> = {
  stunned: 'hurt',
  out: 'ko',
  finished: 'happy',
}

interface RunnerView {
  avatar: AvatarSprite
  shadow: Shadow
  hearts: Phaser.GameObjects.Image[]
  x: number
  status: FreezeDollRunner['status']
  hearts0: number
  fallen: boolean
}

export class FreezeDollScene extends MiniGameScene<FreezeDollSnapshot> {
  private compact = false
  private fieldTop = 0
  private finishY = 0
  private startY = 0
  private laneW = 0
  private lanesX0 = 0
  private lanes = 0
  private avatarSize = 0
  private dollPx = 4
  private doll?: Phaser.GameObjects.Image
  private dollKeys = { back: '', front: '', lit: '' }
  private eyes = { x: 0, y: 0 }
  private lightText?: Phaser.GameObjects.Text
  private songBar?: Phaser.GameObjects.Graphics
  private songBox = { x: 0, y: 0, w: 0, h: 0 }
  private laser?: Phaser.GameObjects.Graphics
  private watch?: Phaser.GameObjects.Graphics
  private field?: Phaser.GameObjects.Graphics
  private prompt?: Phaser.GameObjects.Text
  private promptText = ''
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private youMarker?: YouMarker
  private views = new Map<string, RunnerView>()
  private buttons: {
    mode: 'walk' | 'run'
    img: Phaser.GameObjects.Image
    up: string
    down: string
  }[] = []
  // Held controls → the mode sent to the server (only on change).
  private held = { keys: new Set<string>(), shift: false, walkPtr: -1, runPtr: -1 }
  private sentMode: FreezeDollMode = 'stop'
  private paintedMode: FreezeDollMode | '' = ''
  // Snapshot timing: when the current snapshot arrived (dead reckoning + the sweep's local clock).
  private snapRef: unknown = null
  private snapAt = 0
  private lastLight = ''
  private lastStep = -1
  private lastElapsed = 0
  private laserPlayed = false
  private bannerShown = false
  // The doll's last gloat (one speech bubble at a time).
  private gloatUntil = 0
  private heartKey = ''
  private barKey = ''
  private chromeRef: unknown = null
  // Your runner, predicted.
  private pred?: { x: number; v: number; brake: number }
  private lastFootAt = Number.NEGATIVE_INFINITY
  private footSide = 0
  private lastCheerAt = Number.NEGATIVE_INFINITY
  private lastFrameAt = 0
  private warmed = false
  constructor(...deps: SceneDeps) {
    super('freeze-doll', ...deps)
  }

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.views = new Map()
    this.buttons = []
    this.held = { keys: new Set(), shift: false, walkPtr: -1, runPtr: -1 }
    this.sentMode = 'stop'
    this.paintedMode = ''
    this.snapRef = null
    this.snapAt = 0
    this.lastLight = ''
    this.lastStep = -1
    this.lastElapsed = 0
    this.laserPlayed = false
    this.bannerShown = false
    this.gloatUntil = 0
    this.lanes = 0
    this.promptText = ''
    this.pred = undefined
    this.lastFootAt = Number.NEGATIVE_INFINITY
    this.footSide = 0
    this.lastCheerAt = Number.NEGATIVE_INFINITY
    this.barKey = ''
    this.chromeRef = null
    this.warmed = false
    this.lastFrameAt = 0
    this.heartKey = ensurePixelGrid(this, {
      key: 'fd-heart',
      rows: HEART_ROWS,
      legend: { R: PALETTE.red },
      pixelSize: this.compact ? 2 : 3,
    })

    // Who's who: a strip of names + hearts under the HUD.
    const stripSize = this.compact ? 11 : 13
    this.strip = new PlayerStrip(this, width / 2, this.top + 8, width - 24, stripSize, 2)
    const dollTop = this.top + 8 + PlayerStrip.rowH(stripSize) * 2

    // The doll.
    // Bigger on a big screen (the doll is the clock everyone watches).
    const dollH = this.compact ? 104 : height >= 900 ? 212 : 156
    this.dollPx = Math.max(3, Math.floor((dollH - 30) / DOLL_FRONT.length))
    this.dollKeys = {
      back: ensurePixelGrid(this, {
        key: `fd-doll-back-${this.dollPx}`,
        rows: DOLL_BACK,
        legend: DOLL_LEGEND(0x141126),
        pixelSize: this.dollPx,
      }),
      front: ensurePixelGrid(this, {
        key: `fd-doll-front-${this.dollPx}`,
        rows: DOLL_FRONT,
        legend: DOLL_LEGEND(0x141126),
        pixelSize: this.dollPx,
      }),
      lit: ensurePixelGrid(this, {
        key: `fd-doll-lit-${this.dollPx}`,
        rows: DOLL_FRONT,
        legend: DOLL_LEGEND(0xff2a2a),
        pixelSize: this.dollPx,
      }),
    }
    const dollImgH = DOLL_FRONT.length * this.dollPx
    this.doll = this.add
      .image(width / 2, dollTop, this.dollKeys.front)
      .setOrigin(0.5, 0)
      .setDepth(50)
    // Eye line, for the laser's origin (rows 4–5 of the grid).
    this.eyes = { x: width / 2, y: dollTop + this.dollPx * 5 }
    const labelY = dollTop + dollImgH + (this.compact ? 4 : 6)
    this.lightText = this.add
      .text(width / 2, labelY, '', headlineStyle(this.compact ? 12 : 16, PALETTE.text))
      .setOrigin(0.5, 0)
      .setDepth(51)
    const barW = Math.min(width - 48, 280)
    this.songBox = {
      x: width / 2 - barW / 2,
      y: labelY + (this.compact ? 16 : 22),
      w: barW,
      h: this.compact ? 6 : 8,
    }
    this.songBar = this.add.graphics().setDepth(51)
    this.fieldTop = this.songBox.y + this.songBox.h + (this.compact ? 8 : 12)

    // Controls: hold WALK / RUN.
    const btnH = this.compact ? 80 : 64
    const gap = this.compact ? 10 : 16
    const padW = Math.min(width - 16, 620)
    const btnW = (padW - gap) / 2
    const btnY = height - (this.compact ? 12 : 18) - btnH / 2
    for (const [i, mode] of (['walk', 'run'] as const).entries()) {
      const color = mode === 'walk' ? PALETTE.lime : PALETTE.orange
      const up = ensureBevelPanel(this, btnW, btnH, shade(color, -0.25), 5, true)
      const down = ensureBevelPanel(this, btnW, btnH, shade(color, -0.55), 5, true)
      const x = width / 2 + (i === 0 ? -1 : 1) * (btnW / 2 + gap / 2)
      const img = this.add.image(x, btnY, up).setDepth(700).setInteractive()
      const label = this.t(mode === 'walk' ? 'game.freezeDoll.walk' : 'game.freezeDoll.run')
      this.add
        .text(
          x,
          btnY,
          label,
          headlineStyle(fitFontSize(label, btnW - 20, this.compact ? 16 : 24), PALETTE.text, {
            stroke: '#10121c',
            strokeThickness: 4,
          }),
        )
        .setOrigin(0.5)
        .setDepth(701)
      img.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (mode === 'walk') this.held.walkPtr = p.id
        else this.held.runPtr = p.id
        this.syncMode()
      })
      this.buttons.push({ mode, img, up, down })
    }
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.id === this.held.walkPtr) this.held.walkPtr = -1
      if (p.id === this.held.runPtr) this.held.runPtr = -1
      this.syncMode()
    })
    const kb = this.input.keyboard
    for (const k of ['UP', 'W', 'SPACE']) {
      kb?.on(`keydown-${k}`, () => {
        this.held.keys.add(k)
        this.syncMode()
      })
      kb?.on(`keyup-${k}`, () => {
        this.held.keys.delete(k)
        this.syncMode()
      })
    }
    kb?.on('keydown-SHIFT', () => {
      this.held.shift = true
      this.syncMode()
    })
    kb?.on('keyup-SHIFT', () => {
      this.held.shift = false
      this.syncMode()
    })
    // Losing focus drops every held control (a key-up would never arrive).
    const release = (): void => {
      this.held = { keys: new Set(), shift: false, walkPtr: -1, runPtr: -1 }
      this.syncMode()
    }
    this.game.events.on(Phaser.Core.Events.BLUR, release)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.game.events.off(Phaser.Core.Events.BLUR, release),
    )

    const promptSize = this.compact ? 12 : 16
    this.prompt = this.add
      .text(
        width / 2,
        btnY - btnH / 2 - (this.compact ? 8 : 12),
        '',
        headlineStyle(promptSize, PALETTE.amber),
      )
      .setOrigin(0.5, 1)
      .setDepth(600)
    // Feet on the start line, hearts under them, then the prompt.
    this.startY = this.prompt.y - promptSize - (this.compact ? 30 : 34)
    this.finishY = this.fieldTop + (this.compact ? 10 : 14)
    this.field = this.add.graphics().setDepth(5)
    this.watch = this.add.graphics().setDepth(6)
    this.laser = this.add.graphics().setDepth(80)
    this.youMarker = new YouMarker(this, this.compact ? 12 : 16, 75)
    this.banner = addBanner(this)
  }

  private desiredMode(): FreezeDollMode {
    if (this.held.runPtr !== -1 || this.held.shift) return 'run'
    if (this.held.walkPtr !== -1 || this.held.keys.size > 0) return 'walk'
    return 'stop'
  }

  // Paints the held button and sends the mode when it changed (also called every frame, so a control
  // held before the first snapshot still reaches the server).
  private syncMode(): void {
    const mode = this.desiredMode()
    if (mode !== this.paintedMode) {
      this.paintedMode = mode
      for (const b of this.buttons) b.img.setTexture(mode === b.mode ? b.down : b.up)
    }
    if (mode === this.sentMode || !this.snap || this.state.final) return
    this.sentMode = mode
    this.sendInput({ kind: 'move', mode })
  }

  // The field is laid out from the first snapshot (it knows the lane count).
  private buildField(lanes: number): void {
    const { width } = this.scale
    this.lanes = lanes
    const maxLane = this.compact ? 64 : 144
    this.laneW = Math.min(maxLane, Math.floor((width - 24) / Math.max(1, lanes)))
    this.lanesX0 = width / 2 - (this.laneW * lanes) / 2
    // As big as the lane allows, but the race stays at least ~4 runners tall.
    const fieldH = this.startY - this.fieldTop
    this.avatarSize = avatarPx(
      Math.min(this.compact ? 32 : 64, this.laneW - 6, Math.floor(fieldH / 4)),
    )
    // Finishers stand on the rope, fully inside the field (clear of the chant bar above).
    this.finishY = this.fieldTop + Math.round(this.avatarSize * 0.95) + 4
    const g = this.field as Phaser.GameObjects.Graphics
    const x0 = this.lanesX0
    const w = this.laneW * lanes
    // Sandy field with lane chalk lines, the start line and a red finish rope under the doll.
    g.fillStyle(0x2a2418, 1)
    g.fillRect(x0 - 6, this.fieldTop, w + 12, this.startY + 18 - this.fieldTop)
    for (let i = 0; i < 60; i++) {
      const gx = x0 + ((i * 89) % 97) * (w / 97)
      const gy = this.fieldTop + ((i * 41) % 83) * ((this.startY + 18 - this.fieldTop) / 83)
      g.fillStyle(0x3a3220, 1)
      g.fillRect(Math.round(gx), Math.round(gy), 3, 2)
    }
    g.fillStyle(0x4a4230, 1)
    for (let i = 1; i < lanes; i++) {
      const lx = Math.round(x0 + i * this.laneW)
      for (let y = this.fieldTop; y < this.startY + 18; y += 12) g.fillRect(lx - 1, y, 2, 6)
    }
    g.fillStyle(PALETTE.text, 0.8)
    g.fillRect(x0 - 6, Math.round(this.startY + 4), w + 12, 3)
    for (let i = 0, x = x0 - 6; x < x0 + w + 6; i++, x += 12) {
      g.fillStyle(i % 2 === 0 ? PALETTE.red : PALETTE.text, 1)
      g.fillRect(Math.round(x), Math.round(this.finishY - 2), Math.min(12, x0 + w + 6 - x), 4)
    }
  }

  private laneX(lane: number): number {
    return this.lanesX0 + (lane + 0.5) * this.laneW
  }

  private yAt(x: number): number {
    return Phaser.Math.Linear(this.startY, this.finishY, Math.max(0, Math.min(1, x)))
  }

  protected frame(snap: FreezeDollSnapshot | null, time: number, delta: number): void {
    const dt = this.lastFrameAt ? Math.min(100, time - this.lastFrameAt) : 0
    this.lastFrameAt = time
    if (!snap) return
    if (!this.warmed) {
      this.warmed = true
      this.warmAvatars(
        snap.runners.map((r) => r.id),
        [
          ['back', 'idle', 0],
          ['front', 'hurt', 0],
          ['front', 'ko', 0],
          ['front', 'happy', 0],
        ],
      )
    }
    if (this.lanes === 0) this.buildField(snap.lanes)
    if (snap !== this.snapRef) {
      this.snapRef = snap
      this.snapAt = time
    }
    const since = time - this.snapAt
    this.syncMode()
    this.predict(snap, since, dt)
    this.paintDoll(snap, since, time)
    this.paintLaser(snap, since)
    this.paintRunners(snap, since, time, delta)
    // Strip, HUD and prompt only change with the snapshot.
    if (snap !== this.chromeRef) {
      this.chromeRef = snap
      this.paintChrome(snap)
    }
  }

  private paintDoll(snap: FreezeDollSnapshot, since: number, time: number): void {
    const doll = this.doll
    const label = this.lightText
    if (!doll || !label) return
    const light = snap.light
    if (light !== this.lastLight) {
      const first = this.lastLight === ''
      this.lastLight = light
      this.laserPlayed = false
      if (!first && light === 'turn') this.sfx.turn()
    }
    // Face: back while green, a twitching half-turn on TURN, front (eyes lit) on RED.
    const key =
      light === 'green'
        ? this.dollKeys.back
        : light === 'red'
          ? this.dollKeys.lit
          : light === 'ready'
            ? this.dollKeys.front
            : Math.floor(time / 70) % 2 === 0
              ? this.dollKeys.back
              : this.dollKeys.front
    if (doll.texture.key !== key) doll.setTexture(key)
    doll.setAngle(light === 'turn' ? Math.sin(time / 30) * 4 : 0)
    const text =
      light === 'green'
        ? this.t('game.freezeDoll.green')
        : light === 'red'
          ? this.t('game.freezeDoll.red')
          : light === 'turn'
            ? '!!'
            : this.t('game.freezeDoll.ready')
    if (label.text !== text) label.setText(text)
    label.setColor(
      hexToCss(light === 'green' ? PALETTE.lime : light === 'red' ? PALETTE.red : PALETTE.amber),
    )
    // The chant: a note per step, and a segmented bar that fills as it plays (frozen on a twitch).
    const g = this.songBar as Phaser.GameObjects.Graphics
    if (snap.songMs <= 0 || light === 'red' || light === 'ready') {
      if (this.barKey !== '') g.clear()
      this.barKey = ''
      return
    }
    const elapsed =
      light === 'green' ? Math.min(snap.songMs, snap.songElapsedMs + since) : snap.songElapsedMs
    const step = Math.min(CHANT_STEPS - 1, Math.floor((elapsed / snap.songMs) * CHANT_STEPS))
    // A new chant started (a fake-out only pauses the current one, so its notes carry on).
    if (elapsed + 100 < this.lastElapsed) this.lastStep = -1
    this.lastElapsed = elapsed
    if (light === 'green' && step !== this.lastStep) {
      if (this.lastStep !== -1 || elapsed < snap.songMs / CHANT_STEPS) this.sfx.chant(step)
      this.lastStep = step
    }
    // Redrawn only when a segment changes (it fills a step at a time).
    const frac = elapsed / snap.songMs
    const barKey = `${Math.floor(frac * CHANT_STEPS)}:${frac > 0}`
    if (barKey === this.barKey) return
    this.barKey = barKey
    g.clear()
    const { x, y, w, h } = this.songBox
    const segW = (w - (CHANT_STEPS - 1) * 3) / CHANT_STEPS
    for (let i = 0; i < CHANT_STEPS; i++) {
      const lit = (i + 1) / CHANT_STEPS <= frac + 1e-6
      const partial = !lit && i / CHANT_STEPS < frac
      g.fillStyle(lit ? PALETTE.lime : partial ? shade(PALETTE.lime, -0.4) : PALETTE.panelAlt, 1)
      g.fillRect(Math.round(x + i * (segW + 3)), y, Math.round(segW), h)
    }
  }

  // RED: the beam sweeps from the doll's eyes across the lanes; every lane it has reached stays watched.
  private paintLaser(snap: FreezeDollSnapshot, since: number): void {
    const beam = this.laser as Phaser.GameObjects.Graphics
    const watch = this.watch as Phaser.GameObjects.Graphics
    beam.clear()
    watch.clear()
    if (snap.light !== 'red' || this.lanes === 0) return
    const t = snap.redElapsedMs + since
    const p = (t - FREEZE_DOLL_SWEEP.delayMs) / FREEZE_DOLL_SWEEP.ms
    if (p < 0) return
    if (!this.laserPlayed) {
      this.laserPlayed = true
      this.sfx.laser()
    }
    const sweep = Math.min(1, p)
    const n = this.lanes
    for (let lane = 0; lane < n; lane++) {
      if (freezeDollSweepAt(lane, n, snap.sweepFrom, snap.sweepDir) > sweep + 1e-6) continue
      watch.fillStyle(PALETTE.red, 0.2)
      watch.fillRect(
        this.lanesX0 + lane * this.laneW,
        this.finishY,
        this.laneW,
        this.startY - this.finishY + 14,
      )
    }
    if (p > 1.4) return
    // The beam itself while it sweeps (and a beat after): eyes → the lane it has just reached. Past the
    // field's edge it wraps round to the other side.
    let lanePos = (((snap.sweepFrom + snap.sweepDir * sweep * (n - 1)) % n) + n) % n
    if (lanePos > n - 0.5) lanePos -= n
    const tx = this.lanesX0 + (lanePos + 0.5) * this.laneW
    const ty = this.startY - (this.startY - this.finishY) * 0.35
    const alpha = p > 1 ? 1 - (p - 1) / 0.4 : 1
    beam.lineStyle(6, PALETTE.red, 0.35 * alpha)
    beam.lineBetween(this.eyes.x - this.dollPx * 2, this.eyes.y, tx, ty)
    beam.lineBetween(this.eyes.x + this.dollPx * 2, this.eyes.y, tx, ty)
    beam.lineStyle(2, 0xffd0d0, alpha)
    beam.lineBetween(this.eyes.x - this.dollPx * 2, this.eyes.y, tx, ty)
    beam.lineBetween(this.eyes.x + this.dollPx * 2, this.eyes.y, tx, ty)
  }

  // Your runner: the server's physics on your held control, from the moment you press — eased onto
  // the server's position (run on at its speed). Stunned, finished or out, it simply follows the server.
  private predict(snap: FreezeDollSnapshot, since: number, dt: number): void {
    const me = snap.runners.find((r) => r.id === this.selfId)
    if (!me || me.status !== 'racing' || this.state.final) {
      this.pred = undefined
      return
    }
    const server = Math.min(1, me.x + (me.v * since) / 1000)
    const p = this.pred ?? { x: server, v: me.v, brake: 0 }
    this.pred = p
    const target = snap.light === 'ready' ? 0 : freezeDollSpeed(this.desiredMode())
    freezeDollMove(p, target, dt / 1000)
    p.x = Math.min(1, p.x + (server - p.x) * (1 - Math.exp(-dt / CORRECT_TAU_MS)))
    if (Math.abs(server - p.x) > 0.08) p.x = server
  }

  private paintRunners(snap: FreezeDollSnapshot, since: number, time: number, delta: number): void {
    const heartKey = this.heartKey
    const k = Math.min(1, delta / 80)
    for (const r of snap.runners) {
      let view = this.views.get(r.id)
      if (!view) {
        // Everyone walks away from the camera toward the doll (back view).
        const avatar = new AvatarSprite(
          this,
          this.state.avatarOf(r.id),
          this.state.colorOf(r.id),
          this.avatarSize,
          'back',
        )
        avatar.image.setOrigin(0.5, 0.9).setDepth(60)
        const shadow = addShadow(this, this.avatarSize, 59)
        const hearts = [0, 1].map(() => this.add.image(0, 0, heartKey).setDepth(61))
        view = {
          avatar,
          shadow,
          hearts,
          x: r.x,
          status: r.status,
          hearts0: r.hearts,
          fallen: false,
        }
        this.views.set(r.id, view)
        if (r.status === 'out') this.layDown(view, false)
      }
      this.reactTo(r, view)
      // You: the prediction. The others: dead-reckoned from the snapshot's speed, eased toward it.
      const mine = r.id === this.selfId ? this.pred : undefined
      if (mine) view.x = mine.x
      else {
        const target = r.status === 'racing' ? Math.min(1, r.x + (r.v * since) / 1000) : r.x
        view.x += (target - view.x) * k
        if (Math.abs(target - view.x) > 0.08) view.x = target
      }
      const x = this.laneX(r.lane)
      const y = this.yAt(view.x)
      const moving = (mine ? mine.v : r.v) > 0.001 && r.status === 'racing'
      if (mine && moving) this.footsteps(mine.v)
      const bob = moving ? Math.abs(Math.sin(time / 90)) * -3 : 0
      // Back to the camera while racing; turned around (face visible) when lasered, out or safe.
      const face = FACES[r.status]
      view.avatar.setPose(face ? 'front' : 'back').setExpression(face ?? 'idle')
      view.avatar.tick(time)
      const img = view.avatar.image
      if (!view.fallen) {
        img.setPosition(Math.round(x), Math.round(y + bob))
        img.setAngle(moving ? Math.sin(time / 90) * 6 : 0)
        img.setAlpha(r.status === 'stunned' ? (Math.floor(time / 90) % 2 ? 0.35 : 1) : 1)
      } else img.setPosition(Math.round(x), Math.round(y))
      view.shadow.setPosition(Math.round(x), Math.round(y + 1)).setVisible(!view.fallen)
      const hw = (h0: Phaser.GameObjects.Image): number => h0.width + 2
      view.hearts.forEach((h, i) => {
        h.setVisible(!view.fallen && r.status !== 'finished' && i < r.hearts)
        h.setPosition(Math.round(x + (i - 0.5) * hw(h)), Math.round(y + 8))
      })
      if (r.id === this.selfId) {
        if (view.fallen) this.youMarker?.hide()
        else this.youMarker?.place(x, y - this.avatarSize * 0.9 + bob, time)
      }
    }
  }

  // Your runner's feet, from the frame you set off (the prediction moves at once) until it stops.
  private footsteps(v: number): void {
    const now = this.time.now
    const walk = freezeDollSpeed('walk')
    const gap = v > (walk + freezeDollSpeed('run')) / 2 ? RUN_STEP_MS : WALK_STEP_MS
    if (now - this.lastFootAt < gap) return
    this.lastFootAt = now
    this.footSide ^= 1
    this.sfx.step(this.footSide)
  }

  // Snapshot deltas → hits, eliminations, finishes.
  private reactTo(r: FreezeDollRunner, view: RunnerView): void {
    if (this.firstSnapshot) {
      view.status = r.status
      view.hearts0 = r.hearts
      return
    }
    const self = r.id === this.selfId
    const x = this.laneX(r.lane)
    const y = this.yAt(view.x) - this.avatarSize / 2
    if (r.hearts < view.hearts0) {
      this.zap(x, y)
      this.gloat(`${r.id}:${r.hearts}`)
      if (r.status === 'out') {
        eliminate(
          this,
          x,
          y,
          this.state.colorOf(r.id),
          this.quip('game.common.stamps', r.id),
          this.compact ? 12 : 16,
        )
        this.sfx.quiet(() => this.sfx.eliminated(), self ? 1 : RIVAL_LEVEL)
        this.layDown(view, true)
      } else {
        floatText(this, x, y - 10, '-♥', PALETTE.red, this.compact ? 12 : 16)
        if (self) {
          this.sfx.hurt()
          flash(this, PALETTE.red, 200, 0.25)
        }
      }
    }
    // Gone from the room (out without a hit): they just drop where they stood.
    if (r.status === 'out' && view.status !== 'out' && r.hearts >= view.hearts0)
      this.layDown(view, true)
    if (r.status === 'finished' && view.status !== 'finished') {
      burst(this, x, this.finishY, this.state.colorOf(r.id), 18, 200)
      // Over the line: the crowd roars (yours always; a pack arriving together is one roar).
      const now = this.time.now
      if (self || now - this.lastCheerAt >= CHEER_GAP_MS) {
        this.lastCheerAt = now
        this.sfx.quiet(() => this.sfx.cheer(), self ? 1 : RIVAL_LEVEL * 0.8)
      }
      if (self) {
        this.sfx.win()
        floatText(
          this,
          x,
          this.finishY + 10,
          this.t('game.freezeDoll.safe'),
          PALETTE.lime,
          this.compact ? 12 : 16,
        )
      }
    }
    view.status = r.status
    view.hearts0 = r.hearts
  }

  // The doll's one-liner when her laser catches someone (the same line on every screen).
  private gloat(seed: string): void {
    const doll = this.doll
    if (!doll || this.time.now < this.gloatUntil) return
    this.gloatUntil = this.time.now + 2000
    speechBubble(
      this,
      doll.x + doll.displayWidth * 0.3,
      doll.y + this.dollPx * 3,
      this.quip('game.freezeDoll.doll', seed),
      this.compact ? 12 : 16,
    )
  }

  private zap(x: number, y: number): void {
    const g = this.add.graphics().setDepth(85)
    g.lineStyle(5, PALETTE.red, 1)
    g.lineBetween(this.eyes.x, this.eyes.y, x, y)
    g.lineStyle(2, 0xffffff, 1)
    g.lineBetween(this.eyes.x, this.eyes.y, x, y)
    this.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() })
    burst(this, x, y, PALETTE.red, 12, 180)
    shake(this, 0.005, 120)
  }

  // An eliminated runner falls flat and stays on the field, dimmed.
  private layDown(view: RunnerView, animate: boolean): void {
    view.fallen = true
    const to = { angle: 90, alpha: 0.4 }
    if (animate)
      this.tweens.add({ targets: view.avatar.image, ...to, duration: 380, ease: 'Bounce.easeOut' })
    else view.avatar.image.setAngle(to.angle).setAlpha(to.alpha)
    for (const h of view.hearts) h.setVisible(false)
  }

  private paintChrome(snap: FreezeDollSnapshot): void {
    const me = snap.runners.find((r) => r.id === this.selfId)
    const alive = snap.runners.filter((r) => r.status !== 'out').length
    this.hud?.setCenter(
      this.t('game.common.left', { n: alive, total: snap.runners.length }),
      alive <= 1 ? PALETTE.red : PALETTE.text,
    )
    if (me) this.hud?.setScore(`${Math.round(me.x * 100)}%`)
    this.strip?.set(
      snap.runners.map((r) => ({
        text: `${this.label(r.id)} ${r.status === 'finished' ? '✓' : r.status === 'out' ? '✗' : '♥'.repeat(r.hearts)}`,
        avatar: this.state.avatarOf(r.id),
        color: this.state.colorOf(r.id),
        dim: r.status === 'out',
      })),
    )
    const prompt = this.promptFor(snap, me)
    if (this.prompt && prompt.text !== this.promptText) {
      this.promptText = prompt.text
      this.prompt.setText(prompt.text).setColor(hexToCss(prompt.color))
      this.prompt.setFontSize(
        fitFontSize(prompt.text, this.scale.width - 24, this.compact ? 12 : 16),
      )
      if (prompt.color === PALETTE.red) punch(this, this.prompt, 0.12, 80)
    }
    if (this.state.final && !this.bannerShown && this.banner) {
      this.bannerShown = true
      const text =
        me?.status === 'finished'
          ? this.t('game.freezeDoll.safe')
          : me?.status === 'out'
            ? this.t('game.common.out')
            : this.t('game.freezeDoll.tooSlow')
      showBanner(this, this.banner, text, me?.status === 'finished' ? PALETTE.lime : PALETTE.red)
    }
  }

  private promptFor(
    snap: FreezeDollSnapshot,
    me: FreezeDollRunner | undefined,
  ): { text: string; color: number } {
    if (this.state.final) return { text: '', color: PALETTE.amber }
    if (!me) return { text: this.quip('game.common.spectating', this.selfId), color: PALETTE.dim }
    if (me.status === 'finished')
      return { text: this.t('game.freezeDoll.safeHint'), color: PALETTE.lime }
    if (me.status === 'out')
      return { text: this.quip('game.common.spectating', this.selfId), color: PALETTE.dim }
    if (me.status === 'stunned') return { text: this.t('game.freezeDoll.hit'), color: PALETTE.red }
    if (snap.light === 'ready')
      return { text: this.t('game.freezeDoll.readyHint'), color: PALETTE.amber }
    if (snap.light === 'green')
      return {
        text: this.t(this.compact ? 'game.freezeDoll.goHint' : 'game.freezeDoll.goKeys'),
        color: PALETTE.lime,
      }
    return { text: this.t('game.freezeDoll.freeze'), color: PALETTE.red }
  }
}
