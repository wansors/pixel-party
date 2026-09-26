import { MINIGAMES_BY_ID, PALETTE, type PixelBeatSnapshot } from '@pp/shared'
import type Phaser from 'phaser'
import { burst, floatText, punch, ring, shake } from '../fx'
import {
  bodyStyle,
  ensurePixelGrid,
  ensurePixelOrb,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const HORIZON_MS = 1500
// How long a note stays visible after passing the hit ring (it slides on and fades out).
const TAIL_MS = 220
const NOTE_POOL = 8
// A tap the server hasn't credited within this long (one snapshot + a LAN round trip) was a miss.
const MISS_TIMEOUT_MS = 300
// Beats crossed more than this late (a frame hitch) don't pulse — no burst of catch-up pulses.
const PULSE_WINDOW_MS = 120
// Mirrors the server's pixelBeat.ts PERFECT_POINTS / GOOD_POINTS, to name the credit a tap earned.
const PERFECT_POINTS = 3
const GOOD_POINTS = 1

// Hollow pixel ring (the hit target), `d` cells across, 2 cells thick.
function ringRows(d: number): string[] {
  const r = d / 2
  const rows: string[] = []
  for (let y = 0; y < d; y++) {
    let row = ''
    for (let x = 0; x < d; x++) {
      const dist = Math.hypot(x + 0.5 - r, y + 0.5 - r)
      row += dist <= r && dist > r - 1.1 ? 'o' : dist <= r - 1.1 && dist > r - 2.2 ? 'i' : '_'
    }
    rows.push(row)
  }
  return rows
}

// Stable 0..1 hash so every client draws the same equalizer bounce for the same beat.
function hash01(a: number, b: number): number {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return v - Math.floor(v)
}

interface Chip {
  id: string
  text: Phaser.GameObjects.Text
  key: string
}

// Pixel Beat canvas: a rhythm highway. Notes (the shared seeded beat timeline) slide in from the
// right to a pixel hit ring; tap anywhere or hit Space as one crosses it. The ring, lane and an
// equalizer pulse on every beat (with a soft metronome tick), and each credited tap pops PERFECT /
// GOOD from the server's score delta (MISS when it never gets credited). The round's start is
// anchored from the snapshot's remainingMs + the catalog duration, so notes line up with the
// server's clock rather than with whenever the first snapshot happened to land. Scoring stays
// entirely server-side.
export class PixelBeatScene extends MiniGameScene<PixelBeatSnapshot> {
  private hitRing?: Phaser.GameObjects.Image
  private lane?: Phaser.GameObjects.Rectangle
  private streakText?: Phaser.GameObjects.Text
  private eq?: Phaser.GameObjects.Graphics
  private notes: Phaser.GameObjects.Image[] = []
  private chips: Chip[] = []
  private levels: number[] = []
  private pending: number[] = []
  private layout = { hitX: 0, laneEnd: 0, laneY: 0, laneH: 0, eqTop: 0, eqBottom: 0 }
  private startLocal = Number.POSITIVE_INFINITY
  private lastTick = -1
  private beatsPassed = 0
  private prevScore = 0
  private prevStreak = 0
  // The first snapshot only seeds the score/streak baseline (a rejoin mustn't pop old credits).
  private primed = false
  private streakSize = 32

  constructor(...deps: SceneDeps) {
    super('pixel-beat', ...deps)
  }

  override create(): void {
    super.create()
    this.notes = []
    this.chips = []
    this.pending = []
    this.startLocal = Number.POSITIVE_INFINITY
    this.lastTick = -1
    this.beatsPassed = 0
    this.prevScore = 0
    this.prevStreak = 0
    this.primed = false
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const chipRows = Math.ceil(
      Math.max(1, Object.keys(this.state.names).length) / this.chipsPerRow(),
    )
    const contentTop = this.top + chipRows * (compact ? 20 : 26)

    const laneH = compact ? 76 : 104
    const laneY = Math.round(contentTop + (height - contentTop) * 0.3)
    const hitX = Math.round(width * 0.2)
    const laneEnd = Math.round(width * 0.97)
    this.lane = this.add.rectangle(width / 2, laneY, width, laneH, PALETTE.panel)
    this.add.rectangle(width / 2, laneY - laneH / 2, width, 3, PALETTE.frameLit)
    this.add.rectangle(width / 2, laneY + laneH / 2, width, 3, PALETTE.frameLit)
    const dots = this.add.graphics()
    dots.fillStyle(PALETTE.frame, 1)
    for (let x = hitX; x < width; x += 16) dots.fillRect(x, laneY - 1, 8, 2)

    const ringKey = ensurePixelGrid(this, {
      key: 'pp-beat-ring',
      rows: ringRows(19),
      legend: { o: PALETTE.lime, i: shade(PALETTE.lime, -0.45) },
    })
    this.hitRing = this.add
      .image(hitX, laneY, ringKey)
      .setDisplaySize(laneH * 0.92, laneH * 0.92)
      .setDepth(3)
    const noteKey = ensurePixelOrb(this, 'pp-beat-note', 11, PALETTE.amber)
    for (let i = 0; i < NOTE_POOL; i++) {
      this.notes.push(
        this.add
          .image(hitX, laneY, noteKey)
          .setDisplaySize(laneH * 0.5, laneH * 0.5)
          .setVisible(false)
          .setDepth(2),
      )
    }

    this.streakSize = compact ? 24 : 32
    this.streakText = this.add
      .text(
        width / 2,
        laneY + laneH / 2 + (compact ? 44 : 60),
        '',
        headlineStyle(this.streakSize, PALETTE.amber, { stroke: '#10121c', strokeThickness: 6 }),
      )
      .setOrigin(0.5)

    // Equalizer along the bottom, above the hint.
    const bars = compact ? 12 : 24
    this.levels = new Array<number>(bars).fill(0.08)
    this.eq = this.add.graphics()
    this.layout = {
      hitX,
      laneEnd,
      laneY,
      laneH,
      eqTop: laneY + laneH / 2 + (compact ? 90 : 120),
      eqBottom: height - (compact ? 34 : 44),
    }
    this.add
      .text(
        width / 2,
        height - 10,
        this.t('game.pixelBeat.tapHint'),
        bodyStyle(compact ? 13 : 16, PALETTE.dim),
      )
      .setOrigin(0.5, 1)

    this.input.on('pointerdown', () => this.tap())
    this.onKey('SPACE', () => this.tap())
  }

  private tap(): void {
    if (!this.snap || this.snap.remainingMs <= 0) return
    this.sendInput({ kind: 'tap' })
    this.pending.push(this.time.now)
    // Instant, unjudged acknowledgement; the verdict pops when the server credits (or doesn't).
    if (this.hitRing) {
      punch(this, this.hitRing, -0.1, 60)
      ring(this, this.hitRing.x, this.hitRing.y, PALETTE.text, this.layout.laneH * 0.6)
    }
  }

  protected frame(snap: PixelBeatSnapshot | null, _time: number, delta: number): void {
    if (!snap) return
    if (this.chips.length === 0) this.buildChips(Object.keys(snap.scores))
    const now = this.time.now
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.anchor(snap, now)
      this.judge(snap)
    }
    this.expirePending(now)
    const score = snap.scores[this.selfId] ?? 0
    this.hud?.setScore(this.t('game.common.pts', { n: score }))
    this.renderChips(snap)

    const elapsed = now - this.startLocal
    this.renderNotes(snap.beatTimes, elapsed)
    this.pulseOnBeat(snap.beatTimes, elapsed)
    this.renderEq(delta)
  }

  // Best estimate of the round's local start: the earliest (least delayed) reading wins. Each
  // reading only ever adds delay, so the minimum is the tightest one.
  private anchor(snap: PixelBeatSnapshot, now: number): void {
    const durationMs = (MINIGAMES_BY_ID.get(this.gameId)?.durationSec ?? 0) * 1000
    if (durationMs <= 0) {
      if (!Number.isFinite(this.startLocal)) this.startLocal = now
      return
    }
    this.startLocal = Math.min(this.startLocal, now - (durationMs - snap.remainingMs))
  }

  // Name each new credit from the score delta; a streak reset with no credit is a miss.
  private judge(snap: PixelBeatSnapshot): void {
    const score = snap.scores[this.selfId] ?? 0
    const streak = snap.streaks[this.selfId] ?? 0
    if (!this.primed) {
      this.primed = true
      this.prevScore = score
      this.prevStreak = streak
      return
    }
    let gained = score - this.prevScore
    const hits: number[] = []
    while (gained >= PERFECT_POINTS) {
      hits.push(PERFECT_POINTS)
      gained -= PERFECT_POINTS
    }
    while (gained >= GOOD_POINTS) {
      hits.push(GOOD_POINTS)
      gained -= GOOD_POINTS
    }
    hits.forEach((points, i) => {
      this.pending.shift()
      this.popJudgement(points === PERFECT_POINTS ? 'perfect' : 'good', i)
    })
    if (hits.length === 0 && streak === 0 && this.prevStreak > 0) {
      this.pending.shift()
      this.popJudgement('miss', 0)
    }
    if (streak > this.prevStreak) this.onStreak(streak)
    else if (streak === 0) this.streakText?.setText('')
    this.prevScore = score
    this.prevStreak = streak
  }

  private expirePending(now: number): void {
    while (this.pending.length > 0 && now - (this.pending[0] ?? now) > MISS_TIMEOUT_MS) {
      this.pending.shift()
      this.popJudgement('miss', 0)
    }
  }

  private popJudgement(kind: 'perfect' | 'good' | 'miss', stack: number): void {
    const { hitX, laneY, laneH } = this.layout
    const y = laneY - laneH / 2 - 14 - stack * 26
    const compact = Math.min(this.scale.width, this.scale.height) < 520
    // Keep the label on screen: the hit ring sits close to the left edge.
    const say = (key: string, color: number, size: number): void => {
      const label = this.t(key)
      const x = Math.max(hitX, (label.length * size) / 2 + 12)
      floatText(this, x, y, label, color, size)
    }
    if (kind === 'perfect') {
      this.sfx.correct()
      say('game.common.perfect', PALETTE.amber, compact ? 16 : 24)
      burst(this, hitX, laneY, PALETTE.amber, 16, 240)
      ring(this, hitX, laneY, PALETTE.amber, laneH * 0.8)
    } else if (kind === 'good') {
      this.sfx.click()
      say('game.common.good', PALETTE.cyan, 16)
      ring(this, hitX, laneY, PALETTE.cyan, laneH * 0.7)
    } else {
      this.sfx.wrong()
      say('game.common.miss', PALETTE.red, 16)
      if (this.hitRing) this.hitRing.setTint(PALETTE.red)
      this.time.delayedCall(160, () => this.hitRing?.clearTint())
      shake(this, 0.004, 100)
    }
  }

  private onStreak(streak: number): void {
    if (!this.streakText) return
    this.streakText
      .setText(this.t('game.pixelBeat.streak', { n: streak }))
      .setColor(hexToCss(streak >= 10 ? PALETTE.orange : PALETTE.amber))
    this.streakText.setFontSize(this.streakSize)
    const maxW = this.scale.width * 0.9
    if (this.streakText.width > maxW) {
      this.streakText.setFontSize(Math.floor((this.streakSize * maxW) / this.streakText.width))
    }
    punch(this, this.streakText, 0.25, 90)
    if (streak % 10 === 0) {
      burst(this, this.streakText.x, this.streakText.y, PALETTE.orange, 24, 260)
      floatText(
        this,
        this.streakText.x,
        this.streakText.y - 30,
        this.t('game.common.combo', { n: streak }),
        PALETTE.orange,
        16,
      )
    }
  }

  private renderNotes(beats: readonly number[], elapsed: number): void {
    const { hitX, laneEnd } = this.layout
    let used = 0
    for (const bt of beats) {
      if (used >= this.notes.length) break
      const until = bt - elapsed
      if (until < -TAIL_MS) continue
      if (until > HORIZON_MS) break
      const note = this.notes[used++]
      if (!note) break
      const x = hitX + (until / HORIZON_MS) * (laneEnd - hitX)
      note
        .setVisible(true)
        .setX(x)
        .setAlpha(until < 0 ? 1 + until / TAIL_MS : 1)
    }
    for (let i = used; i < this.notes.length; i++) this.notes[i]?.setVisible(false)
  }

  private pulseOnBeat(beats: readonly number[], elapsed: number): void {
    let passed = this.beatsPassed
    while (passed < beats.length && (beats[passed] ?? Number.POSITIVE_INFINITY) <= elapsed) passed++
    if (passed === this.beatsPassed) return
    const beat = beats[passed - 1] ?? 0
    this.beatsPassed = passed
    if (elapsed - beat > PULSE_WINDOW_MS) return
    this.sfx.tick()
    if (this.hitRing) punch(this, this.hitRing, 0.22, 90)
    if (this.lane) {
      this.lane.setFillStyle(PALETTE.panelAlt)
      this.time.delayedCall(90, () => this.lane?.setFillStyle(PALETTE.panel))
    }
    this.levels = this.levels.map((_, i) => 0.35 + 0.65 * hash01(passed, i))
  }

  // Chunky stepped equalizer bars that jump on each beat and decay in between.
  private renderEq(delta: number): void {
    if (!this.eq) return
    const { eqTop, eqBottom } = this.layout
    const { width } = this.scale
    const n = this.levels.length
    const gap = 6
    const barW = (width * 0.9 - gap * (n - 1)) / n
    const x0 = width * 0.05
    const maxH = Math.max(16, eqBottom - eqTop)
    const decay = 0.9 ** (delta / 16)
    const g = this.eq.clear()
    this.levels.forEach((level, i) => {
      const next = Math.max(0.08, level * decay)
      this.levels[i] = next
      const steps = Math.max(1, Math.round((next * maxH) / 8))
      const color = i % 2 === 0 ? PALETTE.cyan : PALETTE.magenta
      for (let s = 0; s < steps; s++) {
        g.fillStyle(s === steps - 1 ? shade(color, 0.4) : color, 0.85)
        g.fillRect(
          Math.round(x0 + i * (barW + gap)),
          Math.round(eqBottom - (s + 1) * 8),
          Math.max(2, Math.round(barW)),
          6,
        )
      }
    })
  }

  private chipsPerRow(): number {
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    return Math.max(1, Math.floor((width * 0.94) / (compact ? 140 : 190)))
  }

  private buildChips(ids: string[]): void {
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const perRow = Math.min(ids.length, this.chipsPerRow())
    const chipW = (width * 0.94) / Math.max(1, perRow)
    const rowH = compact ? 20 : 26
    ids.forEach((id, i) => {
      const row = Math.floor(i / perRow)
      const inRow = Math.min(perRow, ids.length - row * perRow)
      const x = width / 2 - (inRow * chipW) / 2 + (i % perRow) * chipW + chipW / 2
      const y = this.top + row * rowH + rowH / 2
      const text = this.add
        .text(x, y, '', bodyStyle(compact ? 12 : 15, this.state.colorOf(id, PALETTE.dim)))
        .setOrigin(0.5)
      if (id === this.selfId) text.setBackgroundColor(hexToCss(PALETTE.panelAlt))
      this.chips.push({ id, text, key: '' })
    })
  }

  // Everyone's score and live streak ("x7"), in their colors.
  private renderChips(snap: PixelBeatSnapshot): void {
    const compact = Math.min(this.scale.width, this.scale.height) < 520
    for (const chip of this.chips) {
      const score = snap.scores[chip.id] ?? 0
      const streak = snap.streaks[chip.id] ?? 0
      const key = `${score}:${streak}`
      if (key === chip.key) continue
      chip.key = key
      const name = this.label(chip.id).slice(0, compact ? 6 : 10)
      chip.text.setText(` ${name} ${score}${streak > 1 ? ` x${streak}` : ''} `)
    }
  }
}
