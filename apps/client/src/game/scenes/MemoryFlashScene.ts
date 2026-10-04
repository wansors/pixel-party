import {
  MEMORY_FLASH_COLORS,
  type MemoryFlashBoard,
  type MemoryFlashSnapshot,
  PALETTE,
} from '@pp/shared'
import Phaser from 'phaser'
import { addBanner, burst, floatText, punch, ring, shake, showBanner } from '../fx'
import {
  bodyStyle,
  ensureBevelPanel,
  ensurePixelBlock,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const CHOICES = 4
// Answer tile looks: base colour per state.
const TILE = {
  up: PALETTE.frameLit,
  down: PALETTE.frame,
  locked: PALETTE.panelAlt,
  right: shade(PALETTE.lime, -0.2),
  wrong: shade(PALETTE.red, -0.1),
} as const
// The everyone strip (PlayerStrip) rebuilds every chip from scratch on any change — new Text objects,
// each measuring its font again — which cost a frame per snapshot once a full room was scoring. It
// follows the scores at most twice a second; your own score in the HUD stays immediate.
const STRIP_EVERY_MS = 500

type TileLook = keyof typeof TILE
// How long an answered button keeps its right/wrong colour while the next board flashes.
const VERDICT_MS = 420
// A create() within this long of the scene's own shutdown is a relayout restart mid-round (a new round
// only starts seconds after the previous one stopped) — the one case where a memo may carry over.
const RELAYOUT_GAP_MS = 1000
// Typing the count: digits typed within this long of each other build one number, and a typed number
// that a longer choice still starts with ("1" with 12 on offer) waits this long for its next digit.
const TYPE_GAP_MS = 1200
const TYPE_COMMIT_MS = 500

interface ChoiceBtn {
  img: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  look: TileLook
}

// Memory Flash canvas. Each new board flashes its coloured pixels inside an arcade frame (a draining
// bar shows how long they stay), then hides them and asks "how many <colour>?" with four chunky answer
// tiles: click one, type the number (it shows in the board; a unique match answers at once), or move a
// cursor with the arrows / WASD and press Enter / Space. The server owns the true counts; right/wrong
// is read off the score delta when the player's board advances, and shown on the tile that was picked.
export class MemoryFlashScene extends MiniGameScene<MemoryFlashSnapshot> {
  private prompt?: Phaser.GameObjects.Text
  private swatches: Phaser.GameObjects.Image[] = []
  private levelText?: Phaser.GameObjects.Text
  private boardGfx?: Phaser.GameObjects.Graphics
  private flashBar?: Phaser.GameObjects.Rectangle
  private question?: Phaser.GameObjects.Text
  private waitText?: Phaser.GameObjects.Text
  private banner?: Phaser.GameObjects.Text
  // Everyone's score at a glance (avatar + name + points) under the HUD.
  private strip?: PlayerStrip
  private stripSnap?: MemoryFlashSnapshot
  private scoreSnap?: MemoryFlashSnapshot
  private stripAt = 0
  // The keyboard path, named on screen (hidden on touch-sized screens).
  private hint?: Phaser.GameObjects.Text
  // Keyboard cursor over the answer tiles (shown once an arrow key is used).
  private cursorBox?: Phaser.GameObjects.Rectangle
  private cursor = 0
  private cursorOn = false
  // Digits typed for the board on screen, when the last one landed, and a pending exact-match answer.
  private typed = ''
  private typedAt = 0
  private commitAt = 0
  // State of the tiles/prompt last drawn, so they're only touched when something changes.
  private drawnKey = ''
  private pixels: Phaser.GameObjects.Image[] = []
  private buttons: ChoiceBtn[] = []
  private boardCX = 0
  private boardCY = 0
  private boardArea = 0
  private framePad = 0
  private tileW = 0
  private tileH = 0
  private gridCols = 0
  private gridRows = 0
  private barW = 0
  private drawnLevel = -1
  private flashUntil = 0
  private flashMs = 1
  private lastScore = 0
  private lastLevel = -1
  private answeredLevel = -1
  private picked = -1
  private streak = 0
  private verdictUntil = 0
  private boardBorderReset = false
  private finished = false
  // Whether the board on screen was still flashing last frame (its pixels turning over is a cue).
  private wasFlashing = false
  // The flash window of the board on screen, kept across a relayout restart (create() clears it only
  // for a fresh round): an orientation flip or window resize mid-board resumes it instead of flashing
  // the pixels again — rotating the phone must not hand the player a second look.
  private flashMemo = { round: -1, level: -1, until: 0 }
  private stoppedAt = Number.NEGATIVE_INFINITY

  constructor(...deps: SceneDeps) {
    super('memory-flash', ...deps)
  }

  override create(): void {
    super.create()
    if (this.game.getTime() - this.stoppedAt > RELAYOUT_GAP_MS) {
      this.flashMemo = { round: -1, level: -1, until: 0 }
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stoppedAt = this.game.getTime()
    })
    this.pixels = []
    this.buttons = []
    this.swatches = []
    this.drawnLevel = -1
    this.flashUntil = 0
    this.lastScore = 0
    this.lastLevel = -1
    this.answeredLevel = -1
    this.picked = -1
    this.streak = 0
    this.verdictUntil = 0
    this.boardBorderReset = false
    this.finished = false
    this.wasFlashing = false
    this.gridCols = 0
    this.gridRows = 0
    this.stripSnap = undefined
    this.scoreSnap = undefined
    this.stripAt = 0
    this.hint = undefined
    this.cursor = 0
    this.cursorOn = false
    this.typed = ''
    this.typedAt = 0
    this.commitAt = 0
    this.drawnKey = ''

    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    // Everyone's chips read from the couch on a big (1080p) canvas.
    const stripSize = compact ? 11 : width >= 1400 && height >= 860 ? 16 : 13
    const stripRows = width < 600 ? 3 : 2
    const stripH = PlayerStrip.rowH(stripSize)
    this.strip = new PlayerStrip(
      this,
      width / 2,
      this.top + 2 + stripH / 2,
      width - 24,
      stripSize,
      stripRows,
    )
    const cx = width / 2
    const top = this.top + stripRows * stripH + 2
    const promptSize = compact ? 16 : 24
    const promptY = top + (compact ? 22 : 30)
    this.prompt = this.add
      .text(cx, promptY, '', headlineStyle(promptSize, PALETTE.text, { align: 'center' }))
      .setOrigin(0.5)
    for (let i = 0; i < 2; i++) {
      this.swatches.push(
        this.add
          .image(cx, promptY, this.blockKeyFor(PALETTE.red))
          .setDisplaySize(promptSize, promptSize)
          .setVisible(false),
      )
    }

    // The keys hint at the very bottom (keyboard screens only).
    const hintH = compact ? 0 : 26
    if (!compact) {
      this.hint = this.add
        .text(cx, height - 8, this.t('game.memoryFlash.keys'), bodyStyle(16, PALETTE.dim))
        .setOrigin(0.5, 1)
    }
    // Answer tiles: a 2x2 block anchored to the bottom (thumb reach on phones).
    const gap = compact ? 12 : 16
    const bh = Math.round(Phaser.Math.Clamp((height - top) * 0.1, 56, 84))
    const big = width >= 1400 && height >= 860
    const bw = Math.round(Math.min((width - gap * 3) / 2, big ? 320 : 260))
    this.tileW = bw
    this.tileH = bh
    const btnBottom = height - (compact ? 20 : 28) - hintH
    const btnTop = btnBottom - bh * 2 - gap
    for (let i = 0; i < CHOICES; i++) {
      const col = i % 2
      const row = Math.floor(i / 2)
      const x = cx + (col === 0 ? -1 : 1) * (bw / 2 + gap / 2)
      const y = btnTop + bh / 2 + row * (bh + gap)
      const img = this.add
        .image(x, y, this.tileKey('locked'))
        .setInteractive({ useHandCursor: true })
      img.on('pointerdown', () => this.answer(i))
      const label = this.add
        .text(
          x,
          y,
          '',
          headlineStyle(compact ? 24 : 32, PALETTE.text, { stroke: '#10121c', strokeThickness: 4 }),
        )
        .setOrigin(0.5)
      this.buttons.push({ img, label, look: 'locked' })
    }
    this.cursorBox = this.add
      .rectangle(0, 0, bw + 10, bh + 10)
      .setStrokeStyle(4, PALETTE.amber)
      .setDepth(4)
      .setVisible(false)
    this.wireKeys()

    // Board frame between the prompt and the tiles; the flash bar drains right under it.
    const boardTop = promptY + promptSize + (compact ? 22 : 28)
    const boardBottom = btnTop - (compact ? 30 : 40)
    // A big canvas (1080p) gets a bigger board; laptops and phones keep the old cap.
    this.boardArea = Math.max(120, Math.min(width * 0.86, boardBottom - boardTop, big ? 600 : 460))
    this.boardCX = cx
    this.boardCY = (boardTop + boardBottom) / 2
    const framePad = compact ? 10 : 14
    this.framePad = framePad
    this.boardGfx = this.add.graphics()
    this.levelText = this.add
      .text(
        cx - this.boardArea / 2 - framePad,
        this.boardCY - this.boardArea / 2 - framePad - 4,
        '',
        bodyStyle(compact ? 12 : 14, PALETTE.dim),
      )
      .setOrigin(0, 1)
    this.barW = this.boardArea + framePad * 2
    this.flashBar = this.add
      .rectangle(
        cx - this.barW / 2,
        this.boardCY + this.boardArea / 2 + framePad + 10,
        this.barW,
        compact ? 6 : 8,
        PALETTE.amber,
      )
      .setOrigin(0, 0.5)
    this.question = this.add
      .text(
        cx,
        this.boardCY,
        '?',
        headlineStyle(compact ? 64 : 96, PALETTE.frameLit, {
          stroke: '#10121c',
          strokeThickness: 10,
        }),
      )
      .setOrigin(0.5)
      .setDepth(5)
      .setVisible(false)
    this.waitText = this.add
      .text(
        cx,
        height / 2 + (compact ? 44 : 56),
        '',
        bodyStyle(compact ? 14 : 18, PALETTE.text, { stroke: '#10121c', strokeThickness: 4 }),
      )
      .setOrigin(0.5)
      .setDepth(951)
    this.banner = addBanner(this)
    // The kit's 34px banner overflows a phone on longer words ("¡TERMINADO!").
    if (compact) this.banner.setFontSize(24)
  }

  private blockKeyFor(color: number): string {
    return ensurePixelBlock(this, `pp-memflash-px-${color.toString(16)}`, 24, color, 3)
  }

  private tileKey(look: TileLook): string {
    return ensureBevelPanel(this, this.tileW, this.tileH, TILE[look])
  }

  private setTile(btn: ChoiceBtn, look: TileLook): void {
    if (btn.look === look) return
    btn.look = look
    btn.img.setTexture(this.tileKey(look))
  }

  // Arcade window around the grid (border tinted by the last verdict) plus one dark slot per cell, so
  // the grid's shape stays readable after the pixels hide.
  private drawBoardBack(border: number): void {
    const g = this.boardGfx
    if (!g) return
    const outer = Math.round(this.boardArea + this.framePad * 2)
    const x = Math.round(this.boardCX - outer / 2)
    const y = Math.round(this.boardCY - outer / 2)
    g.clear()
    g.fillStyle(shade(border, -0.45), 1).fillRect(x, y, outer, outer)
    g.fillStyle(border, 1).fillRect(x, y, outer - 4, outer - 4)
    g.fillStyle(PALETTE.panel, 1).fillRect(x + 4, y + 4, outer - 8, outer - 8)
    const n = Math.max(this.gridCols, this.gridRows)
    if (n === 0) return
    const gap = Math.max(2, Math.round(this.boardArea * 0.02))
    const size = (this.boardArea - gap * (n - 1)) / n
    const x0 = this.boardCX - this.boardArea / 2
    const y0 = this.boardCY - this.boardArea / 2
    const s = Math.round(size)
    for (let r = 0; r < this.gridRows; r++) {
      for (let c = 0; c < this.gridCols; c++) {
        const sx = Math.round(x0 + c * (size + gap))
        const sy = Math.round(y0 + r * (size + gap))
        g.fillStyle(shade(PALETTE.panel, -0.35), 1).fillRect(sx, sy, s, s)
        g.fillStyle(PALETTE.panelAlt, 1).fillRect(sx, sy + s - 2, s, 2)
      }
    }
  }

  private drawBoard(board: MemoryFlashBoard): void {
    for (const o of this.pixels) o.destroy()
    this.pixels = []
    this.gridCols = board.cols
    this.gridRows = board.rows
    this.drawBoardBack(PALETTE.frame)
    const n = Math.max(board.cols, board.rows)
    const gap = Math.max(2, Math.round(this.boardArea * 0.02))
    const size = (this.boardArea - gap * (n - 1)) / n
    const x0 = this.boardCX - this.boardArea / 2 + size / 2
    const y0 = this.boardCY - this.boardArea / 2 + size / 2
    for (let i = 0; i < board.cells.length; i++) {
      const color = MEMORY_FLASH_COLORS[Number(board.cells[i])]?.hex
      if (color === undefined) continue
      const x = x0 + (i % board.cols) * (size + gap)
      const y = y0 + Math.floor(i / board.cols) * (size + gap)
      this.pixels.push(
        this.add.image(x, y, this.blockKeyFor(color)).setDisplaySize(size, size).setDepth(2),
      )
    }
    this.drawnLevel = board.level
    this.flashMs = Math.max(1, board.flashMs)
    const memo = this.flashMemo
    if (memo.round === this.state.round && memo.level === board.level) {
      this.flashUntil = memo.until
    } else {
      this.flashUntil = this.time.now + board.flashMs
      this.flashMemo = { round: this.state.round, level: board.level, until: this.flashUntil }
      // The new board's pixels flip face up.
      this.sfx.flip()
    }
    this.levelText?.setText(this.t('game.common.level', { n: board.level + 1 }))
    this.typed = ''
    this.commitAt = 0
  }

  private currentBoard(snap: MemoryFlashSnapshot | null = this.snap): MemoryFlashBoard | null {
    const at = snap?.at[this.selfId]
    if (!snap || at === null || at === undefined) return null
    return snap.boards.find((b) => b.level === at) ?? null
  }

  // A board the player can answer right now (flash over, not answered yet).
  private answerable(): MemoryFlashBoard | null {
    const board = this.currentBoard()
    if (!board || this.time.now < this.flashUntil || this.answeredLevel === board.level) return null
    return board
  }

  // PC controls: type the number, or move the cursor over the tiles and press Enter / Space.
  private wireKeys(): void {
    const move = (dx: number, dy: number): void => {
      if (!this.answerable()) return
      if (this.cursorOn) {
        const col = (this.cursor % 2) + dx
        const row = Math.floor(this.cursor / 2) + dy
        this.cursor = Phaser.Math.Clamp(row, 0, 1) * 2 + Phaser.Math.Clamp(col, 0, 1)
      }
      this.cursorOn = true
      this.typed = ''
      this.commitAt = 0
      this.sfx.tick()
    }
    for (const [keys, dx, dy] of [
      [['LEFT', 'A'], -1, 0],
      [['RIGHT', 'D'], 1, 0],
      [['UP', 'W'], 0, -1],
      [['DOWN', 'S'], 0, 1],
    ] as const) {
      for (const k of keys) this.onKey(k, () => move(dx, dy))
    }
    const confirm = (): void => {
      const board = this.answerable()
      if (!board) return
      const exact = board.choices.findIndex((c) => String(c) === this.typed)
      if (exact >= 0) this.answer(exact)
      else if (this.cursorOn) this.answer(this.cursor)
      else move(0, 0)
    }
    this.onKey('ENTER', confirm)
    this.onKey('SPACE', confirm)
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return
      if (/^[0-9]$/.test(e.key)) this.typeDigit(e.key)
      else if (e.key === 'Backspace' && this.typed) {
        this.typed = this.typed.slice(0, -1)
        this.commitAt = 0
      }
    })
  }

  // A typed digit narrows the choices to those starting with the number typed so far; a unique exact
  // match answers at once, an exact match that a longer choice still extends ("1" vs 12) answers after
  // a short pause, and a number no choice starts with is rejected.
  private typeDigit(digit: string): void {
    const board = this.answerable()
    if (!board) return
    const now = this.time.now
    const choices = board.choices.map(String)
    const starts = (prefix: string): string[] => choices.filter((c) => c.startsWith(prefix))
    let typed = (now - this.typedAt > TYPE_GAP_MS ? '' : this.typed) + digit
    // Not the start of any choice: try the digit as the start of a fresh number instead.
    if (starts(typed).length === 0) typed = digit
    this.typedAt = now
    this.commitAt = 0
    if (starts(typed).length === 0) {
      // No tile starts with that: a dull tick and a flinch of the "?", nothing typed.
      this.typed = ''
      this.drawnKey = ''
      this.sfx.tick()
      if (this.question) punch(this, this.question, -0.15, 60)
      return
    }
    this.typed = typed
    this.cursorOn = false
    const exact = choices.indexOf(typed)
    if (exact >= 0 && starts(typed).length === 1) {
      this.answer(exact)
      return
    }
    this.sfx.tick()
    if (exact >= 0) this.commitAt = now + TYPE_COMMIT_MS
  }

  private answer(choice: number): void {
    const board = this.answerable()
    if (!board || choice >= board.choices.length) return
    this.answeredLevel = board.level
    this.picked = choice
    this.cursor = choice
    this.typed = ''
    this.commitAt = 0
    // Locked in on the press; the verdict arrives when the board advances.
    this.sfx.lock()
    const btn = this.buttons[choice]
    if (btn) {
      this.setTile(btn, 'down')
      punch(this, btn.label, -0.12, 70)
    }
    this.sendInput({ kind: 'answer', level: board.level, value: board.choices[choice] })
  }

  // Right/wrong verdict for the board just answered, shown on the picked tile and the board frame.
  private verdict(correct: boolean): void {
    const btn = this.buttons[this.picked]
    const at = btn ? { x: btn.img.x, y: btn.img.y } : { x: this.boardCX, y: this.boardCY }
    this.verdictUntil = this.time.now + VERDICT_MS
    if (btn) this.setTile(btn, correct ? 'right' : 'wrong')
    this.drawBoardBack(correct ? PALETTE.lime : PALETTE.red)
    this.boardBorderReset = true
    if (correct) {
      this.streak++
      // A streak of 3+ pays out as a combo arpeggio (longer the hotter it runs).
      if (this.streak >= 3) this.sfx.lineClear(Math.min(4, this.streak - 2))
      else this.sfx.correct()
      ring(this, at.x, at.y, PALETTE.lime, 60)
      burst(this, at.x, at.y, PALETTE.lime, 12, 180)
      floatText(this, at.x, at.y - 30, '+1', PALETTE.lime, 24)
      if (this.streak >= 3) {
        floatText(
          this,
          this.boardCX,
          this.boardCY - this.boardArea / 2 - 8,
          this.t('game.common.combo', { n: this.streak }),
          PALETTE.amber,
          16,
        )
      }
    } else {
      this.streak = 0
      this.sfx.wrong()
      shake(this, 0.006, 160)
      floatText(this, at.x, at.y - 30, this.t('game.common.wrong'), PALETTE.red, 16)
    }
  }

  private colorName(board: MemoryFlashBoard): string {
    const key = `game.memoryFlash.colors.${board.targetName}`
    const name = this.t(key)
    return name === key ? board.targetName : name
  }

  protected frame(snap: MemoryFlashSnapshot | null): void {
    if (!snap) return
    // Scores change only with a snapshot: the HUD chip follows each one, the strip is throttled.
    if (snap !== this.scoreSnap) {
      this.scoreSnap = snap
      this.hud?.setScore(this.t('game.common.correct', { n: snap.scores[this.selfId] ?? 0 }))
    }
    if (snap !== this.stripSnap && (this.time.now >= this.stripAt || this.state.final)) {
      this.stripSnap = snap
      this.stripAt = this.time.now + STRIP_EVERY_MS
      this.strip?.set(
        Object.keys(snap.scores).map((id) => ({
          text: `${this.label(id)} ${snap.scores[id] ?? 0}`,
          avatar: this.state.avatarOf(id),
          color: this.state.colorOf(id),
        })),
      )
    }
    const board = this.currentBoard(snap)
    const myScore = snap.scores[this.selfId] ?? 0

    // Right/wrong from the score delta once the player's board advances.
    const lvl = board ? board.level : Number.POSITIVE_INFINITY
    if (this.lastLevel >= 0 && lvl > this.lastLevel) this.verdict(myScore > this.lastScore)
    this.lastScore = myScore
    this.lastLevel = lvl

    if (!board) {
      // Out of boards — or a spectator, not in this round at all.
      this.showFinished(!(this.selfId in snap.at))
      return
    }
    if (board.level !== this.drawnLevel) this.drawBoard(board)

    const now = this.time.now
    const flashing = now < this.flashUntil
    // ...and back face down: "your turn to answer".
    if (this.wasFlashing && !flashing && this.answeredLevel !== board.level) this.sfx.flip()
    this.wasFlashing = flashing
    const verdictOn = now < this.verdictUntil
    if (!verdictOn && this.boardBorderReset) {
      this.boardBorderReset = false
      this.drawBoardBack(PALETTE.frame)
    }
    if (flashing) {
      this.flashBar?.setSize(
        Math.max(0, ((this.flashUntil - now) / this.flashMs) * this.barW),
        this.flashBar.height,
      )
    }
    // A typed exact match that a longer choice could still extend answers once the pause runs out.
    if (this.commitAt > 0 && now >= this.commitAt) {
      this.commitAt = 0
      const exact = board.choices.findIndex((c) => String(c) === this.typed)
      if (exact >= 0) this.answer(exact)
    }

    const answered = this.answeredLevel === board.level
    const key = [
      board.level,
      flashing,
      verdictOn,
      answered,
      this.picked,
      this.typed,
      this.cursorOn ? this.cursor : -1,
    ].join(':')
    if (key === this.drawnKey) return
    this.drawnKey = key
    for (const p of this.pixels) p.setVisible(flashing)
    // The big "?" turns into the number being typed.
    this.question?.setVisible(!flashing).setText(this.typed && !answered ? this.typed : '?')
    this.flashBar?.setVisible(flashing)
    this.buttons.forEach((b, i) => {
      const has = i < board.choices.length
      const value = String(board.choices[i] ?? '')
      b.img.setVisible(has)
      b.label.setVisible(has && !flashing).setText(value)
      if (verdictOn && i === this.picked) return
      const look: TileLook = flashing ? 'locked' : answered && i === this.picked ? 'down' : 'up'
      // The tiles unlock with a little bounce: "your turn to answer".
      if (look === 'up' && b.look === 'locked') punch(this, b.img, 0.06, 80)
      this.setTile(b, look)
      // Answered: the other tiles dim. Typing: the tiles the number can't be any more dim.
      const ruledOut = answered ? i !== this.picked : !value.startsWith(this.typed)
      b.label.setAlpha(ruledOut ? 0.45 : 1)
    })
    const cursorAt = this.buttons[this.cursor]
    this.cursorBox
      ?.setVisible(this.cursorOn && !flashing && !answered && cursorAt !== undefined)
      .setPosition(cursorAt?.img.x ?? 0, cursorAt?.img.y ?? 0)

    if (flashing) {
      this.setPrompt(this.t('game.memoryFlash.memorize'), PALETTE.text, null)
    } else {
      const name = this.colorName(board)
      this.setPrompt(
        this.t('game.memoryFlash.howMany', { color: name }),
        board.targetColor,
        board.targetColor,
      )
    }
  }

  // Prompt line; a question shows a swatch of the target colour on each side of the text.
  private setPrompt(text: string, color: number, swatch: number | null): void {
    const prompt = this.prompt
    if (!prompt) return
    if (prompt.text !== text) {
      prompt.setText(text)
      punch(this, prompt, 0.12, 80)
    }
    // Lightened so the darker target colours (green/blue) still read on the near-black background.
    prompt.setColor(hexToCss(swatch === null ? color : shade(color, 0.3)))
    const half = prompt.width / 2
    const s = prompt.height
    // Swatches only when they fit beside the text (long colour names on a phone don't leave room).
    const fits = (half + s * 1.4) * 2 <= this.scale.width - 32
    this.swatches.forEach((img, i) => {
      img.setVisible(swatch !== null && fits)
      if (swatch === null) return
      img.setTexture(this.blockKeyFor(swatch))
      img.setPosition(prompt.x + (i === 0 ? -1 : 1) * (half + s * 0.9), prompt.y)
    })
  }

  private showFinished(spectator: boolean): void {
    for (const o of this.pixels) o.setVisible(false)
    this.boardGfx?.setVisible(false)
    for (const b of this.buttons) {
      b.img.setVisible(false)
      b.label.setVisible(false)
    }
    for (const s of this.swatches) s.setVisible(false)
    this.cursorBox?.setVisible(false)
    this.hint?.setVisible(false)
    this.question?.setVisible(false)
    this.flashBar?.setVisible(false)
    this.levelText?.setVisible(false)
    this.prompt?.setVisible(false)
    this.waitText?.setText(this.t('game.common.waiting'))
    if (spectator) return
    if (this.banner) showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.lime)
    if (!this.finished) {
      this.finished = true
      if (this.firstSnapshot) return // relayout restart: the end state, without the fanfare
      this.sfx.cheer()
      this.sfx.coin()
      burst(this, this.scale.width / 2, this.scale.height / 2, PALETTE.lime, 24, 260)
    }
  }
}
