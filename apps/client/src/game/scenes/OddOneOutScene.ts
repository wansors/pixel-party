import { PALETTE } from '@pp/shared'
import type { OddOneOutBoard, OddOneOutSnapshot } from '@pp/shared'
import type { ClientMsg } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { addArcadeBackdrop, bodyStyle, ensurePixelBlock, headlineStyle } from '../pixelStyle'

// Odd One Out canvas. Renders this player's current board (a grid of tiles, one slightly brighter);
// tap the odd tile to advance. The grid is rebuilt whenever the player reaches a new level. Scene key
// === mini-game id.
export class OddOneOutScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private score?: Phaser.GameObjects.Text
  private tiles: Phaser.GameObjects.Image[] = []
  private drawnLevel = -1

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('odd-one-out')
  }

  create(): void {
    addArcadeBackdrop(this)
    this.tiles = []
    this.drawnLevel = -1
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.06, '', headlineStyle(24, PALETTE.lime))
      .setOrigin(0.5)
    this.score = this.add.text(cx, height * 0.12, '', bodyStyle(18)).setOrigin(0.5)
  }

  private draw(board: OddOneOutBoard): void {
    for (const t of this.tiles) t.destroy()
    this.tiles = []
    const { width, height } = this.scale
    const cx = width / 2
    const area = Math.min(width * 0.9, height * 0.7)
    const gap = area * 0.02
    const size = (area - gap * (board.cols - 1)) / board.cols
    const startX = cx - area / 2 + size / 2
    const startY = height * 0.2 + size / 2
    const cellPx = Math.max(4, Math.round(size))
    for (let i = 0; i < board.cols * board.rows; i++) {
      const col = i % board.cols
      const row = Math.floor(i / board.cols)
      const x = startX + col * (size + gap)
      const y = startY + row * (size + gap)
      const color = i === board.oddCell ? board.odd : board.base
      const key = ensurePixelBlock(this, `pp-odd-block-${color}-${cellPx}`, cellPx, color)
      const tile = this.add
        .image(x, y, key)
        .setDisplaySize(size, size)
        .setInteractive({ useHandCursor: true })
      tile.on('pointerdown', () => this.tap(board, i))
      this.tiles.push(tile)
    }
    this.drawnLevel = board.level
  }

  private tap(board: OddOneOutBoard, cell: number): void {
    if (cell === board.oddCell) this.sfx.correct()
    else this.sfx.wrong()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'tap', level: board.level, cell } })
  }

  override update(): void {
    const snap = this.state.state as OddOneOutSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const board = snap.boards[selfId] ?? null
    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    this.score?.setText(this.t('game.common.level', { n: (snap.scores[selfId] ?? 0) + 1 }))
    if (board && board.level !== this.drawnLevel) this.draw(board)
  }
}
