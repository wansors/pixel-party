import { PALETTE, STOP_CLOCK, type StopClockSnapshot, stopClockTimeoutMs } from '@pp/shared'
import type Phaser from 'phaser'
import { addBanner, burst, floatText, punch, ring, shake, showBanner } from '../fx'
import {
  bodyStyle,
  ensureBevelPanel,
  fitFontSize,
  fitText,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// The everyone strip (PlayerStrip) rebuilds every chip on any change; it follows the standings at most
// twice a second.
const STRIP_EVERY_MS = 500
// Cosmetic judgement of one stop's error, in seconds (the server just sums the raw error).
const GRADES: readonly [number, string, number][] = [
  [0.05, 'game.common.perfect', PALETTE.amber],
  [0.15, 'game.common.great', PALETTE.lime],
  [0.35, 'game.common.good', PALETTE.cyan],
]
const LCD = 0x1c2a1c
const LCD_INK = 0x9be36b

type Phase = 'wait' | 'ready' | 'run' | 'reveal' | 'done'

interface Card {
  box: Phaser.GameObjects.Rectangle
  text: Phaser.GameObjects.Text
}

function grade(err: number): [string, number] | undefined {
  const g = GRADES.find(([limit]) => err < limit)
  return g ? [g[1], g[2]] : undefined
}

// Stop the Clock canvas (D55): a blind stopwatch. Each try names a whole number of seconds ("STOP AT
// 7 s"); after a GET READY (no countdown — no rhythm to lean on) the stopwatch starts with GO! and
// shows nothing but "??.??": no needle, no bar, no ticking. Hit STOP (Space / Enter / the big red key)
// when you feel the time has come; only then the display shows the time you made and how far off it
// was, graded. The stopwatch runs on this device (performance.now(), not the frame clock), the time
// goes to the server, which scores the error. Three cards keep each try (target and time), everyone's
// tries and running error run along the top. Silence on purpose: the round has no music (a beat would
// be a metronome).
export class StopClockScene extends MiniGameScene<StopClockSnapshot> {
  private strip?: PlayerStrip
  private stripSnap?: StopClockSnapshot
  private stripAt = 0
  private prompt?: Phaser.GameObjects.Text
  private display?: Phaser.GameObjects.Text
  private sub?: Phaser.GameObjects.Text
  private cards: Card[] = []
  private cardsKey = ''
  private button?: Phaser.GameObjects.Image
  private buttonLabel?: Phaser.GameObjects.Text
  private keyHint?: Phaser.GameObjects.Text
  private banner?: Phaser.GameObjects.Text
  private keys = { up: '', down: '' }
  private face = { x: 0, y: 0, r: 0 }
  private compact = false
  private phase: Phase = 'wait'
  // The try on screen, when its phase ends (performance.now() ms) and when its stopwatch started.
  private attempt = 0
  private phaseUntil = 0
  private goAt = 0

  constructor(...deps: SceneDeps) {
    super('stop-clock', ...deps)
  }

  override create(): void {
    super.create()
    this.cards = []
    this.cardsKey = ''
    this.stripSnap = undefined
    this.stripAt = 0
    this.keyHint = undefined
    this.phase = 'wait'
    this.attempt = 0
    this.phaseUntil = 0
    this.goAt = 0

    const { width, height } = this.scale
    const cx = width / 2
    this.compact = Math.min(width, height) < 520
    const compact = this.compact
    const big = width >= 1400 && height >= 860
    const stripSize = compact ? 11 : big ? 16 : 13
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

    // The ask, the stopwatch, the line under it, the try cards, the STOP key.
    const promptY = this.top + 2 + stripRows * stripH + (compact ? 14 : 22)
    this.prompt = this.add
      .text(cx, promptY, '', headlineStyle(compact ? 16 : big ? 32 : 24, PALETTE.amber))
      .setOrigin(0.5, 0)
    const bh = Math.round(compact ? 88 : 104)
    const by = height - bh / 2 - (compact ? 16 : 24) - (compact ? 0 : 26)
    const cardH = compact ? 44 : big ? 72 : 56
    const cardY = by - bh / 2 - (compact ? 16 : 24) - cardH / 2
    const subH = compact ? 20 : 28
    const faceTop = promptY + (compact ? 30 : 44)
    const faceBottom = cardY - cardH / 2 - subH - (compact ? 10 : 18)
    const r = Math.max(48, Math.min((faceBottom - faceTop) / 2.2, width * 0.3, big ? 220 : 170))
    this.face = { x: cx, y: faceTop + (faceBottom - faceTop) / 2 + r * 0.1, r }
    this.paintStopwatch()
    this.display = this.add
      .text(
        cx,
        this.face.y,
        '--.--',
        // Five glyphs ("??.??", "--.--", "12.34") always fit inside the LCD window.
        headlineStyle(
          fitFontSize('??.??', r * 1.15, Math.max(16, Math.round((r * 0.42) / 8) * 8)),
          LCD_INK,
        ),
      )
      .setOrigin(0.5)
      .setDepth(3)
    this.sub = this.add
      .text(
        cx,
        this.face.y + r + subH / 2 + (compact ? 6 : 10),
        '',
        bodyStyle(compact ? 14 : big ? 22 : 18, PALETTE.text, { align: 'center' }),
      )
      .setOrigin(0.5)

    const cardW = Math.min(compact ? 100 : big ? 220 : 170, (width - 48) / 3)
    for (let i = 0; i < STOP_CLOCK.attempts; i++) {
      const x = cx + (i - 1) * (cardW + 12)
      const box = this.add
        .rectangle(x, cardY, cardW, cardH, PALETTE.panel)
        .setStrokeStyle(2, PALETTE.frame)
      const text = this.add
        .text(
          x,
          cardY,
          '—',
          headlineStyle(compact ? 8 : big ? 16 : 12, PALETTE.dim, { align: 'center' }),
        )
        .setOrigin(0.5)
        .setLineSpacing(compact ? 4 : 8)
      this.cards.push({ box, text })
    }

    const bw = Math.round(Math.min(width * 0.7, 440))
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
    this.button.on('pointerdown', () => this.press())
    this.buttonLabel = this.add
      .text(
        cx,
        by,
        this.t('game.stopClock.stop'),
        headlineStyle(compact ? 24 : 32, PALETTE.text, { stroke: '#10121c', strokeThickness: 6 }),
      )
      .setOrigin(0.5)
    this.onKey('SPACE', () => this.press())
    this.onKey('ENTER', () => this.press())
    this.banner = addBanner(this)
    this.banner.setFontSize(compact ? 24 : 34).setY(this.face.y)
  }

  // A chunky pixel stopwatch: crown and side button, a steel rim, an LCD window in the middle.
  private paintStopwatch(): void {
    const { x, y, r } = this.face
    const g = this.add.graphics().setDepth(1)
    const px = Math.max(3, Math.round(r / 24))
    // Crown + side push button.
    g.fillStyle(shade(PALETTE.frameLit, -0.3), 1)
    g.fillRect(x - r * 0.16, y - r - px * 6, r * 0.32, px * 4)
    g.fillRect(x - r * 0.07, y - r - px * 3, r * 0.14, px * 3)
    g.fillRect(x + r * 0.62, y - r * 0.86, px * 4, px * 4)
    // Rim and face.
    g.fillStyle(shade(PALETTE.frameLit, -0.45), 1).fillCircle(x, y, r + px * 2)
    g.fillStyle(PALETTE.frameLit, 1).fillCircle(x, y, r)
    g.fillStyle(PALETTE.panel, 1).fillCircle(x, y, r - px * 2)
    // Hour ticks around the dial (decoration only: no hand ever moves).
    g.fillStyle(PALETTE.frame, 1)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const tx = x + Math.cos(a) * (r - px * 5)
      const ty = y + Math.sin(a) * (r - px * 5)
      g.fillRect(tx - px / 2, ty - px / 2, px * (i % 3 === 0 ? 2 : 1), px * (i % 3 === 0 ? 2 : 1))
    }
    // The LCD window.
    const w = r * 1.3
    const h = r * 0.62
    g.fillStyle(shade(LCD, -0.5), 1).fillRect(
      x - w / 2 - px,
      y - h / 2 - px,
      w + px * 2,
      h + px * 2,
    )
    g.fillStyle(LCD, 1).fillRect(x - w / 2, y - h / 2, w, h)
  }

  private secs(ms: number): string {
    const dec = this.t('room.stat.decimal')
    return (ms / 1000).toFixed(2).replace('.', dec === ',' ? ',' : '.')
  }

  private target(snap: StopClockSnapshot, attempt: number): number {
    return snap.targets[Math.min(attempt, snap.targets.length - 1)] ?? 5
  }

  private startReady(snap: StopClockSnapshot): void {
    this.phase = 'ready'
    this.phaseUntil = performance.now() + STOP_CLOCK.readyMs
    const s = this.target(snap, this.attempt)
    this.prompt?.setText(this.t('game.stopClock.target', { s }))
    if (this.prompt) fitText(this.prompt, this.scale.width - 24, this.compact ? 16 : 24)
    this.display?.setText('--.--').setColor(hexToCss(shade(LCD_INK, -0.4)))
    this.sub?.setText(this.t('game.stopClock.ready')).setColor(hexToCss(PALETTE.dim))
    this.button?.setAlpha(0.5)
  }

  private go(snap: StopClockSnapshot): void {
    this.phase = 'run'
    this.goAt = this.phaseUntil
    this.sfx.go()
    this.display?.setText('??.??').setColor(hexToCss(LCD_INK))
    if (this.display) punch(this, this.display, 0.15, 90)
    this.sub
      ?.setText(this.t('game.stopClock.running', { s: this.target(snap, this.attempt) }))
      .setColor(hexToCss(PALETTE.text))
    this.button?.setAlpha(1)
  }

  private press(): void {
    if (this.phase !== 'run') return
    this.stopAt(performance.now() - this.goAt, false)
  }

  // Stops the try at `ms` on the hidden stopwatch: off to the server, and the reveal here at once.
  private stopAt(ms: number, timedOut: boolean): void {
    const snap = this.snap
    if (!snap) return
    const attempt = this.attempt
    const time = Math.round(ms)
    this.sendInput({ kind: 'stop', attempt, ms: time })
    this.phase = 'reveal'
    this.phaseUntil = performance.now() + STOP_CLOCK.revealMs
    this.sfx.lock()
    if (this.button) {
      this.button.setTexture(this.keys.down)
      punch(this, this.button, -0.06, 60)
      this.time.delayedCall(90, () => this.button?.setTexture(this.keys.up))
      this.button.setAlpha(0.5)
    }
    const target = this.target(snap, attempt)
    const diff = time / 1000 - target
    const err = Math.abs(diff)
    const graded = timedOut ? undefined : grade(err)
    const color = graded?.[1] ?? PALETTE.red
    this.display?.setText(this.secs(time)).setColor(hexToCss(color))
    if (this.display) punch(this, this.display, 0.25, 110)
    const sign = diff >= 0 ? '+' : '−'
    this.sub
      ?.setText(
        timedOut
          ? this.t('game.stopClock.timedOut')
          : this.t('game.stopClock.off', { err: `${sign}${this.secs(err * 1000)}` }),
      )
      .setColor(hexToCss(color))
    const { x, y, r } = this.face
    const label = graded
      ? this.t(graded[0])
      : this.t(diff > 0 ? 'game.stopClock.late' : 'game.stopClock.early')
    floatText(this, x, y - r - (this.compact ? 14 : 22), label, color, this.compact ? 16 : 24)
    if (!graded) {
      this.sfx.wrong()
      shake(this, 0.006, 140)
      return
    }
    if (err < 0.15) {
      if (err < 0.05) this.sfx.coin()
      else this.sfx.correct()
      ring(this, x, y, color, r * 1.1)
      if (err < 0.05) burst(this, x, y, PALETTE.amber, 20, 240)
    }
  }

  protected frame(snap: StopClockSnapshot | null): void {
    if (!snap) return
    const spectator = !(this.selfId in snap.attemptsDone)
    const taken = snap.attemptsDone[this.selfId] ?? 0
    const now = performance.now()
    if (this.phase === 'wait') {
      // First snapshot (or a relayout restart mid-round): pick up at the try the server is on.
      this.attempt = taken
      if (spectator || taken >= snap.attempts) this.finish(spectator)
      else this.startReady(snap)
    }
    if (this.state.final || snap.remainingMs <= 0) {
      if (this.phase !== 'done') this.finish(spectator)
    } else if (this.phase === 'ready' && now >= this.phaseUntil) this.go(snap)
    else if (this.phase === 'run') {
      const timeout = stopClockTimeoutMs(this.target(snap, this.attempt))
      if (now - this.goAt >= timeout) this.stopAt(timeout, true)
    } else if (this.phase === 'reveal' && now >= this.phaseUntil) {
      this.attempt += 1
      if (this.attempt >= snap.attempts) this.finish(false)
      else this.startReady(snap)
    }
    this.hud?.setScore(
      this.t('game.stopClock.try', {
        n: Math.min(this.attempt + 1, snap.attempts),
        total: snap.attempts,
      }),
    )
    this.renderCards(snap)
    if (snap !== this.stripSnap && (this.time.now >= this.stripAt || this.state.final)) {
      this.stripSnap = snap
      this.stripAt = this.time.now + STRIP_EVERY_MS
      this.renderChips(snap)
    }
  }

  private finish(spectator: boolean): void {
    this.phase = 'done'
    this.button?.setAlpha(0.3)
    this.buttonLabel?.setText(this.t('game.stopClock.doneBtn'))
    this.keyHint?.setVisible(false)
    this.prompt?.setText('')
    this.sub
      ?.setText(this.t(spectator ? 'game.common.waiting' : 'game.stopClock.done'))
      .setColor(hexToCss(PALETTE.dim))
    if (!spectator && this.banner)
      showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.lime)
  }

  // Each try: its target and the time you stopped at (from the server's word), graded by colour; the
  // live try's card blinks.
  private renderCards(snap: StopClockSnapshot): void {
    const times = snap.times[this.selfId] ?? []
    const blink = Math.floor(this.time.now / 300) % 2 === 0
    const live = this.phase === 'done' ? -1 : this.attempt
    const key = `${times.join(',')}:${live}:${blink}`
    if (key === this.cardsKey) return
    this.cardsKey = key
    this.cards.forEach((card, i) => {
      const target = snap.targets[i] ?? 0
      const time = times[i]
      card.box.setStrokeStyle(2, i === live && blink ? PALETTE.amber : PALETTE.frame)
      if (time === undefined) {
        card.text.setText(`${target} s\n—`).setColor(hexToCss(PALETTE.dim))
        return
      }
      const err = Math.abs(time / 1000 - target)
      card.text
        .setText(`${target} s\n${this.secs(time)}`)
        .setColor(hexToCss(grade(err)?.[1] ?? PALETTE.red))
    })
  }

  // Everyone: name, tries used (■) / left (□) and the running error. The tries and the error are joined
  // by a no-break space so the strip treats them as one trailing stat (clipping names, never them).
  private renderChips(snap: StopClockSnapshot): void {
    this.strip?.set(
      Object.keys(snap.attemptsDone).map((id) => {
        const used = Math.min(snap.attempts, snap.attemptsDone[id] ?? 0)
        const tries = '■'.repeat(used) + '□'.repeat(snap.attempts - used)
        const err = this.secs((snap.totalError[id] ?? 0) * 1000)
        return {
          text: `${this.label(id)} ${tries} ${err}`,
          avatar: this.state.avatarOf(id),
          color: this.state.colorOf(id),
        }
      }),
    )
  }
}
