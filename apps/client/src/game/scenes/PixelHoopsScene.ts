import { type ClientMsg, PALETTE, type PixelHoopsSnapshot, toleranceForShot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import {
  addArcadeBackdrop,
  bodyStyle,
  ensurePixelBlock,
  ensurePixelOrb,
  headlineStyle,
  hexToCss,
} from '../pixelStyle'

const CHARGE_MS = 1200

// Pixel Hoops (basketball) canvas. Hold to charge the power meter, release to shoot; match the green
// target band (higher hoop = more power). Consecutive baskets build a combo. Scene key === mini-game id.
export class PixelHoopsScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private score?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private hoop?: Phaser.GameObjects.Image
  private ball?: Phaser.GameObjects.Image
  private shotStartX = 0
  private shotStartY = 0
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
    private readonly t: Translate,
  ) {
    super('pixel-hoops')
  }

  create(): void {
    this.charging = false
    this.lastScore = 0
    this.lastIndex = -1
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.06, '', headlineStyle(24, PALETTE.lime))
      .setOrigin(0.5)
    this.score = this.add.text(cx, height * 0.12, '', bodyStyle(18)).setOrigin(0.5)

    // Hoop travels vertically with the shot's required power (higher target = higher hoop).
    this.hoopX = cx
    this.hoopHi = height * 0.24
    this.hoopLo = height * 0.56
    const hoopKey = ensurePixelBlock(this, 'pp-hoops-hoop', 16, PALETTE.amber)
    this.hoop = this.add.image(this.hoopX, this.hoopLo, hoopKey).setDisplaySize(width * 0.22, 10)

    // Ball flies from the shooter to the hoop on release — purely presentational, the server owns the
    // make/miss result; this just gives the shot a visible arc instead of a silent number change.
    const ballKey = ensurePixelOrb(this, 'pp-hoops-ball', 6, PALETTE.orange)
    this.shotStartX = cx
    this.shotStartY = height * 0.92
    this.ball = this.add.image(this.shotStartX, this.shotStartY, ballKey).setVisible(false)

    // Power meter on the right.
    this.meterH = height * 0.5
    this.meterBottom = height * 0.86
    this.meterX = width * 0.82
    const meterW = width * 0.1
    this.meterBg = this.add
      .rectangle(
        this.meterX,
        this.meterBottom - this.meterH / 2,
        meterW,
        this.meterH,
        PALETTE.panelAlt,
      )
      .setStrokeStyle(3, PALETTE.frame)
    this.targetBand = this.add.rectangle(this.meterX, this.meterBottom, meterW, 10, PALETTE.lime)
    this.meterFill = this.add
      .rectangle(this.meterX, this.meterBottom, meterW - 8, 0, PALETTE.amber)
      .setOrigin(0.5, 1)

    this.status = this.add
      .text(cx, height * 0.7, this.t('game.pixelHoops.hint'), bodyStyle(18))
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
    this.animateShot()
  }

  private animateShot(): void {
    if (!this.ball) return
    const start = new Phaser.Math.Vector2(this.shotStartX, this.shotStartY)
    const end = new Phaser.Math.Vector2(this.hoopX, this.hoop?.y ?? this.hoopLo)
    const control = new Phaser.Math.Vector2((start.x + end.x) / 2, Math.min(start.y, end.y) - 80)
    const path = new Phaser.Curves.QuadraticBezier(start, control, end)
    this.ball.setPosition(start.x, start.y).setVisible(true).setAlpha(1).setAngle(0)
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 500,
      ease: 'Sine.easeIn',
      onUpdate: (tw) => {
        const v = tw.getValue() ?? 0
        const p = path.getPoint(v)
        this.ball?.setPosition(p.x, p.y).setAngle(v * 360)
      },
      onComplete: () => {
        this.tweens.add({ targets: this.ball, alpha: 0, duration: 200, delay: 60 })
      },
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
      this.status
        ?.setText(this.t('game.pixelHoops.swish', { combo }))
        .setColor(hexToCss(PALETTE.lime))
    } else if (this.lastIndex >= 0 && idx > this.lastIndex) {
      this.sfx.wrong()
      this.status?.setText(this.t('game.pixelHoops.miss')).setColor(hexToCss(PALETTE.red))
    }
    this.lastScore = myScore
    this.lastIndex = idx

    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    this.score?.setText(this.t('game.pixelHoops.combo', { score: myScore, combo }))

    const target = shot?.distance ?? 0
    // Hoop height + target band track the required power.
    this.hoop?.setY(this.hoopLo + (this.hoopHi - this.hoopLo) * target)
    this.targetBand?.setY(this.meterBottom - target * this.meterH)
    const tolerance = idx >= 0 ? toleranceForShot(idx) : toleranceForShot(0)
    this.targetBand?.setSize(this.meterBg?.width ?? 20, Math.max(6, tolerance * 2 * this.meterH))

    const p = this.charging ? this.power() : 0
    this.meterFill?.setSize((this.meterBg?.width ?? 20) - 8, p * this.meterH)

    if (!shot) this.status?.setText(this.t('game.common.done')).setColor(hexToCss(PALETTE.dim))
  }
}
