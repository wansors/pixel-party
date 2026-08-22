import { PALETTE } from '@pp/shared'
import type { ClientMsg, NumberRushSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import {
  addArcadeBackdrop,
  bodyStyle,
  ensurePixelBlock,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'

// Cleared cells reuse the lime accent, darkened, instead of the flat old-palette green.
const CLEARED_COLOR = shade(PALETTE.lime, -0.6)

// Number Rush (Schulte grid) canvas. Renders the shared seeded grid; the player taps numbers in order.
// Cells already cleared by this player dim out. Scene key === mini-game id.
export class NumberRushScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private next?: Phaser.GameObjects.Text
  private cells: { image: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text }[] = []
  private built = false
  private cellPx = 0

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('number-rush')
  }

  create(): void {
    this.built = false
    this.cells = []
    this.cellPx = 0
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.06, '', headlineStyle(24, PALETTE.lime))
      .setOrigin(0.5)
    this.next = this.add.text(cx, height * 0.12, '', bodyStyle(18)).setOrigin(0.5)
  }

  private cellKey(cleared: boolean): string {
    return `pp-number-rush-cell-${cleared ? 'cleared' : 'open'}-${this.cellPx}`
  }

  // The grid is built once, the first time a snapshot with a layout arrives.
  private build(snap: NumberRushSnapshot): void {
    const { width, height } = this.scale
    const cx = width / 2
    const n = snap.size
    const area = Math.min(width * 0.9, height * 0.7)
    const gap = area * 0.02
    const cell = (area - gap * (n - 1)) / n
    const startX = cx - area / 2 + cell / 2
    const startY = height * 0.2 + cell / 2
    this.cellPx = Math.max(8, Math.floor(cell))
    ensurePixelBlock(this, this.cellKey(false), this.cellPx, PALETTE.panelAlt)
    ensurePixelBlock(this, this.cellKey(true), this.cellPx, CLEARED_COLOR)
    for (let i = 0; i < snap.grid.length; i++) {
      const col = i % n
      const row = Math.floor(i / n)
      const x = startX + col * (cell + gap)
      const y = startY + row * (cell + gap)
      const image = this.add
        .image(x, y, this.cellKey(false))
        .setDisplaySize(cell, cell)
        .setInteractive({ useHandCursor: true })
      image.on('pointerdown', () => this.tap(i))
      const label = this.add
        .text(x, y, String(snap.grid[i]), bodyStyle(Math.floor(cell * 0.4), PALETTE.text))
        .setOrigin(0.5)
      this.cells.push({ image, label })
    }
    this.built = true
  }

  private tap(cell: number): void {
    const snap = this.state.state as NumberRushSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const nextNum = snap.progress[selfId] ?? 1
    if (snap.grid[cell] === nextNum) this.sfx.click()
    else this.sfx.wrong()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'tap', cell } })
  }

  override update(): void {
    const snap = this.state.state as NumberRushSnapshot | null
    if (!snap) return
    if (!this.built) this.build(snap)
    const selfId = this.state.selfId ?? ''
    const nextNum = snap.progress[selfId] ?? 1
    const done = nextNum > snap.grid.length
    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    this.next?.setText(
      done ? this.t('game.numberRush.done') : this.t('game.numberRush.find', { n: nextNum }),
    )
    this.cells.forEach(({ image, label }, i) => {
      const cleared = (snap.grid[i] ?? 0) < nextNum
      image.setTexture(this.cellKey(cleared))
      label.setColor(hexToCss(cleared ? PALETTE.lime : PALETTE.text))
      label.setAlpha(cleared ? 0.5 : 1)
    })
  }
}
