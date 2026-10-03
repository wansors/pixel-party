import { type OddOneOutBoard, type OddOneOutSnapshot, PALETTE } from '@pp/shared'
import Phaser from 'phaser'
import { addBanner, burst, floatText, punch, ring, showBanner } from '../fx'
import { ensureBevelPanel, fitText, headlineStyle } from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const MILESTONE = 5
const MAX_CHIPS = 6

// Odd One Out canvas. Renders this player's current board — a framed grid of beveled tiles, one a
// little brighter — and rebuilds it (with a quick pop-in) whenever the player reaches a new level.
// A right tap rings + bursts, a wrong tap wiggles red (the server ignores it — keep hunting), every
// 5th level cheers, and a chip strip shows everyone's level.
export class OddOneOutScene extends MiniGameScene<OddOneOutSnapshot> {
  private tiles: Phaser.GameObjects.Image[] = []
  // Home x of each tile, so a wiggle always settles back in place.
  private tileX: number[] = []
  private prompt?: Phaser.GameObjects.Text
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private boardFrame?: Phaser.GameObjects.Image
  // Tile textures of the board on screen. Every level has fresh random colors, so they are never
  // reused: dropped when the next board replaces them (and at shutdown) instead of piling up.
  private levelKeys = new Set<string>()
  private drawnLevel = -1
  // Level whose odd tile was just tapped: further taps wait for the server's next board.
  private solvedLevel = -1
  private boardTop = 0
  private boardSide = 0
  private promptSize = 0
  private finished = false

  constructor(...deps: SceneDeps) {
    super('odd-one-out', ...deps)
  }

  override create(): void {
    super.create()
    this.tiles = []
    this.tileX = []
    this.levelKeys = new Set()
    this.drawnLevel = -1
    this.solvedLevel = -1
    this.finished = false
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.clearBoard())
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const cx = width / 2
    const promptSize = compact ? 16 : 24
    this.promptSize = promptSize
    this.prompt = this.add
      .text(
        cx,
        this.top + (compact ? 10 : 14) + promptSize / 2,
        this.t('game.oddOneOut.prompt'),
        headlineStyle(promptSize, PALETTE.amber, { stroke: '#10121c', strokeThickness: 6 }),
      )
      .setOrigin(0.5)
      .setDepth(5)
    fitText(this.prompt, width - 32, promptSize)
    this.boardTop = this.top + promptSize + (compact ? 26 : 34)

    const chipSize = compact ? 11 : 13
    const stripRows = width < 600 ? 2 : 1
    const stripTop = height - (compact ? 12 : 18) - stripRows * PlayerStrip.rowH(chipSize)
    this.strip = new PlayerStrip(
      this,
      cx,
      stripTop + PlayerStrip.rowH(chipSize) / 2,
      width - 32,
      chipSize,
      stripRows,
    )
    this.boardSide = Math.floor(Math.min(width - 32, stripTop - 12 - this.boardTop, 620))
    // Centered in the free band (on phones that also brings it closer to the thumbs).
    this.boardTop += Math.max(0, (stripTop - 12 - this.boardTop - this.boardSide) / 2)
    this.boardFrame = this.add.image(
      cx,
      this.boardTop + this.boardSide / 2,
      ensureBevelPanel(this, this.boardSide, this.boardSide, PALETTE.panel, 5, true),
    )
    this.banner = addBanner(this).setFontSize(compact ? 24 : 32)
  }

  private clearBoard(): void {
    for (const t of this.tiles) t.destroy()
    this.tiles = []
    this.tileX = []
    for (const key of this.levelKeys) if (this.textures.exists(key)) this.textures.remove(key)
    this.levelKeys.clear()
  }

  private draw(board: OddOneOutBoard): void {
    this.clearBoard()
    const cx = this.scale.width / 2
    const pad = Math.max(8, Math.round(this.boardSide * 0.03))
    const gap = Math.max(3, Math.round(this.boardSide * 0.015))
    const size = Math.floor((this.boardSide - pad * 2 - gap * (board.cols - 1)) / board.cols)
    const gridW = size * board.cols + gap * (board.cols - 1)
    const left = cx - gridW / 2
    const top = this.boardTop + (this.boardSide - (size * board.rows + gap * (board.rows - 1))) / 2
    const bevel = Math.max(2, Math.round(size / 14))
    for (let i = 0; i < board.cols * board.rows; i++) {
      const col = i % board.cols
      const row = Math.floor(i / board.cols)
      const color = i === board.oddCell ? board.odd : board.base
      const key = ensureBevelPanel(this, size, size, color, bevel, true)
      this.levelKeys.add(key)
      const tile = this.add
        .image(left + col * (size + gap) + size / 2, top + row * (size + gap) + size / 2, key)
        .setInteractive({ useHandCursor: true })
      tile.on('pointerdown', () => this.tap(board, i))
      // Snappy diagonal pop-in.
      tile.setScale(0.4)
      this.tweens.add({
        targets: tile,
        scale: 1,
        duration: 110,
        delay: (row + col) * 14,
        ease: 'Back.easeOut',
      })
      this.tiles.push(tile)
      this.tileX.push(tile.x)
    }
    this.drawnLevel = board.level
  }

  private tap(board: OddOneOutBoard, cell: number): void {
    const tile = this.tiles[cell]
    if (!tile || this.solvedLevel === board.level || this.snap?.remainingMs === 0) return
    this.sendInput({ kind: 'tap', level: board.level, cell })
    if (cell === board.oddCell) {
      this.solvedLevel = board.level
      this.sfx.correct()
      ring(this, tile.x, tile.y, PALETTE.lime, tile.width * 0.8)
      burst(this, tile.x, tile.y, board.odd, 14, 220)
      floatText(this, tile.x, tile.y - tile.height / 2, '+1', PALETTE.lime, 22)
      return
    }
    this.sfx.wrong()
    this.tweens.killTweensOf(tile)
    const x = this.tileX[cell] ?? tile.x
    tile.setScale(1).setX(x).setTint(PALETTE.red)
    this.tweens.add({ targets: tile, x: x + 5, duration: 40, yoyo: true, repeat: 2 })
    this.time.delayedCall(260, () => {
      if (tile.active) tile.setX(x).clearTint()
    })
  }

  protected frame(snap: OddOneOutSnapshot | null): void {
    if (!snap) return
    const me = this.selfId
    const cleared = snap.scores[me] ?? 0
    this.hud?.setScore(this.t('game.common.level', { n: cleared + 1 }))
    // undefined = not in this round; null = this player has cleared every board.
    const board = snap.boards[me]
    if (board && board.level !== this.drawnLevel) {
      if (this.drawnLevel >= 0) this.onLevelUp(board.level)
      this.draw(board)
    } else if (board === null && !this.finished) {
      this.finished = true
      this.clearBoard()
      if (!this.firstSnapshot) this.sfx.coin()
      if (this.prompt) {
        this.prompt.setText(this.t('game.common.waiting'))
        fitText(this.prompt, this.scale.width - 32, this.promptSize)
      }
      if (this.banner) showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.lime)
    }

    const chips = Object.entries(snap.scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CHIPS)
      .map(([id, n]) => ({
        text: `${this.label(id).slice(0, 10).toUpperCase()} ${n + 1}`,
        avatar: this.state.avatarOf(id),
        color: this.state.colorOf(id),
      }))
    this.strip?.set(chips)
  }

  private onLevelUp(level: number): void {
    if (this.boardFrame) punch(this, this.boardFrame, 0.03, 80)
    if (level % MILESTONE !== 0 || !this.prompt) return
    const { x, y } = this.prompt
    burst(this, x, y, PALETTE.amber, 22, 280)
    floatText(this, x, y + 30, this.t('game.common.level', { n: level + 1 }), PALETTE.amber, 22)
    this.sfx.coin()
  }
}
