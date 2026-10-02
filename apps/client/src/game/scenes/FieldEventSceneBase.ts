import { type FieldAthlete, type FieldEventSnapshot, PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { addBanner, burst, flash, floatText, ring, shake, showBanner } from '../fx'
import { bodyStyle, fitFontSize, headlineStyle, shade } from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene } from './MiniGameScene'
import {
  ATHLETE_H,
  ATHLETE_W,
  type AthletePose,
  GRASS,
  RunnerTracker,
  StridePad,
  TARTAN,
  athleteHand,
  athleteTexture,
  ensureCrowdTile,
  ensureFlagTexture,
  runFrame,
} from './athleticsKit'

const SPRITE_M = 2.2 // world metres the athlete sprite spans
const SAND = 0xe3c98c
const JAVELIN_M = 2.6
const RELEASE_H_M = 1.9 // javelin release height

export interface FieldEventLook {
  // Long jump: sand pit + 1 m marks; javelin: grass sector + 10 m lines and a flying javelin.
  kind: 'jump' | 'throw'
  // Metres of world visible across the screen, and where marks go (every `markStep` m, from the line).
  viewM: number
  markStep: number
  markTo: number
}

// Run-up-and-launch canvas shared by the long jump and the javelin. A side view follows the player's
// own athlete: runway → foul line → sand pit (or the throwing field), with every player's best mark
// planted as a flag in their identity color. The pad's feet build speed; holding the action button
// plants and raises the launch angle (arc gauge with the 45° sweet spot), releasing launches. Fouls,
// marks and personal bests come back from the server as snapshot deltas.
export abstract class FieldEventSceneBase extends MiniGameScene<FieldEventSnapshot> {
  protected abstract readonly look: FieldEventLook
  private pad?: StridePad
  private readonly tracker = new RunnerTracker()
  private world?: Phaser.GameObjects.Container
  private crowd?: Phaser.GameObjects.TileSprite
  private athlete?: Phaser.GameObjects.Image
  private javelin?: Phaser.GameObjects.Image
  private gauge?: Phaser.GameObjects.Graphics
  private gaugeText?: Phaser.GameObjects.Text
  private attemptsText?: Phaser.GameObjects.Text
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private readonly flags = new Map<
    string,
    { img: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; best: number }
  >()
  private compact = false
  private ppm = 40
  private spriteScale = 2
  private groundY = 0
  private worldTop = 0
  private camX = 0
  private color: number = PALETTE.cyan
  private lastTick = -1
  private arrivedAt = 0
  private prev?: FieldAthlete
  private prevBests = new Map<string, number | null>()
  private pose: AthletePose | '' = ''
  private aimStart = -1
  private aimFrozen: number | null = null
  private lastFoot: 'L' | 'R' | null = null
  private bannerHideAt = 0
  private lastFrameAt = 0

  private get i18nNs(): string {
    return this.look.kind === 'jump' ? 'game.longJump' : 'game.javelinThrow'
  }

  override create(): void {
    super.create()
    this.tracker.reset()
    this.flags.clear()
    this.lastTick = -1
    this.prev = undefined
    this.prevBests = new Map()
    this.pose = ''
    this.aimStart = -1
    this.aimFrozen = null
    this.lastFoot = null
    this.bannerHideAt = 0
    this.lastFrameAt = 0
    this.camX = -4

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.color = this.state.colorOf(this.selfId, PALETTE.cyan)
    this.pad = new StridePad(
      this,
      { step: (f) => this.step(f), action: (down) => this.action(down) },
      { action: this.t(`${this.i18nNs}.action`), speedLabel: this.t('game.athletics.speed') },
    )
    if (!this.compact) {
      this.add
        .text(width / 2, height - 14, this.t(`${this.i18nNs}.hint`), bodyStyle(13, PALETTE.dim))
        .setOrigin(0.5)
    }

    // Info rows: own attempts, then everyone's best.
    const infoY = this.top + (this.compact ? 8 : 10)
    this.attemptsText = this.add
      .text(width / 2, infoY, '', headlineStyle(this.compact ? 8 : 12, PALETTE.text))
      .setOrigin(0.5, 0)
    const stripSize = this.compact ? 11 : 13
    const stripY = infoY + (this.compact ? 20 : 26)
    this.strip = new PlayerStrip(this, width / 2, stripY, width - 24, stripSize, 2)
    this.worldTop = stripY + PlayerStrip.rowH(stripSize) * 2

    // World geometry: ground band just above the pad; behind it an infield strip, then the stands
    // (top of the sky, where the flight arcs play out).
    const groundH = this.compact ? 34 : 46
    this.groundY = Math.round(this.pad.top - groundH)
    const skyH = this.groundY - this.worldTop
    const viewM = this.compact ? this.look.viewM * 0.75 : this.look.viewM
    const ppmFit = Math.min(width / viewM, skyH / 3.4, 88)
    this.spriteScale = Math.max(1, Math.floor((ppmFit * SPRITE_M) / ATHLETE_H))
    this.ppm = (this.spriteScale * ATHLETE_H) / SPRITE_M

    const infieldH = Math.round(Math.max(12, skyH * 0.2))
    const standsTop = this.worldTop + (this.compact ? 4 : 8)
    const standsH = Math.max(24, this.groundY - infieldH - 6 - standsTop)
    this.crowd = this.add
      .tileSprite(0, standsTop, width, standsH, ensureCrowdTile(this, standsH))
      .setOrigin(0, 0)
      .setAlpha(0.55)
    this.add.rectangle(0, standsTop + standsH, width, 6, PALETTE.frame).setOrigin(0, 0)
    this.add
      .rectangle(0, this.groundY - infieldH, width, infieldH, shade(GRASS, -0.15))
      .setOrigin(0, 0)
    this.world = this.add.container(0, 0)
    this.buildGround(groundH)

    this.athlete = this.add
      .image(0, this.groundY, athleteTexture(this, 'stand', this.color))
      .setOrigin(0.5, 1)
      .setScale(this.spriteScale)
    this.world.add(this.athlete)
    if (this.look.kind === 'throw') {
      this.javelin = this.add.image(0, 0, this.javelinTexture()).setOrigin(0.5)
      this.world.add(this.javelin)
    }

    this.gauge = this.add.graphics().setDepth(700)
    this.gaugeText = this.add
      .text(
        0,
        0,
        '',
        headlineStyle(this.compact ? 8 : 12, PALETTE.amber, {
          stroke: '#10121c',
          strokeThickness: 3,
        }),
      )
      .setOrigin(0, 1)
      .setDepth(701)
    this.banner = addBanner(this)
    this.banner.setY(this.worldTop + skyH * 0.35)
    this.subline = this.add
      .text(
        width / 2,
        this.worldTop + skyH * 0.35 + (this.compact ? 28 : 40),
        '',
        headlineStyle(this.compact ? 8 : 16, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setDepth(950)
      .setVisible(false)
  }

  // Static ground in world pixels (the container scrolls): grass, runway, the line, pit/sector, marks.
  private buildGround(groundH: number): void {
    const world = this.world
    if (!world) return
    // The server's spec, mirrored until the first snapshot confirms it (long jump 30 m, javelin 28 m).
    const foulLine = this.foulLine
    const px = (m: number): number => m * this.ppm
    const y = this.groundY
    const far = foulLine + this.look.markTo + 30
    world.add(this.add.rectangle(px(-40), y, px(far + 40), groundH, GRASS).setOrigin(0, 0))
    world.add(this.add.rectangle(px(-40), y, px(foulLine + 40), groundH, TARTAN).setOrigin(0, 0))
    // Tartan speckle stripe + white runway edge lines.
    world.add(
      this.add.rectangle(px(-40), y + 2, px(foulLine + 40), 2, PALETTE.text).setOrigin(0, 0),
    )
    world.add(
      this.add
        .rectangle(px(-40), y + groundH - 4, px(foulLine + 40), 2, PALETTE.text)
        .setOrigin(0, 0),
    )
    if (this.look.kind === 'jump') {
      world.add(this.add.rectangle(px(foulLine + 1), y, px(10), groundH, SAND).setOrigin(0, 0))
      for (let i = 0; i < 40; i++) {
        const sx = px(foulLine + 1) + ((i * 53) % Math.max(1, Math.round(px(10))))
        const sy = y + 3 + ((i * 29) % Math.max(1, groundH - 6))
        world.add(this.add.rectangle(sx, sy, 2, 2, shade(SAND, -0.18)).setOrigin(0, 0))
      }
      // Take-off board with its plasticine foul strip.
      world.add(
        this.add
          .rectangle(px(foulLine) - px(0.2), y, px(0.2), groundH, PALETTE.text)
          .setOrigin(0, 0),
      )
      world.add(
        this.add
          .rectangle(px(foulLine), y, Math.max(2, px(0.1)), groundH, PALETTE.red)
          .setOrigin(0, 0),
      )
    } else {
      // Throwing arc + sector lines.
      world.add(
        this.add
          .rectangle(px(foulLine), y, Math.max(3, px(0.15)), groundH, PALETTE.text)
          .setOrigin(0.5, 0),
      )
      world.add(
        this.add
          .rectangle(px(foulLine), y - 3, Math.max(3, px(0.15)), 3, PALETTE.red)
          .setOrigin(0.5, 0),
      )
    }
    for (let m = this.look.markStep; m <= this.look.markTo; m += this.look.markStep) {
      const mx = px(foulLine + m)
      world.add(
        this.add
          .rectangle(mx, y, 2, this.look.kind === 'jump' ? 6 : groundH, PALETTE.text)
          .setOrigin(0.5, 0)
          .setAlpha(0.8),
      )
      world.add(
        this.add
          .text(
            mx,
            y + groundH / 2 + 2,
            `${m}`,
            headlineStyle(8, this.look.kind === 'jump' ? 0x6b4a1f : PALETTE.text),
          )
          .setOrigin(0.5),
      )
    }
  }

  private get foulLine(): number {
    return this.snap?.foulLine ?? (this.look.kind === 'jump' ? 30 : 28)
  }

  private javelinTexture(): string {
    const len = Math.max(20, Math.round(JAVELIN_M * this.ppm))
    const key = `pp-ath-javelin-${len}`
    if (this.textures.exists(key)) return key
    const g = this.make.graphics({ x: 0, y: 0 })
    g.fillStyle(0x10121c, 1)
    g.fillRect(0, 0, len, 5)
    g.fillStyle(0xd8dde8, 1)
    g.fillRect(1, 1, len - 2, 3)
    g.fillStyle(PALETTE.amber, 1)
    g.fillRect(Math.round(len * 0.42), 1, Math.round(len * 0.14), 3)
    g.fillStyle(PALETTE.red, 1)
    g.fillRect(len - Math.round(len * 0.1), 1, Math.round(len * 0.1) - 1, 3)
    g.generateTexture(key, len, 5)
    g.destroy()
    return key
  }

  // --- Input --------------------------------------------------------------------------------------

  private me(): FieldAthlete | undefined {
    return this.snap?.athletes.find((a) => a.id === this.selfId)
  }

  private step(foot: 'L' | 'R'): void {
    const me = this.me()
    if (me?.phase !== 'run' || this.aimStart >= 0)
      if (!me || me.phase !== 'run' || this.aimStart >= 0) return
    this.sendInput({ kind: 'step', foot })
    this.sfx.click()
    this.lastFoot = foot
    this.pad?.setNext(foot === 'L' ? 'R' : 'L')
  }

  private action(down: boolean): void {
    const me = this.me()
    if (!me) return
    if (down) {
      if (me.phase !== 'run' || this.aimStart >= 0) return
      this.sendInput({ kind: 'jump', down: true })
      this.aimStart = this.time.now
      this.aimFrozen = null
      this.sfx.pad(2)
    } else if (this.aimStart >= 0 && this.aimFrozen === null) {
      this.sendInput({ kind: 'jump', down: false })
      this.aimFrozen = this.localAngle(this.time.now)
    }
  }

  private localAngle(now: number): number {
    const snap = this.snap
    if (!snap) return 0
    return Math.min(snap.maxAngle, ((now - this.aimStart) / 1000) * snap.angleRate)
  }

  // --- Frame ----------------------------------------------------------------------------------------

  protected frame(snap: FieldEventSnapshot | null, _time: number, delta: number): void {
    if (!snap) return
    const now = this.time.now
    const me = this.me()
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.arrivedAt = now
      if (me) this.tracker.push(me.id, me.x, me.phase === 'run' ? me.v : 0, now)
      this.onSnapshot(snap)
    }
    if (this.bannerHideAt && now >= this.bannerHideAt) {
      this.bannerHideAt = 0
      this.banner?.setVisible(false)
    }
    if (!me) return
    const age = this.state.final ? 0 : now - this.arrivedAt
    const phaseMs = me.phaseMs + age
    const flightT = Math.max(0, Math.min(1, phaseMs / snap.flightMs))
    const runX = this.tracker.x(me.id, now, delta, this.state.final)

    // Athlete position/pose and the camera target, by phase.
    let ax = 0
    let lift = 0
    let pose: AthletePose = 'stand'
    let focus = 0
    let anchor = 0.28
    const range = (me.landX ?? me.takeoffX) - me.takeoffX
    const apex = this.apexM(range, me.angle)
    switch (me.phase) {
      case 'ready':
      case 'done':
        break
      case 'run':
        ax = runX
        pose = me.v < 0.4 ? 'stand' : runFrame(runX)
        break
      case 'aim':
        ax = me.takeoffX
        pose = this.look.kind === 'jump' ? 'takeoff' : 'windup'
        break
      case 'flight':
        if (this.look.kind === 'jump') {
          ax = me.takeoffX + range * flightT
          lift = 4 * apex * flightT * (1 - flightT)
          pose = flightT > 0.8 ? 'land' : 'fly'
        } else {
          ax = me.takeoffX
          pose = flightT < 0.35 ? 'release' : 'stand'
          focus = me.takeoffX + range * flightT
          anchor = 0.5
        }
        break
      case 'mark':
        if (me.landX === null) {
          ax = me.x
          pose = 'fallen'
        } else if (this.look.kind === 'jump') {
          ax = me.landX
          pose = 'land'
        } else {
          ax = me.takeoffX
          focus = me.landX
          anchor = 0.5
        }
        break
    }
    if (focus === 0) focus = ax
    if (pose !== this.pose) {
      this.pose = pose
      this.athlete?.setTexture(athleteTexture(this, pose, this.color, this.look.kind === 'throw'))
    }
    this.athlete?.setPosition(ax * this.ppm, this.groundY - lift * this.ppm)

    // Camera: glued to the action while running/flying, a quick pan back to the runway between
    // attempts. Real elapsed time (not Phaser's smoothed delta) so a hiccup never leaves it behind.
    const target = focus - (this.scale.width * anchor) / this.ppm
    const dt = Math.min(250, now - (this.lastFrameAt || now))
    this.lastFrameAt = now
    const tau = me.phase === 'run' || me.phase === 'aim' || me.phase === 'flight' ? 45 : 110
    this.camX += (target - this.camX) * (1 - Math.exp(-dt / tau))
    this.world?.setX(-this.camX * this.ppm)
    this.crowd?.setTilePosition(this.camX * this.ppm * 0.6, 0)

    this.renderJavelin(snap, me, pose, ax, flightT, apex, range)
    this.renderGauge(snap, me, ax, now)
    if (me.phase === 'run') this.pad?.setSpeed(me.v)
  }

  // Drawn peak height of the launch arc (metres): the real projectile apex, squashed to fit the sky.
  private apexM(range: number, angle: number): number {
    const real = (Math.max(0, range) * Math.tan((Math.min(80, angle) * Math.PI) / 180)) / 4
    const room = (this.groundY - this.worldTop) / this.ppm - SPRITE_M * 0.6
    return Math.min(real, Math.max(1, room))
  }

  private renderJavelin(
    snap: FieldEventSnapshot,
    me: FieldAthlete,
    pose: AthletePose,
    ax: number,
    flightT: number,
    apex: number,
    range: number,
  ): void {
    const jav = this.javelin
    if (!jav) return
    const inHand =
      me.phase === 'ready' ||
      me.phase === 'run' ||
      me.phase === 'aim' ||
      (me.phase === 'mark' && me.landX === null)
    if (inHand) {
      const hand = athleteHand(pose, true)
      const angle =
        me.phase === 'aim'
          ? -(this.aimFrozen ?? this.aimAngle(snap, me, this.time.now))
          : me.phase === 'run'
            ? -8
            : -60
      jav
        .setVisible(me.phase !== 'mark')
        .setPosition(
          ax * this.ppm + hand.x * this.spriteScale,
          this.groundY + hand.y * this.spriteScale,
        )
        .setAngle(angle)
      return
    }
    if (me.phase === 'flight' || me.phase === 'mark') {
      const t = me.phase === 'mark' ? 1 : flightT
      const h0 = RELEASE_H_M * (1 - t)
      const x = me.takeoffX + range * t
      const y = 4 * apex * t * (1 - t) + h0
      const slope = (4 * apex * (1 - 2 * t) - RELEASE_H_M) / Math.max(1, range)
      const tilt = me.phase === 'mark' ? 40 : (-Math.atan(slope) * 180) / Math.PI
      jav
        .setVisible(true)
        .setPosition(x * this.ppm, this.groundY - y * this.ppm - (me.phase === 'mark' ? 4 : 0))
        .setAngle(tilt)
      return
    }
    jav.setVisible(false)
  }

  private aimAngle(snap: FieldEventSnapshot, me: FieldAthlete, now: number): number {
    if (this.aimStart >= 0) return this.localAngle(now)
    return Math.min(snap.maxAngle, ((me.phaseMs + now - this.arrivedAt) / 1000) * snap.angleRate)
  }

  // Quarter-circle angle gauge beside the athlete while aiming (and the locked angle in flight).
  private renderGauge(snap: FieldEventSnapshot, me: FieldAthlete, ax: number, now: number): void {
    const g = this.gauge
    if (!g) return
    g.clear()
    const aiming = me.phase === 'aim' || (me.phase === 'run' && this.aimStart >= 0)
    const showing = aiming || (me.phase === 'flight' && me.angle > 0)
    this.gaugeText?.setVisible(showing)
    if (!showing) return
    const angle = aiming ? (this.aimFrozen ?? this.aimAngle(snap, me, now)) : me.angle
    const r = this.compact ? 42 : 64
    const cx = (ax - this.camX) * this.ppm + (ATHLETE_W / 2) * this.spriteScale * 0.6 + 8
    const cy = this.groundY - ATHLETE_H * this.spriteScale * 0.55
    const rad = (d: number): number => (-d * Math.PI) / 180
    g.fillStyle(PALETTE.bg, 0.7)
    g.slice(cx, cy, r + 6, rad(0), rad(90), true)
    g.fillPath()
    g.lineStyle(4, PALETTE.frameLit, 1)
    g.beginPath()
    g.arc(cx, cy, r, rad(0), rad(90), true)
    g.strokePath()
    g.lineStyle(6, PALETTE.lime, 1)
    g.beginPath()
    g.arc(cx, cy, r, rad(40), rad(50), true)
    g.strokePath()
    const a = rad(angle)
    const near = Math.abs(angle - 45) <= 5
    g.lineStyle(4, near ? PALETTE.lime : PALETTE.amber, 1)
    g.lineBetween(cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    g.fillStyle(PALETTE.text, 1)
    g.fillRect(cx - 3, cy - 3, 6, 6)
    this.gaugeText
      ?.setText(`${Math.round(angle)}°`)
      .setColor(near ? '#8be94b' : '#ffcf4b')
      .setPosition(cx + r * 0.2, cy - r - 8)
  }

  // --- Snapshot deltas → feedback -------------------------------------------------------------------

  // Marks the player may see: an attempt's mark stays hidden while it is still in the air.
  private revealed(a: FieldAthlete): (number | null)[] {
    const n = a.phase === 'mark' || a.phase === 'done' ? a.attempt + 1 : a.attempt
    return a.marks.slice(0, n)
  }

  private bestOf(a: FieldAthlete): number | null {
    const ms = this.revealed(a).filter((m): m is number => m !== null)
    return ms.length > 0 ? Math.max(...ms) : null
  }

  private fmt(m: number | null): string {
    return m === null ? this.t('game.athletics.foul') : `${m.toFixed(2)}m`
  }

  private onSnapshot(snap: FieldEventSnapshot): void {
    const me = snap.athletes.find((a) => a.id === this.selfId)
    const first = this.firstSnapshot || this.prev === undefined
    this.updateBoards(snap, !first)
    if (!me) return
    const prev = this.prev
    this.prev = me
    this.updateControls(me)
    if (first || !prev) {
      if (me.phase === 'done') this.showDone(me)
      return
    }
    if (me.phase === prev.phase && me.attempt === prev.attempt) return

    if (me.phase === 'ready') {
      this.aimStart = -1
      this.aimFrozen = null
      this.lastFoot = null
      this.subline?.setVisible(false)
      this.sfx.tick()
      this.showEnd(
        this.t('game.athletics.attempt', { n: me.attempt + 1, total: snap.attempts }),
        PALETTE.amber,
        snap.readyMs,
      )
    } else if (me.phase === 'run') {
      this.sfx.go()
      this.showEnd(this.t('game.athletics.go'), PALETTE.lime, 600)
    } else if (me.phase === 'flight') {
      this.sfx.pad(5)
      this.aimStart = -1
    } else if (me.phase === 'mark') {
      this.aimStart = -1
      this.revealMark(snap, me, prev)
    } else if (me.phase === 'done') {
      this.showDone(me)
    }
    if (me.phase !== 'aim' && me.phase !== 'run') this.aimStart = -1
  }

  private revealMark(snap: FieldEventSnapshot, me: FieldAthlete, prev: FieldAthlete): void {
    const mark = me.marks[me.attempt] ?? null
    const px = (m: number): number => (m - this.camX) * this.ppm
    if (mark === null) {
      this.sfx.wrong()
      flash(this, PALETTE.red, 180, 0.3)
      shake(this, 0.01, 200)
      this.showEnd(this.t('game.athletics.foul'), PALETTE.red, snap.markMs)
      return
    }
    const bestBefore = this.bestOf({ ...prev, phase: 'ready' })
    const landX = me.landX ?? 0
    const sx = px(landX)
    burst(this, sx, this.groundY, this.look.kind === 'jump' ? SAND : GRASS, 18, 200)
    burst(this, sx, this.groundY, PALETTE.text, 8, 140)
    this.showEnd(`${mark.toFixed(2)}m`, PALETTE.lime, snap.markMs)
    if (bestBefore === null || mark > bestBefore) {
      const leader = snap.athletes.every((a) => a.id === me.id || (this.bestOf(a) ?? -1) < mark)
      if (leader) this.sfx.fanfare()
      else this.sfx.coin()
      if (bestBefore !== null) {
        this.subline?.setText(this.t('game.athletics.newBest')).setColor('#ffcf4b').setVisible(true)
        this.time.delayedCall(snap.markMs, () => this.subline?.setVisible(false))
      }
      ring(this, sx, this.groundY - 10, this.color, 50)
    } else {
      this.sfx.correct()
    }
  }

  private showDone(me: FieldAthlete): void {
    const best = this.bestOf(me)
    const text =
      best === null
        ? this.t('game.athletics.noMark')
        : `${this.t('game.athletics.best')} ${best.toFixed(2)}m`
    this.showEnd(text, best === null ? PALETTE.red : PALETTE.amber, 0)
    const others = (this.snap?.athletes ?? []).some((a) => a.id !== me.id && a.phase !== 'done')
    this.subline
      ?.setText(others ? this.t('game.common.waiting') : '')
      .setColor('#eef1f7')
      .setVisible(others)
  }

  private updateControls(me: FieldAthlete): void {
    this.pad?.setEnabled(
      me.phase === 'run' && this.aimStart < 0,
      me.phase === 'run' || me.phase === 'aim',
    )
    this.pad?.setNext(
      me.phase === 'run' && this.aimStart < 0
        ? this.lastFoot === 'L'
          ? 'R'
          : this.lastFoot
            ? 'L'
            : null
        : null,
    )
    if (me.phase !== 'run') this.pad?.setSpeed(0)
  }

  // Attempts row, the everyone's-best strip, the HUD best and the mark flags.
  private updateBoards(snap: FieldEventSnapshot, withFx: boolean): void {
    const me = snap.athletes.find((a) => a.id === this.selfId)
    if (me) {
      const shown = this.revealed(me)
      const parts: string[] = []
      for (let i = 0; i < snap.attempts; i++) {
        const m = shown[i]
        parts.push(`${i + 1}:${i < shown.length ? this.fmt(m ?? null) : '—'}`)
      }
      this.attemptsText?.setText(parts.join('  '))
      const best = this.bestOf(me)
      this.hud?.setScore(
        `${this.t('game.athletics.best')} ${best === null ? '—' : `${best.toFixed(2)}m`}`,
      )
    }
    this.strip?.set(
      snap.athletes.map((a) => {
        const best = this.bestOf(a)
        return {
          text: `${this.label(a.id)} ${best === null ? '—' : best.toFixed(2)}`,
          color: this.state.colorOf(a.id, PALETTE.cyan),
          dim: a.phase === 'done',
        }
      }),
    )
    snap.athletes.forEach((a, i) => {
      const best = this.bestOf(a)
      const before = this.prevBests.get(a.id) ?? null
      this.prevBests.set(a.id, best)
      if (best === null) return
      const flag = this.flagOf(a.id)
      if (flag.best === best) return
      flag.best = best
      const x = (snap.foulLine + best) * this.ppm
      flag.img.setPosition(x, this.groundY).setVisible(true)
      flag.label
        .setPosition(x + 2, this.groundY - flag.img.height - 2 - (i % 3) * 11)
        .setVisible(true)
      if (withFx && a.id !== this.selfId && (before === null || best > before)) {
        ring(
          this,
          x - this.camX * this.ppm,
          this.groundY - flag.img.height / 2,
          this.state.colorOf(a.id),
          26,
        )
      }
    })
  }

  private flagOf(id: string): {
    img: Phaser.GameObjects.Image
    label: Phaser.GameObjects.Text
    best: number
  } {
    let flag = this.flags.get(id)
    if (!flag) {
      const color = this.state.colorOf(id, PALETTE.cyan)
      const h = Math.max(14, Math.min(40, this.ppm * 0.9))
      const img = this.add
        .image(0, this.groundY, ensureFlagTexture(this, h, color))
        .setOrigin(0, 1)
        .setVisible(false)
      const label = this.add
        .text(0, 0, this.label(id), {
          ...bodyStyle(this.compact ? 9 : 11, color, { fontStyle: 'bold' }),
          stroke: '#10121c',
          strokeThickness: 3,
        })
        .setOrigin(0, 1)
        .setVisible(false)
      this.world?.add([img, label])
      // Keep the athlete (and javelin) drawn over the flags.
      if (this.athlete) this.world?.bringToTop(this.athlete)
      if (this.javelin) this.world?.bringToTop(this.javelin)
      flag = { img, label, best: -1 }
      this.flags.set(id, flag)
    }
    return flag
  }

  private showEnd(text: string, color: number, holdMs: number): void {
    const banner = this.banner
    if (!banner) return
    banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
    showBanner(this, banner, text, color)
    this.bannerHideAt = holdMs > 0 ? this.time.now + holdMs : 0
  }
}
