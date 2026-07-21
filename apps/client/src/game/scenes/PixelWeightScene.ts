import type { ClientMsg, PixelWeightObject, PixelWeightSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'

// Pixel Weight canvas. A pixel-art object flashes for flashMs, then hides; drag the slider (or use
// -/+) to estimate how many pixels it had and submit. Scene key === mini-game id.
export class PixelWeightScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private score?: Phaser.GameObjects.Text
  private prompt?: Phaser.GameObjects.Text
  private pixels: Phaser.GameObjects.Rectangle[] = []
  private track?: Phaser.GameObjects.Rectangle
  private knob?: Phaser.GameObjects.Rectangle
  private valueLabel?: Phaser.GameObjects.Text
  private submitBtn?: Phaser.GameObjects.Rectangle
  private submitLabel?: Phaser.GameObjects.Text
  private minusBtn?: Phaser.GameObjects.Text
  private plusBtn?: Phaser.GameObjects.Text
  private trackX0 = 0
  private trackX1 = 0
  private guess = 0
  private maxGuess = 100
  private drawnIndex = -1
  private flashUntil = 0
  private lastScore = 0

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
  ) {
    super('pixel-weight')
  }

  create(): void {
    this.pixels = []
    this.drawnIndex = -1
    this.flashUntil = 0
    this.lastScore = 0
    this.guess = 0
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.06, '', { fontFamily: 'monospace', fontSize: '24px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.score = this.add
      .text(cx, height * 0.12, '', { fontFamily: 'monospace', fontSize: '16px', color: '#9fb3c8' })
      .setOrigin(0.5)
    this.prompt = this.add
      .text(cx, height * 0.19, '', { fontFamily: 'monospace', fontSize: '22px', color: '#e6edf3' })
      .setOrigin(0.5)

    // Guess slider.
    this.trackX0 = width * 0.18
    this.trackX1 = width * 0.82
    const ty = height * 0.68
    this.track = this.add
      .rectangle((this.trackX0 + this.trackX1) / 2, ty, this.trackX1 - this.trackX0, 8, 0x3a4668)
      .setInteractive({ useHandCursor: true })
    this.track.on('pointerdown', (p: Phaser.Input.Pointer) => this.setGuessFromX(p.x))
    this.knob = this.add.rectangle(this.trackX0, ty, 22, 34, 0xffd166).setStrokeStyle(3, 0x11181f)
    this.knob.setInteractive({ draggable: true, useHandCursor: true })
    this.input.setDraggable(this.knob)
    this.knob.on('drag', (_p: Phaser.Input.Pointer, dragX: number) => this.setGuessFromX(dragX))
    this.valueLabel = this.add
      .text(cx, ty - height * 0.08, '0', {
        fontFamily: 'monospace',
        fontSize: '34px',
        color: '#ffd166',
      })
      .setOrigin(0.5)

    this.minusBtn = this.add
      .text(this.trackX0 - width * 0.06, ty, '−', {
        fontFamily: 'monospace',
        fontSize: '34px',
        color: '#9fb3c8',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
    this.minusBtn.on('pointerdown', () => this.nudge(-1))
    this.plusBtn = this.add
      .text(this.trackX1 + width * 0.06, ty, '+', {
        fontFamily: 'monospace',
        fontSize: '34px',
        color: '#9fb3c8',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
    this.plusBtn.on('pointerdown', () => this.nudge(1))

    this.submitBtn = this.add
      .rectangle(cx, height * 0.84, width * 0.4, height * 0.1, 0x2a9d3f)
      .setStrokeStyle(3, 0x11181f)
      .setInteractive({ useHandCursor: true })
    this.submitBtn.on('pointerdown', () => this.submit())
    this.submitLabel = this.add
      .text(cx, height * 0.84, 'GUESS', {
        fontFamily: 'monospace',
        fontSize: '26px',
        color: '#e6edf3',
      })
      .setOrigin(0.5)
  }

  private currentObject(): PixelWeightObject | null {
    return (
      (this.state.state as PixelWeightSnapshot | null)?.objects[this.state.selfId ?? ''] ?? null
    )
  }

  private setGuessFromX(x: number): void {
    const clamped = Phaser.Math.Clamp(x, this.trackX0, this.trackX1)
    const t = (clamped - this.trackX0) / (this.trackX1 - this.trackX0)
    this.guess = Math.round(t * this.maxGuess)
    this.sfx.tick()
  }

  private nudge(d: number): void {
    this.guess = Phaser.Math.Clamp(this.guess + d, 0, this.maxGuess)
    this.sfx.tick()
  }

  private submit(): void {
    const obj = this.currentObject()
    if (!obj || this.time.now < this.flashUntil) return
    this.sfx.click()
    this.send({
      type: 'MINIGAME_INPUT',
      input: { kind: 'guess', index: obj.index, value: this.guess },
    })
    this.guess = 0
  }

  private drawObject(obj: PixelWeightObject): void {
    for (const p of this.pixels) p.destroy()
    this.pixels = []
    const { width, height } = this.scale
    const cx = width / 2
    const area = Math.min(width * 0.7, height * 0.34)
    const size = area / Math.max(obj.cols, obj.rows)
    const startX = cx - (obj.cols * size) / 2 + size / 2
    const startY = height * 0.42 - (obj.rows * size) / 2 + size / 2
    for (const px of obj.pixels) {
      const x = startX + px.x * size
      const y = startY + px.y * size
      this.pixels.push(this.add.rectangle(x, y, size - 1, size - 1, 0x06d6a0))
    }
    this.drawnIndex = obj.index
    this.flashUntil = this.time.now + obj.flashMs
    this.maxGuess = obj.maxGuess
    this.guess = 0
  }

  override update(): void {
    const snap = this.state.state as PixelWeightSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const obj = snap.objects[selfId] ?? null
    const myScore = snap.scores[selfId] ?? 0
    if (myScore > this.lastScore) this.sfx.correct()
    this.lastScore = myScore

    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    this.score?.setText(`${myScore} pts`)

    const controls = [
      this.track,
      this.knob,
      this.valueLabel,
      this.submitBtn,
      this.submitLabel,
      this.minusBtn,
      this.plusBtn,
    ]
    if (!obj) {
      this.prompt?.setText('Done!')
      for (const p of this.pixels) p.setVisible(false)
      for (const c of controls) c?.setVisible(false)
      return
    }
    if (obj.index !== this.drawnIndex) this.drawObject(obj)

    const flashing = this.time.now < this.flashUntil
    for (const p of this.pixels) p.setVisible(flashing)
    for (const c of controls) c?.setVisible(!flashing)
    this.prompt
      ?.setText(flashing ? `Weigh the ${obj.name}!` : 'How many pixels?')
      .setColor(flashing ? '#e6edf3' : '#ffd166')

    // Keep the knob + label in sync with the guess.
    const t = this.maxGuess > 0 ? this.guess / this.maxGuess : 0
    this.knob?.setX(this.trackX0 + t * (this.trackX1 - this.trackX0))
    this.valueLabel?.setText(String(this.guess))
  }
}
