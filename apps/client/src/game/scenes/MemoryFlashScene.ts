import type { ClientMsg, MemoryFlashBoard, MemoryFlashSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`

// Memory Flash canvas. When a new board arrives it flashes the pixels for flashMs, then hides them and
// shows the "how many <colour>?" answer buttons. Scene key === mini-game id.
export class MemoryFlashScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private score?: Phaser.GameObjects.Text
  private prompt?: Phaser.GameObjects.Text
  private pixels: Phaser.GameObjects.Rectangle[] = []
  private choiceBtns: Phaser.GameObjects.Rectangle[] = []
  private choiceLabels: Phaser.GameObjects.Text[] = []
  private drawnLevel = -1
  private flashUntil = 0
  private lastScore = 0
  private lastLevel = -1

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
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
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.06, '', { fontFamily: 'monospace', fontSize: '24px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.score = this.add
      .text(cx, height * 0.12, '', { fontFamily: 'monospace', fontSize: '16px', color: '#9fb3c8' })
      .setOrigin(0.5)
    this.prompt = this.add
      .text(cx, height * 0.19, '', { fontFamily: 'monospace', fontSize: '22px', color: '#e6edf3' })
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
      const rect = this.add
        .rectangle(x, y, bw, bh, 0x3a4668)
        .setStrokeStyle(3, 0x11181f)
        .setInteractive({ useHandCursor: true })
      rect.on('pointerdown', () => this.answer(i))
      const label = this.add
        .text(x, y, '', { fontFamily: 'monospace', fontSize: '30px', color: '#e6edf3' })
        .setOrigin(0.5)
      this.choiceBtns.push(rect)
      this.choiceLabels.push(label)
    }
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
      this.pixels.push(this.add.rectangle(x, y, size, size, px.color).setStrokeStyle(2, 0x11181f))
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
    this.score?.setText(`${myScore} correct`)

    if (!board) {
      this.prompt?.setText('Done!')
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
      ?.setText(flashing ? 'Memorize!' : `How many ${board.targetName}?`)
      .setColor(flashing ? '#e6edf3' : css(board.targetColor))
  }
}
