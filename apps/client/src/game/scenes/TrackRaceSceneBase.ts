import { type AthleticsFoot, PALETTE, type TrackRaceSnapshot, type TrackRunner } from '@pp/shared'
import type Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { addBanner, burst, flash, floatText, shake, showBanner } from '../fx'
import { bodyStyle, ensureBevelPanel, fitFontSize, headlineStyle } from '../pixelStyle'
import { YouMarker, nameTagStyle } from '../playerMarks'
import { MiniGameScene } from './MiniGameScene'
import {
  ATHLETE_H,
  GRASS,
  METRES_PER_FRAME,
  RunnerTracker,
  StridePad,
  ensureCheckerTexture,
  ensureCrowdTile,
  ensureHurdleTexture,
  ensureTrackTile,
} from './athleticsKit'

// Mirrors the server's trackRace.ts AIR_MS: how long a hurdle jump stays airborne.
const AIR_MS = 480
const HURDLE_M = 1.07 // hurdle height, metres
const JUMP_M = 1.1 // peak of the drawn jump arc, metres
const SPRITE_M = 2.2 // world metres the athlete's box spans (head room included)
const STUMBLE_MS = 260
// Lanes keep at least this many px while the stands can give up room for them.
const LANE_MIN = 20

// Each athlete is the player's lobby avatar in side view: two-frame strides tied to the distance run,
// crouched in the blocks, tucked over a hurdle, wincing on a stumble, happy past the line.
interface RunnerView {
  avatar: AvatarSprite
  label: Phaser.GameObjects.Text
  color: number
  lane: number
  airStart: number // client time the current jump started (-1 = grounded)
  stumbleAt: number
}

// Side-by-side track race canvas shared by the 100 m dash and the 110 m hurdles. A side-scrolling
// stadium follows the player's own runner: stands up top, one tartan lane per player (pixel athletes
// in identity colors, dead-reckoned from x + v so everyone lines up with the server's present), the
// start/finish lines, 10 m marks and (hurdles) a barrier per lane. The two-foot pad sends strides; the
// gun, false starts, clipped hurdles and finishes come back as snapshot deltas with sound + FX.
export abstract class TrackRaceSceneBase extends MiniGameScene<TrackRaceSnapshot> {
  protected abstract readonly withHurdles: boolean
  private pad?: StridePad
  private readonly tracker = new RunnerTracker()
  private readonly views = new Map<string, RunnerView>()
  private hurdleSprites: Phaser.GameObjects.Image[][] = []
  private marks: Phaser.GameObjects.Text[] = []
  private laneNums: Phaser.GameObjects.Text[] = []
  private track?: Phaser.GameObjects.TileSprite
  private crowd?: Phaser.GameObjects.TileSprite
  private startLine?: Phaser.GameObjects.Rectangle
  private finishLine?: Phaser.GameObjects.Image
  private progress?: Phaser.GameObjects.Graphics
  private clock?: Phaser.GameObjects.Text
  private marker?: YouMarker
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private built = false
  private compact = false
  private ppm = 40
  private spriteScale = 2
  private laneH = 40
  private trackTop = 0
  private anchorX = 0
  private standsTop = 0
  private progressY = 0
  private lastTick = -1
  private prevPhase: TrackRaceSnapshot['phase'] | '' = ''
  private prev = new Map<string, TrackRunner>()
  private cleared = new Set<number>()
  private lastFoot: AthleticsFoot | null = null
  private goHideAt = 0
  private arrivedAt = 0

  override create(): void {
    super.create()
    this.tracker.reset()
    for (const v of this.views.values()) {
      v.avatar.destroy()
      v.label.destroy()
    }
    this.views.clear()
    this.hurdleSprites = []
    this.marks = []
    this.laneNums = []
    this.built = false
    this.lastTick = -1
    this.prevPhase = ''
    this.prev = new Map()
    this.cleared = new Set()
    this.lastFoot = null
    this.goHideAt = 0

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.pad = new StridePad(
      this,
      {
        step: (foot) => this.step(foot),
        action: this.withHurdles ? (down) => down && this.jump() : undefined,
      },
      {
        action: this.withHurdles ? this.t('game.athletics.jump') : undefined,
        speedLabel: this.t('game.athletics.speed'),
      },
    )
    if (!this.compact) {
      this.add
        .text(
          width / 2,
          height - 14,
          this.t(this.withHurdles ? 'game.athletics.hintHurdles' : 'game.athletics.hintDash'),
          bodyStyle(13, PALETTE.dim),
        )
        .setOrigin(0.5)
    }
    this.progressY = this.top + (this.compact ? 8 : 10)
    this.progress = this.add.graphics().setDepth(600)
    this.standsTop = this.progressY + (this.compact ? 16 : 20)
    this.anchorX = Math.round(width * (this.compact ? 0.3 : 0.32))

    this.banner = addBanner(this)
    this.subline = this.add
      .text(
        width / 2,
        height / 2 + (this.compact ? 30 : 42),
        '',
        headlineStyle(this.compact ? 8 : 16, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setDepth(950)
      .setVisible(false)
    this.marker = new YouMarker(this, this.compact ? 12 : 16, 650)
  }

  // --- Layout (on the first snapshot, once the lane count is known) --------------------------------

  private build(snap: TrackRaceSnapshot): void {
    this.built = true
    const { width } = this.scale
    const n = Math.max(1, snap.runners.length)
    const markH = this.compact ? 14 : 18
    const areaBottom = (this.pad?.top ?? this.scale.height) - markH - 2
    // Lanes share the room under a strip of stands. A big field squeezes the stands first, down to
    // nothing (the track then starts right under the progress strip), so lanes keep LANE_MIN px
    // wherever the screen has them; past that they just split what's left (fractional heights).
    let laneFit = (areaBottom - this.standsTop - (this.compact ? 28 : 44)) / n
    if (laneFit < LANE_MIN) {
      laneFit = Math.min(LANE_MIN, (areaBottom - this.progressY - (this.compact ? 10 : 12)) / n)
    }
    // Metres visible across the screen: enough to see the next hurdle coming, tighter on phones. The
    // scale is fractional (the avatar itself still snaps to a crisp size), floored at a 1× athlete box.
    const viewMin = this.compact ? (this.withHurdles ? 11 : 9) : this.withHurdles ? 16 : 13
    const ppmFit = Math.min(width / viewMin, (laneFit * 1.3) / SPRITE_M, 64)
    this.spriteScale = Math.max(1, (ppmFit * SPRITE_M) / ATHLETE_H)
    this.ppm = (this.spriteScale * ATHLETE_H) / SPRITE_M
    this.laneH = Math.min(laneFit, (this.spriteScale * ATHLETE_H) / 1.05)
    const trackH = Math.round(this.laneH * n)
    this.trackTop = Math.round(areaBottom - trackH)

    // Stands fill whatever room is left between the progress strip and the track (none for a packed
    // field), with an ad-board wall.
    const standsH = this.trackTop - this.standsTop - 6
    if (standsH >= 8) {
      this.crowd = this.add
        .tileSprite(0, this.standsTop, width, standsH, ensureCrowdTile(this, standsH))
        .setOrigin(0, 0)
        .setAlpha(0.8)
      this.add.rectangle(0, this.trackTop - 6, width, 6, PALETTE.frame).setOrigin(0, 0)
    } else this.crowd = undefined
    this.track = this.add
      .tileSprite(0, this.trackTop, width, trackH, ensureTrackTile(this, n, this.laneH))
      .setOrigin(0, 0)
    this.add.rectangle(0, this.trackTop + trackH, width, markH + 2, GRASS).setOrigin(0, 0)

    // Stadium clock, centered on the stands (in the HUD's middle chip when the stands are too thin).
    const clockW = this.compact ? 104 : 150
    const clockH = this.compact ? 26 : 36
    if (standsH >= clockH + 4) {
      const clockY = this.standsTop + standsH / 2
      this.add.image(
        width / 2,
        clockY,
        ensureBevelPanel(this, clockW, clockH, PALETTE.panel, 3, true),
      )
      this.clock = this.add
        .text(width / 2, clockY, '0.00', headlineStyle(this.compact ? 16 : 24, PALETTE.amber))
        .setOrigin(0.5)
    } else this.clock = undefined

    this.startLine = this.add
      .rectangle(0, this.trackTop, Math.max(3, this.ppm * 0.12), trackH, PALETTE.text)
      .setOrigin(0.5, 0)
    this.finishLine = this.add
      .image(0, this.trackTop, ensureCheckerTexture(this, Math.max(6, this.ppm * 0.3), trackH))
      .setOrigin(0.5, 0)
    for (let m = 10; m <= snap.distance; m += 10) {
      this.marks.push(
        this.add
          .text(0, this.trackTop + trackH + markH / 2 + 1, `${m}`, headlineStyle(8, PALETTE.text))
          .setOrigin(0.5),
      )
    }
    for (let i = 0; i < n; i++) {
      this.laneNums.push(
        this.add
          .text(
            0,
            this.laneTop(i) + this.laneH / 2,
            `${i + 1}`,
            headlineStyle(this.laneH > 40 ? 16 : 8, PALETTE.text),
          )
          .setOrigin(0.5)
          .setAlpha(0.8),
      )
    }

    const hurdleH = Math.max(10, HURDLE_M * this.ppm)
    const hurdleKey = ensureHurdleTexture(this, hurdleH, false)
    snap.runners.forEach((r, lane) => {
      this.hurdleSprites.push(
        snap.hurdles.map(() =>
          this.add
            .image(0, this.footY(lane), hurdleKey)
            .setOrigin(0.5, 1)
            .setDepth(100 + lane * 2)
            .setVisible(false),
        ),
      )
      this.viewOf(r, lane)
    })
  }

  // The avatar stands in the athlete's box (SPRITE_M tall) at a crisp size, inside its own lane.
  private avatarSize(): number {
    return avatarPx(this.spriteScale * ATHLETE_H * 0.8)
  }

  private laneTop(lane: number): number {
    return this.trackTop + Math.round(lane * this.laneH)
  }

  private footY(lane: number): number {
    return this.laneTop(lane) + Math.round(this.laneH * 0.84)
  }

  private viewOf(r: TrackRunner, lane: number): RunnerView {
    let v = this.views.get(r.id)
    if (!v) {
      const color = this.state.colorOf(r.id, PALETTE.cyan)
      const mine = r.id === this.selfId
      const avatar = new AvatarSprite(
        this,
        this.state.avatarOf(r.id),
        color,
        this.avatarSize(),
        'side',
      )
      avatar.image
        .setOrigin(0.5, 1)
        .setPosition(0, this.footY(lane))
        .setDepth(101 + lane * 2)
      v = {
        avatar,
        label: this.add
          .text(
            0,
            0,
            mine ? this.t('game.common.you') : this.state.nameOf(r.id),
            nameTagStyle(this.compact ? 8 : 10, color),
          )
          .setOrigin(1, 0.5)
          .setDepth(640),
        color,
        lane,
        airStart: -1,
        stumbleAt: -1,
      }
      this.views.set(r.id, v)
    }
    return v
  }

  // --- Input --------------------------------------------------------------------------------------

  private own(): TrackRunner | undefined {
    return this.snap?.runners.find((r) => r.id === this.selfId)
  }

  private step(foot: AthleticsFoot): void {
    const me = this.own()
    if (!this.snap || !me || me.finishMs !== null || this.snap.remainingMs <= 0) return
    this.sendInput({ kind: 'step', foot })
    this.sfx.click()
    // Taps in the air or on the same foot don't count on the server; mirror that in the cue.
    const airborne = (this.views.get(this.selfId)?.airStart ?? -1) >= 0
    if (!airborne) this.lastFoot = foot
    this.pad?.setNext(this.lastFoot === 'L' ? 'R' : 'L')
  }

  private jump(): void {
    const snap = this.snap
    const me = this.own()
    const view = this.views.get(this.selfId)
    if (!snap || !me || !view || snap.phase !== 'go' || me.held || me.finishMs !== null) return
    if (view.airStart >= 0) return
    this.sendInput({ kind: 'jump' })
    // Predict the hop right away; the next snapshot confirms it.
    view.airStart = this.time.now
    this.sfx.pad(3)
  }

  // --- Frame ----------------------------------------------------------------------------------------

  protected frame(snap: TrackRaceSnapshot | null, _time: number, delta: number): void {
    if (!snap) return
    if (!this.built) this.build(snap)
    const now = this.time.now
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.arrivedAt = now
      for (const r of snap.runners) this.tracker.push(r.id, r.x, r.v, now)
      this.onSnapshot(snap, now)
    }
    if (this.goHideAt && now >= this.goHideAt) {
      this.goHideAt = 0
      this.banner?.setVisible(false)
    }

    const freeze = this.state.final
    const shown = new Map(snap.runners.map((r) => [r.id, this.tracker.x(r.id, now, delta, freeze)]))
    const me = this.own()
    const lead = Math.max(0, ...shown.values())
    const camX = (me ? (shown.get(me.id) ?? 0) : lead) - this.anchorX / this.ppm
    const toX = (x: number): number => (x - camX) * this.ppm

    this.track?.setTilePosition(camX * this.ppm, 0)
    this.crowd?.setTilePosition(camX * this.ppm * 0.7, 0)
    this.startLine?.setX(toX(0))
    this.finishLine?.setX(toX(snap.distance))
    this.marks.forEach((t, i) => t.setX(toX((i + 1) * 10)))
    for (const t of this.laneNums) t.setX(toX(-1.6))

    const { width } = this.scale
    snap.runners.forEach((r, lane) => {
      const hs = this.hurdleSprites[lane] ?? []
      snap.hurdles.forEach((h, i) => {
        const s = hs[i]
        if (!s) return
        const sx = toX(h)
        s.setVisible(sx > -60 && sx < width + 60).setX(sx)
        if (r.knocked.includes(i) && !s.getData('down')) {
          s.setData('down', true).setTexture(
            ensureHurdleTexture(this, Math.max(10, HURDLE_M * this.ppm), true),
          )
        }
      })
      this.renderRunner(snap, r, lane, shown.get(r.id) ?? r.x, toX, now)
    })

    this.drawProgress(snap, shown)
    const raceMs = snap.phase === 'go' ? snap.raceMs + (freeze ? 0 : now - this.arrivedAt) : 0
    const clock = ((me?.finishMs ?? raceMs) / 1000).toFixed(2)
    if (this.clock) this.clock.setText(clock)
    else this.hud?.setCenter(clock, PALETTE.amber)
  }

  private renderRunner(
    snap: TrackRaceSnapshot,
    r: TrackRunner,
    lane: number,
    x: number,
    toX: (x: number) => number,
    now: number,
  ): void {
    const v = this.viewOf(r, lane)
    const sx = toX(x)
    const mine = r.id === this.selfId
    // Airborne: server truth for others; own hop is predicted on press and confirmed by snapshots.
    if (r.air && v.airStart < 0) v.airStart = this.arrivedAt - r.airT * AIR_MS
    const airT = v.airStart >= 0 ? (now - v.airStart) / AIR_MS : -1
    if (airT > 1) v.airStart = -1
    const crouched =
      snap.phase === 'set' || r.held || (r.v < 0.4 && r.x < 0.5 && r.finishMs === null)
    const airborne = v.airStart >= 0
    const running = !crouched && !airborne && r.v >= 0.4
    const stumbling = v.stumbleAt >= 0 && now - v.stumbleAt < STUMBLE_MS
    // Strides follow the distance run (two frames per METRES_PER_FRAME * 2), not the clock.
    const stride = Math.floor(x / (METRES_PER_FRAME * 2)) % 2
    v.avatar
      .setStep(airborne ? 1 : running ? (stride as 0 | 1) : 0)
      .setExpression(stumbling ? 'hurt' : r.finishMs !== null ? 'happy' : 'idle')
      .tick(now)
    const lift = airborne
      ? Math.sin(Math.max(0, Math.min(1, airT)) * Math.PI) * JUMP_M * this.ppm
      : 0
    // Lean: deep in the blocks, forward while running, a tuck over the hurdle, a lurch on a stumble.
    const lean = stumbling ? 22 : crouched ? 16 : airborne ? -6 : running ? 6 : 0
    const bob = running && stride === 1 ? -Math.max(1, Math.round(this.avatarSize() / 24)) : 0
    v.avatar.image.setPosition(sx, this.footY(lane) - lift + bob).setAngle(lean)
    const headY = this.footY(lane) - lift - this.avatarSize()
    // Name tag trails the runner inside its own lane (the avatar's head pokes into the lane above).
    v.label.setPosition(
      Math.max(v.label.width + 4, sx - this.avatarSize() * 0.32),
      this.footY(lane) - this.laneH * 0.4,
    )
    if (mine) {
      // The ▼ never covers the progress strip: a packed field starts the track right under it, so
      // there's no marker in a lane without room for one, and a jump can't lift it into the strip.
      const room = this.progressY + 12 + (this.marker?.text.height ?? 0)
      if (r.finishMs === null && this.footY(lane) - this.avatarSize() >= room) {
        this.marker?.place(sx, Math.max(headY, room), now)
      } else this.marker?.hide()
      if (r.finishMs === null) this.pad?.setSpeed(r.v)
    }
  }

  // Top strip: the whole race at a glance — hurdles, finish flag and every runner's dot.
  private drawProgress(snap: TrackRaceSnapshot, shown: Map<string, number>): void {
    const g = this.progress
    if (!g) return
    const { width } = this.scale
    const x0 = this.compact ? 12 : 24
    const x1 = width - x0
    const y = this.progressY
    const at = (m: number): number =>
      x0 + (Math.max(0, Math.min(snap.distance, m)) / snap.distance) * (x1 - x0)
    g.clear()
    g.fillStyle(PALETTE.panelAlt, 1)
    g.fillRect(x0, y - 2, x1 - x0, 4)
    g.fillStyle(PALETTE.dim, 1)
    for (const h of snap.hurdles) g.fillRect(at(h) - 1, y - 4, 2, 8)
    g.fillStyle(PALETTE.text, 1)
    g.fillRect(x1 - 2, y - 7, 4, 14)
    for (const r of snap.runners) {
      if (r.id === this.selfId) continue
      g.fillStyle(this.state.colorOf(r.id, PALETTE.cyan), 1)
      g.fillRect(at(shown.get(r.id) ?? r.x) - 3, y - 3, 6, 6)
    }
    const me = this.own()
    if (me) {
      const x = at(shown.get(me.id) ?? me.x)
      g.fillStyle(PALETTE.text, 1)
      g.fillRect(x - 5, y - 5, 10, 10)
      g.fillStyle(this.state.colorOf(me.id, PALETTE.cyan), 1)
      g.fillRect(x - 3, y - 3, 6, 6)
    }
  }

  // --- Snapshot deltas → feedback -------------------------------------------------------------------

  private onSnapshot(snap: TrackRaceSnapshot, now: number): void {
    const first = this.firstSnapshot || this.prevPhase === ''
    const me = this.own()
    if (first) {
      // Adopt the state silently (a relayout mid-race must not replay the gun or anyone's finish).
      this.prevPhase = snap.phase
      this.prev = new Map(snap.runners.map((r) => [r.id, r]))
      // Not in this round (joined late): just watch.
      if (!me) this.pad?.setEnabled(false, false)
      if (me) {
        for (let i = 0; i < snap.hurdles.length; i++) {
          if ((snap.hurdles[i] as number) <= me.x) this.cleared.add(i)
        }
      }
      if (snap.phase === 'set') this.showEnd(this.t('game.athletics.set'), PALETTE.amber)
      if (me && me.finishMs !== null) this.showFinish(me, false)
      this.pad?.setNext(null)
      this.updateScore(snap)
      return
    }

    if (this.prevPhase === 'set' && snap.phase === 'go') {
      this.sfx.go()
      flash(this, PALETTE.lime, 140, 0.25)
      this.showEnd(this.t('game.athletics.go'), PALETTE.lime)
      this.goHideAt = now + 700
      if (!me?.falseStart)
        this.pad?.setNext(this.lastFoot === 'L' ? 'R' : this.lastFoot ? 'L' : null)
    }
    this.prevPhase = snap.phase

    snap.runners.forEach((r, lane) => {
      const before = this.prev.get(r.id)
      const mine = r.id === this.selfId
      const view = this.views.get(r.id)
      const sx = view?.avatar.image.x ?? 0
      const y = this.footY(lane) - this.laneH * 0.6
      if (before && !before.falseStart && r.falseStart) {
        if (mine) {
          this.sfx.wrong()
          shake(this, 0.01, 200)
          flash(this, PALETTE.red, 160, 0.25)
          this.subline?.setText(this.t('game.athletics.wait')).setVisible(true)
        }
        floatText(this, sx, y, this.t('game.athletics.falseStart'), PALETTE.red, mine ? 16 : 8)
      }
      if (mine && before?.held && !r.held) this.subline?.setVisible(false)
      if (before && r.knocked.length > before.knocked.length) {
        const idx = r.knocked[r.knocked.length - 1] as number
        if (view) view.stumbleAt = now
        burst(this, sx + this.ppm * 0.4, this.footY(lane) - 8, PALETTE.text, mine ? 12 : 6, 160)
        if (mine) {
          this.cleared.add(idx)
          this.sfx.pop()
          shake(this, 0.009, 160)
          floatText(this, sx, y, this.t('game.athletics.ouch'), PALETTE.amber, 16)
        }
      }
      if (before && before.finishMs === null && r.finishMs !== null) {
        if (mine) this.showFinish(r, true)
        else
          floatText(
            this,
            sx,
            y,
            this.t('game.athletics.place', { n: r.place ?? 0 }),
            view?.color ?? PALETTE.text,
            12,
          )
      }
    })

    // Clean clears: the server has resolved a hurdle once the runner's authoritative x is past it.
    if (me) {
      snap.hurdles.forEach((h, i) => {
        if (this.cleared.has(i) || me.x < h + 0.2) return
        this.cleared.add(i)
        if (me.knocked.includes(i)) return
        this.sfx.tick()
        const view = this.views.get(me.id)
        if (view) burst(this, view.avatar.image.x, this.footY(view.lane), PALETTE.lime, 6, 120)
      })
    }

    this.prev = new Map(snap.runners.map((r) => [r.id, r]))
    this.updateScore(snap)
  }

  private updateScore(snap: TrackRaceSnapshot): void {
    const me = this.own()
    if (!me) return
    if (me.finishMs !== null) {
      this.hud?.setScore(
        `${this.t('game.athletics.place', { n: me.place ?? 0 })} ${(me.finishMs / 1000).toFixed(2)}s`,
      )
      return
    }
    // Live position: finishers first, then by distance.
    const ahead = snap.runners.filter(
      (r) => r.id !== me.id && (r.finishMs !== null || r.x > me.x),
    ).length
    this.hud?.setScore(
      `${this.t('game.athletics.place', { n: ahead + 1 })} · ${Math.floor(Math.min(me.x, snap.distance))}m`,
    )
  }

  private showFinish(me: TrackRunner, withFx: boolean): void {
    const time = ((me.finishMs ?? 0) / 1000).toFixed(2)
    const text = `${this.t('game.athletics.place', { n: me.place ?? 0 })}  ${time}s`
    const winner = me.place === 1
    this.showEnd(text, winner ? PALETTE.lime : PALETTE.amber)
    this.goHideAt = 0
    this.pad?.setEnabled(false, false)
    this.pad?.setSpeed(0)
    this.marker?.hide()
    const others = (this.snap?.runners ?? []).some((r) => r.id !== me.id && r.finishMs === null)
    this.subline?.setText(others ? this.t('game.common.waiting') : '').setVisible(others)
    if (!withFx) return
    if (winner) this.sfx.fanfare()
    else this.sfx.coin()
    const view = this.views.get(me.id)
    if (view) {
      const img = view.avatar.image
      burst(this, img.x, img.y - 40, view.color, 24, 260)
      burst(this, img.x, img.y - 40, PALETTE.amber, 16, 200)
    }
  }

  private showEnd(text: string, color: number): void {
    const banner = this.banner
    if (!banner) return
    banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
    showBanner(this, banner, text, color)
  }
}
