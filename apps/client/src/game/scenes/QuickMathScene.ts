import { PALETTE, type QuickMathSnapshot } from '@pp/shared'
import type Phaser from 'phaser'
import { addBanner, burst, floatText, punch, ring, shake, showBanner } from '../fx'
import { bodyStyle, ensureBevelPanel, fitText, headlineStyle, hexToCss, shade } from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Answer button colors — the same quiz palette as Lightning Quiz; lime/red stay reserved for verdicts.
const CHOICE_COLORS = [PALETTE.magenta, PALETTE.cyan, PALETTE.amber, 0x5b8cff]
const LCD_COLOR = shade(PALETTE.lime, -0.86)
const PRESS_PX = 4
const COMBO_EVERY = 3
// Every player gets a chip; rooms bigger than this get an extra strip row.
const CHIPS_PER_ROW = 6
// An answer the server never took (it should always take a live one) unlocks the sum after this long.
const ANSWER_RETRY_MS = 1500

interface Button {
  shadow: Phaser.GameObjects.Image
  face: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  y: number
  maxW: number
  size: number
}

// Quick Math canvas. This player's current sum sits on a green LCD board above four chunky answer
// buttons (tap or keys 1-4); answering advances to the next sum at once. The correct answer never rides
// the live snapshot, so the verdict is inferred when the question advances: a score bump = right
// (+1, ring, combo pops every 3 in a row), no bump = wrong (buzz + shake). A wrong answer also costs a
// short server-side cooldown: the buttons grey out behind a draining red bar until it runs out. One
// answer per sum — further taps wait for the next one. A chip strip ranks every player.
export class QuickMathScene extends MiniGameScene<QuickMathSnapshot> {
  private buttons: Button[] = []
  private board?: Phaser.GameObjects.Image
  private equation?: Phaser.GameObjects.Text
  private comboText?: Phaser.GameObjects.Text
  private cooldownLabel?: Phaser.GameObjects.Text
  private cooldownBar?: Phaser.GameObjects.Graphics
  private barBox = { x: 0, y: 0, w: 0, h: 0 }
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private equationSize = 0
  private equationMaxW = 0
  private lastScore = 0
  private lastIndex = -1
  private lastChoice = -1
  private streak = 0
  // The sum this player already answered (and when): taps on it wait for the next snapshot.
  private answeredIndex = -1
  private answeredAt = 0
  // Wrong-answer cooldown, re-anchored to local time on each fresh snapshot so the bar drains smoothly.
  private lastTick = -1
  private cooldownEndsAt = 0
  private cooldownTotal = 1
  private lastCooldownMs = 0

  constructor(...deps: SceneDeps) {
    super('quick-math', ...deps)
  }

  override create(): void {
    super.create()
    this.buttons = []
    this.lastScore = 0
    this.lastIndex = -1
    this.lastChoice = -1
    this.streak = 0
    this.answeredIndex = -1
    this.answeredAt = 0
    this.lastTick = -1
    this.cooldownEndsAt = 0
    this.cooldownTotal = 1
    this.lastCooldownMs = 0
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const cx = width / 2
    const contentW = Math.round(Math.min(width - (compact ? 32 : 64), 760))

    const boardTop = this.top + (compact ? 8 : 12)
    const boardH = Math.round(Math.min(compact ? 180 : 200, height * 0.24))
    this.board = this.add.image(
      cx,
      boardTop + boardH / 2,
      ensureBevelPanel(this, contentW, boardH, LCD_COLOR, 6, true),
    )
    // Faint LCD scanlines across the board face.
    const lines = this.add.graphics().setAlpha(0.18)
    lines.fillStyle(PALETTE.lime, 1)
    for (let y = boardTop + 10; y < boardTop + boardH - 10; y += 4) {
      lines.fillRect(cx - contentW / 2 + 10, y, contentW - 20, 1)
    }
    this.equationSize = compact ? 40 : 64
    this.equationMaxW = contentW - 40
    this.equation = this.add
      .text(cx, boardTop + boardH / 2, '', headlineStyle(this.equationSize, PALETTE.lime))
      .setOrigin(0.5)
      .setShadow(0, 0, hexToCss(PALETTE.lime), 10, false, true)
    const comboY = boardTop + boardH + (compact ? 20 : 26)
    this.comboText = this.add.text(cx, comboY, '', headlineStyle(16, PALETTE.amber)).setOrigin(0.5)
    // The cooldown takes the combo line's place (a miss just reset the combo anyway), bar below it.
    this.cooldownLabel = this.add
      .text(cx, comboY - 2, '', bodyStyle(compact ? 13 : 16, PALETTE.red, { fontStyle: 'bold' }))
      .setOrigin(0.5)
      .setDepth(6)
    const barW = Math.round(contentW * 0.6)
    const barH = compact ? 6 : 8
    this.barBox = { x: cx - barW / 2, y: comboY + (compact ? 11 : 14), w: barW, h: barH }
    this.cooldownBar = this.add.graphics().setDepth(6)

    const chipSize = compact ? 11 : 13
    const roster = Object.keys(this.state.names).length
    const stripRows = (width < 600 ? 2 : 1) + (roster > CHIPS_PER_ROW ? 1 : 0)
    const stripTop = height - (compact ? 12 : 18) - stripRows * PlayerStrip.rowH(chipSize)
    this.strip = new PlayerStrip(
      this,
      cx,
      stripTop + PlayerStrip.rowH(chipSize) / 2,
      contentW,
      chipSize,
      stripRows,
    )

    const gap = compact ? 12 : 18
    const areaTop = boardTop + boardH + (compact ? 42 : 52)
    const areaH = stripTop - 12 - areaTop
    const bw = Math.round((contentW - gap) / 2)
    const bh = Math.round(Math.min(compact ? 128 : 130, (areaH - gap) / 2))
    const blockTop = areaTop + Math.min(24, Math.max(0, (areaH - bh * 2 - gap) / 3))
    const shadowKey = ensureBevelPanel(this, bw, bh, shade(PALETTE.bg, -0.5), 0, true)
    const size = compact ? 32 : 40
    for (let i = 0; i < 4; i++) {
      const x = cx + (i % 2 === 0 ? -1 : 1) * (bw / 2 + gap / 2)
      const y = blockTop + bh / 2 + Math.floor(i / 2) * (bh + gap)
      const color = CHOICE_COLORS[i] ?? PALETTE.cyan
      const shadow = this.add.image(x, y + PRESS_PX, shadowKey)
      const face = this.add
        .image(x, y, ensureBevelPanel(this, bw, bh, color, 4, true))
        .setInteractive({ useHandCursor: true })
      face.on('pointerdown', () => this.answer(i))
      const label = this.add
        .text(
          x,
          y,
          '',
          headlineStyle(size, PALETTE.text, { stroke: '#10121c', strokeThickness: 6 }),
        )
        .setOrigin(0.5)
      this.buttons.push({ shadow, face, label, y, maxW: bw - 24, size })
    }

    this.banner = addBanner(this).setFontSize(compact ? 24 : 32)
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return // a held digit would answer every following sum with it
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= 4) this.answer(n - 1)
    })
  }

  private coolingDown(): boolean {
    return this.time.now < this.cooldownEndsAt
  }

  private answer(choice: number): void {
    const prompt = this.snap?.prompts[this.selfId]
    if (!prompt || choice >= prompt.choices.length || this.snap?.remainingMs === 0) return
    if (this.coolingDown()) return
    // One answer per sum: a second tap before the next snapshot would only be dropped as stale — and
    // would misplace the verdict onto the button tapped last.
    const now = this.time.now
    if (prompt.index === this.answeredIndex && now - this.answeredAt < ANSWER_RETRY_MS) return
    this.answeredIndex = prompt.index
    this.answeredAt = now
    this.sfx.click()
    this.lastChoice = choice
    this.press(choice)
    this.sendInput({ kind: 'answer', index: prompt.index, choice })
  }

  // Arcade button press: the face sinks onto its shadow for a beat.
  private press(choice: number): void {
    const b = this.buttons[choice]
    if (!b) return
    for (const o of [b.face, b.label]) o.setY(b.y + PRESS_PX)
    this.time.delayedCall(90, () => {
      for (const o of [b.face, b.label]) o.setY(b.y)
    })
  }

  protected frame(snap: QuickMathSnapshot | null): void {
    if (!snap) return
    const me = this.selfId
    const prompt = snap.prompts[me] ?? null
    const score = snap.scores[me] ?? 0
    this.hud?.setScore(this.t('game.common.correct', { n: score }))

    const idx = prompt?.index ?? Number.POSITIVE_INFINITY
    if (idx !== this.lastIndex) {
      if (this.lastIndex >= 0) this.judge(score > this.lastScore)
      this.lastIndex = idx
      this.showPrompt(prompt)
    }
    this.lastScore = score
    this.trackCooldown(snap.cooldowns[me] ?? 0)
    this.renderCooldown(prompt !== null)

    const chips = Object.entries(snap.scores)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => ({
        text: `${this.label(id).slice(0, 10).toUpperCase()} ${n}`,
        avatar: this.state.avatarOf(id),
        color: this.state.colorOf(id),
      }))
    this.strip?.set(chips)
  }

  private trackCooldown(ms: number): void {
    if (this.state.tick === this.lastTick) return
    this.lastTick = this.state.tick
    // A jump up in the remaining time is a fresh penalty: its first reading is the bar's full length.
    if (ms > this.lastCooldownMs + 150 || this.firstSnapshot) this.cooldownTotal = Math.max(1, ms)
    this.cooldownEndsAt = ms > 0 ? this.time.now + ms : 0
    this.lastCooldownMs = ms
  }

  // Cooling down: every button greys out and a red bar drains until answers count again.
  private renderCooldown(live: boolean): void {
    const cooling = live && this.coolingDown()
    for (const b of this.buttons) {
      for (const o of [b.shadow, b.face, b.label]) o.setAlpha(cooling ? 0.35 : 1)
      if (cooling) b.face.setTint(0x9a9a9a)
      else b.face.clearTint()
    }
    this.comboText?.setVisible(!cooling)
    const g = this.cooldownBar
    if (!g) return
    g.clear()
    if (!cooling) {
      this.cooldownLabel?.setText('')
      return
    }
    const { x, y, w, h } = this.barBox
    const frac = Math.max(
      0,
      Math.min(1, (this.cooldownEndsAt - this.time.now) / Math.max(1, this.cooldownTotal)),
    )
    g.fillStyle(PALETTE.panelAlt, 1).fillRect(x, y, w, h)
    g.fillStyle(Math.floor(this.time.now / 120) % 2 ? PALETTE.red : shade(PALETTE.red, 0.25), 1)
    g.fillRect(x, y, Math.round(w * frac), h)
    this.cooldownLabel?.setText(this.t('game.quickMath.cooldown'))
  }

  private showPrompt(prompt: QuickMathSnapshot['prompts'][string]): void {
    const eq = this.equation
    if (!eq) return
    if (!prompt) {
      eq.setText('')
      for (const b of this.buttons) for (const o of [b.shadow, b.face, b.label]) o.setVisible(false)
      if (this.banner) showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.lime)
      this.comboText?.setText(this.t('game.common.waiting'))
      return
    }
    // The server writes minus as U+2212, which Press Start 2P lacks: show the font's own hyphen.
    eq.setText(`${prompt.text.replace(/\u2212/g, '-')} = ?`)
    fitText(eq, this.equationMaxW, this.equationSize)
    if (this.board) punch(this, this.board, 0.03, 70)
    this.buttons.forEach((b, i) => {
      const has = i < prompt.choices.length
      for (const o of [b.shadow, b.face, b.label]) o.setVisible(has)
      if (!has) return
      b.label.setText(String(prompt.choices[i]))
      fitText(b.label, b.maxW, b.size)
    })
  }

  private judge(right: boolean): void {
    const b = this.buttons[this.lastChoice]
    const x = b?.face.x ?? this.scale.width / 2
    const y = b ? b.y : this.scale.height / 2
    if (right) {
      this.streak++
      this.sfx.correct()
      floatText(this, x, y - 30, '+1', PALETTE.lime, 24)
      ring(this, x, y, PALETTE.lime, 60)
      if (this.streak % COMBO_EVERY === 0) {
        const cy = this.comboText?.y ?? y
        burst(this, this.scale.width / 2, cy, PALETTE.amber, 16, 240)
        floatText(
          this,
          this.scale.width / 2,
          cy,
          this.t('game.common.combo', { n: this.streak }),
          PALETTE.amber,
          20,
        )
      }
    } else {
      this.streak = 0
      this.sfx.wrong()
      shake(this, 0.007, 160)
      floatText(this, x, y - 30, this.t('game.common.wrong'), PALETTE.red, 20)
      if (this.board) {
        this.board.setTint(PALETTE.red)
        this.time.delayedCall(160, () => this.board?.clearTint())
      }
    }
    this.comboText?.setText(this.streak >= 2 ? this.t('game.common.combo', { n: this.streak }) : '')
  }
}
