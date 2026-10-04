import { BUTTON_MASHER_MAX_PER_SEC, type ButtonMasherSnapshot, PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { avatarPx, ensureAvatarTexture } from '../avatars'
import { burst, floatText, punch } from '../fx'
import { bodyStyle, ensurePixelOrb, headlineStyle, hexToCss, shade } from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Lanes shorter than this go into two columns (a full room on a short landscape screen).
const MIN_LANE_H = 16
const MAX_PER_SEC = BUTTON_MASHER_MAX_PER_SEC
// The local press limiter's window: the server's rolling second plus a margin for network jitter, so
// a press this client counts is one the server counts too (bunched arrivals can't push it over).
const LOCAL_WINDOW_MS = 1080
// The rate under the speed gauge reads the presses (counted or not) of the last second.
const SPEED_WINDOW_MS = 1000
// A count shown ahead of the server is trusted this long after the last press; if the server still
// hasn't caught up by then, it dropped presses and its number wins.
const CONFIRM_MS = 600
const MAX_POP_EVERY_MS = 700
// Taking the lead plays a power-up sting at most this often (two close mashers swap it constantly).
const LEAD_STING_EVERY_MS = 2000

interface Lane {
  name: Phaser.GameObjects.Text
  count: Phaser.GameObjects.Text
  bar: Phaser.GameObjects.Rectangle
  track: Phaser.GameObjects.Rectangle
  // The player's avatar running at the head of their bar.
  runner: Phaser.GameObjects.Image
  left: number
  width: number
  // Name characters that fit left of the track (two columns leave no margin to spill into).
  nameChars: number
  // What the lane shows (player, count, bar length, stride, face): redrawn only when it changes.
  key: string
}

// Button Masher canvas: a giant arcade button to hammer (click / Space) plus a live "race" of every
// player's press count, drawn as lanes in their own colors (one per player, leader on top). One
// MINIGAME_INPUT per press. The server counts at most BUTTON_MASHER_MAX_PER_SEC presses a second, and
// the scene shows that cap instead of hiding it: a speed gauge beside the button fills with the presses
// of the last second and tops out at MAX, and presses over the cap aren't sent (the gauge flashes MAX
// instead of a dead "+1"). Your count goes up on the press itself; the server's snapshot confirms it.
export class ButtonMasherScene extends MiniGameScene<ButtonMasherSnapshot> {
  private countText?: Phaser.GameObjects.Text
  private button?: Phaser.GameObjects.Image
  private buttonKey = ''
  private buttonDownKey = ''
  private lanes: Lane[] = []
  private lanesTop = 0
  private lanesBottom = 0
  // The count on the button (yours: the server's, or ahead of it while presses are on their way).
  private shown = 0
  // Presses this client counted and sent, and when the last one went.
  private sent = 0
  private lastSentAt = 0
  // Local times of the presses counted (limiter) and of every press (speed gauge), oldest first.
  private counted: number[] = []
  private pressed: number[] = []
  private gauge?: Phaser.GameObjects.Graphics
  private gaugeBox = { x: 0, y: 0, w: 0, h: 0 }
  private gaugeLit = -1
  private maxLabel?: Phaser.GameObjects.Text
  private rateLabel?: Phaser.GameObjects.Text
  private lastMaxPop = 0
  // Whether this player led the race last frame, and when the lead sting last played.
  private leading = false
  private leadStingAt = Number.NEGATIVE_INFINITY

  constructor(...deps: SceneDeps) {
    super('button-masher', ...deps)
  }

  override create(): void {
    super.create()
    this.lanes = []
    this.shown = 0
    this.sent = 0
    this.lastSentAt = 0
    this.counted = []
    this.pressed = []
    this.gaugeLit = -1
    this.lastMaxPop = 0
    this.leading = false
    this.leadStingAt = Number.NEGATIVE_INFINITY
    const { width, height } = this.scale
    const cx = width / 2
    const top = this.top
    const compact = Math.min(width, height) < 520

    this.add
      .text(
        cx,
        top + 18,
        this.t('game.buttonMasher.mash'),
        headlineStyle(compact ? 24 : 40, PALETTE.amber),
      )
      .setOrigin(0.5, 0)

    // The button: a big chunky orb with a darker "pressed" twin swapped in on each hit.
    const d = Math.min(width * 0.42, (height - top) * 0.34)
    this.buttonKey = ensurePixelOrb(this, 'pp-masher-button', 22, PALETTE.red)
    this.buttonDownKey = ensurePixelOrb(this, 'pp-masher-button-down', 22, shade(PALETTE.red, -0.3))
    const buttonY = top + (height - top) * 0.36
    this.add
      .ellipse(cx, buttonY + d * 0.42, d * 0.95, d * 0.26, shade(PALETTE.bg, -0.4))
      .setAlpha(0.8)
    this.button = this.add.image(cx, buttonY, this.buttonKey).setDisplaySize(d, d)
    this.countText = this.add
      .text(
        cx,
        buttonY,
        '0',
        headlineStyle(compact ? 32 : 48, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 6,
        }),
      )
      .setOrigin(0.5)
      .setDepth(5)

    // Speed gauge right of the button: one segment per press a second, MAX on top, the rate below.
    const gw = compact ? 12 : 18
    const gh = Math.round(d * 0.8)
    this.gaugeBox = {
      x: Math.round(cx + d / 2 + (compact ? 22 : 40)),
      y: buttonY - gh / 2,
      w: gw,
      h: gh,
    }
    this.gauge = this.add.graphics()
    const labelX = this.gaugeBox.x + gw / 2
    this.maxLabel = this.add
      .text(
        labelX,
        this.gaugeBox.y - 8,
        this.t('game.buttonMasher.max'),
        headlineStyle(compact ? 8 : 16, PALETTE.dim),
      )
      .setOrigin(0.5, 1)
    this.rateLabel = this.add
      .text(labelX, this.gaugeBox.y + gh + 8, '0/s', headlineStyle(compact ? 8 : 16, PALETTE.dim))
      .setOrigin(0.5, 0)
    this.drawGauge(0, 0)

    // Race lanes: built on the first snapshot, which names the round's players.
    this.lanesTop = buttonY + d / 2 + (compact ? 18 : 28)
    this.lanesBottom = height - (compact ? 50 : 44)

    this.add
      .text(
        cx,
        height - 16,
        this.t('game.buttonMasher.hint', { n: MAX_PER_SEC }),
        bodyStyle(compact ? 12 : 16, PALETTE.dim, {
          align: 'center',
          wordWrap: { width: width * 0.92 },
        }),
      )
      .setOrigin(0.5, 1)

    this.input.on('pointerdown', () => this.mash())
    this.onKey('SPACE', () => this.mash())
  }

  // One lane per player, bar length relative to the current leader. They stack in one column while
  // lanes stay at least MIN_LANE_H tall, else they split into two side by side.
  private buildLanes(n: number): void {
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const avail = this.lanesBottom - this.lanesTop
    const cols = avail / n < MIN_LANE_H && width >= 640 ? 2 : 1
    const perCol = Math.ceil(n / cols)
    const laneH = Math.min(compact ? 20 : 26, avail / perCol)
    const colW = (width * (cols === 1 ? 0.76 : 0.94)) / cols
    const nameW = compact ? 70 : 110
    const countW = compact ? 40 : 50
    const font = compact || laneH < 20 ? 11 : 14
    const margin = cols === 1 ? (width - colW) / 2 : 0
    const nameChars = Math.floor((nameW - 10 + margin) / (font * 0.62))
    for (let i = 0; i < n; i++) {
      const left = (width - cols * colW) / 2 + Math.floor(i / perCol) * colW + nameW
      const laneWidth = colW - nameW - countW
      const y = this.lanesTop + (i % perCol) * laneH + laneH / 2
      const name = this.add.text(left - 10, y, '', bodyStyle(font, PALETTE.text)).setOrigin(1, 0.5)
      const track = this.add
        .rectangle(left, y, laneWidth, laneH * 0.6, PALETTE.panelAlt)
        .setOrigin(0, 0.5)
      const bar = this.add.rectangle(left, y, 0, laneH * 0.6, PALETTE.lime).setOrigin(0, 0.5)
      const count = this.add
        .text(left + laneWidth + 12, y, '', headlineStyle(compact || laneH < 20 ? 8 : 16))
        .setOrigin(0, 0.5)
      const runner = this.add
        .image(left, y + laneH * 0.3, ensureAvatarTexture(this, 'cat', PALETTE.dim, 1))
        .setOrigin(0.5, 1)
        .setDisplaySize(avatarPx(laneH), avatarPx(laneH))
        .setDepth(2)
      this.lanes.push({
        name,
        count,
        bar,
        track,
        runner,
        left,
        width: laneWidth,
        nameChars,
        key: '',
      })
    }
  }

  // Drops press times older than `windowMs` from the front of `times`.
  private static trim(times: number[], now: number, windowMs: number): void {
    while (times.length > 0 && (times[0] as number) <= now - windowMs) times.shift()
  }

  private mash(): void {
    if (!this.snap || this.snap.remainingMs <= 0 || !(this.selfId in this.snap.counts)) return
    const now = this.time.now
    ButtonMasherScene.trim(this.pressed, now, SPEED_WINDOW_MS)
    ButtonMasherScene.trim(this.counted, now, LOCAL_WINDOW_MS)
    this.pressed.push(now)
    if (this.button) {
      this.button.setTexture(this.buttonDownKey)
      punch(this, this.button, -0.08, 60)
      this.time.delayedCall(70, () => this.button?.setTexture(this.buttonKey))
    }
    if (this.counted.length >= MAX_PER_SEC) {
      // Over the cap: the server wouldn't count it, so it isn't sent — the gauge says why.
      this.sfx.tick()
      this.popMax(now)
      return
    }
    this.counted.push(now)
    this.sent++
    this.lastSentAt = now
    // A chunky arcade-button clack on every counted press.
    this.sfx.lock()
    this.sendInput({ kind: 'mash' })
    this.setShown(Math.max(this.shown, this.sent))
  }

  // The count on the button: a punch per press, a burst every 10.
  private setShown(n: number, quiet = false): void {
    if (n === this.shown) return
    const up = n > this.shown
    this.shown = n
    const text = this.countText
    if (!text) return
    text.setText(String(n))
    if (!up || quiet) return
    punch(this, text, 0.25)
    if (n % 10 === 0 && this.button) {
      const { x, y, displayWidth } = this.button
      burst(this, x, y, PALETTE.amber, 16)
      floatText(
        this,
        x + displayWidth * 0.35,
        y - displayWidth * 0.35,
        String(n),
        PALETTE.amber,
        16,
      )
    }
  }

  private popMax(now: number): void {
    if (now - this.lastMaxPop < MAX_POP_EVERY_MS || !this.maxLabel) return
    this.lastMaxPop = now
    punch(this, this.maxLabel, 0.35, 90)
  }

  // Segments lit = presses counted in the limiter's window (all red at the cap: further presses don't
  // count); the label under it is the raw rate, presses counted or not.
  private drawGauge(counted: number, rate: number): void {
    const lit = Math.min(MAX_PER_SEC, counted)
    this.rateLabel?.setText(`${rate}/s`)
    if (lit === this.gaugeLit || !this.gauge) return
    this.gaugeLit = lit
    const { x, y, w, h } = this.gaugeBox
    const gap = 2
    const segH = (h - gap * (MAX_PER_SEC - 1)) / MAX_PER_SEC
    const g = this.gauge.clear()
    for (let i = 0; i < MAX_PER_SEC; i++) {
      const color =
        i >= lit
          ? PALETTE.panelAlt
          : lit >= MAX_PER_SEC
            ? PALETTE.red
            : i >= MAX_PER_SEC * 0.66
              ? PALETTE.amber
              : PALETTE.lime
      g.fillStyle(color, 1)
      g.fillRect(x, Math.round(y + h - (i + 1) * segH - i * gap), w, Math.max(1, Math.round(segH)))
    }
    const atMax = lit >= MAX_PER_SEC
    this.maxLabel?.setColor(hexToCss(atMax ? PALETTE.red : PALETTE.dim))
    this.rateLabel?.setColor(hexToCss(atMax ? PALETTE.red : PALETTE.dim))
  }

  protected frame(snap: ButtonMasherSnapshot | null): void {
    if (!snap) return
    if (this.lanes.length === 0) this.buildLanes(Object.keys(snap.counts).length)
    const now = this.time.now
    const server = snap.counts[this.selfId] ?? 0
    // A relayout restart mid-round adopts the count silently (no burst for every press so far).
    if (this.firstSnapshot) {
      this.sent = server
      this.setShown(server, true)
    }
    // Ahead of the server only while presses are plausibly in flight, never once the round is over.
    if (server >= this.sent || snap.remainingMs <= 0 || now - this.lastSentAt > CONFIRM_MS)
      this.sent = server
    this.setShown(Math.max(server, this.sent))
    this.hud?.setScore(this.t('game.common.pts', { n: this.shown }))

    ButtonMasherScene.trim(this.pressed, now, SPEED_WINDOW_MS)
    ButtonMasherScene.trim(this.counted, now, LOCAL_WINDOW_MS)
    this.drawGauge(this.counted.length, this.pressed.length)
    this.renderLanes(snap)
  }

  // Taking the lead (alone at the top, mid-round) plays a power-up sting — throttled, never on the
  // first snapshot.
  private trackLead(ranked: string[], counts: (id: string) => number): void {
    const top = counts(ranked[0] ?? '')
    const leading =
      ranked[0] === this.selfId && top > 0 && counts(ranked[1] ?? '') < top && !this.state.final
    if (leading && !this.leading && !this.firstSnapshot) {
      const now = this.time.now
      if (now - this.leadStingAt >= LEAD_STING_EVERY_MS) {
        this.leadStingAt = now
        this.sfx.powerUp()
      }
    }
    this.leading = leading
  }

  private renderLanes(snap: ButtonMasherSnapshot): void {
    const counts = (id: string): number =>
      id === this.selfId ? this.shown : (snap.counts[id] ?? 0)
    const ranked = Object.keys(snap.counts).sort((a, b) => counts(b) - counts(a))
    const lead = Math.max(1, counts(ranked[0] ?? ''))
    this.trackLead(ranked, counts)
    const step = Math.floor(this.time.now / 110) % 2
    this.lanes.forEach((lane, i) => {
      const id = ranked[i]
      const n = id === undefined ? 0 : counts(id)
      const barW = Math.max(2, Math.round((n / lead) * lane.width))
      // Strides while mashing; the leader grins.
      const face = i === 0 && n > 0 ? 'happy' : 'idle'
      const key = id === undefined ? '' : `${id}:${n}:${barW}:${n > 0 ? step : 0}:${face}`
      if (key === lane.key) return
      lane.key = key
      const visible = id !== undefined
      for (const o of [lane.name, lane.runner, lane.count, lane.bar, lane.track])
        o.setVisible(visible)
      if (id === undefined) return
      const color = this.state.colorOf(id, PALETTE.lime)
      lane.name.setText(this.label(id).slice(0, lane.nameChars)).setColor(hexToCss(color))
      lane.count.setText(String(n))
      lane.bar.setFillStyle(color).setSize(barW, lane.bar.height)
      lane.runner
        .setTexture(
          ensureAvatarTexture(
            this,
            this.state.avatarOf(id),
            color,
            1,
            'side',
            face,
            (n > 0 ? step : 0) as 0 | 1,
          ),
        )
        .setX(lane.left + barW)
      lane.track.setStrokeStyle(id === this.selfId ? 2 : 0, PALETTE.text)
    })
  }
}
