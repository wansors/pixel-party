import { type NumberRushSnapshot, PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { addBanner, burst, floatText, punch, ring, showBanner } from '../fx'
import { bodyStyle, ensureBevelPanel, fitText, headlineStyle, hexToCss, shade } from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const OPEN_COLOR = PALETTE.panelAlt
const CLEARED_COLOR = shade(PALETTE.lime, -0.72)
const WRONG_COLOR = shade(PALETTE.red, -0.35)
const MILESTONE = 5
const MAX_CHIPS = 6

interface Cell {
  image: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  x: number
  cleared: boolean
}

// Number Rush (Schulte grid) canvas. Renders the shared seeded 5x5 grid on a framed board; the player
// taps 1..25 in order. Cleared numbers sink into dark-lime tiles, a wrong tap wiggles red (the server
// just ignores it — hunting is the game), every 5th number pops a milestone, and a strip of player
// chips shows how far everyone else has got.
export class NumberRushScene extends MiniGameScene<NumberRushSnapshot> {
  private cells: Cell[] = []
  private prompt?: Phaser.GameObjects.Text
  private hint?: Phaser.GameObjects.Text
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private openKey = ''
  private clearedKey = ''
  private wrongKey = ''
  private cellSize = 0
  private boardTop = 0
  private boardBottom = 0
  private promptSize = 0
  // Optimistic next target: a correct tap counts at once, before the server's snapshot confirms it.
  private localNext = 1
  private lastNext = 1

  constructor(...deps: SceneDeps) {
    super('number-rush', ...deps)
  }

  override create(): void {
    super.create()
    this.cells = []
    this.localNext = 1
    this.lastNext = 1
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const cx = width / 2
    const promptSize = compact ? 24 : 32
    this.promptSize = promptSize
    this.prompt = this.add
      .text(
        cx,
        this.top + (compact ? 10 : 14) + promptSize / 2,
        '',
        headlineStyle(promptSize, PALETTE.amber, { stroke: '#10121c', strokeThickness: 6 }),
      )
      .setOrigin(0.5)
      .setDepth(5)
    this.boardTop = this.top + promptSize + (compact ? 26 : 34)

    const chipSize = compact ? 11 : 13
    const stripRows = width < 600 ? 2 : 1
    const hintY = height - (compact ? 14 : 18)
    this.hint = this.add.text(cx, hintY, '', bodyStyle(compact ? 12 : 15)).setOrigin(0.5)
    const stripY = hintY - 14 - stripRows * PlayerStrip.rowH(chipSize)
    this.strip = new PlayerStrip(
      this,
      cx,
      stripY + PlayerStrip.rowH(chipSize) / 2,
      width - 32,
      chipSize,
      stripRows,
    )
    this.cellSize = 0
    this.boardBottom = stripY - 10
    this.banner = addBanner(this).setFontSize(compact ? 24 : 32)
  }

  // The grid is built once, the first time a snapshot with a layout arrives.
  private build(snap: NumberRushSnapshot): void {
    const { width } = this.scale
    const n = snap.size
    const side = Math.floor(Math.min(width - 32, this.boardBottom - this.boardTop, 640))
    // Centered in the free band (on phones that also brings it closer to the thumbs).
    this.boardTop += Math.max(0, (this.boardBottom - this.boardTop - side) / 2)
    const pad = Math.max(8, Math.round(side * 0.025))
    const gap = Math.max(3, Math.round(side * 0.012))
    const cell = Math.floor((side - pad * 2 - gap * (n - 1)) / n)
    const boardW = cell * n + gap * (n - 1) + pad * 2
    const cx = width / 2
    const left = cx - boardW / 2
    this.add.image(
      cx,
      this.boardTop + boardW / 2,
      ensureBevelPanel(this, boardW, boardW, PALETTE.panel, 5, true),
    )
    this.cellSize = cell
    this.hint?.setText(this.t('game.numberRush.hint', { n: snap.grid.length }))
    this.openKey = ensureBevelPanel(this, cell, cell, OPEN_COLOR, 4, true)
    this.clearedKey = ensureBevelPanel(this, cell, cell, CLEARED_COLOR, 0, true)
    this.wrongKey = ensureBevelPanel(this, cell, cell, WRONG_COLOR, 4, true)
    const font = Math.max(8, Math.floor((cell * 0.36) / 8) * 8)
    for (let i = 0; i < snap.grid.length; i++) {
      const x = left + pad + (i % n) * (cell + gap) + cell / 2
      const y = this.boardTop + pad + Math.floor(i / n) * (cell + gap) + cell / 2
      const image = this.add.image(x, y, this.openKey).setInteractive({ useHandCursor: true })
      image.on('pointerdown', () => this.tap(i))
      const label = this.add
        .text(x, y, String(snap.grid[i]), headlineStyle(font, PALETTE.text))
        .setOrigin(0.5)
      this.cells.push({ image, label, x, cleared: false })
    }
  }

  private next(snap: NumberRushSnapshot): number {
    return Math.max(snap.progress[this.selfId] ?? 1, this.localNext)
  }

  private tap(index: number): void {
    const snap = this.snap
    const cell = this.cells[index]
    if (!snap || !cell || snap.remainingMs <= 0) return
    const target = this.next(snap)
    if (target > snap.grid.length || cell.cleared) return
    this.sendInput({ kind: 'tap', cell: index })
    if (snap.grid[index] === target) {
      this.localNext = target + 1
      this.sfx.click()
      punch(this, cell.image, 0.12, 70)
      ring(
        this,
        cell.image.x,
        cell.image.y,
        this.state.colorOf(this.selfId, PALETTE.lime),
        this.cellSize * 0.6,
      )
    } else {
      this.sfx.wrong()
      this.tweens.killTweensOf([cell.image, cell.label])
      cell.image.setX(cell.x).setTexture(this.wrongKey)
      cell.label.setX(cell.x)
      this.tweens.add({
        targets: [cell.image, cell.label],
        x: cell.x + 5,
        duration: 40,
        yoyo: true,
        repeat: 2,
      })
      this.time.delayedCall(260, () => {
        cell.image.setX(cell.x).setTexture(cell.cleared ? this.clearedKey : this.openKey)
        cell.label.setX(cell.x)
      })
    }
  }

  protected frame(snap: NumberRushSnapshot | null): void {
    if (!snap) return
    // A fresh build adopts the current progress silently (no bursts for cells cleared before it).
    const fresh = this.cells.length === 0
    if (fresh) this.build(snap)
    const total = snap.grid.length
    const next = this.next(snap)
    const cleared = Math.min(total, next - 1)
    const done = next > total
    this.hud?.setScore(`${cleared}/${total}`)

    if (next !== this.lastNext) {
      // A fresh build (mid-round relayout) only replays the end state, not every milestone.
      if (!fresh || done) this.onAdvance(next, total)
      this.lastNext = next
    }

    this.cells.forEach((cell, i) => {
      const isCleared = (snap.grid[i] ?? 0) < next
      if (isCleared === cell.cleared) return
      cell.cleared = isCleared
      cell.image.setTexture(isCleared ? this.clearedKey : this.openKey)
      cell.label
        .setColor(hexToCss(isCleared ? PALETTE.lime : PALETTE.text))
        .setAlpha(isCleared ? 0.45 : 1)
      if (isCleared && !fresh) burst(this, cell.image.x, cell.image.y, PALETTE.lime, 6, 120)
    })

    const chips = Object.entries(snap.progress)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CHIPS)
      .map(([id, p]) => {
        const name = this.label(id).slice(0, 10).toUpperCase()
        const n = Math.min(total, p - 1)
        return {
          text: `${name} ${n}/${total}${p > total ? ' ✓' : ''}`,
          color: this.state.colorOf(id),
        }
      })
    this.strip?.set(chips)

    if (done) {
      this.setPrompt(this.t('game.numberRush.done'), PALETTE.lime)
      this.hint?.setText(this.t('game.common.waiting'))
    } else {
      this.setPrompt(this.t('game.numberRush.find', { n: next }), PALETTE.amber)
    }
  }

  private setPrompt(text: string, color: number): void {
    const p = this.prompt
    if (!p || p.text === text) return
    p.setText(text).setColor(hexToCss(color))
    fitText(p, this.scale.width - 32, this.promptSize)
  }

  private onAdvance(next: number, total: number): void {
    const cleared = next - 1
    if (this.prompt) punch(this, this.prompt, 0.12, 80)
    if (next > total) {
      this.sfx.coin()
      const { width, height } = this.scale
      burst(this, width / 2, height / 2, PALETTE.amber, 30, 320)
      burst(this, width / 2, height / 2, PALETTE.lime, 20, 260)
      if (this.banner) showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.lime)
      return
    }
    if (cleared > 0 && cleared % MILESTONE === 0 && this.prompt) {
      this.sfx.correct()
      floatText(this, this.prompt.x, this.prompt.y + 24, `${cleared}/${total}`, PALETTE.lime, 18)
    }
  }
}
