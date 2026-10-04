import { PALETTE, type ReactionSnapshot } from '@pp/shared'
import type Phaser from 'phaser'
import { avatarPx, ensureAvatarTexture } from '../avatars'
import { burst, flash, floatText, punch, ring, shake } from '../fx'
import {
  bodyStyle,
  ensureBevelPanel,
  ensurePixelOrb,
  fitText,
  headlineStyle,
  hexToCss,
} from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const WAIT_BG = 0x5c1422
const GO_BG = 0x14683e
const OUT_BG = 0x2a1a24
// Results board: one column up to this many players (and while rows stay at least BOARD_MIN_ROW_H
// tall), then two (three on a short landscape screen).
const BOARD_ONE_COLUMN = 8
const BOARD_MIN_ROW_H = 18
const BOARD_COL_GAP = 12
// Cosmetic rating of the player's own time (never scoring — the server ranks the raw ms).
const RATINGS: readonly [number, string, number][] = [
  [220, 'game.common.perfect', PALETTE.amber],
  [320, 'game.common.great', PALETTE.lime],
  [450, 'game.common.good', PALETTE.cyan],
]

interface Row {
  swatch: Phaser.GameObjects.Image
  name: Phaser.GameObjects.Text
  value: Phaser.GameObjects.Text
  frame: Phaser.GameObjects.Rectangle
  key: string
}

// Reaction Duel canvas: the whole screen is the signal. A red field with a pixel traffic light
// waits for green; click (or Space / Enter) after it turns. The green moment is scheduled locally from the
// snapshot's `greenInMs`, so the switch lands on time instead of up to one snapshot late — never
// early, because the estimate only ever carries extra delay. A tap also reports this client's own
// reaction time (from the frame that showed green), which the server credits within bounds so the
// network round trip stays out of the score. Every player's time / false start fills a board below
// (two columns in a big room) as they arrive, in each player's color.
export class ReactionScene extends MiniGameScene<ReactionSnapshot> {
  private bg?: Phaser.GameObjects.Rectangle
  private redLamp?: Phaser.GameObjects.Image
  private greenLamp?: Phaser.GameObjects.Image
  private title?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private rows: Row[] = []
  // Players whose result is already on the board (a newly arrived one gets a pop).
  private readonly shown = new Set<string>()
  private keys = { redOn: '', redOff: '', greenOn: '', greenOff: '' }
  private titleSize = 56
  private titleMaxW = 0
  private boardTop = 0
  private greenAtLocal = Number.POSITIVE_INFINITY
  // performance.now() of the frame that turned this screen green (null: not green yet, or it turned
  // green before a relayout restart — then the server's own timing is used).
  private greenShownAt: number | null = null
  private lastTick = -1
  private wasGreen = false
  private resolved = false

  constructor(...deps: SceneDeps) {
    super('reaction-duel', ...deps)
  }

  override create(): void {
    super.create({ hud: false })
    this.rows = []
    this.shown.clear()
    this.greenAtLocal = Number.POSITIVE_INFINITY
    this.greenShownAt = null
    this.lastTick = -1
    this.wasGreen = false
    this.resolved = false
    const { width, height } = this.scale
    const cx = width / 2
    const compact = Math.min(width, height) < 520
    this.bg = this.add.rectangle(0, 0, width, height, WAIT_BG).setOrigin(0, 0)

    this.titleSize = compact ? 32 : 48
    this.titleMaxW = width * 0.9
    this.title = this.add
      .text(
        cx,
        height * 0.1,
        '',
        headlineStyle(this.titleSize, PALETTE.text, { stroke: '#10121c', strokeThickness: 6 }),
      )
      .setOrigin(0.5)
      .setDepth(10)

    // Traffic-light housing with a red lamp over a green one.
    const lamp = Math.min(width * 0.26, height * 0.13, 150)
    const lightY = height * 0.34
    const hw = Math.round(lamp * 1.5)
    const hh = Math.round(lamp * 2.55)
    const housingKey = ensureBevelPanel(this, hw, hh, 0x23263a, 5)
    this.add.image(cx, lightY, housingKey).setDepth(1)
    this.add
      .rectangle(cx, lightY + lamp * 1.28, lamp * 0.28, height, 0x1a1c2b)
      .setOrigin(0.5, 0)
      .setDepth(0)
    this.keys = {
      redOn: ensurePixelOrb(this, 'pp-reaction-red-on', 16, PALETTE.red),
      redOff: ensurePixelOrb(this, 'pp-reaction-red-off', 16, 0x4a1a22),
      greenOn: ensurePixelOrb(this, 'pp-reaction-green-on', 16, PALETTE.lime),
      greenOff: ensurePixelOrb(this, 'pp-reaction-green-off', 16, 0x1d3a24),
    }
    this.redLamp = this.add
      .image(cx, lightY - lamp * 0.58, this.keys.redOn)
      .setDisplaySize(lamp, lamp)
      .setDepth(2)
    this.greenLamp = this.add
      .image(cx, lightY + lamp * 0.58, this.keys.greenOff)
      .setDisplaySize(lamp, lamp)
      .setDepth(2)

    this.status = this.add
      .text(
        cx,
        lightY + lamp * 1.55,
        '',
        bodyStyle(compact ? 15 : 20, PALETTE.text, {
          align: 'center',
          stroke: '#10121c',
          strokeThickness: 4,
          wordWrap: { width: width * 0.9 },
        }),
      )
      .setOrigin(0.5, 0)
      .setDepth(10)

    // Everyone's result board along the bottom: built on the first snapshot, which names the players.
    this.boardTop = lightY + lamp * 1.55 + (compact ? 56 : 70)

    this.input.on('pointerdown', () => this.tap())
    this.onKey('SPACE', () => this.tap())
    this.onKey('ENTER', () => this.tap())
    this.showTitle(this.t('game.reaction.wait'), PALETTE.text)
    this.status.setText(this.t('game.reaction.instruction'))
  }

  private tap(): void {
    const snap = this.snap
    if (!snap || this.resolved || !snap.players.includes(this.selfId)) return
    if (snap.falseStarts.includes(this.selfId) || this.selfId in snap.reactions) return
    const ms = this.greenShownAt === null ? undefined : performance.now() - this.greenShownAt
    this.sendInput(ms === undefined ? { kind: 'tap' } : { kind: 'tap', ms: Math.round(ms) })
    // The slap on the button sounds on the tap itself (a pre-green one just clicks: the server alone
    // calls a false start, then buzzes); the time and its chime arrive with the next snapshot.
    if (!this.wasGreen) this.sfx.click()
    else this.sfx.hit(0.8)
    // Instant "got it" on a post-green tap.
    if (this.wasGreen && this.greenLamp) {
      punch(this, this.greenLamp, -0.12, 70)
      ring(
        this,
        this.greenLamp.x,
        this.greenLamp.y,
        PALETTE.text,
        this.greenLamp.displayWidth * 0.8,
      )
    }
  }

  private showTitle(text: string, color: number): void {
    if (!this.title) return
    if (this.title.text === text) return
    this.title.setText(text).setColor(hexToCss(color))
    fitText(this.title, this.titleMaxW, this.titleSize)
    punch(this, this.title, 0.2, 110)
  }

  protected frame(snap: ReactionSnapshot | null, time: number): void {
    if (!snap) return
    if (this.rows.length === 0) this.buildBoard(snap.players.length)
    const now = this.time.now
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      if (snap.light === 'red')
        this.greenAtLocal = Math.min(this.greenAtLocal, now + snap.greenInMs)
    }
    const green = snap.light === 'green' || now >= this.greenAtLocal
    const falseStart = snap.falseStarts.includes(this.selfId)
    const mine = snap.reactions[this.selfId]

    // A relayout restart mid-round restores the state as it is: no GO flash / buzzer / rating replay.
    const quiet = this.firstSnapshot
    if (green && !this.wasGreen) this.goMoment(quiet)
    if (!this.resolved && falseStart) this.onFalseStart(quiet)
    else if (!this.resolved && typeof mine === 'number') this.onReacted(mine, quiet)

    if (!green && !falseStart) {
      // Constant breathing pulse on the red lamp: pure tension, never a hint of when green comes.
      this.redLamp?.setAlpha(0.8 + 0.2 * Math.sin(time / 180))
    }
    if (!this.resolved) {
      this.showTitle(this.t(green ? 'game.reaction.tap' : 'game.reaction.wait'), PALETTE.text)
      this.status?.setText(this.t(green ? 'game.reaction.go' : 'game.reaction.instruction'))
    }
    this.renderBoard(snap)
  }

  private goMoment(quiet: boolean): void {
    this.wasGreen = true
    if (!quiet) this.greenShownAt = performance.now()
    this.bg?.setFillStyle(this.resolved ? OUT_BG : GO_BG)
    this.redLamp?.setTexture(this.keys.redOff).setAlpha(1)
    this.greenLamp?.setTexture(this.keys.greenOn)
    if (this.resolved || quiet) return
    this.sfx.go()
    flash(this, PALETTE.lime, 120)
    shake(this, 0.006, 140)
    if (this.greenLamp) {
      punch(this, this.greenLamp, 0.25, 120)
      ring(this, this.greenLamp.x, this.greenLamp.y, PALETTE.lime, this.greenLamp.displayWidth)
    }
  }

  private onFalseStart(quiet: boolean): void {
    this.resolved = true
    if (!quiet) {
      this.sfx.wrong()
      shake(this, 0.014, 260)
      flash(this, PALETTE.red, 160)
    }
    this.bg?.setFillStyle(OUT_BG)
    this.redLamp?.setAlpha(1)
    this.showTitle(this.t('game.reaction.tooEarly'), PALETTE.red)
    this.status?.setText(this.t('game.reaction.falseStart'))
  }

  private onReacted(ms: number, quiet: boolean): void {
    this.resolved = true
    this.showTitle(this.t('game.reaction.ms', { ms }), PALETTE.lime)
    this.status?.setText(`${this.t('game.reaction.nice')}\n${this.t('game.common.waiting')}`)
    if (!this.title || quiet) return
    this.sfx.correct()
    const { x, y } = this.title
    burst(this, x, y, PALETTE.lime, 22, 280)
    const rating = RATINGS.find(([limit]) => ms < limit)
    if (rating) floatText(this, x, y + this.title.height, this.t(rating[1]), rating[2], 24)
  }

  // One row per round player, filled column by column. One column fits most rooms; a big room (or a
  // short landscape screen) gets two or three, as the width allows.
  private buildBoard(n: number): void {
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const avail = height - this.boardTop - 6
    const colsFor = (w: number): number => Math.floor((width * 0.94 + BOARD_COL_GAP) / w)
    let cols = n > BOARD_ONE_COLUMN && colsFor(320) >= 2 ? 2 : 1
    while (cols < 3 && avail / Math.ceil(n / cols) < BOARD_MIN_ROW_H && colsFor(260) > cols) cols++
    const perCol = Math.ceil(n / cols)
    const rowH = Math.max(16, Math.min(compact ? 24 : 30, avail / perCol))
    const boardW = Math.min(520, (width * 0.94 - BOARD_COL_GAP * (cols - 1)) / cols)
    const left0 = width / 2 - (cols * boardW + (cols - 1) * BOARD_COL_GAP) / 2
    const icon = avatarPx(rowH - 4)
    for (let i = 0; i < n; i++) {
      const left = left0 + Math.floor(i / perCol) * (boardW + BOARD_COL_GAP)
      const y = this.boardTop + (i % perCol) * rowH + rowH / 2
      const frame = this.add
        .rectangle(left + boardW / 2, y, boardW, rowH - 3, PALETTE.bg, 0.72)
        .setStrokeStyle(2, PALETTE.text)
        .setDepth(5)
      // Each row leads with the player's avatar (texture set per player in renderBoard).
      const swatch = this.add
        .image(left + 8, y, ensureAvatarTexture(this, 'cat', PALETTE.dim, 1))
        .setOrigin(0, 0.5)
        .setDisplaySize(icon, icon)
        .setDepth(6)
      const name = this.add
        .text(left + 14 + icon, y, '', bodyStyle(compact || rowH < 22 ? 13 : 16, PALETTE.text))
        .setOrigin(0, 0.5)
        .setDepth(6)
      const value = this.add
        .text(left + boardW - 10, y, '', headlineStyle(compact || rowH < 22 ? 8 : 16, PALETTE.text))
        .setOrigin(1, 0.5)
        .setDepth(6)
      this.rows.push({ swatch, name, value, frame, key: '' })
      for (const o of [frame, swatch, name, value]) o.setVisible(false)
    }
  }

  // Every round player: fastest first, then those still waiting, then false starts.
  private renderBoard(snap: ReactionSnapshot): void {
    const order = (id: string): number => {
      const ms = snap.reactions[id]
      if (typeof ms === 'number') return ms
      return snap.falseStarts.includes(id) ? 2e9 : 1e9
    }
    const ranked = [...snap.players].sort((a, b) => order(a) - order(b))
    this.rows.forEach((row, i) => {
      const id = ranked[i]
      const visible = id !== undefined
      for (const o of [row.frame, row.swatch, row.name, row.value]) o.setVisible(visible)
      if (!id) return
      const ms = snap.reactions[id]
      const out = snap.falseStarts.includes(id)
      const key = `${id}:${ms ?? ''}:${out}`
      if (key === row.key) return
      row.key = key
      const arrived = (typeof ms === 'number' || out) && !this.shown.has(id)
      if (arrived) this.shown.add(id)
      const color = this.state.colorOf(id, PALETTE.dim)
      const face = i === 0 && typeof ms === 'number' ? 'happy' : out ? 'hurt' : 'idle'
      row.swatch.setTexture(
        ensureAvatarTexture(this, this.state.avatarOf(id), color, 1, 'front', face),
      )
      row.name.setText(this.label(id)).setColor(hexToCss(color))
      row.frame.setStrokeStyle(id === this.selfId ? 2 : 0, PALETTE.text)
      if (typeof ms === 'number') {
        const first = i === 0
        row.value
          .setText(`${first ? '★ ' : ''}${this.t('game.reaction.ms', { ms })}`)
          .setColor(hexToCss(first ? PALETTE.amber : PALETTE.text))
      } else if (out) {
        row.value.setText(this.t('game.reaction.falseStartTag')).setColor(hexToCss(PALETTE.red))
      } else {
        row.value.setText('...').setColor(hexToCss(PALETTE.dim))
      }
      if (arrived) punch(this, row.value, 0.3, 100)
    })
  }
}
