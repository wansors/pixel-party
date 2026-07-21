import type { ClientMsg, PixelHoopsSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'

const CHARGE_MS = 1200
const TOLERANCE = 0.12

// Pixel Hoops (basketball) canvas. Hold to charge the power meter, release to shoot; match the green
// target band (higher hoop = more power). Consecutive baskets build a combo. Scene key === mini-game id.
export class PixelHoopsScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private score?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private hoop?: Phaser.GameObjects.Rectangle
  private meterBg?: Phaser.GameObjects.Rectangle
  private meterFill?: Phaser.GameObjects.Rectangle
  private targetBand?: Phaser.GameObjects.Rectangle
  private meterX = 0
  private meterBottom = 0
  private meterH = 0
  private hoopX = 0
  private hoopLo = 0
  private hoopHi = 0
  private charging = false
  private chargeStart = 0
  private lastScore = 0
  private lastIndex = -1

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
  ) {
    super('pixel-hoops')
  }

  create(): void {
    this.charging = false
    this.lastScore = 0
    this.lastIndex = -1
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.06, '', { fontFamily: 'monospace', fontSize: '24px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.score = this.add
      .text(cx, height * 0.12, '', { fontFamily: 'monospace', fontSize: '18px', color: '#9fb3c8' })
      .setOrigin(0.5)

    // Hoop travels vertically with the shot's required power (higher target = higher hoop).
    this.hoopX = cx
    this.hoopHi = height * 0.24
    this.hoopLo = height * 0.56
    this.hoop = this.add.rectangle(this.hoopX, this.hoopLo, width * 0.22, 10, 0xf4c20d)

    // Power meter on the right.
    this.meterH = height * 0.5
    this.meterBottom = height * 0.86
    this.meterX = width * 0.82
    const meterW = width * 0.1
    this.meterBg = this.add
      .rectangle(this.meterX, this.meterBottom - this.meterH / 2, meterW, this.meterH, 0x1d2740)
      .setStrokeStyle(3, 0x3a4668)
    this.targetBand = this.add.rectangle(this.meterX, this.meterBottom, meterW, 10, 0x2a9d3f)
    this.meterFill = this.add
      .rectangle(this.meterX, this.meterBottom, meterW - 8, 0, 0xffd166)
      .setOrigin(0.5, 1)

    this.status = this.add
      .text(cx, height * 0.7, 'Hold to charge, release to shoot', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#5b6b7b',
      })
      .setOrigin(0.5)

    this.input.on('pointerdown', () => this.startCharge())
    this.input.on('pointerup', () => this.release())
    this.input.keyboard?.on('keydown-SPACE', () => this.startCharge())
    this.input.keyboard?.on('keyup-SPACE', () => this.release())
  }

  private power(): number {
    return Math.min(1, (this.time.now - this.chargeStart) / CHARGE_MS)
  }

  private currentShot() {
    return (this.state.state as PixelHoopsSnapshot | null)?.shots[this.state.selfId ?? ''] ?? null
  }

  private startCharge(): void {
    if (this.charging || !this.currentShot()) return
    this.charging = true
    this.chargeStart = this.time.now
  }

  private release(): void {
    if (!this.charging) return
    this.charging = false
    const shot = this.currentShot()
    if (!shot) return
    this.sfx.click()
    this.send({
      type: 'MINIGAME_INPUT',
      input: { kind: 'shoot', index: shot.index, power: this.power() },
    })
  }

  override update(): void {
    const snap = this.state.state as PixelHoopsSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const shot = snap.shots[selfId] ?? null
    const myScore = snap.scores[selfId] ?? 0
    const combo = snap.combos[selfId] ?? 0
    const idx = shot?.index ?? -1

    // Make/miss inferred from the score delta as the shot index advances.
    if (myScore > this.lastScore) {
      this.sfx.coin()
      this.status?.setText(`SWISH! x${combo}`).setColor('#06d6a0')
    } else if (this.lastIndex >= 0 && idx > this.lastIndex) {
      this.sfx.wrong()
      this.status?.setText('MISS').setColor('#e63946')
    }
    this.lastScore = myScore
    this.lastIndex = idx

    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    this.score?.setText(`${myScore} pts   combo ${combo}`)

    const target = shot?.distance ?? 0
    // Hoop height + target band track the required power.
    this.hoop?.setY(this.hoopLo + (this.hoopHi - this.hoopLo) * target)
    this.targetBand?.setY(this.meterBottom - target * this.meterH)
    this.targetBand?.setSize(this.meterBg?.width ?? 20, Math.max(6, TOLERANCE * 2 * this.meterH))

    const p = this.charging ? this.power() : 0
    this.meterFill?.setSize((this.meterBg?.width ?? 20) - 8, p * this.meterH)

    if (!shot) this.status?.setText('Done!').setColor('#9fb3c8')
  }
}
