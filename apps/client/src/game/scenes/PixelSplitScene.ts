import { PALETTE } from '@pp/shared'
import type { ClientMsg, PixelSplitObject, PixelSplitSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { addArcadeBackdrop, bodyStyle, headlineStyle, shade } from '../pixelStyle'

const OBJECT_COLOR = 0x3a7bd5

// Pixel Split canvas. The object stays visible; drag the vertical cut line to a column boundary so both
// halves hold the same number of pixels, then submit. Counts are never shown — it's a visual judgment.
// Scene key === mini-game id.
export class PixelSplitScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private score?: Phaser.GameObjects.Text
  private prompt?: Phaser.GameObjects.Text
  private pixels: Phaser.GameObjects.Rectangle[] = []
  private cutLine?: Phaser.GameObjects.Rectangle
  private submitBtn?: Phaser.GameObjects.Rectangle
  private submitLabel?: Phaser.GameObjects.Text
  private gridX0 = 0
  private cellSize = 0
  private cols = 0
  private gridTop = 0
  private gridH = 0
  private cut = 1
  private drawnIndex = -1
  private lastScore = 0

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('pixel-split')
  }

  create(): void {
    this.pixels = []
    this.drawnIndex = -1
    this.lastScore = 0
    this.cut = 1
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.06, '', headlineStyle(24, PALETTE.lime))
      .setOrigin(0.5)
    this.score = this.add.text(cx, height * 0.12, '', bodyStyle(16, PALETTE.dim)).setOrigin(0.5)
    this.prompt = this.add
      .text(cx, height * 0.19, this.t('game.pixelSplit.prompt'), headlineStyle(22, PALETTE.text))
      .setOrigin(0.5)

    this.cutLine = this.add.rectangle(cx, height * 0.45, 4, height * 0.4, PALETTE.amber)

    // Drag anywhere over the play area to move the cut.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.setCutFromX(p.x))
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.setCutFromX(p.x)
    })

    this.submitBtn = this.add
      .rectangle(cx, height * 0.86, width * 0.4, height * 0.1, PALETTE.lime)
      .setStrokeStyle(3, PALETTE.bg)
      .setInteractive({ useHandCursor: true })
    this.submitBtn.on('pointerdown', () => this.submit())
    this.submitLabel = this.add
      .text(cx, height * 0.86, this.t('game.pixelSplit.cut'), headlineStyle(26, PALETTE.text))
      .setOrigin(0.5)
  }

  private currentObject(): PixelSplitObject | null {
    return (this.state.state as PixelSplitSnapshot | null)?.objects[this.state.selfId ?? ''] ?? null
  }

  private setCutFromX(x: number): void {
    if (this.cols < 2) return
    const rel = (x - this.gridX0) / this.cellSize
    const next = Phaser.Math.Clamp(Math.round(rel), 1, this.cols - 1)
    if (next !== this.cut) {
      this.cut = next
      this.sfx.tick()
    }
  }

  private submit(): void {
    const obj = this.currentObject()
    if (!obj) return
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'cut', index: obj.index, cut: this.cut } })
  }

  private drawObject(obj: PixelSplitObject): void {
    for (const p of this.pixels) p.destroy()
    this.pixels = []
    const { width, height } = this.scale
    const cx = width / 2
    const area = Math.min(width * 0.8, height * 0.4)
    this.cellSize = area / Math.max(obj.cols, obj.rows)
    this.cols = obj.cols
    this.gridX0 = cx - (obj.cols * this.cellSize) / 2
    this.gridH = obj.rows * this.cellSize
    this.gridTop = height * 0.45 - this.gridH / 2
    // Simple 2-tone shading: a lighter highlight band on the object's top row, base color elsewhere —
    // just enough that the flat silhouette reads as lit from above.
    const highlight = shade(OBJECT_COLOR, 0.25)
    for (const px of obj.pixels) {
      const x = this.gridX0 + px.x * this.cellSize + this.cellSize / 2
      const y = this.gridTop + px.y * this.cellSize + this.cellSize / 2
      const color = px.y === 0 ? highlight : OBJECT_COLOR
      this.pixels.push(this.add.rectangle(x, y, this.cellSize - 1, this.cellSize - 1, color))
    }
    this.drawnIndex = obj.index
    // Start the cut at the far left every object: a centred default would score full points on
    // symmetric figures without the player doing anything, making them trivial.
    this.cut = 1
  }

  override update(): void {
    const snap = this.state.state as PixelSplitSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const obj = snap.objects[selfId] ?? null
    const myScore = snap.scores[selfId] ?? 0
    if (myScore > this.lastScore) this.sfx.correct()
    this.lastScore = myScore

    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    this.score?.setText(this.t('game.common.pts', { n: myScore }))

    if (!obj) {
      this.prompt?.setText(this.t('game.common.done'))
      for (const p of this.pixels) p.setVisible(false)
      this.cutLine?.setVisible(false)
      this.submitBtn?.setVisible(false)
      this.submitLabel?.setVisible(false)
      return
    }
    if (obj.index !== this.drawnIndex) this.drawObject(obj)

    for (const p of this.pixels) p.setVisible(true)
    this.submitBtn?.setVisible(true)
    this.submitLabel?.setVisible(true)
    // Cut line sits on the chosen column boundary, spanning the object's height.
    this.cutLine
      ?.setVisible(true)
      .setPosition(this.gridX0 + this.cut * this.cellSize, this.gridTop + this.gridH / 2)
      .setSize(4, this.gridH + this.cellSize)
  }
}
