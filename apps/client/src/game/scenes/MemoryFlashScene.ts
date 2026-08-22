import {
  type ClientMsg,
  type MemoryFlashBoard,
  type MemoryFlashSnapshot,
  PALETTE,
} from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import {
  addArcadeBackdrop,
  bodyStyle,
  ensurePixelBlock,
  headlineStyle,
  hexToCss,
} from '../pixelStyle'

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`
const CHOICE_BG = PALETTE.frame
const CHOICE_KEY = 'pp-memflash-choice'

// Memory Flash canvas. When a new board arrives it flashes the pixels for flashMs, then hides them and
// shows the "how many <colour>?" answer buttons. Scene key === mini-game id.
export class MemoryFlashScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private score?: Phaser.GameObjects.Text
  private prompt?: Phaser.GameObjects.Text
  private pixels: Phaser.GameObjects.Image[] = []
  private choiceBtns: Phaser.GameObjects.Image[] = []
  private choiceLabels: Phaser.GameObjects.Text[] = []
  private drawnLevel = -1
  private flashUntil = 0
  private lastScore = 0
  private lastLevel = -1

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('memory-flash')
  }

  create(): void {
    this.pixels = []
    this.choiceBtns = []
    this.choiceLabels = []
    this.drawnLevel = -1
    this.flashUntil = 0
    this.lastScore = 0
    this.lastLevel = -1
    addArcadeBackdrop(this)
    ensurePixelBlock(this, CHOICE_KEY, 32, CHOICE_BG)
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.06, '', headlineStyle(24, PALETTE.lime))
      .setOrigin(0.5)
    this.score = this.add.text(cx, height * 0.12, '', bodyStyle(16, PALETTE.dim)).setOrigin(0.5)
    this.prompt = this.add
      .text(cx, height * 0.19, '', headlineStyle(22, PALETTE.text))
      .setOrigin(0.5)

    const cols = 2
    const bw = width * 0.4
    const bh = height * 0.11
    const gap = width * 0.04
    const top = height * 0.66
    for (let i = 0; i < 4; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = cx + (col === 0 ? -1 : 1) * (bw / 2 + gap / 2)
      const y = top + row * (bh + height * 0.03)
      const img = this.add
        .image(x, y, CHOICE_KEY)
        .setDisplaySize(bw, bh)
        .setInteractive({ useHandCursor: true })
      img.on('pointerdown', () => this.answer(i))
      const label = this.add.text(x, y, '', headlineStyle(30, PALETTE.text)).setOrigin(0.5)
      this.choiceBtns.push(img)
      this.choiceLabels.push(label)
    }
  }

  private blockKeyFor(color: number): string {
    return `pp-memflash-px-${color.toString(16)}`
  }

  private drawBoard(board: MemoryFlashBoard): void {
    for (const p of this.pixels) p.destroy()
    this.pixels = []
    const { width, height } = this.scale
    const cx = width / 2
    const area = Math.min(width * 0.8, height * 0.4)
    const gap = area * 0.04
    const size = (area - gap * (board.cols - 1)) / board.cols
    const startX = cx - area / 2 + size / 2
    const startY = height * 0.42 - area / 2 + size / 2
    for (const px of board.pixels) {
      const x = startX + px.x * (size + gap)
      const y = startY + px.y * (size + gap)
      const key = ensurePixelBlock(this, this.blockKeyFor(px.color), 24, px.color)
      this.pixels.push(this.add.image(x, y, key).setDisplaySize(size, size))
    }
    this.drawnLevel = board.level
    this.flashUntil = this.time.now + board.flashMs
  }

  private answer(choice: number): void {
    const board = (this.state.state as MemoryFlashSnapshot | null)?.boards[this.state.selfId ?? '']
    if (!board || this.time.now < this.flashUntil || choice >= board.choices.length) return
    this.sfx.click()
    this.send({
      type: 'MINIGAME_INPUT',
      input: { kind: 'answer', level: board.level, value: board.choices[choice] },
    })
  }

  override update(): void {
    const snap = this.state.state as MemoryFlashSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const board = snap.boards[selfId] ?? null

    // Right/wrong from the score delta once the player advances a level.
    const myScore = snap.scores[selfId] ?? 0
    const lvl = board?.level ?? -1
    if (myScore > this.lastScore) this.sfx.correct()
    else if (this.lastLevel >= 0 && lvl > this.lastLevel && myScore === this.lastScore)
      this.sfx.wrong()
    this.lastScore = myScore
    this.lastLevel = lvl

    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    this.score?.setText(this.t('game.common.correct', { n: myScore }))

    if (!board) {
      this.prompt?.setText(this.t('game.common.done'))
      for (const p of this.pixels) p.setVisible(false)
      for (const b of this.choiceBtns) b.setVisible(false)
      for (const l of this.choiceLabels) l.setVisible(false)
      return
    }
    if (board.level !== this.drawnLevel) this.drawBoard(board)

    const flashing = this.time.now < this.flashUntil
    for (const p of this.pixels) p.setVisible(flashing)
    this.choiceBtns.forEach((b, i) => b.setVisible(!flashing && i < board.choices.length))
    this.choiceLabels.forEach((l, i) =>
      l.setVisible(!flashing && i < board.choices.length).setText(String(board.choices[i] ?? '')),
    )
    this.prompt
      ?.setText(
        flashing
          ? this.t('game.memoryFlash.memorize')
          : this.t('game.memoryFlash.howMany', { color: board.targetName }),
      )
      .setColor(flashing ? hexToCss(PALETTE.text) : css(board.targetColor))
  }
}
