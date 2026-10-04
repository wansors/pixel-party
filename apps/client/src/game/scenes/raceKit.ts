import { type AvatarId, type MicroRacePoint, PALETTE, raceWrapAngle } from '@pp/shared'
import Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { bodyStyle, hexToCss } from '../pixelStyle'

// UI kit for the top-down racers (Micro Race, Rally Stage, Speed Circuit); the netcode is in raceNet:
//  - DriveControls: arrows / WASD (+ SPACE to brake) or a held pointer → steer + throttle, sent on
//    change only (key changes at once, pointer steering at most every 50 ms) — never an idle heartbeat.
//  - RaceMinimap: the whole course in a corner with a dot per car.
//  - RaceStandings: the race order as a pooled column of rows.

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

// --- Controls ------------------------------------------------------------------------------------------

export interface Drive {
  steer: number
  throttle: number
}

const POINTER_SEND_MS = 50

export class DriveControls {
  private readonly cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private readonly wasd?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>
  private aim?: { x: number; y: number }
  private aimPointer = -1
  // What the server holds (it starts every car parked).
  readonly sent: Drive = { steer: 0, throttle: 0 }
  private sentAt = 0

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard
    this.cursors = kb?.createCursorKeys()
    if (kb)
      this.wasd = { W: kb.addKey('W'), A: kb.addKey('A'), S: kb.addKey('S'), D: kb.addKey('D') }
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.aimPointer = p.id
      this.aim = { x: p.x, y: p.y }
    })
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.id === this.aimPointer && p.isDown) this.aim = { x: p.x, y: p.y }
    })
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.id !== this.aimPointer) return
      this.release()
    })
    // Phaser lets go of held keys when the window loses focus; a held pointer must let go too.
    const onBlur = (): void => this.release()
    scene.game.events.on(Phaser.Core.Events.BLUR, onBlur)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      scene.game.events.off(Phaser.Core.Events.BLUR, onBlur),
    )
  }

  private release(): void {
    this.aimPointer = -1
    this.aim = undefined
  }

  // Keys win over a held pointer. `car` is your car on screen (for steering toward the pointer).
  read(car: { x: number; y: number; a: number } | null): { drive: Drive; keys: boolean } {
    const c = this.cursors
    const w = this.wasd
    const left = c?.left.isDown || w?.A.isDown
    const right = c?.right.isDown || w?.D.isDown
    const up = c?.up.isDown || w?.W.isDown
    const down = c?.down.isDown || w?.S.isDown
    const brake = c?.space.isDown
    if (left || right || up || down || brake) {
      return {
        drive: {
          steer: (right ? 1 : 0) - (left ? 1 : 0),
          throttle: brake ? -1 : (up ? 1 : 0) - (down ? 1 : 0),
        },
        keys: true,
      }
    }
    if (this.aim && car) {
      // Steer toward the held point, measured from the car's nose; ease off for a sharp turn or when
      // the point is right there. Quantized, so a still hand doesn't stream inputs.
      const diff = raceWrapAngle(Math.atan2(this.aim.y - car.y, this.aim.x - car.x) - car.a)
      const dist = Math.hypot(this.aim.x - car.x, this.aim.y - car.y)
      return {
        drive: {
          steer: Math.round(clamp(diff / 0.5, -1, 1) * 10) / 10,
          throttle: Math.abs(diff) > 2.3 ? 0.45 : dist < 36 ? 0.3 : 1,
        },
        keys: false,
      }
    }
    return { drive: { steer: 0, throttle: 0 }, keys: true }
  }

  // Sends a changed drive (key changes at once, pointer steering at most every 50 ms) and returns what
  // the server now holds — the drive the local prediction must use.
  sync(read: { drive: Drive; keys: boolean }, now: number, send: (d: Drive) => void): Drive {
    const d = read.drive
    const changed = d.steer !== this.sent.steer || d.throttle !== this.sent.throttle
    if (changed && (read.keys || now - this.sentAt >= POINTER_SEND_MS)) {
      this.sent.steer = d.steer
      this.sent.throttle = d.throttle
      this.sentAt = now
      send({ steer: d.steer, throttle: d.throttle })
    }
    return this.sent
  }
}

// --- Minimap ---------------------------------------------------------------------------------------------

// The whole course in a corner: the road as a thick line (start line marked), a dot per car in its
// driver's color, yours bigger with a white outline and drawn last.
export class RaceMinimap {
  readonly h: number
  private readonly dots: Phaser.GameObjects.Graphics
  private readonly s: number

  constructor(
    scene: Phaser.Scene,
    readonly x: number,
    readonly y: number,
    readonly w: number,
    world: { readonly w: number; readonly h: number },
    samples: readonly MicroRacePoint[],
    halfWidth: number,
    closed: boolean,
    private readonly compact: boolean,
    depth: number,
  ) {
    this.s = w / world.w
    this.h = Math.round(world.h * this.s)
    const g = scene.add.graphics().setDepth(depth)
    g.fillStyle(PALETTE.bg, 0.78).fillRect(x - 6, y - 6, w + 12, this.h + 12)
    g.lineStyle(2, PALETTE.frame, 1).strokeRect(x - 6, y - 6, w + 12, this.h + 12)
    g.lineStyle(Math.max(3, halfWidth * 2 * this.s), 0x8a8d99, 1)
    g.beginPath()
    samples.forEach((p, i) =>
      i === 0
        ? g.moveTo(x + p.x * this.s, y + p.y * this.s)
        : g.lineTo(x + p.x * this.s, y + p.y * this.s),
    )
    if (closed) g.closePath()
    g.strokePath()
    // Start (and a stage's finish) line.
    const mark = (i: number): void => {
      const p = samples[i]
      const q = samples[Math.min(samples.length - 1, i + 1)]
      if (!p || !q) return
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
      const nx = (-(q.y - p.y) / len) * halfWidth * this.s
      const ny = ((q.x - p.x) / len) * halfWidth * this.s
      g.lineStyle(2, PALETTE.text, 1)
      g.lineBetween(
        x + p.x * this.s - nx,
        y + p.y * this.s - ny,
        x + p.x * this.s + nx,
        y + p.y * this.s + ny,
      )
    }
    mark(0)
    if (!closed) mark(samples.length - 2)
    this.dots = scene.add.graphics().setDepth(depth + 1)
  }

  // Per frame: clear(), then car() for every rival and self() for yours (drawn on top).
  clear(): void {
    this.dots.clear()
  }

  car(x: number, y: number, color: number, gone: boolean): void {
    const r = this.compact ? 2 : 3
    this.dots
      .fillStyle(color, gone ? 0.35 : 1)
      .fillRect(
        Math.round(this.x + x * this.s - r),
        Math.round(this.y + y * this.s - r),
        r * 2,
        r * 2,
      )
  }

  self(x: number, y: number, color: number): void {
    const r = (this.compact ? 2 : 3) + 2
    const px = Math.round(this.x + x * this.s)
    const py = Math.round(this.y + y * this.s)
    this.dots.fillStyle(PALETTE.text, 1).fillRect(px - r - 2, py - r - 2, r * 2 + 4, r * 2 + 4)
    this.dots.fillStyle(color, 1).fillRect(px - r, py - r, r * 2, r * 2)
  }
}

// --- Standings ------------------------------------------------------------------------------------------

export interface StandingRow {
  id: string
  pos: number
  name: string
  color: number
  avatar: AvatarId
  mine: boolean
  done: boolean
  gone: boolean
}

interface StandingView {
  icon: Phaser.GameObjects.Image
  text: Phaser.GameObjects.Text
  key: string
}

// The race order as a column of pooled rows (avatar + "3. NAME ★"), top-left over the view: every car
// in a full room on a big screen, the top few plus yourself on a phone. Rows update in place (no
// object churn when places swap); the backing panel is redrawn only when the column changes.
export class RaceStandings {
  private readonly rows: StandingView[] = []
  private readonly panel: Phaser.GameObjects.Graphics
  private readonly rowH: number
  private readonly icon: number
  private shown = 0
  private width = 0

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly x: number,
    private readonly y: number,
    private readonly maxRows: number,
    size: number,
    depth: number,
  ) {
    this.rowH = Math.round(size * 1.45)
    this.icon = size >= 14 ? 16 : 12
    this.panel = scene.add.graphics().setDepth(depth)
    for (let i = 0; i < maxRows; i++) {
      const cy = y + i * this.rowH + this.rowH / 2
      this.rows.push({
        icon: scene.add
          .image(x + 6 + this.icon / 2, cy, '__DEFAULT')
          .setDisplaySize(this.icon, this.icon)
          .setDepth(depth + 1)
          .setVisible(false),
        text: scene.add
          .text(x + 10 + this.icon, cy, '', {
            ...bodyStyle(size, PALETTE.text, { fontStyle: 'bold' }),
            stroke: '#10121c',
            strokeThickness: 3,
          })
          .setOrigin(0, 0.5)
          .setDepth(depth + 1)
          .setVisible(false),
        key: '',
      })
    }
  }

  get bottom(): number {
    return this.y + this.shown * this.rowH + 4
  }

  // `order` is the race order; past maxRows the column keeps the leaders plus your own row.
  set(order: readonly StandingRow[]): void {
    let rows = order.slice(0, this.maxRows)
    const me = order.find((r) => r.mine)
    if (me && !rows.includes(me)) rows = [...rows.slice(0, this.maxRows - 1), me]
    let maxW = 0
    let changed = rows.length !== this.shown
    this.rows.forEach((v, i) => {
      const r = rows[i]
      if (!r) {
        if (v.key !== '') {
          v.key = ''
          v.icon.setVisible(false)
          v.text.setVisible(false)
        }
        return
      }
      const label = `${r.mine ? '▶' : ''}${r.pos}. ${r.name.slice(0, 10)}${r.done ? ' ★' : ''}`
      const key = `${label}|${r.color}|${r.avatar}|${r.gone ? 1 : 0}`
      if (key !== v.key) {
        changed = true
        v.key = key
        v.icon
          .setTexture(
            ensureAvatarTexture(this.scene, r.avatar, r.color, 1, 'front', r.gone ? 'ko' : 'idle'),
          )
          .setDisplaySize(this.icon, this.icon)
          .setAlpha(r.gone ? 0.5 : 1)
          .setVisible(true)
        v.text
          .setText(label)
          .setColor(hexToCss(r.mine ? PALETTE.amber : r.color))
          .setAlpha(r.gone ? 0.5 : 1)
          .setVisible(true)
      }
      maxW = Math.max(maxW, v.text.width)
    })
    if (!changed && Math.abs(maxW - this.width) < 1) return
    this.shown = rows.length
    this.width = maxW
    this.panel.clear()
    if (rows.length === 0) return
    this.panel
      .fillStyle(PALETTE.bg, 0.72)
      .fillRect(this.x, this.y - 2, maxW + this.icon + 18, rows.length * this.rowH + 4)
  }
}

// --- Name tags -----------------------------------------------------------------------------------------

// Keeps name tags from piling up when cars bunch (the start, a scrum in a hairpin): tags are placed
// in race order, and one that would overlap a tag already placed (or your ▼) stays hidden this frame.
export class LabelDeclutter {
  private readonly boxes: number[] = []

  // Starts a frame; `reserve` an area first (your own car's marker).
  reset(): void {
    this.boxes.length = 0
  }

  reserve(cx: number, bottom: number, w: number, h: number): void {
    this.boxes.push(cx - w / 2, bottom - h, cx + w / 2, bottom)
  }

  // True (and reserved) when a w × h tag centered on cx, sitting on `bottom`, overlaps nothing placed.
  place(cx: number, bottom: number, w: number, h: number): boolean {
    const x0 = cx - w / 2
    const x1 = cx + w / 2
    const y0 = bottom - h
    for (let i = 0; i < this.boxes.length; i += 4) {
      if (
        x0 < (this.boxes[i + 2] as number) &&
        x1 > (this.boxes[i] as number) &&
        y0 < (this.boxes[i + 3] as number) &&
        bottom > (this.boxes[i + 1] as number)
      )
        return false
    }
    this.boxes.push(x0, y0, x1, bottom)
    return true
  }
}
