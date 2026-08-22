import type { ClientMsg, TetrisSprintSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'

// 0 = empty board cell; 1..4 map to the four piece colors from tetrisCore's SHAPES.
const CELL_COLORS: Record<number, number> = {
  0: 0x1d2740,
  1: 0x06d6a0,
  2: 0xffcf4b,
  3: 0xe63946,
  4: 0x6fa8ff,
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
  private cells: Phaser.GameObjects.Rectangle[] = []
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
    this.prevToppedOut = false
    this.prevDone = false
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.05, '', { fontFamily: 'monospace', fontSize: '22px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.status = this.add
      .text(cx, height * 0.11, '', { fontFamily: 'monospace', fontSize: '16px', color: '#9fb3c8' })
      .setOrigin(0.5)
    this.banner = this.add
      .text(cx, height * 0.42, '', { fontFamily: 'monospace', fontSize: '28px', color: '#ffcf4b' })
      .setOrigin(0.5)
      .setDepth(10)
      .setVisible(false)

    this.input.keyboard?.on('keydown-LEFT', () => this.move('left'))
    this.input.keyboard?.on('keydown-RIGHT', () => this.move('right'))
    this.input.keyboard?.on('keydown-DOWN', () => this.drop())
    this.input.keyboard?.on('keydown-SPACE', () => this.drop())

    this.buildTouchControls()
  }

  private buildTouchControls(): void {
    const { width, height } = this.scale
    const y = height * 0.93
    const addButton = (x: number, label: string, onTap: () => void): void => {
      this.add
        .rectangle(x, y, width * 0.16, height * 0.08, 0x1d2740)
        .setStrokeStyle(2, 0x3a4668)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', onTap)
      this.add
        .text(x, y, label, { fontFamily: 'monospace', fontSize: '22px', color: '#e6edf3' })
        .setOrigin(0.5)
    }
    addButton(width * 0.2, '◀', () => this.move('left'))
    addButton(width * 0.5, '▼', () => this.drop())
    addButton(width * 0.8, '▶', () => this.move('right'))
  }

  private move(dir: 'left' | 'right'): void {
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'move', dir } })
  }

  private drop(): void {
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'drop' } })
  }

  private build(snap: TetrisSprintSnapshot): void {
    const { width, height } = this.scale
    const areaW = width * 0.7
    const areaH = height * 0.72
    const cell = Math.min(areaW / snap.cols, areaH / snap.rows)
    const boardW = cell * snap.cols
    const startX = width / 2 - boardW / 2 + cell / 2
    const startY = height * 0.16 + cell / 2
    for (let y = 0; y < snap.rows; y++) {
      for (let x = 0; x < snap.cols; x++) {
        this.cells.push(
          this.add
            .rectangle(startX + x * cell, startY + y * cell, cell - 2, cell - 2, CELL_COLORS[0])
            .setStrokeStyle(1, 0x3a4668),
        )
      }
    }
    this.built = true
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
      cellEl?.setFillStyle(CELL_COLORS[v] ?? CELL_COLORS[0])
    }
  }
}
