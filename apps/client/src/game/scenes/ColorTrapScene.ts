import { COLOR_TRAP_COLORS, type ColorTrapSnapshot, PALETTE } from '@pp/shared'
import Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { addBanner, burst, floatText, punch, ring, shake, showBanner } from '../fx'
import { bodyStyle, ensureBevelPanel, fitText, headlineStyle, hexToCss, shade } from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Mirrors the server's colorTrap.ts DEFAULT_PROMPT_MS (the snapshot only carries the live prompt's
// remaining time) so the HUD can show the whole round draining, not just the current prompt.
const PROMPT_MS = 1800
const FUSE_SEGMENTS = 18

// 'unknown' = a prompt whose verdict this client never saw (it was answered, or already over, before a
// relayout restart) — shown neutral, never counted as a miss.
type PipState = 'upcoming' | 'correct' | 'wrong' | 'missed' | 'unknown'

interface Chip {
  id: string
  box: Phaser.GameObjects.Rectangle
  text: Phaser.GameObjects.Text
  lamp: Phaser.GameObjects.Rectangle
  key: string
}

// Color Trap (Stroop) canvas. A translated color WORD is printed in a mismatched INK on a pixel
// card; tap the colored tile matching the INK (+1; a wrong color costs a point). One answer per
// prompt, tagged with the prompt index so the server can drop stale taps. The prompt's end is
// extrapolated on the local clock: the fuse drains smoothly and taps stop the moment it runs out, so
// every local verdict is one the server scores (it still takes the previous prompt's answer for a
// short grace period while the tap is in flight). A pip row tracks every prompt (right / wrong /
// missed) and the other players' chips light up as they lock in.
export class ColorTrapScene extends MiniGameScene<ColorTrapSnapshot> {
  private word?: Phaser.GameObjects.Text
  private card?: Phaser.GameObjects.Image
  private status?: Phaser.GameObjects.Text
  private fuse?: Phaser.GameObjects.Graphics
  private pipsGfx?: Phaser.GameObjects.Graphics
  private banner?: Phaser.GameObjects.Text
  private buttons: Phaser.GameObjects.Image[] = []
  private chips: Chip[] = []
  private pips: PipState[] = []
  private wordSize = 72
  private wordMaxW = 0
  private fuseRect = { x: 0, y: 0, w: 0, h: 0 }
  private pipRow = { y: 0, size: 0 }
  private lastIndex = -1
  private lastWordKey = ''
  private lastFuseLit = -1
  private pipsKey = ''
  private streak = 0
  // The live prompt's end on the local clock (the earliest estimate any of its snapshots gave).
  private endsIndex = -1
  private endsAt = 0
  private lastTick = -1

  constructor(...deps: SceneDeps) {
    super('color-trap', ...deps)
  }

  override create(): void {
    super.create()
    this.buttons = []
    this.chips = []
    this.pips = []
    this.lastIndex = -1
    this.lastWordKey = ''
    this.lastFuseLit = -1
    this.pipsKey = ''
    this.streak = 0
    this.endsIndex = -1
    this.endsAt = 0
    this.lastTick = -1
    const { width, height } = this.scale
    const cx = width / 2
    const compact = Math.min(width, height) < 520
    const portrait = height > width

    // Player chips land here once the first snapshot names the round's players (see buildChips);
    // the roster is a good-enough estimate of how many rows they need.
    const chips = this.chipLayout(Math.max(1, Object.keys(this.state.names).length))
    const chipsH = chips.rows * chips.rowH
    this.pipRow = { y: this.top + 2 + chipsH + (compact ? 8 : 10), size: compact ? 10 : 14 }
    this.pipsGfx = this.add.graphics()

    // The word card.
    const cardTop = this.pipRow.y + this.pipRow.size + (compact ? 12 : 18)
    const cardW = Math.round(Math.min(width * 0.9, 680))
    const cardH = Math.round(Math.min((height - cardTop) * (portrait ? 0.3 : 0.36), 220))
    const cardY = cardTop + cardH / 2
    const cardKey = ensureBevelPanel(this, cardW, cardH, PALETTE.panel, 4)
    this.card = this.add.image(cx, cardY, cardKey)
    this.add
      .rectangle(cx, cardY, cardW - 16, cardH - 16)
      .setStrokeStyle(2, PALETTE.frame)
      .setFillStyle(PALETTE.bg, 0.55)
    this.wordSize = compact ? 48 : 72
    this.wordMaxW = cardW - 40
    this.word = this.add
      .text(
        cx,
        cardY - cardH * 0.08,
        '',
        headlineStyle(this.wordSize, PALETTE.text, { stroke: '#10121c', strokeThickness: 8 }),
      )
      .setOrigin(0.5)
      .setDepth(5)
    const fuseW = cardW - 48
    const fuseH = compact ? 8 : 10
    this.fuseRect = { x: cx - fuseW / 2, y: cardY + cardH / 2 - 26, w: fuseW, h: fuseH }
    this.fuse = this.add.graphics().setDepth(5)

    this.status = this.add
      .text(
        cx,
        cardY + cardH / 2 + (compact ? 14 : 20),
        this.t('game.colorTrap.instruction'),
        bodyStyle(compact ? 14 : 18, PALETTE.text, {
          align: 'center',
          wordWrap: { width: width * 0.9 },
        }),
      )
      .setOrigin(0.5, 0)

    // Answer tiles: one row on wide screens, a 2x2 grid on phones (bigger thumbs targets).
    const n = COLOR_TRAP_COLORS.length
    const cols = portrait ? 2 : n
    const rows = Math.ceil(n / cols)
    const gap = compact ? 12 : 18
    const areaTop = cardY + cardH / 2 + (compact ? 60 : 70)
    const areaH = height - areaTop - (compact ? 14 : 24)
    const bw = Math.round(Math.min(190, (width * 0.9 - gap * (cols - 1)) / cols))
    const bh = Math.round(Math.max(48, Math.min(bw * 0.7, (areaH - gap * (rows - 1)) / rows)))
    const gridW = cols * bw + (cols - 1) * gap
    const gridH = rows * bh + (rows - 1) * gap
    const startX = cx - gridW / 2 + bw / 2
    const startY = areaTop + Math.max(0, (areaH - gridH) / 2) + bh / 2
    COLOR_TRAP_COLORS.forEach((c, i) => {
      const x = startX + (i % cols) * (bw + gap)
      const y = startY + Math.floor(i / cols) * (bh + gap)
      const key = ensureBevelPanel(this, bw, bh, c.hex, compact ? 5 : 6)
      const img = this.add.image(x, y, key).setInteractive({ useHandCursor: true })
      img.on('pointerdown', () => this.answer(i))
      this.buttons.push(img)
    })

    this.banner = addBanner(this)
    this.banner.setFontSize(compact ? 24 : 34).setWordWrapWidth(width * 0.9)
  }

  protected override remainingMs(snap: ColorTrapSnapshot): number | null {
    if (snap.word === null) return 0
    return (snap.total - snap.index - 1) * PROMPT_MS + snap.promptRemainingMs
  }

  // Whether the live prompt still takes a tap on this client's clock.
  private open(snap: ColorTrapSnapshot): boolean {
    return snap.index === this.endsIndex && this.time.now < this.endsAt
  }

  private answer(color: number): void {
    const snap = this.snap
    if (!snap || snap.ink === null || !(this.selfId in snap.scores) || !this.open(snap)) return
    if (snap.answeredCurrent.includes(this.selfId) || this.answeredLocally(snap.index)) return
    const btn = this.buttons[color]
    // The ink index is already in the snapshot, so right/wrong feedback can be instant and local.
    const right = color === snap.ink
    this.pips[snap.index] = right ? 'correct' : 'wrong'
    this.sendInput({ kind: 'answer', prompt: snap.index, color })
    if (!btn) return
    punch(this, btn, -0.1, 70)
    if (right) {
      this.streak++
      this.sfx.correct()
      ring(this, btn.x, btn.y, PALETTE.lime, btn.displayWidth * 0.6)
      burst(this, btn.x, btn.y, COLOR_TRAP_COLORS[color]?.hex, 14, 200)
      floatText(this, btn.x, btn.y - btn.displayHeight / 2, '+1', PALETTE.lime, 20)
      if (this.streak >= 3 && this.word) {
        floatText(
          this,
          this.word.x,
          this.word.y - this.word.height * 0.6,
          this.t('game.common.combo', { n: this.streak }),
          PALETTE.amber,
          16,
        )
      }
      if (this.card) punch(this, this.card, 0.04, 80)
    } else {
      this.streak = 0
      this.sfx.wrong()
      shake(this, 0.008, 160)
      burst(this, btn.x, btn.y, PALETTE.red, 10, 160)
      floatText(
        this,
        btn.x,
        btn.y - btn.displayHeight / 2,
        `${this.t('game.common.wrong')} -1`,
        PALETTE.red,
      )
    }
  }

  protected frame(snap: ColorTrapSnapshot | null, time: number): void {
    if (!snap) return
    if (this.chips.length === 0) this.buildChips(Object.keys(snap.scores))
    if (this.pips.length !== snap.total)
      this.pips = new Array<PipState>(snap.total).fill('upcoming')
    // Joining mid-round (relayout restart): earlier prompts are history this client can't judge.
    if (this.firstSnapshot)
      for (let i = 0; i < Math.min(snap.index, snap.total); i++) this.pips[i] = 'unknown'
    // The server already has this player's answer for the live prompt, but no local verdict for it.
    if (snap.answeredCurrent.includes(this.selfId) && this.pips[snap.index] === 'upcoming')
      this.pips[snap.index] = 'unknown'
    this.hud?.setScore(this.t('game.common.pts', { n: snap.scores[this.selfId] ?? 0 }))
    this.trackPromptEnd(snap)
    this.onPromptChange(snap)
    this.renderChips(snap)
    this.renderPips(snap, time)

    if (snap.word === null || snap.ink === null) {
      this.word?.setVisible(false)
      this.fuse?.clear()
      for (const b of this.buttons) b.setAlpha(0.25)
      this.status?.setText('')
      if (this.banner) showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.lime)
      return
    }

    const wordKey = `${snap.index}:${this.t(this.wordKey(snap.word))}`
    if (wordKey !== this.lastWordKey && this.word) {
      this.lastWordKey = wordKey
      this.word
        .setVisible(true)
        .setText(this.t(this.wordKey(snap.word)))
        .setColor(hexToCss(COLOR_TRAP_COLORS[snap.ink]?.hex ?? PALETTE.text))
      fitText(this.word, this.wordMaxW, this.wordSize)
      punch(this, this.word, 0.22, 90)
    }
    this.renderFuse(this.open(snap) ? this.endsAt - this.time.now : 0)

    const locked = snap.answeredCurrent.includes(this.selfId) || this.answeredLocally(snap.index)
    this.status?.setText(this.t(locked ? 'game.colorTrap.locked' : 'game.colorTrap.instruction'))
    for (const b of this.buttons) b.setAlpha(locked || !this.open(snap) ? 0.35 : 1)
  }

  // Anchors the live prompt's end to the local clock on each fresh snapshot, keeping the earliest
  // estimate: a late snapshot only ever carries extra delay, and ending early is the safe side.
  private trackPromptEnd(snap: ColorTrapSnapshot): void {
    if (this.state.tick === this.lastTick) return
    this.lastTick = this.state.tick
    const endsAt = this.time.now + snap.promptRemainingMs
    if (snap.index !== this.endsIndex) {
      this.endsIndex = snap.index
      this.endsAt = endsAt
    } else this.endsAt = Math.min(this.endsAt, endsAt)
  }

  private answeredLocally(index: number): boolean {
    const pip = this.pips[index]
    return pip === 'correct' || pip === 'wrong' || pip === 'unknown'
  }

  private wordKey(colorIndex: number): string {
    const name = COLOR_TRAP_COLORS[colorIndex]?.name.toLowerCase() ?? 'red'
    return `game.colorTrap.words.${name}`
  }

  // A prompt the player let pass without answering is a miss (quiet pop, no buzzer).
  private onPromptChange(snap: ColorTrapSnapshot): void {
    if (snap.index === this.lastIndex) return
    const prev = this.lastIndex
    this.lastIndex = snap.index
    if (prev < 0 || this.pips[prev] !== 'upcoming') return
    this.pips[prev] = 'missed'
    this.streak = 0
    if (this.card) {
      floatText(this, this.card.x, this.card.y, this.t('game.common.miss'), PALETTE.dim, 18)
    }
  }

  private chipLayout(n: number): { perRow: number; chipW: number; rowH: number; rows: number } {
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const perRow = Math.max(1, Math.min(n, Math.floor((width * 0.94) / (compact ? 98 : 150))))
    const chipW = Math.min(compact ? 110 : 170, (width * 0.94) / perRow)
    return { perRow, chipW, rowH: compact ? 20 : 26, rows: Math.ceil(n / perRow) }
  }

  private buildChips(ids: string[]): void {
    const { width } = this.scale
    const compact = Math.min(width, this.scale.height) < 520
    const { perRow, chipW, rowH, rows } = this.chipLayout(ids.length)
    ids.forEach((id, i) => {
      const row = Math.floor(i / perRow)
      const inRow = row < rows - 1 ? perRow : ids.length - row * perRow
      const x = width / 2 - (inRow * chipW) / 2 + (i % perRow) * chipW + 4
      const y = this.top + 2 + row * rowH + rowH / 2
      const color = this.state.colorOf(id, PALETTE.dim)
      // Boxed chip: the player's avatar, "name score", and a lamp that lights (with the frame) once
      // this player has locked an answer for the live prompt.
      const box = this.add
        .rectangle(x, y, chipW - 8, rowH - 4, PALETTE.panel)
        .setOrigin(0, 0.5)
        .setStrokeStyle(2, PALETTE.frame)
      this.add
        .image(x + 3, y, ensureAvatarTexture(this, this.state.avatarOf(id), color, 1))
        .setOrigin(0, 0.5)
      const lamp = this.add.rectangle(x + chipW - 22, y, 8, 8, PALETTE.panelAlt).setOrigin(0, 0.5)
      const text = this.add
        .text(x + 23, y, '', bodyStyle(compact ? 12 : 14, color))
        .setOrigin(0, 0.5)
        .setFixedSize(chipW - 50, 0)
      this.chips.push({ id, box, text, lamp, key: '' })
    })
  }

  private renderChips(snap: ColorTrapSnapshot): void {
    const compact = Math.min(this.scale.width, this.scale.height) < 520
    for (const chip of this.chips) {
      const score = snap.scores[chip.id] ?? 0
      const locked = snap.answeredCurrent.includes(chip.id)
      const key = `${score}:${locked}`
      if (key === chip.key) continue
      chip.key = key
      const name = this.label(chip.id).slice(0, compact ? 5 : 9)
      chip.text.setText(`${name} ${score}`)
      chip.lamp.setFillStyle(locked ? PALETTE.lime : PALETTE.panelAlt)
      chip.box.setStrokeStyle(2, locked ? PALETTE.lime : PALETTE.frame)
    }
  }

  private renderPips(snap: ColorTrapSnapshot, time: number): void {
    const blink = Math.floor(time / 250) % 2
    const key = `${this.pips.join(',')}:${snap.index}:${blink}`
    if (key === this.pipsKey || !this.pipsGfx) return
    this.pipsKey = key
    const { size, y } = this.pipRow
    const gap = Math.max(3, size * 0.4)
    const total = this.pips.length
    const rowW = total * size + (total - 1) * gap
    const x0 = this.scale.width / 2 - rowW / 2
    const g = this.pipsGfx.clear()
    this.pips.forEach((pip, i) => {
      const x = x0 + i * (size + gap)
      const current = i === snap.index && pip === 'upcoming'
      const color =
        pip === 'correct'
          ? PALETTE.lime
          : pip === 'wrong'
            ? PALETTE.red
            : pip === 'missed'
              ? shade(PALETTE.dim, -0.4)
              : pip === 'unknown'
                ? PALETTE.frame
                : current && blink
                  ? PALETTE.text
                  : PALETTE.panelAlt
      g.fillStyle(shade(color, -0.5), 1).fillRect(x, y, size, size)
      g.fillStyle(color, 1).fillRect(x, y, size - 2, size - 2)
    })
  }

  private renderFuse(remaining: number): void {
    if (!this.fuse) return
    const frac = Phaser.Math.Clamp(remaining / PROMPT_MS, 0, 1)
    const lit = Math.ceil(frac * FUSE_SEGMENTS)
    if (lit === this.lastFuseLit) return
    this.lastFuseLit = lit
    const { x, y, w, h } = this.fuseRect
    const gap = 3
    const segW = (w - gap * (FUSE_SEGMENTS - 1)) / FUSE_SEGMENTS
    const color = frac < 0.3 ? PALETTE.red : frac < 0.6 ? PALETTE.amber : PALETTE.lime
    const g = this.fuse.clear()
    for (let i = 0; i < FUSE_SEGMENTS; i++) {
      g.fillStyle(i < lit ? color : PALETTE.panelAlt, 1)
      g.fillRect(Math.round(x + i * (segW + gap)), y, Math.max(1, Math.round(segW)), h)
    }
  }
}
