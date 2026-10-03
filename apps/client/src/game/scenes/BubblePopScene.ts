import { type BubblePopBoard, type BubblePopSnapshot, PALETTE } from '@pp/shared'
import Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { addBanner, burst, floatText, punch, ring, shake, showBanner } from '../fx'
import { bodyStyle, ensurePixelGrid, ensurePixelOrb, headlineStyle, shade } from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Color id 1..4 -> fill color. 0 (empty) is never rendered as a filled cell.
const COLOR_HEX: Record<number, number> = {
  1: PALETTE.red,
  2: PALETTE.cyan,
  3: PALETTE.lime,
  4: PALETTE.amber,
}
const ORB_CELLS = 12
const FLIGHT_MS_PER_CELL = 22
const BIG_POP = 6

function bubbleKey(colorId: number): string {
  return `pp-bubble-orb-${colorId}`
}

// Where a shot up `col` sticks: mirrors the server's landingRow (bubblePop.ts) so the aim guide shows
// the real landing cell — the bubble travels up from the bottom and stops under the first bubble in
// its way (or at the ceiling). -1 = the column is full and the shot is wasted. Cosmetic only.
function landingRow(grid: readonly number[], rows: number, cols: number, col: number): number {
  for (let row = rows - 1; row >= 0; row--) {
    if ((grid[row * cols + col] ?? 0) !== 0) continue
    if (row === 0 || (grid[(row - 1) * cols + col] ?? 0) !== 0) return row
  }
  return -1
}

// A little pixel cannon the loaded bubble sits on.
const CANNON = [
  '___oooooooo___',
  '__ohhhhhhhho__',
  '_ohbbbbbbbbho_',
  'ohbbbbbbbbbbho',
  'obbbbbbbbbbbdo',
  'oddddddddddddo',
  '_oooooooooooo_',
]

// Bubble Pop canvas. Renders this player's own board under a riveted ceiling; aim a column by
// pointing / dragging (or ← →) and release (or Space / ↑) to fire the loaded bubble from the cannon.
// A dotted guide + ghost bubble show where it will stick (an X when the column is full). The shot flies
// up its lane, then the new board is applied: popped groups burst in their colour with a "+n" pop.
export class BubblePopScene extends MiniGameScene<BubblePopSnapshot> {
  private orbs: Phaser.GameObjects.Image[] = []
  private laneGfx?: Phaser.GameObjects.Graphics
  private guideGfx?: Phaser.GameObjects.Graphics
  private ghost?: Phaser.GameObjects.Image
  private blocked?: Phaser.GameObjects.Text
  private cannon?: Phaser.GameObjects.Image
  // You: your avatar manning the cannon (stands beside it, on the side with room).
  private gunner?: AvatarSprite
  private loaded?: Phaser.GameObjects.Image
  private hint?: Phaser.GameObjects.Text
  private waitText?: Phaser.GameObjects.Text
  private banner?: Phaser.GameObjects.Text
  private built = false
  private rows = 0
  private cols = 0
  private cell = 0
  private gridX0 = 0
  private gridTop = 0
  private launcherY = 0
  private aim = 3
  private pressed = false
  private flying = 0
  private shown: number[] = []
  private pending?: BubblePopBoard
  private wastedShot = false
  private prevScore = 0
  private prevDone = false
  private guideKey = ''

  constructor(...deps: SceneDeps) {
    super('bubble-pop', ...deps)
  }

  override create(): void {
    super.create()
    this.built = false
    this.orbs = []
    this.shown = []
    this.pending = undefined
    this.flying = 0
    this.pressed = false
    this.wastedShot = false
    this.prevScore = 0
    this.prevDone = false
    this.guideKey = ''
    for (const value of Object.keys(COLOR_HEX)) {
      const id = Number(value)
      ensurePixelOrb(this, bubbleKey(id), ORB_CELLS, COLOR_HEX[id] as number)
    }
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    this.hint = this.add
      .text(
        width / 2,
        height - (compact ? 12 : 16),
        this.t('game.bubblePop.hint'),
        bodyStyle(compact ? 13 : 15, PALETTE.dim),
      )
      .setOrigin(0.5, 1)
    this.waitText = this.add
      .text(
        width / 2,
        height / 2 + (compact ? 44 : 56),
        '',
        bodyStyle(compact ? 14 : 18, PALETTE.text, { stroke: '#10121c', strokeThickness: 4 }),
      )
      .setOrigin(0.5)
      .setDepth(951)
    this.banner = addBanner(this)
    // The kit's 34px banner overflows a phone on longer words ("¡TERMINADO!").
    if (compact) this.banner.setFontSize(24)

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y < this.gridTop - 10) return
      this.pressed = true
      this.aimAt(p.x)
    })
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      // Desktop hover aims too; on touch this is the drag.
      if (this.built && (p.isDown ? this.pressed : true)) this.aimAt(p.x)
    })
    this.input.on('pointerup', () => {
      if (!this.pressed) return
      this.pressed = false
      this.fire()
    })
    this.onKey('LEFT', () => this.setAim(this.aim - 1), { repeat: true })
    this.onKey('RIGHT', () => this.setAim(this.aim + 1), { repeat: true })
    this.onKey('SPACE', () => this.fire())
    this.onKey('UP', () => this.fire())
  }

  // Lays the board out once the first snapshot tells us its size.
  private build(snap: BubblePopSnapshot): void {
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    this.rows = snap.rows
    this.cols = snap.cols
    this.aim = Math.floor(snap.cols / 2)
    const top = this.top + (compact ? 14 : 20)
    const bottomReserve = compact ? 40 : 48
    const launcherRows = 2
    this.cell = Math.floor(
      Math.min(
        (width - 32) / snap.cols,
        (height - top - bottomReserve) / (snap.rows + launcherRows),
        64,
      ),
    )
    const gridW = this.cell * snap.cols
    const blockH = this.cell * (snap.rows + launcherRows)
    this.gridX0 = Math.round(width / 2 - gridW / 2)
    this.gridTop = Math.round(top + Math.max(0, (height - top - bottomReserve - blockH) / 2))
    this.launcherY = this.gridTop + this.cell * (snap.rows + 1.1)

    // Playfield: dark lanes (one per column) under a riveted ceiling bar.
    this.laneGfx = this.add.graphics()
    const ceiling = this.add.graphics()
    const barH = compact ? 8 : 10
    ceiling.fillStyle(0x8d95b5, 1).fillRect(this.gridX0 - 6, this.gridTop - barH, gridW + 12, barH)
    ceiling.fillStyle(0xdfe8f3, 1).fillRect(this.gridX0 - 6, this.gridTop - barH, gridW + 12, 2)
    ceiling.fillStyle(0x4a4f72, 1)
    for (let x = this.gridX0; x < this.gridX0 + gridW; x += this.cell) {
      ceiling.fillRect(Math.round(x + this.cell / 2) - 2, this.gridTop - barH + 3, 4, 4)
    }
    this.guideGfx = this.add.graphics().setDepth(3)
    for (let i = 0; i < snap.rows * snap.cols; i++) {
      const orb = this.add
        .image(this.cellX(i % snap.cols), this.cellY(Math.floor(i / snap.cols)), bubbleKey(1))
        .setDisplaySize(this.cell - 4, this.cell - 4)
        .setVisible(false)
        .setDepth(2)
      this.orbs.push(orb)
    }
    this.ghost = this.add
      .image(0, 0, bubbleKey(1))
      .setDisplaySize(this.cell - 4, this.cell - 4)
      .setAlpha(0.35)
      .setDepth(3)
      .setVisible(false)
    this.blocked = this.add
      .text(0, 0, 'X', headlineStyle(24, PALETTE.red, { stroke: '#10121c', strokeThickness: 6 }))
      .setOrigin(0.5)
      .setDepth(4)
      .setVisible(false)
    const cannonKey = ensurePixelGrid(this, {
      key: `pp-bubble-cannon-${Math.max(2, Math.round(this.cell / 14))}`,
      rows: CANNON,
      legend: { o: 0x2a2e48, h: 0xb3bbd6, b: 0x8d95b5, d: 0x5b6088 },
      pixelSize: Math.max(2, Math.round(this.cell / 14)),
    })
    this.cannon = this.add
      .image(this.cellX(this.aim), this.launcherY + this.cell * 0.42, cannonKey)
      .setDisplaySize(this.cell * 1.3, this.cell * 0.65)
      .setDepth(4)
    this.gunner = new AvatarSprite(
      this,
      this.state.avatarOf(this.selfId),
      this.state.colorOf(this.selfId),
      avatarPx(this.cell * 1.1),
      'side',
    )
    this.gunner.image.setOrigin(0.5, 1).setDepth(4)
    this.placeGunner(this.cellX(this.aim))
    this.loaded = this.add
      .image(this.cellX(this.aim), this.launcherY, bubbleKey(1))
      .setDisplaySize(this.cell - 2, this.cell - 2)
      .setDepth(5)
    this.drawLanes()
    this.built = true
  }

  // Beside the cannon, facing it: on its right, or on its left at the last column.
  private placeGunner(x: number): void {
    const g = this.gunner
    if (!g) return
    const right = this.aim < this.cols - 1
    g.face(right ? -1 : 1)
    g.image.setPosition(
      Math.round(x + (right ? 1 : -1) * this.cell * 1.05),
      Math.round(this.launcherY + this.cell * 0.78),
    )
  }

  private cellX(col: number): number {
    return this.gridX0 + col * this.cell + this.cell / 2
  }

  private cellY(row: number): number {
    return this.gridTop + row * this.cell + this.cell / 2
  }

  private drawLanes(): void {
    const g = this.laneGfx
    if (!g) return
    g.clear()
    for (let c = 0; c < this.cols; c++) {
      const lit = c === this.aim
      g.fillStyle(
        lit
          ? shade(PALETTE.panelAlt, 0.1)
          : c % 2 === 0
            ? PALETTE.panel
            : shade(PALETTE.panel, -0.2),
        1,
      )
      g.fillRect(
        this.gridX0 + c * this.cell,
        this.gridTop,
        this.cell,
        this.cell * (this.rows + 0.6),
      )
    }
    g.fillStyle(shade(PALETTE.panel, 0.25), 1)
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        g.fillRect(Math.round(this.cellX(c)) - 1, Math.round(this.cellY(r)) - 1, 2, 2)
      }
    }
  }

  private aimAt(px: number): void {
    if (!this.built) return
    this.setAim(Math.floor((px - this.gridX0) / this.cell))
  }

  private setAim(col: number): void {
    const next = Phaser.Math.Clamp(col, 0, this.cols - 1)
    if (next === this.aim) return
    this.aim = next
    this.drawLanes()
    this.guideKey = ''
    // Hard cut, arcade style: the cannon snaps to the lane.
    const x = this.cellX(next)
    this.cannon?.setX(x)
    this.loaded?.setX(x)
    this.placeGunner(x)
  }

  private myBoard(): BubblePopBoard | null {
    return this.snap?.boards[this.selfId] ?? null
  }

  private fire(): void {
    const board = this.myBoard()
    if (!this.built || !board || board.done || this.flying > 0) return
    const col = this.aim
    this.sfx.click()
    this.sendInput({ kind: 'shoot', col })
    const grid = this.shown.length ? this.shown : board.grid
    const row = landingRow(grid, this.rows, this.cols, col)
    this.wastedShot = row === -1
    // The shot flies up its lane to where it sticks (or to the top of a full column, and fizzles).
    const toY =
      row === -1 ? this.cellY(Math.max(0, this.firstEmptyFromBottom(grid, col))) : this.cellY(row)
    const fromY = this.launcherY
    const shot = this.add
      .image(this.cellX(col), fromY, bubbleKey(board.nextColor))
      .setDisplaySize(this.cell - 4, this.cell - 4)
      .setDepth(4)
    this.flying++
    this.loaded?.setVisible(false)
    if (this.cannon) punch(this, this.cannon, -0.12, 60)
    if (this.gunner) punch(this, this.gunner.image, 0.1, 60)
    this.tweens.add({
      targets: shot,
      y: toY,
      duration: Math.max(70, (Math.abs(fromY - toY) / this.cell) * FLIGHT_MS_PER_CELL),
      ease: 'Quad.easeIn',
      onComplete: () => {
        shot.destroy()
        this.flying = Math.max(0, this.flying - 1)
        this.loaded?.setVisible(true)
        if (this.wastedShot) {
          this.sfx.wrong()
          floatText(
            this,
            this.cellX(col),
            this.gridTop + this.cell,
            this.t('game.common.miss'),
            PALETTE.red,
            16,
          )
        }
      },
    })
  }

  // Row just below the lowest bubble in a column (where a full column's shot visibly fizzles).
  private firstEmptyFromBottom(grid: readonly number[], col: number): number {
    for (let row = this.rows - 1; row >= 0; row--) {
      if ((grid[row * this.cols + col] ?? 0) !== 0) return Math.min(this.rows - 1, row + 1)
    }
    return 0
  }

  protected frame(snap: BubblePopSnapshot | null, time: number): void {
    if (!snap) return
    if (!this.built) this.build(snap)
    this.gunner?.tick(time)
    const board = snap.boards[this.selfId]
    if (!board) return
    this.hud?.setScore(this.t('game.common.pts', { n: board.score }))
    // Hold board updates while a shot is in flight, so pops happen when it lands.
    this.pending = board
    if (this.flying === 0 && this.pending) this.apply(this.pending)

    const tex = COLOR_HEX[board.nextColor] !== undefined ? bubbleKey(board.nextColor) : undefined
    if (tex && this.loaded?.texture.key !== tex) {
      this.loaded?.setTexture(tex)
      if (this.loaded) punch(this, this.loaded, 0.2, 80)
    }
    this.drawGuide(board)
  }

  // Applies a board: diff against what's on screen for the stick / pop / clear feedback.
  private apply(board: BubblePopBoard): void {
    this.pending = undefined
    const prev = this.shown
    const next = board.grid
    const popped: number[] = []
    let changed = prev.length === 0
    for (let i = 0; i < this.orbs.length; i++) {
      const orb = this.orbs[i]
      if (!orb) continue
      const before = prev[i] ?? 0
      const value = next[i] ?? 0
      if (before === value && prev.length) continue
      changed = true
      if (before !== 0 && value === 0 && prev.length) popped.push(i)
      if (before === 0 && value !== 0 && prev.length) punch(this, orb, 0.25, 90)
      orb.setVisible(value > 0 && COLOR_HEX[value] !== undefined)
      if (value && COLOR_HEX[value] !== undefined) orb.setTexture(bubbleKey(value))
    }
    this.shown = [...next]
    if (popped.length > 0) this.popFx(popped, prev, board.score - this.prevScore)
    this.prevScore = board.score
    if (board.done && !this.prevDone) this.showCleared()
    this.prevDone = board.done
    if (changed) this.guideKey = ''
  }

  private popFx(popped: number[], prev: readonly number[], gained: number): void {
    this.sfx.pop()
    let sx = 0
    let sy = 0
    for (const i of popped) {
      const x = this.cellX(i % this.cols)
      const y = this.cellY(Math.floor(i / this.cols))
      sx += x
      sy += y
      burst(this, x, y, COLOR_HEX[prev[i] ?? 0] ?? PALETTE.text, 6, 160)
    }
    const cx = sx / popped.length
    const cy = sy / popped.length
    ring(this, cx, cy, PALETTE.text, this.cell)
    floatText(
      this,
      cx,
      cy,
      `+${Math.max(gained, popped.length)}`,
      PALETTE.amber,
      popped.length >= BIG_POP ? 24 : 16,
    )
    if (popped.length >= BIG_POP) {
      this.sfx.coin()
      shake(this, 0.006, 140)
      floatText(this, cx, cy - 36, this.t('game.common.great'), PALETTE.lime, 16)
    }
  }

  // Dotted guide from the cannon up to the landing cell + a ghost bubble there (or an X if full).
  private drawGuide(board: BubblePopBoard): void {
    const g = this.guideGfx
    if (!g || !this.ghost || !this.blocked) return
    const grid = this.shown.length ? this.shown : board.grid
    const row = board.done ? -2 : landingRow(grid, this.rows, this.cols, this.aim)
    const key = `${this.aim}:${row}:${board.nextColor}`
    if (key === this.guideKey) return
    this.guideKey = key
    g.clear()
    this.ghost.setVisible(false)
    this.blocked.setVisible(false)
    if (row === -2) return
    const x = this.cellX(this.aim)
    if (row === -1) {
      this.blocked.setPosition(x, this.cellY(this.rows) - this.cell * 0.2).setVisible(true)
      return
    }
    const color = COLOR_HEX[board.nextColor] ?? PALETTE.text
    const endY = this.cellY(row) + this.cell / 2
    g.fillStyle(color, 0.8)
    for (let y = this.launcherY - this.cell * 0.7; y > endY; y -= 12)
      g.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4)
    this.ghost
      .setTexture(bubbleKey(board.nextColor))
      .setPosition(x, this.cellY(row))
      .setVisible(true)
  }

  private showCleared(): void {
    this.sfx.coin()
    const { width, height } = this.scale
    burst(this, width / 2, height / 2, PALETTE.amber, 30, 320)
    burst(this, width / 2, height / 2, PALETTE.cyan, 20, 260)
    if (this.banner) showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.lime)
    this.waitText?.setText(this.t('game.common.waiting'))
    this.hint?.setVisible(false)
    this.cannon?.setVisible(false)
    this.loaded?.setVisible(false)
    this.gunner?.setExpression('happy')
  }
}
