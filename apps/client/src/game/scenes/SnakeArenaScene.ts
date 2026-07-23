import type { ClientMsg, SnakeSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'

type Dir = 'up' | 'down' | 'left' | 'right'

// Snake Arena canvas. The server owns every player's board; this renders only THIS player's snake and
// food (via selfId), rebuilt each frame from the latest snapshot — the grid snap needs no interpolation.
// Controls: arrow keys and swipe. Scene key === mini-game id.
export class SnakeArenaScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private score?: Phaser.GameObjects.Text
  private board?: Phaser.GameObjects.Rectangle
  private food?: Phaser.GameObjects.Rectangle
  private dead?: Phaser.GameObjects.Text
  private readonly segments: Phaser.GameObjects.Rectangle[] = []
  private origin = { x: 0, y: 0 }
  private cell = 0
  private lastLen = 0
  private wasAlive = true
  private swipeStart?: { x: number; y: number }

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('snake-arena')
  }

  create(): void {
    this.lastLen = 0
    this.wasAlive = true
    for (const s of this.segments) s.destroy()
    this.segments.length = 0

    const { width, height } = this.scale
    this.timer = this.add
      .text(width / 2, height * 0.06, '', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#8be94b',
      })
      .setOrigin(0.5)
    this.score = this.add
      .text(width / 2, height * 0.12, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#7b88a8',
      })
      .setOrigin(0.5)

    this.dead = this.add
      .text(width / 2, height / 2, 'DEAD', {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: '#ff5252',
      })
      .setOrigin(0.5)
      .setDepth(10)
      .setVisible(false)

    this.input.keyboard?.on('keydown-UP', () => this.turn('up'))
    this.input.keyboard?.on('keydown-DOWN', () => this.turn('down'))
    this.input.keyboard?.on('keydown-LEFT', () => this.turn('left'))
    this.input.keyboard?.on('keydown-RIGHT', () => this.turn('right'))

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.swipeStart = { x: p.x, y: p.y }
    })
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.endSwipe(p.x, p.y))
  }

  private turn(dir: Dir): void {
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'turn', dir } })
  }

  private endSwipe(x: number, y: number): void {
    if (!this.swipeStart) return
    const dx = x - this.swipeStart.x
    const dy = y - this.swipeStart.y
    this.swipeStart = undefined
    if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return
    if (Math.abs(dx) > Math.abs(dy)) this.turn(dx > 0 ? 'right' : 'left')
    else this.turn(dy > 0 ? 'down' : 'up')
  }

  private layout(grid: number): void {
    const { width, height } = this.scale
    const size = Math.min(width, height) * 0.72
    this.cell = Math.floor(size / grid)
    const boardSize = this.cell * grid
    this.origin = { x: (width - boardSize) / 2, y: (height - boardSize) / 2 + height * 0.06 }
    if (!this.board) {
      this.board = this.add
        .rectangle(0, 0, boardSize, boardSize, 0x1b1e2e)
        .setOrigin(0, 0)
        .setStrokeStyle(3, 0x3a3f66)
    }
    this.board.setPosition(this.origin.x, this.origin.y).setSize(boardSize, boardSize)
  }

  private cellRect(cx: number, cy: number, color: number): Phaser.GameObjects.Rectangle {
    const pad = Math.max(1, Math.floor(this.cell * 0.1))
    return this.add
      .rectangle(
        this.origin.x + cx * this.cell + pad,
        this.origin.y + cy * this.cell + pad,
        this.cell - pad * 2,
        this.cell - pad * 2,
        color,
      )
      .setOrigin(0, 0)
  }

  override update(): void {
    const snap = this.state.state as SnakeSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const me = snap.snakes[selfId]
    const myFood = snap.food[selfId]
    this.layout(snap.grid)

    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    const len = me?.len ?? 0
    this.score?.setText(this.t('game.common.pts', { n: len }))

    if (me) {
      if (len > this.lastLen && this.lastLen > 0) {
        this.sfx.coin()
        this.sfx.correct()
      }
      this.lastLen = len
      if (this.wasAlive && !me.alive) this.sfx.wrong()
      this.wasAlive = me.alive
      this.dead?.setVisible(!me.alive)
    }

    if (myFood) {
      if (!this.food) this.food = this.cellRect(myFood.x, myFood.y, 0xffcf4b)
      const pad = Math.max(1, Math.floor(this.cell * 0.1))
      this.food.setPosition(
        this.origin.x + myFood.x * this.cell + pad,
        this.origin.y + myFood.y * this.cell + pad,
      )
      this.food.setSize(this.cell - pad * 2, this.cell - pad * 2)
    }

    this.renderSnake(me?.body ?? [], me?.alive ?? true)
  }

  private renderSnake(body: { x: number; y: number }[], alive: boolean): void {
    while (this.segments.length > body.length) {
      const extra = this.segments.pop()
      extra?.destroy()
    }
    const headColor = alive ? 0x8be94b : 0x7b88a8
    const bodyColor = alive ? 0x29d3f2 : 0x3a3f66
    body.forEach((c, i) => {
      let seg = this.segments[i]
      if (!seg) {
        seg = this.cellRect(c.x, c.y, bodyColor)
        this.segments[i] = seg
      }
      const pad = Math.max(1, Math.floor(this.cell * 0.1))
      seg.setPosition(this.origin.x + c.x * this.cell + pad, this.origin.y + c.y * this.cell + pad)
      seg.setSize(this.cell - pad * 2, this.cell - pad * 2)
      seg.setFillStyle(i === 0 ? headColor : bodyColor)
    })
  }
}
