import { PALETTE } from '@pp/shared'
import type { ClientMsg, TetrisSprintSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { addArcadeBackdrop, bodyStyle, ensurePixelBlock, headlineStyle } from '../pixelStyle'

// 0 = empty board cell; 1..4 map to the four piece colors from tetrisCore's SHAPES.
const CELL_COLORS: Record<number, number> = {
  0: PALETTE.panel,
  1: PALETTE.lime,
  2: PALETTE.amber,
  3: PALETTE.red,
  4: PALETTE.cyan,
}

function kebabToCamel(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

// Shared canvas for the two Tetris-style sprint games (line-clear-sprint, quick-tetris): both render
// only THIS player's own board (server-owned, falling piece already baked into `grid`) and send
// move/drop inputs. They differ only in duration/target-lines and scene key, so subclasses just forward
// their key into `super()`. Scene key === mini-game id (set by the subclass).
export class TetrisSprintSceneBase extends Phaser.Scene {
  private readonly i18nNs: string
  private timer?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private banner?: Phaser.GameObjects.Text
  private cells: Phaser.GameObjects.Image[] = []
  private cellPx = 0
  private built = false
  private prevToppedOut = false
  private prevDone = false

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
    sceneKey: string,
  ) {
    super(sceneKey)
    this.i18nNs = kebabToCamel(sceneKey)
  }

  create(): void {
    this.built = false
    this.cells = []
    this.cellPx = 0
    this.prevToppedOut = false
    this.prevDone = false
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.05, '', headlineStyle(22, PALETTE.lime))
      .setOrigin(0.5)
    this.status = this.add.text(cx, height * 0.11, '', bodyStyle(16)).setOrigin(0.5)
    this.banner = this.add
      .text(cx, height * 0.42, '', headlineStyle(24, PALETTE.amber))
      .setOrigin(0.5)
      .setDepth(10)
      .setVisible(false)

    this.input.keyboard?.on('keydown-LEFT', () => this.move('left'))
    this.input.keyboard?.on('keydown-RIGHT', () => this.move('right'))
    this.input.keyboard?.on('keydown-DOWN', () => this.drop())
    this.input.keyboard?.on('keydown-SPACE', () => this.drop())
    this.input.keyboard?.on('keydown-UP', () => this.rotate())

    this.buildTouchControls()
  }

  private buildTouchControls(): void {
    const { width, height } = this.scale
    const y = height * 0.93
    const buttonKey = ensurePixelBlock(this, 'pp-tetris-button', 8, PALETTE.panelAlt)
    const addButton = (x: number, label: string, onTap: () => void): void => {
      this.add
        .image(x, y, buttonKey)
        .setDisplaySize(width * 0.16, height * 0.08)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', onTap)
      this.add.text(x, y, label, headlineStyle(18)).setOrigin(0.5)
    }
    addButton(width * 0.15, '◀', () => this.move('left'))
    addButton(width * 0.4, '▼', () => this.drop())
    addButton(width * 0.6, '⟳', () => this.rotate())
    addButton(width * 0.85, '▶', () => this.move('right'))
  }

  private move(dir: 'left' | 'right'): void {
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'move', dir } })
  }

  private drop(): void {
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'drop' } })
  }

  private rotate(): void {
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'rotate' } })
  }

  private build(snap: TetrisSprintSnapshot): void {
    const { width, height } = this.scale
    const areaW = width * 0.7
    const areaH = height * 0.72
    const cell = Math.min(areaW / snap.cols, areaH / snap.rows)
    const boardW = cell * snap.cols
    const startX = width / 2 - boardW / 2 + cell / 2
    const startY = height * 0.16 + cell / 2
    this.cellPx = Math.max(6, Math.floor(cell) - 2)
    for (const value of Object.keys(CELL_COLORS)) {
      const v = Number(value)
      ensurePixelBlock(this, this.blockKey(v), this.cellPx, CELL_COLORS[v])
    }
    for (let y = 0; y < snap.rows; y++) {
      for (let x = 0; x < snap.cols; x++) {
        this.cells.push(this.add.image(startX + x * cell, startY + y * cell, this.blockKey(0)))
      }
    }
    this.built = true
  }

  private blockKey(value: number): string {
    return `pp-tetris-block-${value}-${this.cellPx}`
  }

  override update(): void {
    const snap = this.state.state as TetrisSprintSnapshot | null
    if (!snap) return
    if (!this.built) this.build(snap)
    const selfId = this.state.selfId ?? ''
    const board = snap.boards[selfId]
    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    if (!board) return

    this.status?.setText(
      snap.targetLines
        ? this.t(`game.${this.i18nNs}.progress`, {
            n: board.linesCleared,
            target: snap.targetLines,
          })
        : this.t(`game.${this.i18nNs}.lines`, { n: board.linesCleared }),
    )

    const toppedOut = board.toppedOut
    const done = (board.doneAt ?? 0) > 0
    if (done) {
      if (!this.prevDone) this.sfx.coin()
      this.banner?.setText(this.t(`game.${this.i18nNs}.win`)).setVisible(true)
    } else if (toppedOut) {
      if (!this.prevToppedOut) this.sfx.wrong()
      this.banner?.setText(this.t(`game.${this.i18nNs}.toppedOut`)).setVisible(true)
    } else {
      this.banner?.setVisible(false)
    }
    this.prevDone = done
    this.prevToppedOut = toppedOut

    for (let i = 0; i < this.cells.length; i++) {
      const cellEl = this.cells[i]
      const v = board.grid[i] ?? 0
      cellEl?.setTexture(this.blockKey(CELL_COLORS[v] !== undefined ? v : 0))
    }
  }
}
