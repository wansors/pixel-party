import { PALETTE, type QuizLang, type QuizReveal, type TriviaSnapshot } from '@pp/shared'
import type Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
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
// Picker heads perched on the answer tiles at the reveal (32 px = a crisp 2x avatar).
const PICK_PX = 32
const PICK_PIXEL = PICK_PX / 16
// Rooms bigger than this get an extra row of contestant lights.
const LIGHTS_PER_ROW = 6

const CHECK_ROWS = ['______oo', '_____oo_', 'oo__oo__', '_oooo___', '__oo____']
const CROSS_ROWS = ['oo___oo', '_oo_oo_', '__ooo__', '_oo_oo_', 'oo___oo']

// The wire shape every quiz game shares (a game may extend its reveal, e.g. Weird Trivia's fun fact).
export type QuizSnapshot = Omit<TriviaSnapshot, 'reveal'> & { reveal: QuizReveal | null }

// What the board shows of a snapshot, in the player's language.
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
  // Round players still in play.
  players: readonly string[]
  // The verdict on the question on screen, once it closes.
  reveal: QuizReveal | null
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
// board, four chunky lettered answer tiles (tap or keys 1-4) and contestant lights for every player
// showing who has locked in. Answers are tagged with the question index so the server drops stale
// taps. Each question ends with a reveal: the right tile lights up, this player's pick gets its
// verdict (unless the game gave it at lock-in, `onLocked`), every player's avatar pops onto the tile
// they picked and the lights turn into who scored.
export abstract class QuizSceneBase<S extends QuizSnapshot> extends MiniGameScene<S> {
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
  // The status line while a question is open and this player hasn't answered.
  protected hintKey = 'game.trivia.hint'
  private revealedIndex = -1
  private pickIcons: Phaser.GameObjects.Image[] = []
  private marquee?: Phaser.GameObjects.Graphics
  private rightKey = ''
  private wrongKey = ''
  private checkKey = ''
  private crossKey = ''
  private questionFont = 0
  private lightPhase = -1

  protected view(snap: S): QuizView {
    const text = snap.text?.[this.lang()] ?? null
    return {
      index: snap.index,
      total: snap.total,
      question: text?.q ?? null,
      choices: text?.choices ?? [],
      open: snap.phase === 'question',
      answered: snap.answeredCurrent,
      scores: snap.scores,
      players: snap.players,
      reveal: snap.reveal,
    }
  }

  // The clock is the answer window (it refills with each question); the reveal has none.
  protected override remainingMs(snap: S): number | null {
    if (snap.phase === 'done') return 0
    return snap.phase === 'question' ? snap.phaseRemainingMs : null
  }

  // The question banks ship every language; this is the player's (each translation bundle names its
  // own code — Phaser scenes only see the translate function).
  protected lang(): QuizLang {
    return this.t('lang.code') === 'es' ? 'es' : 'en'
  }

  // Called every frame once the board is up to date: a game that scores an answer the moment it lands
  // can give this player's verdict here, before the reveal.
  protected onLocked(_v: QuizView): void {}

  override create(): void {
    super.create()
    this.tiles = []
    this.shownIndex = -1
    this.pick = null
    this.revealed = false
    this.revealedIndex = -1
    this.pickIcons = []
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

    // Contestant lights: every player, lit once they have locked an answer for this question. The
    // roster sizes the rows (the round's players arrive with the first snapshot).
    const chipSize = compact ? 11 : 13
    const roster = Object.keys(this.state.names).length
    const stripRows = (twoCols ? 1 : 2) + (roster > LIGHTS_PER_ROW ? 1 : 0)
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
    if (!(this.selfId in v.scores)) return
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
    this.onLocked(v)
    if (snap.reveal && this.revealedIndex !== v.index) {
      this.revealedIndex = v.index
      this.showReveal(snap.reveal as NonNullable<S['reveal']>, v)
    }

    const locked =
      v.question !== null && (this.pick?.index === v.index || v.answered.includes(this.selfId))
    this.paintTiles(v, locked, time)
    this.strip?.set(v.question === null ? [] : this.chips(v))
    this.status?.setText(this.statusText(v, locked))
    this.drawLights(Math.floor(time / 180))
  }

  // The question closed: the right tile lights up, this player's pick gets its verdict (if the game
  // hasn't given it yet), a "TIME UP!" if they never answered, and everybody's picks pop onto the tiles.
  protected showReveal(reveal: NonNullable<S['reveal']>, v: QuizView): void {
    const mine = reveal.picks[this.selfId]
    // A restart mid-reveal (relayout) redraws it without replaying the cheers.
    const quiet = this.firstSnapshot
    if (mine === undefined) {
      if (!quiet && this.selfId in v.scores) this.timeUp()
    } else if (!quiet && !this.revealed) {
      this.revealPick(v.index, mine, reveal.gained[this.selfId] ?? 0)
    } else {
      this.markTile(mine, mine === reveal.correct)
    }
    if (mine !== reveal.correct) this.markTile(reveal.correct, true)
    this.revealed = true
    this.perchPickers(reveal, Object.keys(v.scores))
  }

  // Each player's avatar pops onto the top edge of the tile they picked, right to left.
  private perchPickers(reveal: QuizReveal, players: string[]): void {
    this.tiles.forEach((tile, slot) => {
      const pickers = players.filter((id) => reveal.picks[id] === slot)
      if (pickers.length === 0) return
      const room = tile.w - 24
      const step = Math.min(PICK_PX + 4, (room - PICK_PX) / Math.max(1, pickers.length - 1))
      const right = slot === reveal.correct
      pickers.forEach((id, i) => {
        const key = ensureAvatarTexture(
          this,
          this.state.avatarOf(id),
          this.state.colorOf(id),
          PICK_PIXEL,
          'front',
          right ? 'happy' : 'hurt',
        )
        const x = Math.round(tile.x + tile.w / 2 - 12 - PICK_PX / 2 - i * step)
        // Perched on the top edge, clear of the label and (mostly) of the tile above.
        const y = Math.round(tile.y - tile.h / 2 + (this.compact ? 8 : 2))
        const icon = this.add.image(x, y, key).setDepth(5).setScale(0)
        this.tweens.add({
          targets: icon,
          scale: 1,
          duration: 160,
          delay: 120 + i * 70,
          ease: 'Back.easeOut',
        })
        this.pickIcons.push(icon)
      })
    })
  }

  // Locked: the other tiles fade and the picked one's outline blinks until it is revealed. At the
  // reveal, the right tile and this player's pick stay lit.
  protected paintTiles(v: QuizView, locked: boolean, time: number): void {
    const reveal = v.reveal
    this.tiles.forEach((tile, i) => {
      const mine = locked && this.pick?.choice === i
      const lit = reveal ? i === reveal.correct || i === reveal.picks[this.selfId] : !locked || mine
      for (const o of [tile.shadow, tile.face, tile.badge, tile.label]) o.setAlpha(lit ? 1 : 0.3)
      if (mine && !this.revealed) tile.outline.setAlpha(Math.floor(time / 160) % 2 ? 1 : 0.25)
    })
  }

  // Contestant lights: everybody's avatar, lit once they have locked in — and at the reveal, lit (with
  // the points) when they scored on this question.
  protected chips(v: QuizView): PlayerChip[] {
    const reveal = v.reveal
    return Object.keys(v.scores).map((id) => {
      const name = this.label(id).slice(0, 10).toUpperCase()
      const gained = reveal?.gained[id] ?? 0
      const lit = reveal ? gained > 0 : v.answered.includes(id)
      const tag = reveal ? (lit ? ` +${gained}` : '') : lit ? ' ✓' : ''
      return {
        text: `${name}${tag}`,
        avatar: this.state.avatarOf(id),
        color: this.state.colorOf(id),
        dim: !lit,
      }
    })
  }

  protected statusText(v: QuizView, locked: boolean): string {
    if (v.question === null) return this.t('game.common.waiting')
    if (v.reveal) return v.index + 1 < v.total ? this.t('game.trivia.getReady') : ''
    return this.t(locked ? 'game.trivia.locked' : this.hintKey)
  }

  private showQuestion(v: QuizView): void {
    for (const icon of this.pickIcons) icon.destroy()
    this.pickIcons = []
    this.shownIndex = v.index
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
  private markTile(choice: number, right: boolean): void {
    const tile = this.tiles[choice]
    if (!tile) return
    tile.face.setTexture(right ? this.rightKey : this.wrongKey)
    tile.outline.setAlpha(1).setStrokeStyle(3, right ? PALETTE.text : PALETTE.red)
    tile.badge.setVisible(false)
    tile.icon.setTexture(right ? this.checkKey : this.crossKey).setVisible(true)
  }

  // Reveals this player's pick (once): the tile verdict plus a cheer (and the points) or a buzz.
  protected revealPick(index: number, choice: number, gained: number): void {
    const tile = this.tiles[choice]
    if (index !== this.shownIndex || !tile || this.revealed) return
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
