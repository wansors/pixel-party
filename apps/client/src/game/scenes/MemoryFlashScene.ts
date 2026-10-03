import { type MemoryFlashBoard, type MemoryFlashSnapshot, PALETTE } from '@pp/shared'
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
type TileLook = keyof typeof TILE
// How long an answered button keeps its right/wrong colour while the next board flashes.
const VERDICT_MS = 420
// A create() within this long of the scene's own shutdown is a relayout restart mid-round (a new round
// only starts seconds after the previous one stopped) — the one case where a memo may carry over.
const RELAYOUT_GAP_MS = 1000
const CHOICE_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR'] as const

interface ChoiceBtn {
  img: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  look: TileLook
}

// Memory Flash canvas. Each new board flashes its coloured pixels inside an arcade frame (a draining
// bar shows how long they stay), then hides them and asks "how many <colour>?" with four chunky answer
// tiles (tap or keys 1–4). The server owns the true counts; right/wrong is read off the score delta
// when the player's board advances, and shown on the tile that was picked.
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
    this.gridCols = 0
    this.gridRows = 0

    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const stripSize = compact ? 11 : 13
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

    // Answer tiles: a 2x2 block anchored to the bottom (thumb reach on phones).
    const gap = compact ? 12 : 16
    const bh = Math.round(Phaser.Math.Clamp((height - top) * 0.1, 56, 84))
    const bw = Math.round(Math.min((width - gap * 3) / 2, 260))
    this.tileW = bw
    this.tileH = bh
    const btnBottom = height - (compact ? 20 : 28)
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
    CHOICE_KEYS.forEach((k, i) => this.onKey(k, () => this.answer(i)))

    // Board frame between the prompt and the tiles; the flash bar drains right under it.
    const boardTop = promptY + promptSize + (compact ? 22 : 28)
    const boardBottom = btnTop - (compact ? 30 : 40)
    this.boardArea = Math.max(120, Math.min(width * 0.86, boardBottom - boardTop, 460))
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
    for (const px of board.pixels) {
      const img = this.add
        .image(x0 + px.x * (size + gap), y0 + px.y * (size + gap), this.blockKeyFor(px.color))
        .setDisplaySize(size, size)
        .setDepth(2)
      this.pixels.push(img)
    }
    this.drawnLevel = board.level
    this.flashMs = Math.max(1, board.flashMs)
    const memo = this.flashMemo
    if (memo.round === this.state.round && memo.level === board.level) {
      this.flashUntil = memo.until
    } else {
      this.flashUntil = this.time.now + board.flashMs
      this.flashMemo = { round: this.state.round, level: board.level, until: this.flashUntil }
      this.sfx.tick()
    }
    this.levelText?.setText(this.t('game.common.level', { n: board.level + 1 }))
  }

  private answer(choice: number): void {
    const board = this.snap?.boards[this.selfId]
    if (!board || this.time.now < this.flashUntil || choice >= board.choices.length) return
    if (this.answeredLevel === board.level) return
    this.answeredLevel = board.level
    this.picked = choice
    this.sfx.click()
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
      this.sfx.correct()
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
    this.strip?.set(
      Object.keys(snap.scores).map((id) => ({
        text: `${this.label(id)} ${snap.scores[id] ?? 0}`,
        avatar: this.state.avatarOf(id),
        color: this.state.colorOf(id),
      })),
    )
    const board = snap.boards[this.selfId] ?? null
    const myScore = snap.scores[this.selfId] ?? 0
    this.hud?.setScore(this.t('game.common.correct', { n: myScore }))

    // Right/wrong from the score delta once the player's board advances.
    const lvl = board ? board.level : Number.POSITIVE_INFINITY
    if (this.lastLevel >= 0 && lvl > this.lastLevel) this.verdict(myScore > this.lastScore)
    this.lastScore = myScore
    this.lastLevel = lvl

    if (!board) {
      // Out of boards — or a spectator, not in this round at all.
      this.showFinished(!(this.selfId in snap.boards))
      return
    }
    if (board.level !== this.drawnLevel) this.drawBoard(board)

    const now = this.time.now
    const flashing = now < this.flashUntil
    const verdictOn = now < this.verdictUntil
    if (!verdictOn && this.boardBorderReset) {
      this.boardBorderReset = false
      this.drawBoardBack(PALETTE.frame)
    }
    for (const p of this.pixels) p.setVisible(flashing)
    this.question?.setVisible(!flashing)
    this.flashBar
      ?.setVisible(flashing)
      .setSize(
        Math.max(0, ((this.flashUntil - now) / this.flashMs) * this.barW),
        this.flashBar.height,
      )

    const answered = this.answeredLevel === board.level
    this.buttons.forEach((b, i) => {
      const has = i < board.choices.length
      b.img.setVisible(has)
      b.label.setVisible(has && !flashing).setText(String(board.choices[i] ?? ''))
      if (verdictOn && i === this.picked) return
      const look: TileLook = flashing ? 'locked' : answered && i === this.picked ? 'down' : 'up'
      // The tiles unlock with a little bounce: "your turn to answer".
      if (look === 'up' && b.look === 'locked') punch(this, b.img, 0.06, 80)
      this.setTile(b, look)
      b.label.setAlpha(answered && i !== this.picked ? 0.45 : 1)
    })

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
      this.sfx.coin()
      burst(this, this.scale.width / 2, this.scale.height / 2, PALETTE.lime, 24, 260)
    }
  }
}
