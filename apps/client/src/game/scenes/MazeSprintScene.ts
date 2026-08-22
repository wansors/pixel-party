import { PALETTE } from '@pp/shared'
import type { ClientMsg, MazeSprintSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { addArcadeBackdrop, bodyStyle, ensurePixelOrb, headlineStyle } from '../pixelStyle'

type Dir = 'up' | 'down' | 'left' | 'right'

const DOT_COLORS = [PALETTE.lime, PALETTE.amber, PALETTE.red, 0x5b8cff, 0xa06fff, PALETTE.dim]
const DOT_DIAMETER_CELLS = 10

// Maze Sprint canvas. Renders the ONE shared maze (identical for everyone) plus every player's own dot
// within it. Movement is server-validated: taps/keys/arrows just send an intent, the server decides
// whether a wall blocks it. Scene key === mini-game id.
export class MazeSprintScene extends Phaser.Scene {
  private built = false
  private prevDone = false
  private walls: Phaser.GameObjects.Graphics | undefined
  private dots: Phaser.GameObjects.Image[] = []
  private timer?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private winBanner?: Phaser.GameObjects.Text
  private originX = 0
  private originY = 0
  private cell = 0

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('maze-sprint')
  }

  create(): void {
    this.built = false
    this.prevDone = false
    this.dots = []
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.05, '', headlineStyle(22, PALETTE.lime))
      .setOrigin(0.5)
    this.status = this.add.text(cx, height * 0.1, '', bodyStyle(16, PALETTE.dim)).setOrigin(0.5)
    this.winBanner = this.add
      .text(cx, height * 0.5, this.t('game.common.done'), headlineStyle(36, PALETTE.amber))
      .setOrigin(0.5)
      .setVisible(false)
    this.walls = this.add.graphics()

    this.input.keyboard?.on('keydown-UP', () => this.move('up'))
    this.input.keyboard?.on('keydown-DOWN', () => this.move('down'))
    this.input.keyboard?.on('keydown-LEFT', () => this.move('left'))
    this.input.keyboard?.on('keydown-RIGHT', () => this.move('right'))
    this.input.keyboard?.on('keydown-W', () => this.move('up'))
    this.input.keyboard?.on('keydown-S', () => this.move('down'))
    this.input.keyboard?.on('keydown-A', () => this.move('left'))
    this.input.keyboard?.on('keydown-D', () => this.move('right'))

    this.buildTouchControls()
  }

  private buildTouchControls(): void {
    const { width, height } = this.scale
    const cx = width / 2
    const baseY = height * 0.9
    const gap = Math.min(width, height) * 0.11
    const size = gap * 0.9
    const makeButton = (x: number, y: number, label: string, dir: Dir) => {
      const rect = this.add
        .rectangle(x, y, size, size, PALETTE.panelAlt)
        .setStrokeStyle(2, PALETTE.frame)
        .setInteractive({ useHandCursor: true })
      rect.on('pointerdown', () => this.move(dir))
      this.add.text(x, y, label, headlineStyle(22, PALETTE.text)).setOrigin(0.5)
    }
    makeButton(cx, baseY - gap, '▲', 'up')
    makeButton(cx - gap, baseY, '◀', 'left')
    makeButton(cx, baseY, '▼', 'down')
    makeButton(cx + gap, baseY, '▶', 'right')
  }

  private move(dir: Dir): void {
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'move', dir } })
  }

  private build(snap: MazeSprintSnapshot): void {
    const { width, height } = this.scale
    const cx = width / 2
    const area = Math.min(width * 0.85, height * 0.58)
    this.cell = area / snap.size
    this.originX = cx - area / 2
    this.originY = height * 0.18
    this.built = true
  }

  private drawMaze(snap: MazeSprintSnapshot): void {
    const g = this.walls
    if (!g) return
    g.clear()
    g.lineStyle(3, PALETTE.dim, 1)
    const size = snap.size
    for (let i = 0; i < snap.walls.length; i++) {
      const row = Math.floor(i / size)
      const col = i % size
      const x0 = this.originX + col * this.cell
      const y0 = this.originY + row * this.cell
      const x1 = x0 + this.cell
      const y1 = y0 + this.cell
      const mask = snap.walls[i] ?? 0
      g.beginPath()
      if (mask & 1) {
        g.moveTo(x0, y0)
        g.lineTo(x1, y0)
      }
      if (mask & 2) {
        g.moveTo(x1, y0)
        g.lineTo(x1, y1)
      }
      if (mask & 4) {
        g.moveTo(x0, y1)
        g.lineTo(x1, y1)
      }
      if (mask & 8) {
        g.moveTo(x0, y0)
        g.lineTo(x0, y1)
      }
      g.strokePath()
    }
    // Mark the exit cell so it reads clearly even before anyone gets close.
    const exitRow = Math.floor(snap.exitIndex / size)
    const exitCol = snap.exitIndex % size
    g.fillStyle(PALETTE.lime, 0.25)
    g.fillRect(
      this.originX + exitCol * this.cell + 4,
      this.originY + exitRow * this.cell + 4,
      this.cell - 8,
      this.cell - 8,
    )
  }

  private cellCenter(index: number, size: number): { x: number; y: number } {
    const row = Math.floor(index / size)
    const col = index % size
    return {
      x: this.originX + col * this.cell + this.cell / 2,
      y: this.originY + row * this.cell + this.cell / 2,
    }
  }

  private dotKey(color: number): string {
    const key = `pp-maze-dot-${color.toString(16)}`
    return ensurePixelOrb(this, key, DOT_DIAMETER_CELLS, color)
  }

  private drawPlayers(snap: MazeSprintSnapshot): void {
    for (const dot of this.dots) dot.destroy()
    this.dots = []
    const selfId = this.state.selfId ?? ''
    const ids = Object.keys(snap.pos)
    // Draw other players first (faint), then the local player on top so it always stands out.
    ids
      .filter((id) => id !== selfId)
      .forEach((id, idx) => {
        const { x, y } = this.cellCenter(snap.pos[id] ?? 0, snap.size)
        const color = DOT_COLORS[idx % DOT_COLORS.length] ?? PALETTE.dim
        this.dots.push(
          this.add
            .image(x, y, this.dotKey(color))
            .setDisplaySize(this.cell * 0.32, this.cell * 0.32)
            .setAlpha(0.45),
        )
      })
    if (selfId in snap.pos) {
      const { x, y } = this.cellCenter(snap.pos[selfId] ?? 0, snap.size)
      this.dots.push(
        this.add
          .image(x, y, this.dotKey(PALETTE.lime))
          .setDisplaySize(this.cell * 0.44, this.cell * 0.44),
      )
    }
  }

  override update(): void {
    const snap = this.state.state as MazeSprintSnapshot | null
    if (!snap) return
    if (!this.built) this.build(snap)
    this.drawMaze(snap)
    this.drawPlayers(snap)

    const selfId = this.state.selfId ?? ''
    const steps = snap.progress[selfId] ?? 0
    const done = (snap.doneAt[selfId] ?? 0) > 0
    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    this.status?.setText(this.t('game.mazeSprint.steps', { n: steps }))

    if (done && !this.prevDone) this.sfx.coin()
    this.winBanner?.setVisible(done)
    this.prevDone = done
  }
}
