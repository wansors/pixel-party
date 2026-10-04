import {
  BUBBLE,
  type BubblePopBoard,
  type BubblePopSnapshot,
  type BubbleShot,
  PALETTE,
  bubbleJammed,
  bubbleLandingRow,
  bubbleNextShot,
  bubbleShoot,
} from '@pp/shared'
import Phaser from 'phaser'
import { AvatarSprite, avatarPx, ensureAvatarTexture } from '../avatars'
import { addBanner, burst, flash, floatText, punch, ring, shake, showBanner } from '../fx'
import {
  bodyStyle,
  ensurePixelGrid,
  ensurePixelOrb,
  fitText,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
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
// Holding ◀ ▶ steps the aim once, then every AIM_REPEAT_MS after AIM_DELAY_MS (not the OS key repeat).
const AIM_DELAY_MS = 170
const AIM_REPEAT_MS = 70
// Shots the server never acknowledged within this long are taken as lost and stop being replayed.
const PENDING_TTL_MS = 2000
// Standings rows beside the board (landscape): between these heights.
const ROW_MIN = 18
const ROW_MAX = 32

function bubbleKey(colorId: number): string {
  return `pp-bubble-orb-${colorId}`
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

// This player's board as the screen predicts it.
interface Predicted {
  grid: number[]
  score: number
  nextColor: number
  done: boolean
  jammed: boolean
}

interface SentShot {
  n: number // the player's shot number, 1-based (the server counts the same way)
  col: number
  at: number // scene time
}

interface RivalRow {
  pip: Phaser.GameObjects.Image
  name: Phaser.GameObjects.Text
  score: Phaser.GameObjects.Text
}

// Bubble Pop canvas. Renders this player's own board under a riveted ceiling; aim a column with the
// mouse (or ◀ ▶ / A D) and click (or SPACE / ENTER / ↑) to fire the loaded bubble from the cannon;
// on touch, drag and release. A dotted guide + ghost bubble show where it will stick (an X when the
// column is blocked at the bottom). The board is predicted with the shared shot rules (@pp/shared
// bubblePop): the shot flies up its lane, sticks, pops and loads the next colour without waiting for
// the server, and each snapshot (the server's word) is the base the unacknowledged shots are replayed
// on. Rivals' scores sit beside the board. A board blocked in every column is jammed: done for the
// round.
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
  private queue: number[] = []
  private base?: BubblePopBoard
  private sent: SentShot[] = []
  private shotCount = 0
  private synced = false
  private prevScore = 0
  private scoreShown = false
  private prevDone = false
  private prevJammed = false
  private guideKey = ''
  private loadedColor = 0
  private aimSide?: -1 | 1
  private aimAt = 0
  private aimKeys: Record<'left' | 'right', Phaser.Input.Keyboard.Key[]> = { left: [], right: [] }
  private panel?: { x: number; y: number; w: number; h: number }
  private rivalRows: RivalRow[] = []
  private rivalsKey = ''
  // Everyone else's board as last seen (cleared / jammed), for the room's big moments.
  private rivalEnds = new Map<string, { done: boolean; jammed: boolean }>()

  constructor(...deps: SceneDeps) {
    super('bubble-pop', ...deps)
  }

  override create(): void {
    super.create()
    this.built = false
    this.orbs = []
    this.shown = []
    this.queue = []
    this.base = undefined
    this.sent = []
    this.shotCount = 0
    this.synced = false
    this.flying = 0
    this.pressed = false
    this.prevScore = 0
    this.scoreShown = false
    this.prevDone = false
    this.prevJammed = false
    this.guideKey = ''
    this.loadedColor = 0
    this.aimSide = undefined
    this.panel = undefined
    this.rivalRows = []
    this.rivalsKey = ''
    this.rivalEnds = new Map()
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
    if (this.hint) fitText(this.hint, width - 16, compact ? 13 : 15)
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
      // Only a press over the board (or just beside it) aims and fires — not one on the standings.
      const side = this.gridX0 - this.cell
      if (p.y < this.gridTop - 10 || p.x < side || p.x > side + this.cell * (this.cols + 2)) return
      this.pressed = true
      this.aimAtX(p.x)
    })
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      // Desktop hover aims too; on touch this is the drag.
      if (this.built && (p.isDown ? this.pressed : true)) this.aimAtX(p.x)
    })
    this.input.on('pointerup', () => {
      if (!this.pressed) return
      this.pressed = false
      this.fire()
    })
    const kb = this.input.keyboard
    if (kb) {
      this.aimKeys = {
        left: [kb.addKey('LEFT'), kb.addKey('A')],
        right: [kb.addKey('RIGHT'), kb.addKey('D')],
      }
      kb.addKeys('UP,W,SPACE,ENTER')
    }
    for (const key of ['LEFT', 'A']) this.onKey(key, () => this.startAim(-1))
    for (const key of ['RIGHT', 'D']) this.onKey(key, () => this.startAim(1))
    for (const key of ['SPACE', 'ENTER', 'UP', 'W']) this.onKey(key, () => this.fire())
  }

  // Lays the board out once the first snapshot tells us its size: as big as the space allows (a
  // standings column beside it on a wide screen).
  private build(snap: BubblePopSnapshot): void {
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    this.rows = snap.rows
    this.cols = snap.cols
    this.aim = Math.floor(snap.cols / 2)
    const top = this.top + (compact ? 14 : 20)
    const bottomReserve = compact ? 40 : 48
    const launcherRows = 2
    const landscape = !compact && width > height * 1.15
    const panelW = landscape ? Math.min(260, Math.round(width * 0.2)) : 0
    const sideRoom = landscape ? (panelW + 40) * 2 : 32
    this.cell = Math.floor(
      Math.min(
        (width - sideRoom) / snap.cols,
        (height - top - bottomReserve) / (snap.rows + launcherRows),
        96,
      ),
    )
    const gridW = this.cell * snap.cols
    const blockH = this.cell * (snap.rows + launcherRows)
    this.gridX0 = Math.round(width / 2 - gridW / 2)
    this.gridTop = Math.round(top + Math.max(0, (height - top - bottomReserve - blockH) / 2))
    this.launcherY = this.gridTop + this.cell * (snap.rows + 1.1)
    if (landscape) {
      this.panel = {
        x: this.gridX0 + gridW + 40,
        y: this.gridTop,
        w: panelW,
        h: this.cell * snap.rows,
      }
    }

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
      .text(
        0,
        0,
        'X',
        headlineStyle(this.cell >= 64 ? 32 : 24, PALETTE.red, {
          stroke: '#10121c',
          strokeThickness: 6,
        }),
      )
      .setOrigin(0.5)
      .setDepth(4)
      .setVisible(false)
    const px = Math.max(2, Math.round(this.cell / 14))
    const cannonKey = ensurePixelGrid(this, {
      key: `pp-bubble-cannon-${px}`,
      rows: CANNON,
      legend: { o: 0x2a2e48, h: 0xb3bbd6, b: 0x8d95b5, d: 0x5b6088 },
      pixelSize: px,
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

  private aimAtX(px: number): void {
    if (!this.built) return
    this.setAim(Math.floor((px - this.gridX0) / this.cell))
  }

  // ◀ ▶ pressed: one lane now, then repeating while held.
  private startAim(side: -1 | 1): void {
    this.aimSide = side
    this.aimAt = this.time.now + AIM_DELAY_MS
    this.setAim(this.aim + side)
  }

  private repeatAim(now: number): void {
    const side = this.aimSide
    if (!side) return
    const keys = side < 0 ? this.aimKeys.left : this.aimKeys.right
    if (!keys.some((k) => k.isDown)) {
      this.aimSide = undefined
      return
    }
    if (now < this.aimAt) return
    this.aimAt = now + AIM_REPEAT_MS
    this.setAim(this.aim + side)
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

  // The colour of the shot queue at slot `i`.
  private colorAt = (i: number): number => this.queue[i % Math.max(1, this.queue.length)] ?? 1

  // The server's board with the shots it hasn't taken yet replayed on it (all of them, or all but the
  // last `skip` — a shot still flying hasn't landed on screen).
  private predict(skip = 0): Predicted | null {
    const base = this.base
    if (!base) return null
    const grid = Array.from(base.grid, (c) => Number(c) || 0)
    let score = base.score
    let ptr = base.shot
    let done = base.done
    let jammed = base.jammed
    const replay = this.sent.filter((s) => s.n > base.shots)
    for (const s of replay.slice(0, Math.max(0, replay.length - skip))) {
      if (done || jammed) break
      const next = bubbleNextShot(grid, this.colorAt, ptr, this.queue.length)
      ptr = next.index + 1
      const shot = bubbleShoot(grid, s.col, next.color)
      if (shot.row === -1) continue
      score += shot.popped.length + shot.dropped.length
      done = grid.every((c) => c === 0)
      jammed = !done && bubbleJammed(grid)
    }
    const nextColor = bubbleNextShot(grid, this.colorAt, ptr, this.queue.length).color
    return { grid, score, nextColor, done, jammed }
  }

  private fire(): void {
    const now = this.predict()
    if (!this.built || !now || now.done || now.jammed || this.flying > 0 || this.state.final) return
    const col = this.aim
    this.sfx.shoot()
    this.sendInput({ kind: 'shoot', col })
    // What this shot does, on the board as shown: it flies there, then the board catches up.
    const grid = [...now.grid]
    const shot = bubbleShoot(grid, col, now.nextColor)
    this.sent.push({ n: ++this.shotCount, col, at: this.time.now })
    const toY = shot.row === -1 ? this.cellY(this.rows) : this.cellY(shot.row)
    const fromY = this.launcherY
    const color = now.nextColor
    const ball = this.add
      .image(this.cellX(col), fromY, bubbleKey(color))
      .setDisplaySize(this.cell - 4, this.cell - 4)
      .setDepth(4)
    this.flying++
    this.loaded?.setVisible(false)
    if (this.cannon) punch(this, this.cannon, -0.12, 60)
    if (this.gunner) punch(this, this.gunner.image, 0.1, 60)
    const before = now.grid
    this.tweens.add({
      targets: ball,
      y: toY,
      duration: Math.max(70, (Math.abs(fromY - toY) / this.cell) * FLIGHT_MS_PER_CELL),
      ease: 'Quad.easeIn',
      onComplete: () => {
        ball.destroy()
        this.flying = Math.max(0, this.flying - 1)
        this.loaded?.setVisible(true)
        this.onLanded(col, color, shot, before)
      },
    })
  }

  // The flying shot reached its cell: stick, pop, drop — the feedback comes from the shot itself.
  private onLanded(col: number, color: number, shot: BubbleShot, before: number[]): void {
    if (shot.row === -1) {
      this.sfx.wrong()
      floatText(
        this,
        this.cellX(col),
        this.gridTop + this.cell,
        this.t('game.common.miss'),
        PALETTE.red,
        16,
      )
      return
    }
    const view = this.predict()
    if (!view) return
    this.render(view)
    const placedOrb = this.orbs[shot.placed]
    if (placedOrb && !shot.popped.length) {
      // No match: it sticks where it hit.
      this.sfx.lock()
      placedOrb.setTexture(bubbleKey(color)).setVisible(true)
      punch(this, placedOrb, 0.25, 90)
    }
    const gone = [...shot.popped, ...shot.dropped]
    if (gone.length)
      this.popFx(
        gone,
        [...before.slice(0, shot.placed), color, ...before.slice(shot.placed + 1)],
        gone.length,
      )
  }

  protected frame(snap: BubblePopSnapshot | null, time: number): void {
    if (!snap) return
    if (!this.built) this.build(snap)
    this.gunner?.tick(time)
    this.repeatAim(this.time.now)
    this.renderRivals(snap)
    this.watchRivals(snap)
    const board = snap.boards[this.selfId]
    if (!board) {
      // A spectator (joined mid-round) has no board: an idle, unmanned cannon.
      this.gunner?.image.setVisible(false)
      this.loaded?.setVisible(false)
      this.hint?.setVisible(false)
      return
    }
    if (board !== this.base) this.onBoard(board, snap)
    // Hold the board while a shot is in flight, so pops happen when it lands.
    const view = this.predict(this.flying)
    if (!view) return
    if (this.flying === 0) this.render(view)
    const tex = COLOR_HEX[view.nextColor] !== undefined ? bubbleKey(view.nextColor) : undefined
    if (tex && view.nextColor !== this.loadedColor) {
      this.loadedColor = view.nextColor
      this.loaded?.setTexture(tex)
      if (this.loaded) punch(this, this.loaded, 0.2, 80)
    }
    if (this.flying === 0) {
      this.drawGuide(view)
    } else if (this.guideKey) {
      // The guide belongs to the loaded bubble: gone while it flies.
      this.guideKey = ''
      this.guideGfx?.clear()
      this.ghost?.setVisible(false)
      this.blocked?.setVisible(false)
    }
  }

  // A fresh snapshot of this player's board: the new base to predict from.
  private onBoard(board: BubblePopBoard, snap: BubblePopSnapshot): void {
    this.base = board
    if (snap.queue.length && this.queue.length !== snap.queue.length) {
      this.queue = Array.from(snap.queue, (c) => Number(c) || 1)
    }
    const now = this.time.now
    this.sent = this.sent.filter((s) => s.n > board.shots && now - s.at < PENDING_TTL_MS)
    if (!this.synced) {
      // First snapshot of this (possibly restarted) scene: adopt it without replaying fx, and number
      // shots after the ones the server has already taken.
      this.synced = true
      this.shotCount = Math.max(this.shotCount, board.shots)
      this.prevScore = board.score
      this.prevDone = board.done
      this.prevJammed = board.jammed
      if (board.done) this.showCleared(false)
      if (board.jammed) this.showJammed(false)
    }
  }

  // Shows a board state: orbs as they are, score, and the end states.
  private render(view: Predicted): void {
    const next = view.grid
    let changed = this.shown.length === 0
    for (let i = 0; i < this.orbs.length; i++) {
      const value = next[i] ?? 0
      if (this.shown.length && (this.shown[i] ?? 0) === value) continue
      changed = true
      const orb = this.orbs[i]
      if (!orb) continue
      orb.setVisible(value > 0 && COLOR_HEX[value] !== undefined)
      if (value && COLOR_HEX[value] !== undefined) orb.setTexture(bubbleKey(value))
    }
    if (changed) {
      this.shown = [...next]
      this.guideKey = ''
    }
    if (view.score !== this.prevScore || !this.scoreShown) {
      this.prevScore = view.score
      this.scoreShown = true
      this.hud?.setScore(this.t('game.common.pts', { n: view.score }))
    }
    if (view.done && !this.prevDone) this.showCleared(true)
    if (view.jammed && !this.prevJammed) this.showJammed(true)
    this.prevDone = view.done
    this.prevJammed = view.jammed
  }

  private popFx(cells: number[], colors: readonly number[], gained: number): void {
    this.sfx.pop()
    let sx = 0
    let sy = 0
    for (const i of cells) {
      const x = this.cellX(i % this.cols)
      const y = this.cellY(Math.floor(i / this.cols))
      sx += x
      sy += y
      burst(this, x, y, COLOR_HEX[colors[i] ?? 0] ?? PALETTE.text, 6, 160)
    }
    const cx = sx / cells.length
    const cy = sy / cells.length
    ring(this, cx, cy, PALETTE.text, this.cell)
    floatText(this, cx, cy, `+${gained}`, PALETTE.amber, cells.length >= BIG_POP ? 24 : 16)
    if (cells.length >= BIG_POP) {
      // A big cascade pays out like a multi-line clear.
      this.sfx.lineClear(Math.min(4, Math.floor(cells.length / BIG_POP) + 1))
      shake(this, 0.006, 140)
      floatText(this, cx, cy - 36, this.t('game.common.great'), PALETTE.lime, 16)
    }
  }

  // Dotted guide from the cannon up to the landing cell + a ghost bubble there (or an X if full).
  private drawGuide(view: Predicted): void {
    const g = this.guideGfx
    if (!g || !this.ghost || !this.blocked) return
    const grid = this.shown.length ? this.shown : view.grid
    const row = view.done || view.jammed ? -2 : bubbleLandingRow(grid, this.aim)
    const key = `${this.aim}:${row}:${view.nextColor}`
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
    const color = COLOR_HEX[view.nextColor] ?? PALETTE.text
    const endY = this.cellY(row) + this.cell / 2
    const dot = this.cell >= 64 ? 6 : 4
    g.fillStyle(color, 0.8)
    for (let y = this.launcherY - this.cell * 0.7; y > endY; y -= dot * 3)
      g.fillRect(Math.round(x) - dot / 2, Math.round(y) - dot / 2, dot, dot)
    this.ghost
      .setTexture(bubbleKey(view.nextColor))
      .setPosition(x, this.cellY(row))
      .setVisible(true)
  }

  private showCleared(withFx: boolean): void {
    if (withFx) {
      this.sfx.cheer()
      this.sfx.coin()
      const { width, height } = this.scale
      burst(this, width / 2, height / 2, PALETTE.amber, 30, 320)
      burst(this, width / 2, height / 2, PALETTE.cyan, 20, 260)
    }
    if (this.banner) showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.lime)
    this.waitText?.setText(this.t('game.common.waiting'))
    this.hint?.setVisible(false)
    this.cannon?.setVisible(false)
    this.loaded?.setVisible(false)
    this.gunner?.setExpression('happy')
  }

  // Every column blocked at the bottom: the board can't take another shot. Out for the round.
  private showJammed(withFx: boolean): void {
    if (withFx) {
      this.sfx.eliminated()
      shake(this, 0.012, 260)
      flash(this, PALETTE.red, 160)
    }
    if (this.banner) showBanner(this, this.banner, this.t('game.bubblePop.jammed'), PALETTE.red)
    this.waitText?.setText(this.t('game.common.waiting'))
    this.hint?.setVisible(false)
    this.cannon?.setAlpha(0.4)
    this.loaded?.setVisible(false)
    this.gunner?.setExpression('hurt')
  }

  // The rest of the room: a board cleared, or jammed for good — one quieter sound each per change,
  // however many happen at once.
  private watchRivals(snap: BubblePopSnapshot): void {
    const primed = this.rivalEnds.size > 0
    let out = false
    let finished = false
    for (const [id, b] of Object.entries(snap.boards)) {
      if (id === this.selfId) continue
      const was = this.rivalEnds.get(id)
      if (primed && was) {
        if (b.jammed && !was.jammed) out = true
        if (b.done && !was.done) finished = true
      }
      if (!was || was.done !== b.done || was.jammed !== b.jammed) {
        this.rivalEnds.set(id, { done: b.done, jammed: b.jammed })
      }
    }
    if (out) this.sfx.quiet(() => this.sfx.eliminated(), 0.6)
    if (finished) this.sfx.quiet(() => this.sfx.cheer(), 0.5)
  }

  // Everyone's score beside the board (wide screens), best first: avatar, name, points — a ★ for a
  // cleared board, a KO face for a jammed one. Rows are pooled; only changed text is touched.
  private renderRivals(snap: BubblePopSnapshot): void {
    const panel = this.panel
    if (!panel) return
    const ids = Object.keys(snap.boards)
    if (!this.rivalRows.length && ids.length) {
      const rowH = Math.max(ROW_MIN, Math.min(ROW_MAX, Math.floor(panel.h / ids.length)))
      const rows = Math.min(ids.length, Math.floor(panel.h / rowH))
      const font = rowH >= 26 ? 15 : 12
      for (let i = 0; i < rows; i++) {
        const y = panel.y + i * rowH + rowH / 2
        this.rivalRows.push({
          pip: this.add
            .image(panel.x, y, ensureAvatarTexture(this, 'cat', PALETTE.dim, 1))
            .setOrigin(0, 0.5),
          name: this.add.text(panel.x + 22, y, '', bodyStyle(font, PALETTE.text)).setOrigin(0, 0.5),
          score: this.add
            .text(panel.x + panel.w, y, '', headlineStyle(rowH >= 26 ? 16 : 8, PALETTE.text))
            .setOrigin(1, 0.5),
        })
      }
    }
    const rank = (id: string): number => {
      const b = snap.boards[id]
      return b?.done ? 1e6 : (b?.score ?? 0)
    }
    const ranked = [...ids].sort((a, b) => rank(b) - rank(a))
    let shown = ranked.slice(0, this.rivalRows.length)
    if (ranked.includes(this.selfId) && !shown.includes(this.selfId)) {
      shown = [...shown.slice(0, -1), this.selfId]
    }
    const key = shown
      .map(
        (id) =>
          `${id}:${snap.boards[id]?.score}:${snap.boards[id]?.done}:${snap.boards[id]?.jammed}`,
      )
      .join('|')
    if (key === this.rivalsKey) return
    this.rivalsKey = key
    this.rivalRows.forEach((row, i) => {
      const id = shown[i]
      const b = id ? snap.boards[id] : undefined
      row.pip.setVisible(!!b)
      row.name.setVisible(!!b)
      row.score.setVisible(!!b)
      if (!id || !b) return
      const color = this.state.colorOf(id)
      const face = b.jammed ? 'ko' : b.done ? 'happy' : 'idle'
      const alpha = b.jammed ? 0.5 : 1
      row.pip
        .setTexture(ensureAvatarTexture(this, this.state.avatarOf(id), color, 1, 'front', face))
        .setAlpha(alpha)
      row.name
        .setText(`${b.done ? '★' : ''}${this.label(id).slice(0, 12)}`)
        .setColor(hexToCss(id === this.selfId ? PALETTE.amber : color))
        .setAlpha(alpha)
      row.score.setText(String(b.score)).setAlpha(alpha)
    })
  }
}
