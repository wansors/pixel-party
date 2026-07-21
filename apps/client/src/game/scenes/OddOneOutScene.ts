import type { OddOneOutBoard, OddOneOutSnapshot } from '@pp/shared'
import type { ClientMsg } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'

// Odd One Out canvas. Renders this player's current board (a grid of tiles, one slightly brighter);
// tap the odd tile to advance. The grid is rebuilt whenever the player reaches a new level. Scene key
// === mini-game id.
export class OddOneOutScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private score?: Phaser.GameObjects.Text
  private tiles: Phaser.GameObjects.Rectangle[] = []
  private drawnLevel = -1

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
  ) {
    super('odd-one-out')
  }

  create(): void {
    this.tiles = []
    this.drawnLevel = -1
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.06, '', { fontFamily: 'monospace', fontSize: '24px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.score = this.add
      .text(cx, height * 0.12, '', { fontFamily: 'monospace', fontSize: '18px', color: '#9fb3c8' })
      .setOrigin(0.5)
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
    for (let i = 0; i < board.cols * board.rows; i++) {
      const col = i % board.cols
      const row = Math.floor(i / board.cols)
      const x = startX + col * (size + gap)
      const y = startY + row * (size + gap)
      const color = i === board.oddCell ? board.odd : board.base
      const rect = this.add
        .rectangle(x, y, size, size, color)
        .setStrokeStyle(2, 0x11181f)
        .setInteractive({ useHandCursor: true })
      rect.on('pointerdown', () => this.tap(board, i))
      this.tiles.push(rect)
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
    this.score?.setText(`Level ${(snap.scores[selfId] ?? 0) + 1}`)
    if (board && board.level !== this.drawnLevel) this.draw(board)
  }
}
