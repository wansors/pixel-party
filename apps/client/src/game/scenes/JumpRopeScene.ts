import { JUMP_ROPE, type JumpRopePlayer, type JumpRopeSnapshot, PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import {
  addBanner,
  burst,
  eliminate,
  flash,
  floatText,
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
import { addShadow, type Shadow, YouMarker } from '../playerMarks'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Jump Rope: a schoolyard at dusk, two turners swinging a giant rope over everyone standing in a row.
// The rope is a curve whose middle swings round (drawn behind the jumpers on the far side of its turn,
// in front of them on the near side) and sweeps the ground under their feet on every pass. Everyone is
// their lobby avatar; your own jump shows the instant you press. SPACE / ↑ / W / Enter, a click or a
// tap jumps. A line on the ground names the keys (or heckles you once you're out).

// The rope's sweep is heard this long before it passes under the feet (the whoosh swells into it),
// once per pass and never closer together than WHOOSH_GAP_MS.
const WHOOSH_LEAD_MS = 120
const WHOOSH_GAP_MS = 250
// Rivals' moments play at this fraction of the volume (yours stay full), so a full room stays readable.
const RIVAL_LEVEL = 0.5

const TURNER_ROWS = ['__HH__', '__HH__', '_TTTT_', 'TTTTTT', '_TTTT_', '__LL__', '_L__L_', 'L____L']

interface View {
  avatar: AvatarSprite
  shadow: Shadow
  out: boolean
  // Wincing after a trip until then (scene time).
  hurtUntil: number
}

export class JumpRopeScene extends MiniGameScene<JumpRopeSnapshot> {
  private compact = false
  private groundY = 0
  private hands = { lx: 0, rx: 0, y: 0 }
  // Where the turners' heads are (they heckle), and when they last did.
  private turners = { lx: 0, rx: 0, y: 0 }
  private heckleUntil = 0
  // The rope's middle swings between ropeTop (well over the heads) and just under the feet.
  private ropeTop = 0
  // Avatar display size: the largest crisp step up to maxAvatar that lets the whole row stand side by
  // side between the turners (set from the first snapshot's headcount).
  private maxAvatar = 0
  private avatarSize = 0
  private slots: number[] = []
  private ropeBack?: Phaser.GameObjects.Graphics
  private ropeFront?: Phaser.GameObjects.Graphics
  private views = new Map<string, View>()
  private marker?: YouMarker
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private jumpBtn?: Phaser.GameObjects.Image
  private jumpKeys = { up: '', down: '' }
  private localJumpAt = -1
  private warmed = false
  private prompt?: Phaser.GameObjects.Text
  private promptText = ''
  private lastTick = -1
  private snapAt = 0
  private prev?: JumpRopeSnapshot
  // The pass count whose sweep was last heard, and when.
  private whooshedFor = -1
  private whooshAt = Number.NEGATIVE_INFINITY

  constructor(...deps: SceneDeps) {
    super('jump-rope', ...deps)
  }

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.views = new Map()
    this.slots = []
    this.localJumpAt = -1
    this.warmed = false
    this.promptText = ''
    this.lastTick = -1
    this.snapAt = 0
    this.prev = undefined
    this.whooshedFor = -1
    this.whooshAt = Number.NEGATIVE_INFINITY

    const stripSize = this.compact ? 11 : 13
    this.strip = new PlayerStrip(this, width / 2, this.top + 8, width - 24, stripSize, 2)
    const areaTop = this.top + 8 + PlayerStrip.rowH(stripSize) * 2

    const btnH = this.compact ? 80 : 60
    const btnW = Math.min(width - 32, 320)
    const btnY = height - (this.compact ? 14 : 16) - btnH / 2
    this.jumpKeys = {
      up: ensureBevelPanel(this, btnW, btnH, PALETTE.lime, 5, true),
      down: ensureBevelPanel(this, btnW, btnH, shade(PALETTE.lime, -0.45), 5, true),
    }
    this.jumpBtn = this.add.image(width / 2, btnY, this.jumpKeys.up).setDepth(700)
    const label = this.t('game.jumpRope.jump')
    this.add
      .text(
        width / 2,
        btnY,
        label,
        headlineStyle(fitFontSize(label, btnW - 20, this.compact ? 24 : 32), PALETTE.bg),
      )
      .setOrigin(0.5)
      .setDepth(701)
    // Anywhere on the canvas jumps (a big target for thumbs).
    this.input.on('pointerdown', () => this.jump())
    for (const k of ['SPACE', 'UP', 'W', 'ENTER']) this.onKey(k, () => this.jump())

    // The yard: dusk sky bands, a wall, the ground.
    const g = this.add.graphics().setDepth(1)
    this.groundY = btnY - btnH / 2 - (this.compact ? 40 : 56)
    const bands = [0x2b2350, 0x3d2b5c, 0x5a3560, 0x7a4058]
    bands.forEach((c, i) => {
      g.fillStyle(c, 1)
      g.fillRect(
        0,
        areaTop + ((this.groundY - areaTop) * i) / bands.length,
        width,
        (this.groundY - areaTop) / bands.length + 1,
      )
    })
    g.fillStyle(0x4a3a40, 1).fillRect(
      0,
      this.groundY - (this.groundY - areaTop) * 0.3,
      width,
      (this.groundY - areaTop) * 0.3,
    )
    for (let x = 0; x < width; x += 24)
      g.fillStyle(0x3b2e34, 1).fillRect(
        x,
        this.groundY - (this.groundY - areaTop) * 0.3,
        2,
        (this.groundY - areaTop) * 0.3,
      )
    g.fillStyle(0x6b5a4a, 1).fillRect(0, this.groundY, width, btnY - btnH / 2 - this.groundY - 6)
    g.fillStyle(0x8a7560, 1).fillRect(0, this.groundY, width, 3)

    // Turners at both ends; the rope hangs from their hands.
    const turnerKey = ensurePixelGrid(this, {
      key: 'jr-turner',
      rows: TURNER_ROWS,
      legend: { H: 0xf2c49b, T: PALETTE.frameLit, L: 0x2a2234 },
      pixelSize: this.compact ? 5 : 8,
    })
    const turnerH = TURNER_ROWS.length * (this.compact ? 5 : 8)
    const margin = this.compact ? 22 : 60
    this.add.image(margin, this.groundY, turnerKey).setOrigin(0.5, 1).setDepth(50)
    this.add
      .image(width - margin, this.groundY, turnerKey)
      .setOrigin(0.5, 1)
      .setDepth(50)
      .setFlipX(true)
    this.hands = { lx: margin + 10, rx: width - margin - 10, y: this.groundY - turnerH * 0.55 }
    this.turners = { lx: margin, rx: width - margin, y: this.groundY - turnerH - 4 }
    this.heckleUntil = 0
    // Bigger jumpers on a big screen.
    this.maxAvatar = this.compact ? 32 : height >= 900 ? 64 : 48
    this.avatarSize = this.maxAvatar
    this.ropeTop = this.groundY - this.maxAvatar * 2.6
    // The keys (or a heckle once you're out), on the ground under the row.
    this.prompt = this.add
      .text(
        width / 2,
        this.groundY + (this.compact ? 20 : 28),
        '',
        headlineStyle(this.compact ? 12 : 16, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setDepth(600)
    this.ropeBack = this.add.graphics().setDepth(40)
    this.ropeFront = this.add.graphics().setDepth(60)
    this.marker = new YouMarker(this, this.compact ? 8 : 12, 70)
    this.banner = addBanner(this)
  }

  private jump(): void {
    const me = this.snap?.players.find((p) => p.id === this.selfId)
    if (!me?.alive || this.state.final) return
    const now = this.time.now
    if (this.localJumpAt >= 0 && now - this.localJumpAt < JUMP_ROPE.jumpMs) return
    this.localJumpAt = now
    this.sendInput({ kind: 'jump' })
    this.sfx.jump()
    if (this.jumpBtn) {
      this.jumpBtn.setTexture(this.jumpKeys.down)
      this.time.delayedCall(120, () => this.jumpBtn?.setTexture(this.jumpKeys.up))
    }
  }

  protected frame(snap: JumpRopeSnapshot | null, time: number): void {
    if (!snap) return
    if (!this.warmed) {
      this.warmed = true
      this.warmAvatars(
        snap.players.map((p) => p.id),
        [
          ['front', 'happy', 0],
          ['front', 'hurt', 0],
          ['front', 'ko', 0],
        ],
      )
    }
    if (this.slots.length !== snap.players.length) {
      const n = snap.players.length
      const room = this.hands.rx - this.hands.lx
      // n avatar-wide slots plus 0.75 of an avatar of clearance at each end fit between the hands.
      this.avatarSize = avatarPx(Math.min(this.maxAvatar, room / (n + 1.5)))
      const span = room - this.avatarSize * 1.5
      this.slots = snap.players.map(
        (_, i) => this.hands.lx + this.avatarSize * 0.75 + (span * (i + 0.5)) / n,
      )
    }
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.snapAt = time
      this.onSnapshot(snap)
    }
    const since = time - this.snapAt
    // Rope angle: π/2 = sweeping the ground (a pass), -π/2 = over the heads.
    const toPass = Math.max(0, snap.nextPassMs - since)
    const angle = Math.PI / 2 - (Math.PI * 2 * toPass) / Math.max(1, snap.periodMs)
    this.sweepSfx(snap, toPass, time)
    // After a pass the rope climbs behind everyone; over the heads it comes down in front of them.
    this.paintRope(angle, toPass < snap.periodMs / 2)
    this.paintJumpers(snap, since)
    this.paintPrompt(snap)
  }

  // The rope swishing under the feet, timed on this screen's rope (not a snapshot later).
  private sweepSfx(snap: JumpRopeSnapshot, toPass: number, time: number): void {
    if (this.state.final || toPass > WHOOSH_LEAD_MS || this.whooshedFor === snap.passes) return
    this.whooshedFor = snap.passes
    if (time - this.whooshAt < WHOOSH_GAP_MS) return
    this.whooshAt = time
    this.sfx.whoosh()
  }

  private paintPrompt(snap: JumpRopeSnapshot): void {
    const me = snap.players.find((p) => p.id === this.selfId)
    const text = this.state.final
      ? ''
      : !me?.alive
        ? this.quip('game.common.spectating', this.selfId)
        : this.t(this.compact ? 'game.jumpRope.hintTouch' : 'game.jumpRope.hint')
    if (!this.prompt || text === this.promptText) return
    this.promptText = text
    this.prompt
      .setText(text)
      .setColor(hexToCss(me?.alive ? PALETTE.text : PALETTE.dim))
      .setFontSize(fitFontSize(text, this.scale.width - 24, this.compact ? 12 : 16))
  }

  private paintRope(angle: number, front: boolean): void {
    const back = this.ropeBack as Phaser.GameObjects.Graphics
    const fore = this.ropeFront as Phaser.GameObjects.Graphics
    back.clear()
    fore.clear()
    const g = front ? fore : back
    const { lx, rx, y } = this.hands
    // The middle of the rope swings round from high over the heads down to just below the feet.
    const centre = (this.ropeTop + this.groundY + 6) / 2
    const amp = (this.groundY + 6 - this.ropeTop) / 2
    const midY = centre + Math.sin(angle) * amp
    g.lineStyle(this.compact ? 3 : 4, front ? 0xffffff : 0xb9b2c8, 1)
    g.beginPath()
    g.moveTo(lx, y)
    const steps = 24
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      // A flattened arc: most of the span (where the jumpers stand) sits at the middle's height.
      const sag = 1 - (1 - 4 * t * (1 - t)) ** 3
      g.lineTo(lx + (rx - lx) * t, y + (midY - y) * sag)
    }
    g.strokePath()
  }

  private paintJumpers(snap: JumpRopeSnapshot, since: number): void {
    snap.players.forEach((p, i) => {
      let view = this.views.get(p.id)
      if (!view) {
        const avatar = new AvatarSprite(
          this,
          this.state.avatarOf(p.id),
          this.state.colorOf(p.id),
          this.avatarSize,
        )
        avatar.image.setOrigin(0.5, 1).setDepth(50)
        const shadow = addShadow(this, this.avatarSize, 49)
        view = { avatar, shadow, out: !p.alive, hurtUntil: 0 }
        this.views.set(p.id, view)
        if (!p.alive) {
          avatar.setExpression('ko')
          avatar.image.setAngle(90).setAlpha(0.35)
          shadow.setVisible(false)
        }
      }
      const x = this.slots[i] ?? 0
      let jumpMs = p.jumpMs === null ? -1 : p.jumpMs + since
      // Your own jump starts the moment you press (the server's echo catches up).
      if (p.id === this.selfId && this.localJumpAt >= 0)
        jumpMs = Math.max(jumpMs, this.time.now - this.localJumpAt)
      const airborne = jumpMs >= 0 && jumpMs < JUMP_ROPE.jumpMs && p.alive
      const h = airborne
        ? Math.sin((Math.PI * jumpMs) / JUMP_ROPE.jumpMs) * this.avatarSize * 0.9
        : 0
      const now = this.time.now
      if (!view.out) {
        view.avatar.setExpression(now < view.hurtUntil ? 'hurt' : airborne ? 'happy' : 'idle')
        view.avatar.image.setPosition(Math.round(x), Math.round(this.groundY - h))
        // The shadow stays on the ground and shrinks while you're up in the air.
        const lift = 1 - h / (this.avatarSize * 1.8)
        view.shadow.setPosition(Math.round(x), Math.round(this.groundY - 1)).setScale(lift, 1)
      }
      view.avatar.tick(now)
      if (p.id === this.selfId) {
        if (p.alive) this.marker?.place(x, this.groundY - h - this.avatarSize, now)
        else this.marker?.hide()
      }
    })
  }

  // Each pass: who cleared it, who tripped, who's out.
  private onSnapshot(snap: JumpRopeSnapshot): void {
    const prev = this.prev
    this.prev = snap
    const me = snap.players.find((p) => p.id === this.selfId)
    const alive = snap.players.filter((p) => p.alive).length
    if (me) this.hud?.setScore(this.t('game.jumpRope.jumps', { n: me.cleared }))
    this.hud?.setCenter(
      this.t('game.common.left', { n: alive, total: snap.players.length }),
      alive <= 1 ? PALETTE.red : PALETTE.text,
    )
    this.strip?.set(
      snap.players.map((p) => ({
        text: `${this.label(p.id)} ${p.alive ? '♥'.repeat(p.hearts) : '✗'}`,
        avatar: this.state.avatarOf(p.id),
        color: this.state.colorOf(p.id),
        dim: !p.alive,
      })),
    )
    if (!prev || this.firstSnapshot) return
    const before = new Map(prev.players.map((p) => [p.id, p]))
    snap.players.forEach((p, i) => {
      const was = before.get(p.id)
      if (!was) return
      const x = this.slots[i] ?? 0
      if (p.hearts < was.hearts) this.trip(p, x, was)
      else if (p.cleared > was.cleared && p.id === this.selfId) {
        floatText(
          this,
          x,
          this.groundY - this.avatarSize - 16,
          '+1',
          PALETTE.lime,
          this.compact ? 12 : 16,
        )
      }
    })
    if (this.state.final && me && this.banner && !this.banner.visible) {
      const won = me.alive && alive === 1 && snap.players.length > 1
      showBanner(
        this,
        this.banner,
        won
          ? this.t('game.common.youWin')
          : me.alive
            ? this.t('game.jumpRope.survived')
            : this.t('game.common.out'),
        me.alive ? PALETTE.lime : PALETTE.red,
      )
    }
  }

  // The nearer turner's one-liner for whoever got swept off (one bubble at a time).
  private heckle(x: number, seed: string): void {
    if (this.time.now < this.heckleUntil) return
    this.heckleUntil = this.time.now + 2000
    const left = x < this.scale.width / 2
    speechBubble(
      this,
      left ? this.turners.lx : this.turners.rx,
      this.turners.y,
      this.quip('game.jumpRope.turners', seed),
      this.compact ? 12 : 16,
    )
  }

  private trip(p: JumpRopePlayer, x: number, was: JumpRopePlayer): void {
    const view = this.views.get(p.id)
    const self = p.id === this.selfId
    burst(this, x, this.groundY - 6, 0xb9b2c8, 10, 160)
    if (!p.alive && was.alive) {
      eliminate(
        this,
        x,
        this.groundY - this.avatarSize,
        this.state.colorOf(p.id),
        this.quip('game.common.stamps', p.id),
        this.compact ? 12 : 16,
      )
      this.sfx.quiet(() => this.sfx.eliminated(), self ? 1 : RIVAL_LEVEL)
      this.heckle(x, p.id)
      if (view) {
        view.out = true
        view.avatar.setExpression('ko')
        view.avatar.image.setPosition(x, this.groundY)
        view.shadow.setVisible(false)
        this.tweens.add({ targets: view.avatar.image, angle: 90, alpha: 0.35, duration: 300 })
      }
      if (self) flash(this, PALETTE.red, 200, 0.3)
      return
    }
    floatText(
      this,
      x,
      this.groundY - this.avatarSize - 16,
      this.t('game.jumpRope.trip'),
      PALETTE.red,
      this.compact ? 12 : 16,
    )
    if (self) {
      this.sfx.hurt()
      shake(this, 0.008, 160)
    }
    if (view) {
      view.hurtUntil = this.time.now + 700
      this.tweens.add({
        targets: view.avatar.image,
        angle: { from: -18, to: 0 },
        duration: 300,
        ease: 'Bounce.easeOut',
      })
    }
  }
}
