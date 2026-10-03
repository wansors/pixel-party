import { PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { addBanner, burst, floatText, punch, ring, shake, showBanner } from '../fx'
import {
  bodyStyle,
  ensureBevelPanel,
  ensurePixelGrid,
  fitText,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { type PlayerChip, PlayerStrip } from '../playerStrip'
import { MiniGameScene } from './MiniGameScene'

// Answer tile colors, quiz-show style. None of them is a reveal color (lime = right, red = wrong), so a
// revealed tile can never be mistaken for an idle one.
const CHOICE_COLORS = [PALETTE.magenta, PALETTE.cyan, PALETTE.amber, 0x5b8cff]
const LETTERS = ['A', 'B', 'C', 'D']
const RIGHT_COLOR = PALETTE.lime
const WRONG_COLOR = shade(PALETTE.red, -0.25)
const PRESS_PX = 4
const MAX_CHIPS = 6

const CHECK_ROWS = ['______oo', '_____oo_', 'oo__oo__', '_oooo___', '__oo____']
const CROSS_ROWS = ['oo___oo', '_oo_oo_', '__ooo__', '_oo_oo_', 'oo___oo']

// What a quiz scene reads from its game's snapshot, whatever the wire shape.
export interface QuizView {
  index: number
  total: number
  // The question on screen (null once the round is over).
  question: string | null
  choices: readonly string[]
  // Whether answers are accepted right now.
  open: boolean
  // Players who locked an answer for the question on screen.
  answered: readonly string[]
  scores: Record<string, number>
}

export interface QuizTile {
  shadow: Phaser.GameObjects.Image
  face: Phaser.GameObjects.Image
  badge: Phaser.GameObjects.Text
  icon: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  outline: Phaser.GameObjects.Rectangle
  idleKey: string
  x: number
  y: number
  w: number
  h: number
  labelX: number
  labelSize: number
  labelMaxW: number
}

export interface QuizPick {
  index: number
  choice: number
  at: number
  scoreBefore: number
  judged: boolean
}

// The quiz-show board shared by the quiz games (Lightning Quiz, Weird Trivia): a marquee-lit question
// board, four chunky lettered answer tiles (tap or keys 1-4) and a row of contestant lights showing who
// has locked in. Answers are tagged with the question index so the server drops stale taps. Subclasses
// map their snapshot to a QuizView and decide when a locked pick is judged (`judge`).
export abstract class QuizSceneBase<S> extends MiniGameScene<S> {
  protected tiles: QuizTile[] = []
  protected question?: Phaser.GameObjects.Text
  protected progress?: Phaser.GameObjects.Text
  protected status?: Phaser.GameObjects.Text
  protected panel?: Phaser.GameObjects.Image
  protected strip?: PlayerStrip
  protected banner?: Phaser.GameObjects.Text
  protected panelBox = { x: 0, y: 0, w: 0, h: 0 }
  protected compact = false
  protected shownIndex = -1
  protected pick: QuizPick | null = null
  // The pick on screen has been revealed (right/wrong).
  protected revealed = false
  // Float "TIME UP!" when the next question lands and this player never locked one in. A game with its
  // own reveal phase says it there instead.
  protected timeUpOnAdvance = true
  private marquee?: Phaser.GameObjects.Graphics
  private rightKey = ''
  private wrongKey = ''
  private checkKey = ''
  private crossKey = ''
  private questionFont = 0
  // Whether this player locked an answer for the question on screen (from the pick or the snapshot).
  private lockedShown = false
  private lightPhase = -1

  protected abstract view(snap: S): QuizView
  // Called every frame after the board is up to date: judge a locked pick, play a reveal.
  protected abstract judge(snap: S, view: QuizView): void

  override create(): void {
    super.create()
    this.tiles = []
    this.shownIndex = -1
    this.pick = null
    this.lockedShown = false
    this.revealed = false
    this.lightPhase = -1
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    this.compact = compact
    const cx = width / 2
    const contentW = Math.min(width - (compact ? 32 : 64), 960)
    const twoCols = width >= 600
    let y = this.top + (compact ? 4 : 8)

    const progressSize = 16
    this.progress = this.add
      .text(cx, y, '', headlineStyle(progressSize, PALETTE.amber))
      .setOrigin(0.5, 0)
    y += progressSize + (compact ? 10 : 14)

    // Question board: a beveled panel framed by chasing marquee bulbs.
    const panelH = Math.round(Math.min(compact ? 170 : 180, height * 0.22))
    const panelW = Math.round(contentW)
    this.panelBox = { x: cx - panelW / 2, y, w: panelW, h: panelH }
    this.panel = this.add
      .image(cx, y + panelH / 2, ensureBevelPanel(this, panelW, panelH, PALETTE.panelAlt, 6, true))
      .setDepth(1)
    this.marquee = this.add.graphics().setDepth(2)
    this.questionFont = compact ? 19 : 26
    this.question = this.add
      .text(
        cx,
        y + panelH / 2,
        '',
        bodyStyle(this.questionFont, PALETTE.text, {
          align: 'center',
          fontStyle: 'bold',
          wordWrap: { width: panelW - 48 },
        }),
      )
      .setOrigin(0.5)
      .setDepth(3)
    y += panelH + (compact ? 14 : 18)

    // Contestant lights: who has locked an answer for this question.
    const chipSize = compact ? 11 : 13
    const stripRows = twoCols ? 1 : 2
    this.strip = new PlayerStrip(this, cx, y, contentW, chipSize, stripRows)
    y += stripRows * PlayerStrip.rowH(chipSize)

    const statusY = height - (compact ? 16 : 22)
    this.status = this.add
      .text(cx, statusY, '', bodyStyle(compact ? 13 : 16, PALETTE.dim))
      .setOrigin(0.5)

    // Answer tiles: 2x2 on wide screens, a single column on phones.
    const cols = twoCols ? 2 : 1
    const rows = 4 / cols
    const gap = compact ? 10 : 16
    const areaTop = y
    const areaH = statusY - 18 - areaTop
    const tileW = Math.round((contentW - gap * (cols - 1)) / cols)
    const tileH = Math.round(Math.min(compact ? 84 : 120, (areaH - gap * (rows - 1)) / rows))
    const blockH = rows * tileH + (rows - 1) * gap
    const blockTop = areaTop + Math.min(32, Math.max(0, (areaH - blockH) / 3))
    const labelSize = compact ? 16 : 24
    this.rightKey = ensureBevelPanel(this, tileW, tileH, RIGHT_COLOR, 4, true)
    this.wrongKey = ensureBevelPanel(this, tileW, tileH, WRONG_COLOR, 4, true)
    const shadowKey = ensureBevelPanel(this, tileW, tileH, shade(PALETTE.bg, -0.5), 0, true)
    const legend = { o: PALETTE.text }
    const iconSpec = { legend, pixelSize: 1 }
    this.checkKey = ensurePixelGrid(this, { key: 'pp-trivia-check', rows: CHECK_ROWS, ...iconSpec })
    this.crossKey = ensurePixelGrid(this, { key: 'pp-trivia-cross', rows: CROSS_ROWS, ...iconSpec })
    for (let i = 0; i < 4; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = cx - contentW / 2 + tileW / 2 + col * (tileW + gap)
      const ty = blockTop + tileH / 2 + row * (tileH + gap)
      const color = CHOICE_COLORS[i] ?? PALETTE.cyan
      const idle = ensureBevelPanel(this, tileW, tileH, color, 4, true)
      const shadow = this.add.image(x, ty + PRESS_PX, shadowKey)
      const face = this.add.image(x, ty, idle).setInteractive({ useHandCursor: true })
      face.on('pointerdown', () => this.answer(i))
      const badgeX = x - tileW / 2 + (compact ? 26 : 34)
      const badge = this.add
        .text(
          badgeX,
          ty,
          LETTERS[i] ?? '',
          headlineStyle(labelSize, PALETTE.text, {
            backgroundColor: hexToCss(shade(color, -0.55)),
            padding: { x: 7, y: 6 },
          }),
        )
        .setOrigin(0.5)
      const icon = this.add
        .image(badgeX, ty, this.checkKey)
        .setScale(compact ? 3 : 4)
        .setVisible(false)
      const labelLeft = badgeX + (compact ? 24 : 32)
      const labelMaxW = x + tileW / 2 - 14 - labelLeft
      const label = this.add
        .text(
          labelLeft + labelMaxW / 2,
          ty,
          '',
          headlineStyle(labelSize, PALETTE.text, { stroke: '#10121c', strokeThickness: 4 }),
        )
        .setOrigin(0.5)
      const outline = this.add
        .rectangle(x, ty, tileW + 8, tileH + 8)
        .setStrokeStyle(3, PALETTE.text)
        .setVisible(false)
      this.tiles.push({
        shadow,
        face,
        badge,
        icon,
        label,
        outline,
        idleKey: idle,
        x,
        y: ty,
        w: tileW,
        h: tileH,
        labelX: labelLeft + labelMaxW / 2,
        labelSize,
        labelMaxW,
      })
    }

    this.banner = addBanner(this).setFontSize(compact ? 24 : 32)
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= 4) this.answer(n - 1)
    })
  }

  private answer(choice: number): void {
    const snap = this.snap
    if (!snap) return
    const v = this.view(snap)
    if (!v.open || v.question === null || choice >= v.choices.length) return
    if (v.answered.includes(this.selfId) || this.pick?.index === v.index) return
    this.pick = {
      index: v.index,
      choice,
      at: this.time.now,
      scoreBefore: v.scores[this.selfId] ?? 0,
      judged: false,
    }
    this.sfx.click()
    this.pressTile(choice)
    this.sendInput({ kind: 'answer', question: v.index, choice })
  }

  // Locked-in look: the tile sinks onto its shadow and gets a (blinking) white outline.
  private pressTile(choice: number): void {
    const tile = this.tiles[choice]
    if (!tile) return
    for (const o of [tile.face, tile.badge, tile.icon, tile.label]) o.setY(tile.y + PRESS_PX)
    tile.outline.setY(tile.y + PRESS_PX).setVisible(true)
    punch(this, tile.face, 0.04, 70)
  }

  protected frame(snap: S | null, time: number): void {
    if (!snap) return
    const v = this.view(snap)
    this.hud?.setScore(this.t('game.common.pts', { n: v.scores[this.selfId] ?? 0 }))
    if (v.index !== this.shownIndex) this.showQuestion(v)
    this.judge(snap, v)

    const locked =
      v.question !== null && (this.pick?.index === v.index || v.answered.includes(this.selfId))
    this.lockedShown = locked
    this.paintTiles(v, locked, time)
    this.strip?.set(v.question === null ? [] : this.chips(v).slice(0, MAX_CHIPS))
    this.status?.setText(this.statusText(v, locked))
    this.drawLights(Math.floor(time / 180))
  }

  // Locked: the other tiles fade and the picked one's outline blinks until it is revealed.
  protected paintTiles(_v: QuizView, locked: boolean, time: number): void {
    this.tiles.forEach((tile, i) => {
      const mine = locked && this.pick?.choice === i
      const alpha = locked && !mine ? 0.3 : 1
      for (const o of [tile.shadow, tile.face, tile.badge, tile.label]) o.setAlpha(alpha)
      if (mine && !this.revealed) tile.outline.setAlpha(Math.floor(time / 160) % 2 ? 1 : 0.25)
    })
  }

  // Contestant lights: everybody's avatar, lit once they have locked in.
  protected chips(v: QuizView): PlayerChip[] {
    return Object.keys(v.scores).map((id) => {
      const done = v.answered.includes(id)
      const name = this.label(id).slice(0, 10).toUpperCase()
      return {
        text: done ? `${name} ✓` : name,
        avatar: this.state.avatarOf(id),
        color: this.state.colorOf(id),
        dim: !done,
      }
    })
  }

  protected statusText(v: QuizView, locked: boolean): string {
    if (v.question === null) return this.t('game.common.waiting')
    return this.t(locked ? 'game.trivia.locked' : 'game.trivia.hint')
  }

  private showQuestion(v: QuizView): void {
    // Moving on without ever locking an answer: the clock beat us.
    if (this.timeUpOnAdvance && this.shownIndex >= 0 && !this.lockedShown) this.timeUp()
    this.shownIndex = v.index
    this.lockedShown = false
    this.revealed = false
    this.progress
      ?.setText(
        this.t('game.trivia.progress', {
          index: Math.min(v.index + 1, v.total),
          total: v.total,
        }),
      )
      .setColor(hexToCss(PALETTE.amber))
    this.question?.setColor(hexToCss(PALETTE.text))
    this.onQuestionShown(v)

    if (v.question === null) {
      for (const tile of this.tiles) this.setTileVisible(tile, false)
      this.question?.setText('')
      if (this.banner) showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.amber)
      return
    }

    this.fitBoardText(v.question)
    if (this.panel) punch(this, this.panel, 0.03, 90)
    this.sfx.tick()
    this.tiles.forEach((tile, i) => {
      const has = i < v.choices.length
      this.setTileVisible(tile, has)
      if (!has) return
      tile.face.setTexture(tile.idleKey)
      tile.icon.setVisible(false)
      tile.badge.setVisible(true)
      tile.outline.setVisible(false).setAlpha(1).setStrokeStyle(3, PALETTE.text)
      tile.label.setText(v.choices[i] ?? '')
      // Snappy staggered drop-in (also undoes any press offset / wrong-answer wiggle).
      tile.outline.setPosition(tile.x, tile.y)
      tile.label.setX(tile.labelX)
      for (const o of [tile.face, tile.badge, tile.icon, tile.label]) {
        this.tweens.killTweensOf(o)
        o.setY(tile.y - 14)
        this.tweens.add({
          targets: o,
          y: tile.y,
          duration: 120,
          delay: i * 45,
          ease: 'Back.easeOut',
        })
      }
      tile.face.setX(tile.x)
      tile.icon.setX(tile.badge.x)
    })
    this.fitLabels(v.choices.length)
  }

  // Every answer gets the same (crisp) size: the largest one at which the longest of them still fits.
  private fitLabels(count: number): void {
    const tiles = this.tiles.slice(0, count)
    for (const tile of tiles) fitText(tile.label, tile.labelMaxW, tile.labelSize)
    const sizes = tiles.map((tile) => Number.parseInt(String(tile.label.style.fontSize), 10))
    const size = Math.min(...sizes)
    if (Number.isFinite(size)) for (const tile of tiles) tile.label.setFontSize(size)
  }

  // Hook: a new question (or the end of the round) just landed on the board.
  protected onQuestionShown(_v: QuizView): void {}

  protected timeUp(): void {
    this.sfx.wrong()
    const { x, y, w, h } = this.panelBox
    floatText(this, x + w / 2, y + h, this.t('game.trivia.timeUp'), PALETTE.red, 22)
  }

  private setTileVisible(tile: QuizTile, visible: boolean): void {
    for (const o of [tile.shadow, tile.face, tile.badge, tile.label]) o.setVisible(visible)
    if (!visible) {
      tile.icon.setVisible(false)
      tile.outline.setVisible(false)
    }
  }

  // Paints a tile right (lime + check) or wrong (red + cross).
  protected markTile(choice: number, right: boolean): void {
    const tile = this.tiles[choice]
    if (!tile) return
    tile.face.setTexture(right ? this.rightKey : this.wrongKey)
    tile.outline.setAlpha(1).setStrokeStyle(3, right ? PALETTE.text : PALETTE.red)
    tile.badge.setVisible(false)
    tile.icon.setTexture(right ? this.checkKey : this.crossKey).setVisible(true)
  }

  // Reveals this player's pick: the tile verdict plus a cheer (and the points) or a buzz.
  protected revealPick(index: number, choice: number, gained: number): void {
    const tile = this.tiles[choice]
    if (index !== this.shownIndex || !tile) return
    this.revealed = true
    const right = gained > 0
    this.markTile(choice, right)
    const { x } = tile.face
    const y = tile.y + PRESS_PX
    if (right) {
      this.sfx.correct()
      ring(this, x, y, RIGHT_COLOR, tile.face.width * 0.4)
      burst(this, x, y, RIGHT_COLOR, 18, 240)
      floatText(this, x, y - tile.face.height / 2, `+${gained}`, PALETTE.amber, 22)
      punch(this, tile.face, 0.06, 100)
    } else {
      this.sfx.wrong()
      shake(this, 0.008, 200)
      floatText(this, x, y - tile.face.height / 2, this.t('game.common.wrong'), PALETTE.red, 20)
      for (const o of [tile.face, tile.icon, tile.label, tile.outline]) {
        this.tweens.add({ targets: o, x: o.x + 6, duration: 45, yoyo: true, repeat: 2 })
      }
    }
  }

  // Shows a text on the question board, shrinking it until it fits.
  protected fitBoardText(text: string): void {
    const q = this.question
    if (!q) return
    let size = this.questionFont
    q.setFontSize(size).setText(text)
    while (q.height > this.panelBox.h - 28 && size > 12) {
      size -= 1
      q.setFontSize(size)
    }
  }

  // Chasing marquee bulbs along the top and bottom edges of the question board.
  private drawLights(phase: number): void {
    const g = this.marquee
    if (!g || phase === this.lightPhase) return
    this.lightPhase = phase
    const { x, y, w, h } = this.panelBox
    const step = 18
    const count = Math.floor((w - 16) / step)
    const left = x + (w - (count - 1) * step) / 2
    const unlit = shade(PALETTE.amber, -0.65)
    g.clear()
    for (let i = 0; i < count; i++) {
      // Top row chases right, bottom row chases left.
      const bx = Math.round(left + i * step - 3)
      g.fillStyle((i + 3 - (phase % 3)) % 3 === 0 ? PALETTE.amber : unlit, 1)
      g.fillRect(bx, Math.round(y + 5), 6, 6)
      g.fillStyle((i + phase) % 3 === 0 ? PALETTE.amber : unlit, 1)
      g.fillRect(bx, Math.round(y + h - 11), 6, 6)
    }
  }
}
