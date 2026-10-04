import {
  PALETTE,
  type PixelCell,
  type PixelWeightObject,
  type PixelWeightSnapshot,
  unpackCells,
} from '@pp/shared'
import Phaser from 'phaser'
import { addBanner, burst, floatText, punch, ring, showBanner } from '../fx'
import {
  bodyStyle,
  ensureBevelPanel,
  ensurePixelBlock,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Cosmetic colour per shared object (the server only sends a name); anything new falls back to lime.
const OBJECT_COLORS: Record<string, number> = {
  HEART: PALETTE.red,
  BANANA: PALETTE.amber,
  CAR: PALETTE.cyan,
  FISH: PALETTE.orange,
  TREE: PALETTE.lime,
  STAR: PALETTE.amber,
  MUSHROOM: PALETTE.magenta,
  HOUSE: PALETTE.orange,
  CAT: 0xb06bff,
  GHOST: PALETTE.text,
  KEY: PALETTE.amber,
  APPLE: PALETTE.red,
  CROWN: PALETTE.amber,
}
// Mirrors pixelWeight.ts scoring: a perfect guess is worth this much, minus one per pixel off.
const MAX_POINTS = 10
const REVEAL_MS = 900
const REPEAT_DELAY_MS = 350
const REPEAT_MS = 55
// ↑ ↓ (W S) step the guess by this much; ← → (A D) by one.
const BIG_STEP = 10
// Digits typed within this long of each other build one number ("8", "7" -> 87); a pause starts over.
const TYPE_GAP_MS = 1500
// The dial's tick plays at most this often (a fast drag across the track would buzz otherwise).
const DIAL_TICK_EVERY_MS = 45
// A create() within this long of the scene's own shutdown is a relayout restart mid-round (a new round
// only starts seconds after the previous one stopped) — the one case where a memo may carry over.
const RELAYOUT_GAP_MS = 1000

// The everyone strip (PlayerStrip) rebuilds every chip from scratch on any change — new Text objects,
// each measuring its font again — which cost a frame per snapshot once a full room was scoring. It
// follows the scores at most twice a second; your own score in the HUD stays immediate.
const STRIP_EVERY_MS = 500

interface Button {
  img: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  up: string
  down: string
}

// Pixel Weight canvas. A pixel-art object sits on a weighing scale for flashMs (a draining bar shows
// how long), then hides; dial in how many pixels it had — type the number, drag the slider, tap/hold
// − +, or ← → (±1) / ↑ ↓ (±10) — and press GUESS (Enter / Space). The scale's LED shows the guess; after
// a guess it briefly shows the real count while the score delta rates the estimate. The server owns
// the true counts and scoring.
export class PixelWeightScene extends MiniGameScene<PixelWeightSnapshot> {
  private prompt?: Phaser.GameObjects.Text
  private pixels: Phaser.GameObjects.Image[] = []
  // Spare pixel images (hidden), reused by the next object.
  private pool: Phaser.GameObjects.Image[] = []
  private question?: Phaser.GameObjects.Text
  private flashBar?: Phaser.GameObjects.Rectangle
  private led?: Phaser.GameObjects.Text
  private trackGfx?: Phaser.GameObjects.Graphics
  private knob?: Phaser.GameObjects.Image
  private minus?: Button
  private plus?: Button
  private submitBtn?: Button
  private waitText?: Phaser.GameObjects.Text
  private banner?: Phaser.GameObjects.Text
  // Everyone's score at a glance (avatar + name + points) under the HUD.
  private strip?: PlayerStrip
  // The keyboard path, named on screen (hidden on touch-sized screens).
  private hint?: Phaser.GameObjects.Text
  private controls: (Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Visible)[] = []
  private repeat?: Phaser.Time.TimerEvent
  private plateY = 0
  private plateW = 0
  private objArea = 0
  private barW = 0
  private trackX0 = 0
  private trackX1 = 0
  private trackY = 0
  private guess = 0
  private maxGuess = 100
  private drawnIndex = -1
  private flashUntil = 0
  private flashMs = 1
  private lastScore = 0
  private lastCount = 0
  private revealUntil = 0
  private controlsOn = false
  private finished = false
  // Digits typed so far for this object, and when the last one landed.
  private typed = ''
  private typedAt = 0
  private dialTickAt = Number.NEGATIVE_INFINITY
  // What's drawn, so per-frame work only happens on a change.
  private drawnTrack = ''
  private shownFlash: boolean | null = null
  private stripSnap?: PixelWeightSnapshot
  private scoreSnap?: PixelWeightSnapshot
  private stripAt = 0
  // The cells of the object on screen (unpacked once per object).
  private cells: PixelCell[] = []
  // The flash window of the object on screen, kept across a relayout restart (create() clears it only
  // for a fresh round): an orientation flip or window resize mid-object resumes it instead of showing
  // the object again — rotating the phone must not hand the player a second look.
  private flashMemo = { round: -1, index: -1, until: 0 }
  private stoppedAt = Number.NEGATIVE_INFINITY

  constructor(...deps: SceneDeps) {
    super('pixel-weight', ...deps)
  }

  override create(): void {
    super.create()
    if (this.game.getTime() - this.stoppedAt > RELAYOUT_GAP_MS) {
      this.flashMemo = { round: -1, index: -1, until: 0 }
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stoppedAt = this.game.getTime()
    })
    this.pixels = []
    this.pool = []
    this.controls = []
    this.repeat = undefined
    this.drawnIndex = -1
    this.flashUntil = 0
    this.lastScore = 0
    this.lastCount = 0
    this.revealUntil = 0
    this.guess = 0
    this.controlsOn = false
    this.finished = false
    this.typed = ''
    this.typedAt = 0
    this.dialTickAt = Number.NEGATIVE_INFINITY
    this.drawnTrack = ''
    this.shownFlash = null
    this.stripSnap = undefined
    this.scoreSnap = undefined
    this.stripAt = 0
    this.cells = []
    this.hint = undefined

    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    // Everyone's chips read from the couch on a big (1080p) canvas.
    const stripSize = compact ? 11 : width >= 1400 && height >= 860 ? 16 : 13
    const stripRows = width < 600 ? 3 : 2
    const stripH = PlayerStrip.rowH(stripSize)
    this.strip = new PlayerStrip(
      this,
      width / 2,
      this.top + 2 + stripH / 2,
      width - 24,
      stripSize,
      stripRows,
    )
    const cx = width / 2
    const top = this.top + stripRows * stripH + 2
    const promptY = top + (compact ? 22 : 30)
    this.prompt = this.add
      .text(cx, promptY, '', headlineStyle(compact ? 16 : 24, PALETTE.text, { align: 'center' }))
      .setOrigin(0.5)

    // Bottom-up: the keys hint (keyboard screens only), GUESS button, slider row, the scale (LED +
    // plate), the object above the plate.
    const hintH = compact ? 0 : 26
    if (!compact) {
      this.hint = this.add
        .text(cx, height - 8, this.t('game.pixelWeight.keys'), bodyStyle(16, PALETTE.dim))
        .setOrigin(0.5, 1)
    }
    const btnH = compact ? 56 : 64
    const btnW = Math.round(Math.min(width * 0.6, 300))
    const btnY = height - (compact ? 20 : 28) - hintH - btnH / 2
    this.submitBtn = this.makeButton(
      cx,
      btnY,
      btnW,
      btnH,
      PALETTE.lime,
      this.t('game.pixelWeight.guess'),
      24,
      () => this.submit(),
    )

    const side = compact ? 48 : 56
    this.trackY = btnY - btnH / 2 - (compact ? 40 : 52)
    this.minus = this.makeButton(
      16 + side / 2,
      this.trackY,
      side,
      side,
      PALETTE.frameLit,
      '-',
      24,
      () => this.nudge(-1),
      true,
    )
    this.plus = this.makeButton(
      width - 16 - side / 2,
      this.trackY,
      side,
      side,
      PALETTE.frameLit,
      '+',
      24,
      () => this.nudge(1),
      true,
    )
    this.trackX0 = 16 + side + (compact ? 24 : 36)
    this.trackX1 = width - 16 - side - (compact ? 24 : 36)
    this.trackGfx = this.add.graphics()
    const zone = this.add
      .zone((this.trackX0 + this.trackX1) / 2, this.trackY, this.trackX1 - this.trackX0 + 40, side)
      .setInteractive({ useHandCursor: true })
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => this.setGuessFromX(p.x))
    zone.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.setGuessFromX(p.x)
    })
    this.knob = this.add
      .image(
        this.trackX0,
        this.trackY,
        ensureBevelPanel(this, compact ? 24 : 28, compact ? 40 : 44, PALETTE.amber),
      )
      .setDepth(2)
    this.controls.push(
      this.trackGfx,
      zone,
      this.knob,
      this.minus.img,
      this.minus.label,
      this.plus.img,
      this.plus.label,
      this.submitBtn.img,
      this.submitBtn.label,
    )

    // The scale: LED base, neck and the plate the object sits on.
    const ledH = compact ? 40 : 48
    const baseTop = this.trackY - side / 2 - (compact ? 26 : 34) - ledH - 12
    this.objArea = Math.max(
      100,
      // A big canvas (1080p) gets a bigger object; laptops and phones keep the old cap.
      Math.min(
        width * (compact ? 0.78 : 0.42),
        baseTop - (promptY + 40) - 30,
        width >= 1400 && height >= 860 ? 480 : 340,
      ),
    )
    this.plateW = Math.round(this.objArea + (compact ? 24 : 40))
    this.plateY = baseTop - (compact ? 22 : 28)
    // On tall screens the prompt drops to sit just above the object instead of floating at the top.
    this.prompt.setY(Math.max(promptY, this.plateY - this.objArea * 0.75 - (compact ? 40 : 56)))
    this.drawScale(cx, baseTop, ledH)
    this.led = this.add
      .text(cx, baseTop + 6 + ledH / 2, '--', headlineStyle(compact ? 24 : 32, PALETTE.lime))
      .setOrigin(0.5)
      .setDepth(3)
    this.barW = this.plateW
    this.flashBar = this.add
      .rectangle(cx - this.barW / 2, this.plateY + 16, this.barW, compact ? 6 : 8, PALETTE.amber)
      .setOrigin(0, 0.5)
      .setDepth(3)
    this.question = this.add
      .text(
        cx,
        this.plateY - this.objArea * 0.4,
        '?',
        headlineStyle(compact ? 64 : 96, PALETTE.frameLit, {
          stroke: '#10121c',
          strokeThickness: 10,
        }),
      )
      .setOrigin(0.5)
      .setVisible(false)
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

    for (const [keys, d] of [
      [['LEFT', 'A'], -1],
      [['RIGHT', 'D'], 1],
      [['DOWN', 'S'], -BIG_STEP],
      [['UP', 'W'], BIG_STEP],
    ] as const) {
      for (const k of keys) this.onKey(k, () => this.nudge(d), { repeat: true })
    }
    this.onKey('ENTER', () => this.submit())
    this.onKey('SPACE', () => this.submit())
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.typeKey(e))
    // A held − / + stops repeating when the button is released anywhere — or the window loses focus.
    const stop = (): void => this.stopRepeat()
    this.input.on('pointerup', stop)
    this.input.on('pointerupoutside', stop)
    this.game.events.on(Phaser.Core.Events.BLUR, stop)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.game.events.off(Phaser.Core.Events.BLUR, stop),
    )
    this.controlsOn = true
    this.setControls(false)
  }

  private makeButton(
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    text: string,
    size: number,
    onPress: () => void,
    repeat = false,
  ): Button {
    const up = ensureBevelPanel(this, w, h, color)
    const down = ensureBevelPanel(this, w, h, shade(color, -0.25))
    const img = this.add.image(x, y, up).setInteractive({ useHandCursor: true })
    const label = this.add
      .text(x, y, text, headlineStyle(size, color === PALETTE.lime ? PALETTE.bg : PALETTE.text))
      .setOrigin(0.5)
      .setDepth(1)
    const btn = { img, label, up, down }
    img.on('pointerdown', () => {
      img.setTexture(down)
      label.setY(y + 2)
      onPress()
      if (repeat) {
        this.stopRepeat()
        this.repeat = this.time.addEvent({
          delay: REPEAT_DELAY_MS,
          callback: () => {
            this.repeat = this.time.addEvent({ delay: REPEAT_MS, loop: true, callback: onPress })
          },
        })
      }
    })
    const release = (): void => {
      img.setTexture(up)
      label.setY(y)
      if (repeat) this.stopRepeat()
    }
    img.on('pointerup', release)
    img.on('pointerout', release)
    return btn
  }

  private stopRepeat(): void {
    this.repeat?.remove()
    this.repeat = undefined
  }

  // Pixel-art weighing scale: plate on a neck over a base with an LED window.
  private drawScale(cx: number, baseTop: number, ledH: number): void {
    const g = this.add.graphics()
    const metal = 0x8d95b5
    const plateH = 10
    const px = Math.round(cx - this.plateW / 2)
    const py = Math.round(this.plateY)
    g.fillStyle(shade(metal, -0.5), 1).fillRect(px, py, this.plateW, plateH)
    g.fillStyle(shade(metal, 0.4), 1).fillRect(px, py, this.plateW, 3)
    g.fillStyle(metal, 1).fillRect(px + 2, py + 3, this.plateW - 4, plateH - 5)
    const neckW = 24
    g.fillStyle(shade(metal, -0.35), 1).fillRect(
      Math.round(cx - neckW / 2),
      py + plateH,
      neckW,
      Math.round(baseTop - py - plateH),
    )
    const baseW = Math.round(Math.min(this.plateW * 0.7, 260))
    const bx = Math.round(cx - baseW / 2)
    const bh = ledH + 12
    g.fillStyle(shade(PALETTE.frame, -0.4), 1).fillRect(bx, Math.round(baseTop), baseW, bh)
    g.fillStyle(PALETTE.frameLit, 1).fillRect(bx, Math.round(baseTop), baseW, 4)
    g.fillStyle(PALETTE.frame, 1).fillRect(bx + 4, Math.round(baseTop) + 4, baseW - 8, bh - 8)
    const ledW = Math.round(Math.min(baseW - 24, 150))
    g.fillStyle(0x0b1a10, 1).fillRect(
      Math.round(cx - ledW / 2),
      Math.round(baseTop) + 6,
      ledW,
      ledH,
    )
    g.lineStyle(2, shade(PALETTE.lime, -0.6), 1).strokeRect(
      Math.round(cx - ledW / 2),
      Math.round(baseTop) + 6,
      ledW,
      ledH,
    )
  }

  private currentObject(snap: PixelWeightSnapshot | null = this.snap): PixelWeightObject | null {
    const at = snap?.at[this.selfId]
    if (!snap || at === null || at === undefined) return null
    return snap.objects.find((o) => o.index === at) ?? null
  }

  private canGuess(): boolean {
    return this.currentObject() !== null && this.time.now >= this.flashUntil
  }

  private setGuessFromX(x: number): void {
    if (!this.canGuess()) return
    const clamped = Phaser.Math.Clamp(x, this.trackX0, this.trackX1)
    const t = (clamped - this.trackX0) / (this.trackX1 - this.trackX0)
    const next = Math.round(t * this.maxGuess)
    if (next !== this.guess) {
      this.guess = next
      this.dialTick()
    }
  }

  // The guess moved: a throttled dial tick.
  private dialTick(): void {
    if (this.time.now - this.dialTickAt < DIAL_TICK_EVERY_MS) return
    this.dialTickAt = this.time.now
    this.sfx.tick()
  }

  private nudge(d: number): void {
    if (!this.canGuess()) return
    this.typed = ''
    const next = Phaser.Math.Clamp(this.guess + d, 0, this.maxGuess)
    if (next === this.guess) return
    this.guess = next
    this.dialTick()
  }

  // Typing the count: digits (top row or numpad) build the number, Backspace takes one back.
  private typeKey(e: KeyboardEvent): void {
    if (e.repeat || !this.canGuess()) return
    const now = this.time.now
    if (e.key === 'Backspace') {
      this.typed = this.typed.slice(0, -1)
    } else if (/^[0-9]$/.test(e.key)) {
      const fresh = now - this.typedAt > TYPE_GAP_MS || this.typed.length >= 3
      this.typed = (fresh ? '' : this.typed) + e.key
    } else {
      return
    }
    this.typedAt = now
    this.guess = Phaser.Math.Clamp(Number(this.typed || '0'), 0, this.maxGuess)
    this.sfx.tick()
    if (this.led) punch(this, this.led, 0.12, 60)
  }

  private submit(): void {
    const obj = this.currentObject()
    if (!obj || !this.canGuess()) return
    this.stopRepeat()
    // The guess locks in on the press; the rating follows the score.
    this.sfx.lock()
    this.sendInput({ kind: 'guess', index: obj.index, value: this.guess })
    this.guess = 0
    this.typed = ''
    if (this.submitBtn) punch(this, this.submitBtn.img, -0.06, 60)
  }

  private objectName(obj: PixelWeightObject): string {
    const key = `game.pixelWeight.objects.${obj.name}`
    const name = this.t(key)
    return name === key ? obj.name : name
  }

  private drawObject(obj: PixelWeightObject): void {
    // The last object's images are reused (hidden spares wait in the pool), not destroyed and rebuilt.
    this.pool.push(...this.pixels)
    this.pixels = []
    this.shownFlash = null
    this.cells = unpackCells(obj.cols, obj.rows, obj.bits)
    const cx = this.scale.width / 2
    const size = Math.floor(this.objArea / Math.max(obj.cols, obj.rows))
    const color = OBJECT_COLORS[obj.name] ?? PALETTE.lime
    const key = ensurePixelBlock(this, `pp-weight-px-${color.toString(16)}`, 16, color, 2)
    // Centred on its filled pixels (the shared art is padded off-centre), bottom row on the plate.
    let minX = obj.cols
    let maxX = 0
    let maxY = 0
    for (const p of this.cells) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    const x0 = cx - ((maxX + minX + 1) * size) / 2 + size / 2
    const y0 = this.plateY - (maxY + 1) * size + size / 2
    for (const px of this.cells) {
      const img = this.pool.pop() ?? this.add.image(0, 0, key).setDepth(1)
      this.pixels.push(
        img
          .setTexture(key)
          .setPosition(x0 + px.x * size, y0 + px.y * size)
          .setDisplaySize(size, size),
      )
    }
    for (const img of this.pool) img.setVisible(false)
    this.drawnIndex = obj.index
    this.flashMs = Math.max(1, obj.flashMs)
    const memo = this.flashMemo
    if (memo.round === this.state.round && memo.index === obj.index) {
      this.flashUntil = memo.until
    } else {
      this.flashUntil = this.time.now + obj.flashMs
      this.flashMemo = { round: this.state.round, index: obj.index, until: this.flashUntil }
      // A fresh object thuds onto the scale's plate (not when a relayout restart redraws it).
      this.sfx.land()
    }
    this.maxGuess = obj.maxGuess
    this.lastCount = this.cells.length
    this.guess = 0
    this.typed = ''
    this.question?.setY(this.plateY - Math.min((maxY + 1) * size, this.objArea) / 2)
  }

  // Rates the guess just scored from its score delta (the server's 10-minus-error formula).
  private rate(gained: number, count: number): void {
    const cx = this.scale.width / 2
    const y = this.plateY - this.objArea * 0.5
    const [label, color] =
      gained >= MAX_POINTS
        ? [this.t('game.common.perfect'), PALETTE.lime]
        : gained >= 7
          ? [this.t('game.common.great'), PALETTE.lime]
          : gained >= 4
            ? [this.t('game.common.good'), PALETTE.amber]
            : [this.t('game.common.miss'), PALETTE.red]
    floatText(this, cx, y, label, color, 24)
    floatText(this, cx, y + 36, this.t('game.pixelWeight.actual', { n: count }), PALETTE.text, 16)
    if (gained > 0)
      floatText(this, cx + this.plateW / 2 - 20, this.plateY - 20, `+${gained}`, PALETTE.amber, 16)
    if (gained >= MAX_POINTS) {
      this.sfx.coin()
      burst(this, cx, this.plateY, PALETTE.lime, 20, 260)
      ring(this, cx, this.plateY, PALETTE.lime, 80)
    } else if (gained >= 4) {
      this.sfx.correct()
      burst(this, cx, this.plateY, PALETTE.amber, 10, 180)
    } else {
      this.sfx.wrong()
    }
    // The LED shows the real count for a moment.
    this.revealUntil = this.time.now + REVEAL_MS
    this.led?.setText(String(count)).setColor(hexToCss(color))
    if (this.led) punch(this, this.led, 0.25, 100)
  }

  private setControls(on: boolean): void {
    if (on === this.controlsOn) return
    this.controlsOn = on
    for (const c of this.controls) c.setVisible(on)
    if (on && this.submitBtn) punch(this, this.submitBtn.img, 0.08, 80)
    if (!on) this.stopRepeat()
  }

  protected frame(snap: PixelWeightSnapshot | null): void {
    if (!snap) return
    // Scores change only with a snapshot: the HUD chip follows each one, the strip is throttled.
    if (snap !== this.scoreSnap) {
      this.scoreSnap = snap
      this.hud?.setScore(this.t('game.common.pts', { n: snap.scores[this.selfId] ?? 0 }))
    }
    if (snap !== this.stripSnap && (this.time.now >= this.stripAt || this.state.final)) {
      this.stripSnap = snap
      this.stripAt = this.time.now + STRIP_EVERY_MS
      this.strip?.set(
        Object.keys(snap.scores).map((id) => ({
          text: `${this.label(id)} ${snap.scores[id] ?? 0}`,
          avatar: this.state.avatarOf(id),
          color: this.state.colorOf(id),
        })),
      )
    }
    const obj = this.currentObject(snap)
    const myScore = snap.scores[this.selfId] ?? 0
    const advanced = obj ? obj.index !== this.drawnIndex : this.drawnIndex >= 0 && !this.finished
    if (advanced && this.drawnIndex >= 0) this.rate(myScore - this.lastScore, this.lastCount)
    this.lastScore = myScore

    if (!obj) {
      // Out of objects — or a spectator, not in this round at all.
      this.showFinished(!(this.selfId in snap.at))
      return
    }
    if (obj.index !== this.drawnIndex) this.drawObject(obj)

    const now = this.time.now
    const flashing = now < this.flashUntil
    if (flashing !== this.shownFlash) {
      this.shownFlash = flashing
      for (const p of this.pixels) p.setVisible(flashing)
      this.question?.setVisible(!flashing)
      this.flashBar?.setVisible(flashing)
      this.setControls(!flashing)
      this.prompt
        ?.setText(
          flashing
            ? this.t('game.pixelWeight.weigh', { object: this.objectName(obj) })
            : this.t('game.pixelWeight.howMany'),
        )
        .setColor(hexToCss(flashing ? PALETTE.text : PALETTE.amber))
    }
    if (flashing) {
      this.flashBar?.setSize(
        Math.max(0, ((this.flashUntil - now) / this.flashMs) * this.barW),
        this.flashBar.height,
      )
    }

    if (now >= this.revealUntil) {
      this.led?.setText(flashing ? '--' : String(this.guess)).setColor(hexToCss(PALETTE.lime))
    }
    this.drawTrack()
  }

  // Groove with a tick every 10 units, amber fill up to the knob (redrawn only when the guess moves).
  private drawTrack(): void {
    const g = this.trackGfx
    if (!g || !this.controlsOn) return
    const key = `${this.guess}/${this.maxGuess}`
    if (key === this.drawnTrack) return
    this.drawnTrack = key
    const t = this.maxGuess > 0 ? this.guess / this.maxGuess : 0
    const kx = this.trackX0 + t * (this.trackX1 - this.trackX0)
    this.knob?.setX(kx)
    const y = Math.round(this.trackY)
    const w = this.trackX1 - this.trackX0
    g.clear()
    g.fillStyle(shade(PALETTE.panel, -0.4), 1).fillRect(this.trackX0 - 4, y - 7, w + 8, 14)
    g.fillStyle(PALETTE.frame, 1).fillRect(this.trackX0 - 4, y + 5, w + 8, 2)
    g.fillStyle(PALETTE.amber, 1).fillRect(this.trackX0, y - 3, Math.max(0, kx - this.trackX0), 6)
    g.fillStyle(PALETTE.frameLit, 1)
    for (let v = 0; v <= this.maxGuess; v += 10) {
      const x = Math.round(this.trackX0 + (v / Math.max(1, this.maxGuess)) * w)
      g.fillRect(x - 1, y + 10, 2, v % 50 === 0 ? 8 : 4)
    }
  }

  private showFinished(spectator: boolean): void {
    for (const p of this.pixels) p.setVisible(false)
    this.question?.setVisible(false)
    this.flashBar?.setVisible(false)
    this.setControls(false)
    this.prompt?.setVisible(false)
    this.hint?.setVisible(false)
    if (this.time.now >= this.revealUntil) this.led?.setText('--')
    if (this.finished) return
    this.finished = true
    if (this.banner && !spectator)
      showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.lime)
    this.waitText?.setText(this.t('game.common.waiting'))
  }
}
