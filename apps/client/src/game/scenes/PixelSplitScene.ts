import { PALETTE, type PixelSplitObject, type PixelSplitSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import { addBanner, burst, floatText, punch, ring, showBanner } from '../fx'
import { bodyStyle, ensureBevelPanel, ensurePixelBlock, headlineStyle, shade } from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// The two halves are tinted apart so the balance reads at a glance (counts are never shown until the
// cut is made — it's a visual judgment).
const LEFT_COLOR = PALETTE.cyan
const RIGHT_COLOR = PALETTE.magenta
// Mirrors pixelSplit.ts scoring: the best achievable cut is worth this much.
const MAX_POINTS = 10
const SPLIT_MS = 380
const REVEAL_DELAY_MS = 220
// Space between the board's bottom edge and the cut handle.
const HANDLE_GAP = 26

interface Cell {
  img: Phaser.GameObjects.Image
  x: number
}

// Pixel Split canvas. The object stays visible on a gridded board; drag the cut line (or ← →) to a
// column boundary so both halves hold the same number of pixels — the halves are tinted apart as it
// moves — then press CUT (Enter/Space). The object splits open, each half shows its count and the
// score delta rates the cut. Objects arrive mirrored/shifted by the server, so the ideal cut moves.
export class PixelSplitScene extends MiniGameScene<PixelSplitSnapshot> {
  private prompt?: Phaser.GameObjects.Text
  private boardGfx?: Phaser.GameObjects.Graphics
  private cells: Cell[] = []
  private cutGfx?: Phaser.GameObjects.Graphics
  private handle?: Phaser.GameObjects.Image
  private handleLabel?: Phaser.GameObjects.Text
  private submitImg?: Phaser.GameObjects.Image
  private submitLabel?: Phaser.GameObjects.Text
  private waitText?: Phaser.GameObjects.Text
  private banner?: Phaser.GameObjects.Text
  private leftKey = ''
  private rightKey = ''
  private boardCX = 0
  private boardCY = 0
  private boardW = 0
  private boardH = 0
  private handleY = 0
  private handleSize = 44
  private gridX0 = 0
  private gridTop = 0
  private cellSize = 0
  private cols = 0
  private rows = 0
  private cut = 1
  private drawnCut = -1
  private drawnIndex = -1
  private lastScore = 0
  private submitted?: { index: number; cut: number }
  private finished = false

  constructor(...deps: SceneDeps) {
    super('pixel-split', ...deps)
  }

  override create(): void {
    super.create()
    this.cells = []
    this.drawnIndex = -1
    this.drawnCut = -1
    this.lastScore = 0
    this.cut = 1
    this.cols = 0
    this.submitted = undefined
    this.finished = false

    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const cx = width / 2
    const top = this.top
    this.leftKey = ensurePixelBlock(this, 'pp-split-left', 16, LEFT_COLOR, 2)
    this.rightKey = ensurePixelBlock(this, 'pp-split-right', 16, RIGHT_COLOR, 2)

    const promptY = top + (compact ? 22 : 30)
    this.prompt = this.add
      .text(
        cx,
        promptY,
        this.t('game.pixelSplit.prompt'),
        headlineStyle(compact ? 16 : 24, PALETTE.text),
      )
      .setOrigin(0.5)

    // CUT button at the bottom, the cut handle row above it, the board filling the rest.
    const btnH = compact ? 56 : 64
    const btnW = Math.round(Math.min(width * 0.6, 300))
    const btnY = height - (compact ? 20 : 28) - btnH / 2
    const up = ensureBevelPanel(this, btnW, btnH, PALETTE.lime)
    const down = ensureBevelPanel(this, btnW, btnH, shade(PALETTE.lime, -0.25))
    this.submitImg = this.add.image(cx, btnY, up).setInteractive({ useHandCursor: true })
    this.submitLabel = this.add
      .text(cx, btnY, this.t('game.pixelSplit.cut'), headlineStyle(24, PALETTE.bg))
      .setOrigin(0.5)
    this.submitImg.on('pointerdown', () => {
      this.submitImg?.setTexture(down)
      this.submitLabel?.setY(btnY + 2)
      this.submit()
    })
    const release = (): void => {
      this.submitImg?.setTexture(up)
      this.submitLabel?.setY(btnY)
    }
    this.submitImg.on('pointerup', release)
    this.submitImg.on('pointerout', release)

    const handleSize = compact ? 44 : 48
    this.handleSize = handleSize
    this.handleY = btnY - btnH / 2 - (compact ? 22 : 30) - handleSize / 2
    const boardTop = promptY + (compact ? 28 : 40)
    const boardBottom = this.handleY + handleSize / 2
    this.boardCX = cx
    this.boardCY = (boardTop + boardBottom) / 2
    this.boardW = Math.min(width - 32, 620)
    this.boardH = boardBottom - boardTop - HANDLE_GAP - handleSize
    this.boardGfx = this.add.graphics()
    this.cutGfx = this.add.graphics().setDepth(5)
    this.handle = this.add
      .image(cx, this.handleY, ensureBevelPanel(this, handleSize, handleSize, PALETTE.amber))
      .setDepth(5)
    this.handleLabel = this.add
      .text(cx, this.handleY, '◀▶', headlineStyle(16, PALETTE.bg))
      .setOrigin(0.5)
      .setDepth(6)

    // Drag over the play area (not the whole scene — a global listener would also fire, and move the
    // cut, when the CUT button below is pressed) to move the cut.
    const dragZone = this.add
      .zone(
        cx,
        (boardTop + this.handleY + handleSize / 2) / 2,
        width,
        this.handleY + handleSize / 2 - boardTop + 20,
      )
      .setInteractive()
    dragZone.on('pointerdown', (p: Phaser.Input.Pointer) => this.setCutFromX(p.x))
    dragZone.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.setCutFromX(p.x)
    })
    this.onKey('LEFT', () => this.moveCut(this.cut - 1), { repeat: true })
    this.onKey('RIGHT', () => this.moveCut(this.cut + 1), { repeat: true })
    this.onKey('ENTER', () => this.submit())
    this.onKey('SPACE', () => this.submit())

    this.waitText = this.add
      .text(
        cx,
        height / 2 + (compact ? 44 : 56),
        '',
        bodyStyle(compact ? 14 : 18, PALETTE.text, { stroke: '#10121c', strokeThickness: 4 }),
      )
      .setOrigin(0.5)
      .setDepth(951)
    this.banner = addBanner(this)
    // The kit's 34px banner overflows a phone on longer words ("¡TERMINADO!").
    if (compact) this.banner.setFontSize(24)
  }

  private currentObject(): PixelSplitObject | null {
    return this.snap?.objects[this.selfId] ?? null
  }

  private setCutFromX(x: number): void {
    if (this.cols < 2) return
    this.moveCut(Math.round((x - this.gridX0) / this.cellSize))
  }

  private moveCut(next: number): void {
    if (this.cols < 2 || !this.currentObject()) return
    const clamped = Phaser.Math.Clamp(next, 1, this.cols - 1)
    if (clamped === this.cut) return
    this.cut = clamped
    this.sfx.tick()
  }

  private submit(): void {
    const obj = this.currentObject()
    if (!obj || this.submitted?.index === obj.index) return
    this.sfx.click()
    this.submitted = { index: obj.index, cut: this.cut }
    this.sendInput({ kind: 'cut', index: obj.index, cut: this.cut })
  }

  // Board window + faint column guides (every possible cut position).
  private drawBoard(): void {
    const g = this.boardGfx
    if (!g) return
    g.clear()
    const w = this.cols * this.cellSize
    const h = this.rows * this.cellSize
    const pad = 10
    const x = Math.round(this.gridX0 - pad)
    const y = Math.round(this.gridTop - pad)
    g.fillStyle(shade(PALETTE.frame, -0.45), 1).fillRect(x, y, w + pad * 2, h + pad * 2)
    g.fillStyle(PALETTE.frame, 1).fillRect(x, y, w + pad * 2 - 4, h + pad * 2 - 4)
    g.fillStyle(PALETTE.panel, 1).fillRect(x + 4, y + 4, w + pad * 2 - 8, h + pad * 2 - 8)
    g.fillStyle(PALETTE.panelAlt, 1)
    for (let c = 1; c < this.cols; c++) {
      g.fillRect(Math.round(this.gridX0 + c * this.cellSize) - 1, Math.round(this.gridTop), 2, h)
    }
  }

  private layoutFor(obj: PixelSplitObject): void {
    this.cols = obj.cols
    this.rows = obj.rows
    this.cellSize = Math.floor(
      Math.min((this.boardW - 20) / obj.cols, (this.boardH - 20) / obj.rows, 44),
    )
    this.gridX0 = Math.round(this.boardCX - (obj.cols * this.cellSize) / 2)
    // Board + cut handle travel together, centred in the free space (a flat object on a tall phone
    // would otherwise leave a long laser dangling down to a far-off handle).
    const gridH = obj.rows * this.cellSize
    const blockH = gridH + HANDLE_GAP + this.handleSize
    this.gridTop = Math.round(this.boardCY - blockH / 2)
    this.handleY = this.gridTop + gridH + HANDLE_GAP + this.handleSize / 2
    this.handle?.setY(this.handleY)
    this.handleLabel?.setY(this.handleY)
  }

  private drawObject(obj: PixelSplitObject): void {
    for (const c of this.cells) c.img.destroy()
    this.layoutFor(obj)
    this.drawBoard()
    const s = this.cellSize
    const fresh: Cell[] = obj.pixels.map((px) => ({
      x: px.x,
      img: this.add
        .image(this.gridX0 + px.x * s + s / 2, this.gridTop + px.y * s + s / 2, this.leftKey)
        .setDisplaySize(s - 1, s - 1)
        .setDepth(2),
    }))
    // After a cut, let the old halves fly apart before the next object drops in.
    if (this.drawnIndex >= 0) {
      for (const c of fresh) c.img.setVisible(false)
      this.time.delayedCall(REVEAL_DELAY_MS, () => {
        for (const c of fresh) c.img.setVisible(true)
      })
    }
    this.cells = fresh
    this.drawnIndex = obj.index
    this.drawnCut = -1
    // Start the cut at the far left every object: a centred default would score full points on
    // symmetric figures without the player doing anything, making them trivial.
    this.cut = 1
  }

  // The object just scored splits open along the cut; each half pops its pixel count.
  private splitApart(cut: number, gained: number): void {
    const s = this.cellSize
    let left = 0
    let right = 0
    for (const c of this.cells) {
      const isLeft = c.x < cut
      if (isLeft) left++
      else right++
      this.tweens.add({
        targets: c.img,
        x: c.img.x + (isLeft ? -s * 1.5 : s * 1.5),
        alpha: 0,
        duration: SPLIT_MS,
        ease: 'Quad.easeOut',
        onComplete: () => c.img.destroy(),
      })
    }
    this.cells = []
    const cutX = this.gridX0 + cut * s
    const y = this.gridTop - 6
    const even = left === right
    floatText(this, cutX - 50, y, String(left), even ? PALETTE.lime : LEFT_COLOR, 24)
    floatText(this, cutX + 50, y, String(right), even ? PALETTE.lime : RIGHT_COLOR, 24)
    const [label, color] =
      gained >= MAX_POINTS
        ? [this.t('game.common.perfect'), PALETTE.lime]
        : gained >= 7
          ? [this.t('game.common.great'), PALETTE.lime]
          : gained >= 4
            ? [this.t('game.common.good'), PALETTE.amber]
            : [this.t('game.common.miss'), PALETTE.red]
    const midY = this.gridTop + (this.rows * s) / 2
    floatText(this, this.boardCX, midY, label, color, 24)
    if (gained > 0) floatText(this, this.boardCX, midY + 36, `+${gained}`, PALETTE.amber, 16)
    if (gained >= MAX_POINTS) {
      this.sfx.coin()
      ring(this, cutX, midY, PALETTE.lime, 90)
      burst(this, cutX, midY, PALETTE.lime, 22, 280)
    } else if (gained >= 4) {
      this.sfx.correct()
      burst(this, cutX, midY, PALETTE.amber, 10, 180)
    } else {
      this.sfx.wrong()
    }
  }

  protected frame(snap: PixelSplitSnapshot | null): void {
    if (!snap) return
    const obj = snap.objects[this.selfId] ?? null
    const myScore = snap.scores[this.selfId] ?? 0
    this.hud?.setScore(this.t('game.common.pts', { n: myScore }))

    const advanced = obj ? obj.index !== this.drawnIndex : !this.finished
    if (advanced && this.drawnIndex >= 0 && this.submitted?.index === this.drawnIndex) {
      this.splitApart(this.submitted.cut, myScore - this.lastScore)
    }
    this.lastScore = myScore

    if (!obj) {
      this.showFinished()
      return
    }
    if (obj.index !== this.drawnIndex) this.drawObject(obj)
    if (this.cut !== this.drawnCut) this.drawCut()
  }

  // Cut line on the chosen column boundary + handle; the halves re-tint around it.
  private drawCut(): void {
    this.drawnCut = this.cut
    for (const c of this.cells) c.img.setTexture(c.x < this.cut ? this.leftKey : this.rightKey)
    const g = this.cutGfx
    if (!g) return
    const x = Math.round(this.gridX0 + this.cut * this.cellSize)
    const y0 = this.gridTop - 16
    const y1 = this.handleY
    g.clear()
    // Dashed "laser": a dark core with amber dashes, so it reads over both halves.
    g.fillStyle(shade(PALETTE.amber, -0.6), 1).fillRect(x - 3, y0, 6, y1 - y0)
    g.fillStyle(PALETTE.amber, 1)
    for (let y = y0; y < y1; y += 12) g.fillRect(x - 2, y, 4, Math.min(8, y1 - y))
    this.handle?.setX(x)
    this.handleLabel?.setX(x)
    if (this.handle) punch(this, this.handle, 0.1, 60)
  }

  private showFinished(): void {
    for (const c of this.cells) c.img.setVisible(false)
    this.cutGfx?.clear()
    this.boardGfx?.setVisible(false)
    for (const o of [this.handle, this.handleLabel, this.submitImg, this.submitLabel, this.prompt])
      o?.setVisible(false)
    if (this.finished) return
    this.finished = true
    if (this.banner) showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.lime)
    this.waitText?.setText(this.t('game.common.waiting'))
  }
}
