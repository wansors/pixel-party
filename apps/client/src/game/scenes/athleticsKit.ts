import { type AthleticsFoot, PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { punch } from '../fx'
import { ensureBevelPanel, fitFontSize, headlineStyle, shade } from '../pixelStyle'

// Shared kit for the track & field scenes (TrackRaceSceneBase, FieldEventSceneBase): the athlete box
// the world is sized from, the two-foot tap pad (+ optional action button), stadium textures and
// dead-reckoned runner positions.

// --- Athlete box ----------------------------------------------------------------------------------

// The athletes are the players' lobby avatars (side view). Scenes size the world from an athlete
// "box" ATHLETE_H cells tall, scaled by an integer factor, spanning ~2.2 m.
export const ATHLETE_H = 24
// Metres of ground per stride frame, so the legs cycle with the runner's real speed.
export const METRES_PER_FRAME = 0.55

// --- Stadium textures -----------------------------------------------------------------------------

export const TARTAN = 0xc4553d
export const GRASS = 0x3f8f3a

// A repeating strip of `lanes` tartan lanes, each `laneH` px tall, with white lane lines.
export function ensureTrackTile(scene: Phaser.Scene, lanes: number, laneH: number): string {
  const h = Math.max(1, Math.round(lanes * laneH))
  const key = `pp-ath-track-${lanes}x${Math.round(laneH)}`
  if (scene.textures.exists(key)) return key
  const w = 64
  const g = scene.make.graphics({ x: 0, y: 0 })
  g.fillStyle(TARTAN, 1)
  g.fillRect(0, 0, w, h)
  // Deterministic speckle so the surface reads as rubber, not flat paint.
  for (let y = 0; y < h; y += 3) {
    for (let x = 0; x < w; x += 3) {
      const n = (x * 37 + y * 91 + ((x * y) % 13)) % 17
      if (n === 0) {
        g.fillStyle(shade(TARTAN, 0.18), 1)
        g.fillRect(x, y, 2, 2)
      } else if (n === 5) {
        g.fillStyle(shade(TARTAN, -0.2), 1)
        g.fillRect(x, y, 2, 2)
      }
    }
  }
  g.fillStyle(PALETTE.text, 1)
  for (let i = 0; i <= lanes; i++) {
    const y = Math.min(h - 2, Math.round(i * laneH))
    g.fillRect(0, y, w, 2)
  }
  g.generateTexture(key, w, h)
  g.destroy()
  return key
}

// Stadium stands: rows of spectators (deterministic hues) over dark terracing, `h` px tall.
export function ensureCrowdTile(scene: Phaser.Scene, h: number): string {
  const hh = Math.max(8, Math.round(h))
  const key = `pp-ath-crowd-${hh}`
  if (scene.textures.exists(key)) return key
  const w = 96
  const hues = [
    PALETTE.magenta,
    PALETTE.cyan,
    PALETTE.lime,
    PALETTE.amber,
    PALETTE.orange,
    0xb06bff,
    PALETTE.text,
    0x5b8cff,
  ]
  const g = scene.make.graphics({ x: 0, y: 0 })
  g.fillStyle(0x1b1e2e, 1)
  g.fillRect(0, 0, w, hh)
  const rowH = 8
  for (let row = 0; row * rowH < hh; row++) {
    const y = row * rowH
    g.fillStyle(row % 2 === 0 ? 0x252a40 : 0x20243a, 1)
    g.fillRect(0, y + 6, w, 2)
    for (let x = (row % 2) * 3; x < w; x += 6) {
      const n = (x * 7 + row * 13) % 23
      if (n % 5 === 0) continue // empty seat
      g.fillStyle(0xe0b48a, 1)
      g.fillRect(x + 1, y + 1, 3, 2)
      g.fillStyle(hues[n % hues.length] as number, 1)
      g.fillRect(x, y + 3, 5, 3)
    }
  }
  g.generateTexture(key, w, hh)
  g.destroy()
  return key
}

// Side-view hurdle (h px tall): striped top bar on two posts with feet. `down` = knocked flat.
export function ensureHurdleTexture(scene: Phaser.Scene, h: number, down: boolean): string {
  const hh = Math.max(8, Math.round(h))
  const key = `pp-ath-hurdle-${hh}${down ? '-down' : ''}`
  if (scene.textures.exists(key)) return key
  const w = Math.max(8, Math.round(hh * 0.55))
  const g = scene.make.graphics({ x: 0, y: 0 })
  const ink = 0x10121c
  const t = Math.max(2, Math.round(hh / 10))
  if (down) {
    // Toppled: the bar lying on the track in front of its feet.
    g.fillStyle(ink, 1)
    g.fillRect(0, hh - t * 2 - 2, w, t * 2 + 2)
    for (let x = 0; x < w; x += t * 2) {
      g.fillStyle((x / (t * 2)) % 2 === 0 ? PALETTE.text : PALETTE.red, 1)
      g.fillRect(x + 1, hh - t * 2 - 1, Math.min(t * 2, w - x - 2), t * 2)
    }
  } else {
    g.fillStyle(ink, 1)
    g.fillRect(Math.round(w / 2) - t, t, t * 2 + 2, hh - t) // post
    g.fillRect(0, hh - t - 1, w, t + 1) // foot
    g.fillStyle(0xb8c0d0, 1)
    g.fillRect(Math.round(w / 2) - t + 1, t * 2, t * 2, hh - t * 3)
    // Top bar: white with red bands.
    g.fillStyle(ink, 1)
    g.fillRect(0, 0, w, t * 2 + 2)
    for (let x = 0; x < w; x += t * 2) {
      g.fillStyle((x / (t * 2)) % 2 === 0 ? PALETTE.text : PALETTE.red, 1)
      g.fillRect(x + 1, 1, Math.min(t * 2, w - x - 2), t * 2)
    }
  }
  g.generateTexture(key, w, hh)
  g.destroy()
  return key
}

// Checkered finish strip, `w` x `h` px.
export function ensureCheckerTexture(scene: Phaser.Scene, w: number, h: number): string {
  const ww = Math.max(4, Math.round(w))
  const hh = Math.max(4, Math.round(h))
  const key = `pp-ath-checker-${ww}x${hh}`
  if (scene.textures.exists(key)) return key
  const cell = Math.max(2, Math.floor(ww / 2))
  const g = scene.make.graphics({ x: 0, y: 0 })
  for (let y = 0; y < hh; y += cell) {
    for (let x = 0; x < ww; x += cell) {
      g.fillStyle(((x + y) / cell) % 2 === 0 ? PALETTE.text : 0x10121c, 1)
      g.fillRect(x, y, cell, cell)
    }
  }
  g.generateTexture(key, ww, hh)
  g.destroy()
  return key
}

// A small marker flag on a pole (identity `color`), `h` px tall.
export function ensureFlagTexture(scene: Phaser.Scene, h: number, color: number): string {
  const hh = Math.max(10, Math.round(h))
  const key = `pp-ath-flag-${hh}-${color.toString(16)}`
  if (scene.textures.exists(key)) return key
  const w = Math.max(8, Math.round(hh * 0.6))
  const g = scene.make.graphics({ x: 0, y: 0 })
  g.fillStyle(0x10121c, 1)
  g.fillRect(0, 0, 3, hh)
  g.fillRect(2, 0, w - 2, Math.round(hh * 0.45) + 2)
  g.fillStyle(PALETTE.text, 1)
  g.fillRect(1, 1, 1, hh - 2)
  g.fillStyle(color, 1)
  g.fillRect(3, 1, w - 4, Math.round(hh * 0.45))
  g.generateTexture(key, w, hh)
  g.destroy()
  return key
}

// --- Dead reckoning -------------------------------------------------------------------------------

const MAX_EXTRAPOLATION_MS = 350
const CORRECTION_TAU_MS = 140

interface Track {
  x: number
  v: number
  at: number
  offset: number
}

// Runner positions between snapshots: extrapolate the last authoritative `x` with its speed `v` (so
// what a player sees lines up with the server's present, which matters for jumping a hurdle or
// taking off at the board), and blend any correction out over ~140 ms instead of snapping.
export class RunnerTracker {
  private readonly tracks = new Map<string, Track>()

  reset(): void {
    this.tracks.clear()
  }

  push(id: string, x: number, v: number, now: number): void {
    const t = this.tracks.get(id)
    if (!t) {
      this.tracks.set(id, { x, v, at: now, offset: 0 })
      return
    }
    const shown = this.predict(t, now) + t.offset
    t.x = x
    t.v = v
    t.at = now
    const err = shown - x
    t.offset = Math.abs(err) > 4 ? 0 : err
  }

  // Current display position; `freeze` stops extrapolating (the round's final snapshot).
  x(id: string, now: number, dtMs: number, freeze = false): number {
    const t = this.tracks.get(id)
    if (!t) return 0
    t.offset *= Math.exp(-dtMs / CORRECTION_TAU_MS)
    return (freeze ? t.x : this.predict(t, now)) + t.offset
  }

  private predict(t: Track, now: number): number {
    return t.x + (t.v * Math.min(MAX_EXTRAPOLATION_MS, Math.max(0, now - t.at))) / 1000
  }
}

// --- Tap pad --------------------------------------------------------------------------------------

export interface StridePadHandlers {
  step(foot: AthleticsFoot): void
  // Middle button: down (and, for hold-to-aim, up).
  action?(down: boolean): void
}

export interface StridePadOptions {
  // Label of the middle action button; omitted = just the two feet.
  action?: string
  speedLabel: string
}

const SPEED_FULL = 11.5 // m/s that fills the speed meter

// The arcade two-button run pad along the bottom of the canvas: big LEFT / RIGHT buttons (the one to
// hit next glows), an optional middle action button (JUMP / THROW, press-and-hold aware) and a
// segmented speed meter above them. Also binds the keyboard: ← / A / Z and → / D / X for the feet,
// SPACE / ↑ / W for the action.
export class StridePad {
  readonly top: number
  private readonly left: Phaser.GameObjects.Image
  private readonly right: Phaser.GameObjects.Image
  private readonly act?: Phaser.GameObjects.Image
  private readonly actText?: Phaser.GameObjects.Text
  private readonly glow: Phaser.GameObjects.Graphics
  private readonly meter: Phaser.GameObjects.Graphics
  private readonly keys: {
    foot?: { up: string; down: string }
    act?: { up: string; down: string }
  } = {}
  private readonly meterBox: { x: number; y: number; w: number; h: number }
  private next: AthleticsFoot | null = null
  private holding = false
  private holdPointer = -1
  private shownSpeed = -1
  private enabled = { feet: true, action: true }

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly handlers: StridePadHandlers,
    opts: StridePadOptions,
  ) {
    const { width, height } = scene.scale
    const compact = Math.min(width, height) < 520
    const padW = Math.min(width - 16, 760)
    const btnH = compact ? 96 : 84
    const gap = compact ? 8 : 12
    const bottom = height - (compact ? 10 : 34)
    const y = bottom - btnH / 2
    const x0 = (width - padW) / 2
    const withAction = opts.action !== undefined
    const footW = withAction ? (padW - gap * 2) * 0.36 : (padW - gap) / 2
    const actW = withAction ? padW - gap * 2 - footW * 2 : 0

    const footKey = ensureBevelPanel(scene, footW, btnH, PALETTE.frameLit, compact ? 4 : 5, true)
    const footDown = ensureBevelPanel(scene, footW, btnH, PALETTE.frame, compact ? 4 : 5, true)
    this.keys.foot = { up: footKey, down: footDown }
    const size = compact ? 32 : 40
    const mk = (cx: number, label: string, key: string, w: number): Phaser.GameObjects.Image => {
      const img = scene.add.image(cx, y, key).setDepth(700).setInteractive()
      scene.add
        .text(
          cx,
          y,
          label,
          headlineStyle(fitFontSize(label, w - 16, size), PALETTE.text, {
            stroke: '#10121c',
            strokeThickness: 4,
          }),
        )
        .setOrigin(0.5)
        .setDepth(701)
      return img
    }
    this.left = mk(x0 + footW / 2, '◀ L', footKey, footW)
    this.right = mk(x0 + padW - footW / 2, 'R ▶', footKey, footW)
    this.left.on('pointerdown', () => this.foot('L'))
    this.right.on('pointerdown', () => this.foot('R'))

    if (withAction) {
      const actKey = ensureBevelPanel(scene, actW, btnH, PALETTE.orange, compact ? 4 : 5, true)
      const actDown = ensureBevelPanel(
        scene,
        actW,
        btnH,
        shade(PALETTE.orange, -0.3),
        compact ? 4 : 5,
        true,
      )
      this.keys.act = { up: actKey, down: actDown }
      const cx = width / 2
      this.act = scene.add.image(cx, y, actKey).setDepth(700).setInteractive()
      this.actText = scene.add
        .text(
          cx,
          y,
          opts.action ?? '',
          headlineStyle(
            fitFontSize(opts.action ?? '', actW - 12, compact ? 16 : 24),
            PALETTE.text,
            {
              stroke: '#10121c',
              strokeThickness: 4,
            },
          ),
        )
        .setOrigin(0.5)
        .setDepth(701)
      this.act.on('pointerdown', (p: Phaser.Input.Pointer) => {
        this.holdPointer = p.id
        this.press()
      })
      scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (p.id === this.holdPointer) this.releaseHold()
      })
    }

    // Speed meter strip above the buttons.
    const meterH = compact ? 8 : 10
    this.meterBox = { x: x0, y: y - btnH / 2 - gap - meterH, w: padW, h: meterH }
    this.meter = scene.add.graphics().setDepth(700)
    scene.add
      .text(x0, this.meterBox.y - 2, opts.speedLabel, headlineStyle(compact ? 8 : 8, PALETTE.dim))
      .setOrigin(0, 1)
      .setDepth(700)
    this.glow = scene.add.graphics().setDepth(702)
    this.top = this.meterBox.y - (compact ? 14 : 16)

    const kb = scene.input.keyboard
    const bind = (names: string[], down: () => void, up?: () => void): void => {
      for (const n of names) {
        kb?.on(`keydown-${n}`, (e: KeyboardEvent) => {
          if (!e.repeat) down()
        })
        if (up) kb?.on(`keyup-${n}`, () => up())
      }
    }
    bind(['LEFT', 'A', 'Z'], () => this.foot('L'))
    bind(['RIGHT', 'D', 'X'], () => this.foot('R'))
    if (withAction) {
      bind(
        ['SPACE', 'UP', 'W'],
        () => this.press(),
        () => this.releaseHold(),
      )
    }
    this.setSpeed(0)
  }

  private foot(f: AthleticsFoot): void {
    if (!this.enabled.feet) return
    this.handlers.step(f)
    const img = f === 'L' ? this.left : this.right
    this.flashPressed(img, 'foot')
  }

  private press(): void {
    if (!this.enabled.action || this.holding || !this.act) return
    this.holding = true
    this.act.setTexture(this.keys.act?.down ?? '')
    punch(this.scene, this.act, -0.06, 60)
    this.handlers.action?.(true)
  }

  private releaseHold(): void {
    if (!this.holding || !this.act) return
    this.holding = false
    this.holdPointer = -1
    this.act.setTexture(this.keys.act?.up ?? '')
    this.handlers.action?.(false)
  }

  private flashPressed(img: Phaser.GameObjects.Image, kind: 'foot'): void {
    const keys = this.keys[kind]
    if (!keys) return
    img.setTexture(keys.down)
    punch(this.scene, img, -0.06, 50)
    this.scene.time.delayedCall(70, () => img.setTexture(keys.up))
  }

  get isHolding(): boolean {
    return this.holding
  }

  setActionLabel(label: string): void {
    this.actText?.setText(label)
  }

  // Greys out whichever controls do nothing right now (inputs stay harmless either way).
  setEnabled(feet: boolean, action = true): void {
    if (feet === this.enabled.feet && action === this.enabled.action) return
    this.enabled = { feet, action }
    this.left.setAlpha(feet ? 1 : 0.45)
    this.right.setAlpha(feet ? 1 : 0.45)
    this.act?.setAlpha(action ? 1 : 0.45)
    this.actText?.setAlpha(action ? 1 : 0.45)
    if (!action) this.releaseHold()
    this.drawGlow()
  }

  // Highlights the foot to press next (the opposite of the last one), or none.
  setNext(foot: AthleticsFoot | null): void {
    if (foot === this.next) return
    this.next = foot
    this.drawGlow()
  }

  private drawGlow(): void {
    this.glow.clear()
    const img = this.next === 'L' ? this.left : this.next === 'R' ? this.right : undefined
    if (!img || !this.enabled.feet) return
    this.glow.lineStyle(4, PALETTE.lime, 1)
    this.glow.strokeRect(
      img.x - img.width / 2 - 3,
      img.y - img.height / 2 - 3,
      img.width + 6,
      img.height + 6,
    )
  }

  setSpeed(v: number): void {
    const { x, y, w, h } = this.meterBox
    const segs = 20
    const lit = Math.round(Math.max(0, Math.min(1, v / SPEED_FULL)) * segs)
    if (lit === this.shownSpeed) return
    this.shownSpeed = lit
    const g = this.meter
    g.clear()
    const segW = (w - (segs - 1) * 2) / segs
    for (let i = 0; i < segs; i++) {
      const on = i < lit
      const c = i >= segs * 0.8 ? PALETTE.red : i >= segs * 0.5 ? PALETTE.amber : PALETTE.lime
      g.fillStyle(on ? c : PALETTE.panelAlt, 1)
      g.fillRect(x + i * (segW + 2), y, segW, h)
    }
  }
}
