import { PALETTE, type StopClockSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import { addBanner, burst, floatText, punch, ring, shake, showBanner } from '../fx'
import { bodyStyle, ensureBevelPanel, headlineStyle, hexToCss, shade } from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const PERIOD_MS = 1500
const TRAIL = 4
// The everyone strip (PlayerStrip) rebuilds every chip from scratch on any change — new Text objects,
// each measuring its font again — which cost a frame per snapshot once a full room was playing. It
// follows the standings at most twice a second; your own progress in the HUD stays immediate.
const STRIP_EVERY_MS = 500
// A create() within this long of the scene's own shutdown is a relayout restart mid-round (a new round
// only starts seconds after the previous one stopped) — the one case where a memo may carry over.
const RELAYOUT_GAP_MS = 1000
// Cosmetic judgement of one stop's error (the server just sums the raw error).
const GRADES: readonly [number, string, number][] = [
  [0.02, 'game.common.perfect', PALETTE.amber],
  [0.06, 'game.common.great', PALETTE.lime],
  [0.15, 'game.common.good', PALETTE.cyan],
]

interface Card {
  box: Phaser.GameObjects.Rectangle
  text: Phaser.GameObjects.Text
}

function grade(err: number): [string, number] | undefined {
  const g = GRADES.find(([limit]) => err < limit)
  return g ? [g[1], g[2]] : undefined
}

// Stop the Clock (timing) canvas. A needle sweeps a ruler-marked gauge (triangle wave, animated
// locally); hit STOP (click/tap, Space or Enter) to lock it on the flagged green target. The reported
// position goes to the server, which scores the absolute error. Each stop leaves a pin + gap bracket
// and a graded pop; three result cards track every attempt's error, and everyone's tries/error run
// along the top (a player strip, so a full room never pushes the prompt into the gauge).
export class StopClockScene extends MiniGameScene<StopClockSnapshot> {
  private status?: Phaser.GameObjects.Text
  private needle?: Phaser.GameObjects.Graphics
  private target?: Phaser.GameObjects.Container
  private button?: Phaser.GameObjects.Image
  private buttonLabel?: Phaser.GameObjects.Text
  private banner?: Phaser.GameObjects.Text
  private cards: Card[] = []
  private strip?: PlayerStrip
  private stripSnap?: StopClockSnapshot
  private labelsSnap?: StopClockSnapshot
  private stripAt = 0
  private cardsKey = ''
  private keyHint?: Phaser.GameObjects.Text
  private keys = { up: '', down: '' }
  private gauge = { left: 0, width: 0, y: 0, h: 0 }
  private trail: number[] = []
  private lastAttempt = -1
  private lastError = 0
  private pendingAttempt = -1
  // Per-attempt errors already on the cards, kept across a relayout restart (create() clears it only
  // for a fresh round) — the snapshot only carries the running total, so they can't be rebuilt.
  private errMemo: { round: number; errs: number[] } = { round: -1, errs: [] }
  private stoppedAt = Number.NEGATIVE_INFINITY

  constructor(...deps: SceneDeps) {
    super('stop-clock', ...deps)
  }

  override create(): void {
    super.create()
    this.cards = []
    this.trail = []
    this.lastAttempt = -1
    this.lastError = 0
    this.pendingAttempt = -1
    this.stripSnap = undefined
    this.labelsSnap = undefined
    this.stripAt = 0
    this.keyHint = undefined
    this.cardsKey = ''
    if (this.game.getTime() - this.stoppedAt > RELAYOUT_GAP_MS)
      this.errMemo = { round: -1, errs: [] }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stoppedAt = this.game.getTime()
    })
    const { width, height } = this.scale
    const cx = width / 2
    const compact = Math.min(width, height) < 520
    // A big canvas (1080p) gets a longer, taller gauge and bigger readouts.
    const big = width >= 1400 && height >= 860
    // Everyone's chips read from the couch on a big (1080p) canvas.
    const stripSize = compact ? 11 : width >= 1400 && height >= 860 ? 16 : 13
    const stripRows = width < 600 ? 3 : 2
    const stripH = PlayerStrip.rowH(stripSize)
    this.strip = new PlayerStrip(
      this,
      cx,
      this.top + 2 + stripH / 2,
      width - 24,
      stripSize,
      stripRows,
    )

    const promptY = this.top + 2 + stripRows * stripH + (compact ? 10 : 16)
    const promptH = compact ? 18 : 24
    this.status = this.add
      .text(
        cx,
        promptY,
        this.t('game.stopClock.prompt'),
        bodyStyle(compact ? 14 : big ? 22 : 18, PALETTE.text, { align: 'center' }),
      )
      .setOrigin(0.5, 0)

    // The gauge: beveled track, ruler ticks, flagged target, sweeping needle.
    const gw = Math.round(Math.min(width * 0.86, big ? 1360 : 900))
    const gh = Math.round(compact ? 64 : big ? 120 : 88)
    // Never above the prompt + the target's pennant (16 px over the track) + the bevel.
    const gy = Math.round(
      Math.max(this.top + (height - this.top) * 0.36, promptY + promptH + 22 + gh / 2 + 6),
    )
    this.gauge = { left: cx - gw / 2, width: gw, y: gy, h: gh }
    this.add.image(cx, gy, ensureBevelPanel(this, gw + 12, gh + 12, PALETTE.frame, 4))
    this.add.rectangle(cx, gy, gw, gh, PALETTE.bg)
    const ruler = this.add.graphics()
    for (let i = 0; i <= 20; i++) {
      const x = Math.round(this.gauge.left + (i / 20) * gw)
      const major = i % 5 === 0
      ruler.fillStyle(major ? PALETTE.frameLit : PALETTE.frame, 1)
      ruler.fillRect(x - 1, gy + gh / 2 - (major ? 16 : 8), 2, major ? 16 : 8)
      ruler.fillRect(x - 1, gy - gh / 2, 2, major ? 10 : 5)
    }

    const band = Math.max(8, gw * 0.05)
    const flag = this.add.graphics()
    flag.fillStyle(PALETTE.lime, 0.22).fillRect(-band / 2, -gh / 2, band, gh)
    flag.fillStyle(PALETTE.lime, 1).fillRect(-2, -gh / 2, 4, gh)
    // Down-pointing pixel pennant above the track.
    for (let r = 0; r < 5; r++) flag.fillRect(-(5 - r) * 2, -gh / 2 - 16 + r * 3, (5 - r) * 4, 3)
    this.target = this.add.container(this.gauge.left + gw / 2, gy, [flag]).setDepth(2)
    this.needle = this.add.graphics().setDepth(3)

    // Per-attempt result cards under the gauge.
    const cardW = Math.min(compact ? 84 : big ? 200 : 150, (gw - 24) / 3)
    const cardH = compact ? 40 : big ? 64 : 52
    const cardY = gy + gh / 2 + (compact ? 44 : 60)
    for (let i = 0; i < 3; i++) {
      const x = cx + (i - 1) * (cardW + 12)
      const box = this.add
        .rectangle(x, cardY, cardW, cardH, PALETTE.panel)
        .setStrokeStyle(2, PALETTE.frame)
      const text = this.add
        .text(
          x,
          cardY,
          '—',
          headlineStyle(compact ? 12 : big ? 24 : 16, PALETTE.dim, { align: 'center' }),
        )
        .setOrigin(0.5)
      this.cards.push({ box, text })
    }

    // The STOP button: a big red arcade key with a pressed twin; on keyboard screens the keys are named
    // right under it.
    const bw = Math.round(Math.min(width * 0.7, 440))
    const bh = Math.round(compact ? 96 : 110)
    const by = height - bh / 2 - (compact ? 16 : 24) - (compact ? 0 : 26)
    if (!compact) {
      this.keyHint = this.add
        .text(cx, height - 8, this.t('game.stopClock.keys'), bodyStyle(16))
        .setOrigin(0.5, 1)
    }
    this.keys = {
      up: ensureBevelPanel(this, bw, bh, PALETTE.red, 8),
      down: ensureBevelPanel(this, bw, bh, shade(PALETTE.red, -0.3), 8),
    }
    this.button = this.add.image(cx, by, this.keys.up).setInteractive({ useHandCursor: true })
    this.button.on('pointerdown', () => this.stop())
    this.buttonLabel = this.add
      .text(
        cx,
        by,
        this.t('game.stopClock.stop'),
        headlineStyle(compact ? 24 : 32, PALETTE.text, { stroke: '#10121c', strokeThickness: 6 }),
      )
      .setOrigin(0.5)
    this.onKey('SPACE', () => this.stop())
    this.onKey('ENTER', () => this.stop())

    this.banner = addBanner(this)
    this.banner
      .setFontSize(compact ? 24 : 34)
      .setWordWrapWidth(width * 0.9)
      .setY(gy)
  }

  // Triangle sweep 0..1..0 over PERIOD_MS, driven by the scene clock.
  private needlePos(): number {
    const phase = (this.time.now % PERIOD_MS) / PERIOD_MS
    return phase < 0.5 ? phase * 2 : 2 - phase * 2
  }

  private gaugeX(pos: number): number {
    return this.gauge.left + pos * this.gauge.width
  }

  private stop(): void {
    const snap = this.snap
    // A spectator (not in this round) has no tries.
    if (!snap || snap.remainingMs <= 0 || !(this.selfId in snap.attemptsDone)) return
    const attempt = snap.attemptsDone[this.selfId] ?? 0
    // Still waiting for the server to take the previous stop: a second tap would be dropped anyway.
    if (attempt >= snap.attempts || attempt === this.pendingAttempt) return
    const pos = this.needlePos()
    this.pendingAttempt = attempt
    // The needle clunks to a stop on the press itself; its grade sounds on top (pinFeedback).
    this.sfx.lock()
    this.sendInput({ kind: 'stop', attempt, pos })
    if (this.button) {
      this.button.setTexture(this.keys.down)
      punch(this, this.button, -0.06, 60)
      this.time.delayedCall(90, () => this.button?.setTexture(this.keys.up))
    }
    this.pinFeedback(pos, snap.targets[attempt] ?? 0.5)
  }

  // A pin where the needle stopped, a bracket to the target and a graded pop — instant and local
  // (same |pos - target| the server scores); the result card fills in from the snapshot.
  private pinFeedback(pos: number, target: number): void {
    const { y, h } = this.gauge
    const px = this.gaugeX(pos)
    const tx = this.gaugeX(target)
    const err = Math.abs(pos - target)
    const g = this.add.graphics().setDepth(4)
    g.fillStyle(PALETTE.text, 1).fillRect(px - 2, y - h / 2 - 6, 4, h + 12)
    g.fillStyle(PALETTE.amber, 1)
    const left = Math.min(px, tx)
    g.fillRect(left, y + h / 2 + 8, Math.max(2, Math.abs(px - tx)), 3)
    g.fillRect(left, y + h / 2 + 4, 2, 8).fillRect(
      left + Math.abs(px - tx) - 2,
      y + h / 2 + 4,
      2,
      8,
    )
    this.tweens.add({
      targets: g,
      alpha: 0,
      delay: 700,
      duration: 300,
      onComplete: () => g.destroy(),
    })

    const graded = grade(err)
    const label = graded ? this.t(graded[0]) : this.t('game.stopClock.off', { err: err.toFixed(2) })
    const size = this.scale.width < 520 ? 16 : 24
    const half = (label.length * size) / 2 + 12
    const fx = Math.max(half, Math.min(this.scale.width - half, px))
    floatText(this, fx, y - h / 2 - 24, label, graded?.[1] ?? PALETTE.red, size)
    if (!graded) {
      this.sfx.wrong()
      shake(this, 0.006, 140)
      return
    }
    // Perfect rings the jackpot, great chimes; a merely good stop is just the clunk.
    if (err < 0.06) {
      if (err < 0.02) this.sfx.coin()
      else this.sfx.correct()
      ring(this, px, y, graded[1], h * 0.8)
      if (err < 0.02) burst(this, px, y, PALETTE.amber, 20, 240)
    }
  }

  protected frame(snap: StopClockSnapshot | null): void {
    if (!snap) return
    const spectator = !(this.selfId in snap.attemptsDone)
    const attempt = snap.attemptsDone[this.selfId] ?? 0
    const done = spectator || attempt >= snap.attempts
    const totalError = snap.totalError[this.selfId] ?? 0
    if (attempt > this.pendingAttempt) this.pendingAttempt = -1
    this.onAttemptChange(snap, attempt, totalError)
    this.renderCards(done ? snap.attempts : attempt, snap.attempts)
    if (snap !== this.stripSnap && (this.time.now >= this.stripAt || this.state.final)) {
      this.stripSnap = snap
      this.stripAt = this.time.now + STRIP_EVERY_MS
      this.renderChips(snap)
    }
    // Tries, errors and the labels only change with a snapshot.
    if (snap !== this.labelsSnap) {
      this.labelsSnap = snap
      this.hud?.setScore(
        this.t('game.stopClock.try', {
          n: Math.min(attempt + 1, snap.attempts),
          total: snap.attempts,
        }),
      )
      this.status?.setText(
        this.t(
          spectator
            ? 'game.common.waiting'
            : done
              ? 'game.stopClock.done'
              : 'game.stopClock.prompt',
        ),
      )
      this.button?.setAlpha(done ? 0.3 : 1)
      this.buttonLabel?.setText(this.t(done ? 'game.stopClock.doneBtn' : 'game.stopClock.stop'))
      this.keyHint?.setVisible(!done)
      if (done && !spectator && this.banner) {
        showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.lime)
      }
    }

    // Needle with a short motion trail; parked (hidden) once every try is used.
    const g = this.needle?.clear()
    if (g && !done) {
      const x = this.gaugeX(this.needlePos())
      this.trail.unshift(x)
      this.trail.length = Math.min(this.trail.length, TRAIL + 1)
      const { y, h } = this.gauge
      for (let i = 1; i < this.trail.length; i++) {
        const tx = this.trail[i] ?? x
        g.fillStyle(PALETTE.amber, 0.35 - (i - 1) * 0.08).fillRect(tx - 2, y - h / 2, 4, h)
      }
      g.fillStyle(shade(PALETTE.amber, -0.5), 1).fillRect(x - 4, y - h / 2 - 8, 8, h + 16)
      g.fillStyle(PALETTE.amber, 1).fillRect(x - 2, y - h / 2 - 6, 4, h + 12)
      g.fillRect(x - 7, y - h / 2 - 10, 14, 4).fillRect(x - 7, y + h / 2 + 6, 14, 4)
    }
  }

  // The server took a stop: record its error on the card and slide the flag to the next target.
  private onAttemptChange(snap: StopClockSnapshot, attempt: number, totalError: number): void {
    if (attempt === this.lastAttempt) return
    const first = this.lastAttempt < 0
    if (first && this.errMemo.round === this.state.round) {
      // Relayout restart: put the attempts already taken back on their cards.
      this.errMemo.errs.forEach((err, i) => {
        if (i < attempt) this.showCardError(i, err)
      })
    }
    if (!first && attempt > this.lastAttempt) {
      const err = totalError - this.lastError
      const card = this.showCardError(attempt - 1, err)
      if (card) punch(this, card.text, 0.3, 100)
      if (this.errMemo.round !== this.state.round)
        this.errMemo = { round: this.state.round, errs: [] }
      this.errMemo.errs[attempt - 1] = err
    }
    this.lastAttempt = attempt
    this.lastError = totalError
    const target = snap.targets[Math.min(attempt, snap.targets.length - 1)] ?? 0.5
    if (!this.target) return
    this.tweens.killTweensOf(this.target)
    if (first) this.target.setX(this.gaugeX(target))
    else
      this.tweens.add({ targets: this.target, x: this.gaugeX(target), duration: 220, delay: 500 })
  }

  private showCardError(i: number, err: number): Card | undefined {
    const card = this.cards[i]
    card?.text.setText(err.toFixed(2)).setColor(hexToCss(grade(err)?.[1] ?? PALETTE.red))
    return card
  }

  private renderCards(attempt: number, attempts: number): void {
    const blink = Math.floor(this.time.now / 300) % 2 === 0
    const key = `${attempt}:${blink}`
    if (key === this.cardsKey) return
    this.cardsKey = key
    this.cards.forEach((card, i) => {
      const live = i === attempt && attempt < attempts
      card.box.setStrokeStyle(2, live && blink ? PALETTE.amber : PALETTE.frame)
    })
  }

  // Everyone: name, tries used (■) / left (□) and the running error. The tries and the error are joined
  // by a no-break space so the strip treats them as one trailing stat (clipping names, never them).
  private renderChips(snap: StopClockSnapshot): void {
    this.strip?.set(
      Object.keys(snap.attemptsDone).map((id) => {
        const used = Math.min(snap.attempts, snap.attemptsDone[id] ?? 0)
        const tries = '■'.repeat(used) + '□'.repeat(snap.attempts - used)
        const err = (snap.totalError[id] ?? 0).toFixed(2)
        return {
          text: `${this.label(id)} ${tries}\u00a0${err}`,
          avatar: this.state.avatarOf(id),
          color: this.state.colorOf(id),
        }
      }),
    )
  }
}
