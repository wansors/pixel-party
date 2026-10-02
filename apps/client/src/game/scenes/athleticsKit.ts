import { type AthleticsFoot, PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { punch } from '../fx'
import { ensureBevelPanel, ensurePixelGrid, fitFontSize, headlineStyle, shade } from '../pixelStyle'

// Shared kit for the track & field scenes (TrackRaceSceneBase, FieldEventSceneBase): a procedural
// pixel-art athlete with a pose set, the two-foot tap pad (+ optional action button), stadium
// textures and dead-reckoned runner positions.

// --- Athlete rig ----------------------------------------------------------------------------------

export type AthletePose =
  | 'stand'
  | 'set'
  | 'run0'
  | 'run1'
  | 'run2'
  | 'run3'
  | 'hurdle'
  | 'takeoff'
  | 'fly'
  | 'land'
  | 'fallen'
  | 'windup'
  | 'release'

export const RUN_FRAMES: readonly AthletePose[] = ['run0', 'run1', 'run2', 'run3']
// Metres of ground covered per run frame, so the legs cycle with the runner's real speed.
export const METRES_PER_FRAME = 0.55

// Sprite grid (cells) — scenes scale it by an integer factor so the pixels stay square.
export const ATHLETE_W = 20
export const ATHLETE_H = 24
const GROUND = 23.2
const THIGH = 5.5
const SHIN = 5
const UPPER_ARM = 3.8
const FOREARM = 3.5
const TORSO = 6.5

// Angles in degrees: 0 = straight down, + = forward (the athlete faces right). Legs/arms are
// [upper, lower] absolute angles; `lean` tips the torso forward from vertical.
interface PoseDef {
  lean: number
  hip?: readonly [number, number]
  airborne?: boolean
  near: readonly [number, number]
  far: readonly [number, number]
  armNear: readonly [number, number]
  armFar: readonly [number, number]
}

const POSES: Record<AthletePose, PoseDef> = {
  stand: { lean: 0, near: [4, 0], far: [-4, 0], armNear: [-8, 4], armFar: [8, 14] },
  set: {
    lean: 100,
    hip: [7, 13],
    near: [62, -30],
    far: [-15, -50],
    armNear: [2, 2],
    armFar: [-4, -4],
  },
  run0: { lean: 18, near: [30, 12], far: [-38, -80], armNear: [-45, 25], armFar: [45, 115] },
  run1: { lean: 18, near: [-4, -12], far: [58, -15], armNear: [-10, 70], armFar: [15, 85] },
  run2: { lean: 18, near: [-38, -80], far: [30, 12], armNear: [45, 115], armFar: [-45, 25] },
  run3: { lean: 18, near: [58, -15], far: [-4, -12], armNear: [15, 85], armFar: [-10, 70] },
  hurdle: {
    lean: 24,
    airborne: true,
    hip: [7, 12],
    near: [82, 84],
    far: [-78, 5],
    armNear: [-40, -10],
    armFar: [80, 90],
  },
  takeoff: {
    lean: 8,
    airborne: true,
    near: [78, 5],
    far: [-20, -20],
    armNear: [150, 160],
    armFar: [-40, -10],
  },
  fly: {
    lean: 5,
    airborne: true,
    near: [70, 40],
    far: [60, 30],
    armNear: [160, 170],
    armFar: [150, 160],
  },
  land: {
    lean: 35,
    hip: [6, 20],
    near: [88, 92],
    far: [84, 88],
    armNear: [70, 85],
    armFar: [60, 80],
  },
  fallen: {
    lean: 80,
    hip: [6, 19.5],
    near: [-60, -80],
    far: [-40, -75],
    armNear: [100, 110],
    armFar: [120, 125],
  },
  windup: { lean: -12, near: [32, 20], far: [-28, -18], armNear: [-120, -95], armFar: [70, 95] },
  release: { lean: 25, near: [30, 18], far: [-35, -70], armNear: [150, 175], armFar: [-30, -10] },
}

// Javelin carry: the throwing (near) arm held up by the head while running.
const CARRY_ARM: readonly [number, number] = [-150, 160]

type Pt = readonly [number, number]
const dir = (deg: number): Pt => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)]
const along = (p: Pt, deg: number, len: number): Pt => {
  const [dx, dy] = dir(deg)
  return [p[0] + dx * len, p[1] + dy * len]
}

function segDist(px: number, py: number, a: Pt, b: Pt): number {
  const vx = b[0] - a[0]
  const vy = b[1] - a[1]
  const len2 = vx * vx + vy * vy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / len2)) : 0
  return Math.hypot(px - (a[0] + vx * t), py - (a[1] + vy * t))
}

interface Rig {
  rows: string[]
  // Where the near (throwing) hand ends up, in grid cells — the javelin's anchor.
  hand: Pt
}

// Rasterizes a pose into an ASCII grid (the ensurePixelGrid DSL): far limbs in shade, torso in the
// shirt color, head with hair, near limbs on top, then a dark 1-cell outline around everything.
function rig(pose: AthletePose, carry: boolean): Rig {
  const p = POSES[pose]
  const armNear = carry && pose.startsWith('run') ? CARRY_ARM : p.armNear
  let hip: Pt = p.hip ?? [8, 12.6]
  const foot = (leg: readonly [number, number], h: Pt): Pt =>
    along(along(h, leg[0], THIGH), leg[1], SHIN)
  if (!p.airborne && !p.hip) {
    // Plant the lowest foot on the ground line, so the stride bobs naturally.
    const low = Math.max(foot(p.near, hip)[1], foot(p.far, hip)[1])
    hip = [hip[0], hip[1] + (GROUND - low)]
  }
  const up = 180 - p.lean
  const shoulder = along(hip, up, TORSO)
  const head = along(shoulder, up, 3.3)
  const facing = dir(up + 90) // perpendicular, pointing the way the athlete faces
  const grid: string[][] = Array.from({ length: ATHLETE_H }, () => Array(ATHLETE_W).fill('_'))
  const paint = (ch: string, test: (x: number, y: number) => boolean): void => {
    for (let y = 0; y < ATHLETE_H; y++) {
      for (let x = 0; x < ATHLETE_W; x++) {
        if (test(x + 0.5, y + 0.5)) (grid[y] as string[])[x] = ch
      }
    }
  }
  const seg = (ch: string, a: Pt, b: Pt, r: number): void =>
    paint(ch, (x, y) => segDist(x, y, a, b) <= r)
  const limb = (
    upper: number,
    lower: number,
    from: Pt,
    lenA: number,
    lenB: number,
    r: number,
    ch: { a: string; b: string },
  ): Pt => {
    const joint = along(from, upper, lenA)
    const end = along(joint, lower, lenB)
    seg(ch.a, from, joint, r)
    seg(ch.b, joint, end, r)
    return end
  }
  const leg = (angles: readonly [number, number], near: boolean): void => {
    const knee = along(hip, angles[0], THIGH)
    const end = along(knee, angles[1], SHIN)
    const shorts = along(hip, angles[0], THIGH * 0.45)
    seg(near ? 's' : 'S', shorts, knee, 1)
    seg(near ? 'p' : 'P', hip, shorts, 1.1)
    seg(near ? 's' : 'S', knee, end, 0.95)
    seg(near ? 'o' : 'O', end, [end[0] + 1.6, end[1]], 0.8)
  }

  limb(p.armFar[0], p.armFar[1], shoulder, UPPER_ARM, FOREARM, 0.8, { a: 'C', b: 'S' })
  leg(p.far, false)
  // Torso, shaded along its back edge.
  const back: Pt = [-facing[0], -facing[1]]
  paint('c', (x, y) => segDist(x, y, hip, shoulder) <= 1.9)
  paint('C', (x, y) => {
    if (segDist(x, y, hip, shoulder) > 1.9) return false
    return (x - hip[0]) * back[0] + (y - hip[1]) * back[1] > 0.9
  })
  paint('p', (x, y) => Math.hypot(x - hip[0], y - hip[1]) <= 1.9)
  // Head: skin, hair on the back/top, one eye.
  paint('s', (x, y) => Math.hypot(x - head[0], y - head[1]) <= 2.3)
  paint('h', (x, y) => {
    const dx = x - head[0]
    const dy = y - head[1]
    if (Math.hypot(dx, dy) > 2.3) return false
    const fwd = dx * facing[0] + dy * facing[1]
    const upness = -(dx * dir(up)[0] + dy * dir(up)[1])
    return fwd < -0.2 || upness < -1.2
  })
  const eye = along(along(head, up + 90, 1.2), up, 0.3)
  paint('e', (x, y) => Math.abs(x - eye[0]) < 0.5 && Math.abs(y - eye[1]) < 0.5)
  leg(p.near, true)
  const hand = limb(armNear[0], armNear[1], shoulder, UPPER_ARM, FOREARM, 0.8, { a: 'c', b: 's' })

  // 1-cell dark outline.
  const filled = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < ATHLETE_W &&
    y < ATHLETE_H &&
    grid[y]?.[x] !== '_' &&
    grid[y]?.[x] !== 'k'
  for (let y = 0; y < ATHLETE_H; y++) {
    for (let x = 0; x < ATHLETE_W; x++) {
      if (grid[y]?.[x] !== '_') continue
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
        ;(grid[y] as string[])[x] = 'k'
      }
    }
  }
  return { rows: grid.map((r) => r.join('')), hand }
}

const handCache = new Map<string, Pt>()

// Texture key for an athlete in `pose`, shirt in the player's identity `color` (cached per combo).
export function athleteTexture(
  scene: Phaser.Scene,
  pose: AthletePose,
  color: number,
  carry = false,
): string {
  const key = `pp-ath-${pose}${carry ? '-j' : ''}-${color.toString(16)}`
  if (scene.textures.exists(key)) return key
  const r = rig(pose, carry)
  handCache.set(`${pose}${carry ? '-j' : ''}`, r.hand)
  return ensurePixelGrid(scene, {
    key,
    rows: r.rows,
    legend: {
      c: color,
      C: shade(color, -0.35),
      s: 0xf2c29b,
      S: 0xc98f68,
      p: 0x2a2f4a,
      P: 0x1c2033,
      h: 0x3a2618,
      e: 0x10121c,
      o: PALETTE.text,
      O: 0xa8b0c4,
      k: 0x10121c,
    },
    pixelSize: 1,
  })
}

// Near-hand position of a pose relative to the sprite's bottom-centre origin, in grid cells.
export function athleteHand(pose: AthletePose, carry = false): { x: number; y: number } {
  const id = `${pose}${carry ? '-j' : ''}`
  let hand = handCache.get(id)
  if (!hand) {
    hand = rig(pose, carry).hand
    handCache.set(id, hand)
  }
  return { x: hand[0] - ATHLETE_W / 2, y: hand[1] - ATHLETE_H }
}

// Run-cycle frame for a runner who has covered `x` metres.
export function runFrame(x: number): AthletePose {
  const i = Math.floor(Math.max(0, x) / METRES_PER_FRAME) % RUN_FRAMES.length
  return RUN_FRAMES[i] as AthletePose
}

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
