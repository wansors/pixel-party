import { PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { addBanner, burst, ring, showBanner } from '../fx'
import { bodyStyle, ensurePixelGrid, headlineStyle, hexToCss, shade } from '../pixelStyle'

// Shared naval-grid kit behind the two Battleship scenes (sink-the-fleet duel, fleet-battle team).
// A NavalBoard is one framed N×N sea: shimmering pixel-water tiles, splash (miss) / burning-hull (hit)
// / wreck (sunk) markers, an aiming reticle, a "last shot" outline and a row of fleet-health pips. The
// board only renders what the snapshot says — shot results arrive from the server, ship positions never
// do — and reports newly landed shots so the scene can play the matching feedback.

export interface NavalShot {
  readonly cell: number
  readonly hit: boolean
}

export interface BoardRect {
  readonly cx: number
  readonly cy: number
  readonly size: number
  readonly compact: boolean
  // A big screen (1080p and up): larger labels, so the boards read from the sofa.
  readonly big: boolean
}

const ART = 12 // art pixels per cell side
const WATER = 0x1f4a8a
const LAST_SHOT_MS = 2400
const COLS = 'ABCDEFGHIJ'

const WATER_LEGEND = {
  w: WATER,
  e: shade(WATER, -0.35),
  v: shade(WATER, 0.12),
  c: shade(WATER, 0.26),
}

// Wave squiggles per water variant ([x, y] of each squiggle's top-left). Variants are picked per cell
// index so the sea looks hand-drawn but identical on every screen.
const WAVES: readonly (readonly (readonly [number, number])[])[] = [
  [
    [1, 2],
    [6, 7],
  ],
  [
    [5, 1],
    [1, 7],
  ],
  [
    [3, 4],
    [6, 9],
  ],
]

function waterRows(variant: number, frame: number): string[] {
  const grid: string[][] = Array.from({ length: ART }, (_, y) =>
    Array.from({ length: ART }, (_, x) => (x === ART - 1 || y === ART - 1 ? 'e' : 'w')),
  )
  const put = (x: number, y: number, c: string): void => {
    const row = grid[y]
    if (row && x >= 0 && x < ART - 1 && y < ART - 1) row[x] = c
  }
  for (const [wx, wy] of WAVES[variant % WAVES.length] ?? []) {
    const x = wx + frame
    put(x + 1, wy, 'c')
    put(x + 2, wy, 'c')
    put(x, wy + 1, 'v')
    put(x + 3, wy + 1, 'v')
  }
  return grid.map((r) => r.join(''))
}

// Miss: a white peg in a ripple ring.
const SPLASH_ROWS = [
  '____________',
  '____rrrr____',
  '__rr____rr__',
  '__r__qq__r__',
  '_r__q__q__r_',
  '_r_q_pp_q_r_',
  '_r_q_pp_q_r_',
  '_r__q__q__r_',
  '__r__qq__r__',
  '__rr____rr__',
  '____rrrr____',
  '____________',
]

// Hit: a hull chunk on fire (two flicker frames).
const HIT_ROWS: readonly (readonly string[])[] = [
  [
    '_____a______',
    '____aya___a_',
    '___aoyoa_ao_',
    '___orrro_o__',
    '__aorrrroo__',
    '__orryyrro__',
    '__hhhhhhhh__',
    '_hmmmmmmmmh_',
    '_kmmmmmmmmk_',
    '__kkkkkkkk__',
    '____________',
    '____________',
  ],
  [
    '______a_____',
    '__a__aya____',
    '__oaaoyoa___',
    '___orrrro___',
    '__oorrrroa__',
    '__orryyrro__',
    '__hhhhhhhh__',
    '_hmmmmmmmmh_',
    '_kmmmmmmmmk_',
    '__kkkkkkkk__',
    '____________',
    '____________',
  ],
]

// Sunk: a tilted wreck going under, trailing smoke.
const WRECK_ROWS = [
  '________s___',
  '______ss_s__',
  '_______ss___',
  '____________',
  '________hh__',
  '______hmmk__',
  '____hmmmk___',
  '___kmmmk____',
  '__kmmkk_____',
  '_vvkkvvvvvv_',
  'vvvvvvvvvvvv',
  '____________',
]

const MARK_LEGEND = {
  r: shade(WATER, 0.5),
  p: 0x9aa2cc,
  w: PALETTE.text,
  a: PALETTE.amber,
  y: 0xfff1a8,
  o: PALETTE.orange,
  h: 0xa9b1d6,
  m: 0x6b7390,
  k: 0x2b2f45,
  s: 0x8a90a8,
  v: shade(WATER, 0.25),
}

// Aiming reticle: amber corner brackets + a center pip.
const RETICLE_ROWS = [
  'aaaa____aaaa',
  'a__________a',
  'a__________a',
  'a__________a',
  '____________',
  '_____aa_____',
  '_____aa_____',
  '____________',
  'a__________a',
  'a__________a',
  'a__________a',
  'aaaa____aaaa',
]

// Fleet-health pips (one per ship cell): intact hull vs burning hull.
const PIP_ROWS = {
  ok: ['________', '________', '__hhhh__', '_hmmmmh_', 'kmmmmmmk', '_kkkkkk_'],
  hit: ['___a____', '__aoa___', '__hooh__', '_hRRRRh_', 'kRRRRRRk', '_kkkkkk_'],
}

type Mark = 'water' | 'miss' | 'hit' | 'sunk'
export type Focus = 'active' | 'idle' | 'dim'

interface Textures {
  water: string[][] // [variant][frame]
  splash: string
  hit: string[]
  wreck: string
  reticle: string
}

function ensureTextures(scene: Phaser.Scene, ps: number): Textures {
  const grid = (key: string, rows: readonly string[], legend: Record<string, number>): string =>
    ensurePixelGrid(scene, { key: `pp-naval-${key}-${ps}`, rows, legend, pixelSize: ps })
  return {
    water: WAVES.map((_, v) =>
      [0, 1].map((f) => grid(`water-${v}-${f}`, waterRows(v, f), WATER_LEGEND)),
    ),
    splash: grid('splash', SPLASH_ROWS, {
      ...MARK_LEGEND,
      r: 0x6fb2f5,
      q: 0x3f7bc4,
      p: PALETTE.text,
    }),
    hit: HIT_ROWS.map((rows, i) => grid(`hit-${i}`, rows, { ...MARK_LEGEND, r: PALETTE.red })),
    wreck: grid('wreck', WRECK_ROWS, MARK_LEGEND),
    reticle: grid('reticle', RETICLE_ROWS, MARK_LEGEND),
  }
}

interface Metrics {
  readonly pad: number
  readonly coordSize: number
  readonly tagSize: number
  readonly titleSize: number
  readonly pipW: number
  readonly above: number // title + tag + coordinates rows above the frame
  readonly below: number // health-pip row under the frame
}

function metrics(compact: boolean, big: boolean): Metrics {
  const pad = compact ? 5 : big ? 10 : 8
  const coordSize = compact ? 10 : big ? 18 : 12
  const tagSize = compact ? 12 : big ? 18 : 14
  const titleSize = big ? 24 : 16
  const pipW = compact ? 14 : big ? 24 : 18
  return {
    pad,
    coordSize,
    tagSize,
    titleSize,
    pipW,
    above: pad + 3 + coordSize + 5 + tagSize + 4 + titleSize + 2,
    below: pad + 8 + pipW,
  }
}

// Splits the free canvas area (top..bottom) into the TARGET board (the one you fire at) and your OWN
// board. Landscape: side by side, equal. Portrait: stacked, the tappable target board gets the larger
// share so its cells stay comfortably above the 44 px touch-target floor on phones.
export function layoutBoards(
  width: number,
  height: number,
  top: number,
  bottom: number,
): { target: BoardRect; own: BoardRect } {
  const compact = Math.min(width, height) < 520
  const big = Math.min(width, height) >= 900
  const { above, below } = metrics(compact, big)
  const chrome = above + below
  const avail = bottom - top
  if (width > height * 1.1) {
    const size = Math.min(avail - chrome, width * 0.38, 620)
    const gap = Math.max(56, width * 0.07)
    const cy = top + (avail - size - chrome) / 2 + above + size / 2
    return {
      target: { cx: width / 2 - gap / 2 - size / 2, cy, size, compact, big },
      own: { cx: width / 2 + gap / 2 + size / 2, cy, size, compact, big },
    }
  }
  const grids = avail - chrome * 2
  const tSize = Math.min(grids * 0.58, width * 0.8)
  const oSize = Math.min(grids - tSize, width * 0.62)
  const tTop = top + (grids - tSize - oSize) / 2 + above
  const oTop = tTop + tSize + chrome
  return {
    target: { cx: width / 2, cy: tTop + tSize / 2, size: tSize, compact, big },
    own: { cx: width / 2, cy: oTop + oSize / 2, size: oSize, compact, big },
  }
}

// Draws a segmented draining bar (turn timers) into `g` — only when the lit count or color changed.
export function drawSegmentBar(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  color: number,
): void {
  const segments = Math.max(6, Math.floor(w / 12))
  const gap = 2
  const segW = (w - gap * (segments - 1)) / segments
  const lit = Math.ceil(Math.max(0, Math.min(1, frac)) * segments)
  const key = `${x},${y},${w},${lit},${color}`
  if (g.getData('bar') === key) return
  g.setData('bar', key)
  g.clear()
  for (let i = 0; i < segments; i++) {
    g.fillStyle(i < lit ? color : PALETTE.panelAlt, 1)
    g.fillRect(Math.round(x + i * (segW + gap)), y, Math.max(1, Math.round(segW)), h)
  }
}

// One framed sea. `onFire` (target boards only) makes the grid tappable — and aimable from the keyboard
// (moveCursor / fireCursor: arrows or WASD, then SPACE / ENTER); it is called only for cells not yet
// fired at while the board is aimable — the server still validates every shot.
export class NavalBoard {
  readonly cell: number
  readonly title: Phaser.GameObjects.Text
  readonly tag: Phaser.GameObjects.Text
  readonly tagSize: number
  private readonly pad: number
  private readonly scene: Phaser.Scene
  private readonly n: number
  private readonly left: number
  private readonly topY: number
  readonly size: number
  private readonly tex: Textures
  private readonly water: Phaser.GameObjects.Image[] = []
  private readonly waterFrame: number[] = []
  private readonly waterVariant: number[] = []
  private readonly marks: Phaser.GameObjects.Image[] = []
  private readonly mark: Mark[] = []
  private readonly markFrame: number[] = []
  private readonly pips: Phaser.GameObjects.Image[] = []
  private readonly pipKeys: { ok: string; hit: string }
  private readonly pipCount: Phaser.GameObjects.Text
  private readonly glow: Phaser.GameObjects.Graphics
  private readonly dim: Phaser.GameObjects.Rectangle
  private readonly reticle: Phaser.GameObjects.Image
  private readonly lastOutline: Phaser.GameObjects.Rectangle
  private readonly objects: (Phaser.GameObjects.GameObject &
    Phaser.GameObjects.Components.Visible)[] = []
  private readonly known = new Map<number, boolean>()
  private primed = false
  private sunk = false
  private aimable = false
  private focus: Focus = 'idle'
  private activeColor: number = PALETTE.amber
  private hover = -1
  // Keyboard aim: the cell the cursor keys sit on, shown instead of the hover while keys were last used.
  private cursor = -1
  private keyAim = false
  private readonly onFire?: (cell: number) => void
  private destroyed = false
  private pending = -1
  private lastShot = -1
  private lastShotAt = 0

  constructor(
    scene: Phaser.Scene,
    rect: BoardRect,
    n: number,
    fleetCells: number,
    onFire?: (cell: number) => void,
  ) {
    this.scene = scene
    this.n = n
    this.size = rect.size
    this.cell = rect.size / n
    this.left = rect.cx - rect.size / 2
    this.topY = rect.cy - rect.size / 2
    this.onFire = onFire
    const m = metrics(rect.compact, rect.big)
    this.pad = m.pad
    const ps = Math.max(1, Math.round(this.cell / ART))
    this.tex = ensureTextures(scene, ps)

    // Frame: a chunky beveled arcade window around the sea.
    const pad = m.pad
    const frame = scene.add.graphics()
    frame.fillStyle(shade(PALETTE.frame, -0.4), 1)
    frame.fillRect(this.left - pad, this.topY - pad + 3, rect.size + pad * 2, rect.size + pad * 2)
    frame.fillStyle(PALETTE.frame, 1)
    frame.fillRect(this.left - pad, this.topY - pad, rect.size + pad * 2, rect.size + pad * 2)
    frame.fillStyle(PALETTE.frameLit, 1)
    frame.fillRect(this.left - pad, this.topY - pad, rect.size + pad * 2, 2)
    frame.fillStyle(shade(WATER, -0.5), 1)
    frame.fillRect(this.left - 2, this.topY - 2, rect.size + 4, rect.size + 4)
    this.objects.push(frame)
    this.glow = scene.add.graphics().setDepth(4)
    this.glow.lineStyle(3, PALETTE.amber, 1)
    this.glow.strokeRect(
      this.left - pad - 2,
      this.topY - pad - 2,
      rect.size + pad * 2 + 4,
      rect.size + pad * 2 + 4,
    )
    this.glow.setVisible(false)
    this.objects.push(this.glow)

    for (let i = 0; i < n * n; i++) {
      const { x, y } = this.cellXY(i)
      const variant = (i * 7 + Math.floor(i / n)) % WAVES.length
      const img = scene.add
        .image(x, y, this.tex.water[variant]?.[0] ?? '')
        .setDisplaySize(this.cell, this.cell)
      this.waterVariant.push(variant)
      this.water.push(img)
      this.waterFrame.push(0)
      const mark = scene.add
        .image(x, y, this.tex.splash)
        .setDisplaySize(this.cell, this.cell)
        .setVisible(false)
        .setDepth(2)
      this.marks.push(mark)
      this.mark.push('water')
      this.markFrame.push(-1)
    }
    this.objects.push(...this.water, ...this.marks)

    this.dim = scene.add
      .rectangle(this.left, this.topY, rect.size, rect.size, PALETTE.bg, 0.38)
      .setOrigin(0, 0)
      .setDepth(3)
      .setVisible(false)
    this.lastOutline = scene.add
      .rectangle(0, 0, this.cell - 2, this.cell - 2)
      .setStrokeStyle(2, PALETTE.text)
      .setDepth(5)
      .setVisible(false)
    this.reticle = scene.add
      .image(0, 0, this.tex.reticle)
      .setDisplaySize(this.cell, this.cell)
      .setDepth(6)
      .setVisible(false)
    this.objects.push(this.dim, this.lastOutline, this.reticle)

    // Battleship coordinates (A–E across, 1–5 down) when there's room for them.
    const coordSize = m.coordSize
    for (let i = 0; i < n; i++) {
      const col = scene.add
        .text(
          this.left + (i + 0.5) * this.cell,
          this.topY - pad - 3,
          COLS[i] ?? '',
          bodyStyle(coordSize, PALETTE.dim),
        )
        .setOrigin(0.5, 1)
      const row = scene.add
        .text(
          this.left - pad - 4,
          this.topY + (i + 0.5) * this.cell,
          String(i + 1),
          bodyStyle(coordSize, PALETTE.dim),
        )
        .setOrigin(1, 0.5)
      this.objects.push(col, row)
    }

    const tagY = this.topY - pad - 3 - coordSize - 5
    this.tagSize = m.tagSize
    this.tag = scene.add
      .text(rect.cx, tagY, '', bodyStyle(this.tagSize, PALETTE.text))
      .setOrigin(0.5, 1)
    this.title = scene.add
      .text(rect.cx, tagY - m.tagSize - 4, '', headlineStyle(m.titleSize, PALETTE.text))
      .setOrigin(0.5, 1)
    this.objects.push(this.tag, this.title)

    // Fleet health: one hull pip per ship cell, burning once that cell has been hit.
    this.pipKeys = {
      ok: ensurePixelGrid(scene, {
        key: `pp-naval-pip-ok-${ps}`,
        rows: PIP_ROWS.ok,
        legend: MARK_LEGEND,
        pixelSize: Math.max(2, ps),
      }),
      hit: ensurePixelGrid(scene, {
        key: `pp-naval-pip-hit-${ps}`,
        rows: PIP_ROWS.hit,
        legend: { ...MARK_LEGEND, R: PALETTE.red },
        pixelSize: Math.max(2, ps),
      }),
    }
    const pipW = m.pipW
    const pipY = this.topY + rect.size + pad + 6 + (pipW * 0.75) / 2
    const rowW = fleetCells * (pipW + 2)
    const pipX0 = rect.cx - rowW / 2 - pipW
    for (let i = 0; i < fleetCells; i++) {
      const pip = scene.add
        .image(pipX0 + i * (pipW + 2) + pipW / 2, pipY, this.pipKeys.ok)
        .setDisplaySize(pipW, pipW * 0.75)
      this.pips.push(pip)
    }
    this.pipCount = scene.add
      .text(
        pipX0 + rowW + 6,
        pipY,
        '',
        headlineStyle(rect.compact ? 8 : rect.big ? 24 : 16, PALETTE.dim),
      )
      .setOrigin(0, 0.5)
    this.objects.push(...this.pips, this.pipCount)

    if (onFire) {
      const zone = scene.add
        .zone(this.left, this.topY, rect.size, rect.size)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true })
      zone.on('pointermove', (p: Phaser.Input.Pointer) => {
        this.hover = this.cellAt(p.x, p.y)
        // The mouse takes over the aim; the keys carry on from where it points.
        this.keyAim = false
        if (this.hover >= 0) this.cursor = this.hover
      })
      zone.on('pointerout', () => {
        this.hover = -1
      })
      zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
        const cell = this.cellAt(p.x, p.y)
        if (cell >= 0 && this.aimable && !this.known.has(cell)) onFire(cell)
      })
      this.objects.push(zone)
    }
  }

  // Keyboard aim: moves the cursor one cell (clamped to the sea), starting from the middle.
  moveCursor(dx: number, dy: number): void {
    const n = this.n
    if (this.cursor < 0) this.cursor = Math.floor((n * n) / 2)
    else {
      const col = Math.max(0, Math.min(n - 1, (this.cursor % n) + dx))
      const row = Math.max(0, Math.min(n - 1, Math.floor(this.cursor / n) + dy))
      this.cursor = row * n + col
    }
    this.keyAim = true
  }

  // Fires at the keyboard cursor. False when there's nothing to fire at (not aimable, no cursor yet,
  // or a cell already fired at).
  fireCursor(): boolean {
    if (!this.aimable || this.cursor < 0) {
      if (this.aimable) this.moveCursor(0, 0)
      return false
    }
    this.keyAim = true
    if (this.known.has(this.cursor) || !this.onFire) return false
    this.onFire(this.cursor)
    return true
  }

  // Screen center of a cell.
  cellXY(cell: number): { x: number; y: number } {
    const col = cell % this.n
    const row = Math.floor(cell / this.n)
    return { x: this.left + (col + 0.5) * this.cell, y: this.topY + (row + 0.5) * this.cell }
  }

  // Center of the grid (for banners / fx that belong to the board as a whole).
  center(): { x: number; y: number } {
    return { x: this.left + this.size / 2, y: this.topY + this.size / 2 }
  }

  setLabels(title: string, titleColor: number, tag = '', tagColor: number = PALETTE.text): void {
    if (this.title.text !== title) this.title.setText(title)
    setTextColor(this.title, titleColor)
    if (this.tag.text !== tag) this.tag.setText(tag)
    setTextColor(this.tag, tagColor)
  }

  // 'active' = the board the current shot will land on (lit, pulsing frame in `color`); 'idle' = plain;
  // 'dim' = out of play right now (shaded over).
  setFocus(focus: Focus, color: number = PALETTE.amber): void {
    this.focus = focus
    this.activeColor = color
    this.dim.setVisible(focus === 'dim')
  }

  // Aimable = the local player may fire here right now (reticle follows the pointer).
  setAimable(aimable: boolean): void {
    this.aimable = aimable
    if (!aimable) this.pending = -1
  }

  // Locks the reticle on a cell just fired at until its result lands in a snapshot.
  setPending(cell: number): void {
    this.pending = cell
  }

  setVisible(v: boolean): void {
    for (const o of this.objects) o.setVisible(v)
    if (v) {
      this.dim.setVisible(this.focus === 'dim')
      this.glow.setVisible(this.focus === 'active')
      this.lastOutline.setVisible(false)
      this.reticle.setVisible(false)
      // Un-shot cells keep their (splash-textured) mark image hidden.
      this.marks.forEach((m, i) => m.setVisible(this.mark[i] !== 'water'))
    }
  }

  // Applies the board's shot list. Returns the shots that are new since the previous sync (none on the
  // very first sync, so a relayout never replays old feedback). `fleetSunk` flips every hit to a wreck.
  sync(shots: readonly NavalShot[], fleetSunk: boolean): NavalShot[] {
    const fresh: NavalShot[] = []
    for (const s of shots) {
      if (this.known.has(s.cell)) continue
      this.known.set(s.cell, s.hit)
      if (this.primed) fresh.push(s)
      this.setMark(s.cell, s.hit ? 'hit' : 'miss')
    }
    const last = shots[shots.length - 1]
    if (fresh.length > 0 && last) {
      this.lastShot = last.cell
      this.lastShotAt = this.scene.time.now
    }
    if (this.pending >= 0 && this.known.has(this.pending)) this.pending = -1
    let hits = 0
    for (const hit of this.known.values()) if (hit) hits++
    this.pips.forEach((pip, i) => {
      pip.setTexture(i < hits ? this.pipKeys.hit : this.pipKeys.ok)
    })
    this.pipCount.setText(`${hits}/${this.pips.length}`)
    setTextColor(this.pipCount, hits > 0 ? PALETTE.red : PALETTE.dim)
    if (fleetSunk && !this.sunk) {
      this.sunk = true
      this.revealWrecks(this.primed)
    }
    this.primed = true
    return fresh
  }

  // Per-shot feedback on this board (pixel explosion or splash + a ping ring).
  shotFx(shot: NavalShot, loud: boolean): void {
    const { x, y } = this.cellXY(shot.cell)
    if (shot.hit) {
      burst(this.scene, x, y, PALETTE.orange, loud ? 22 : 14, loud ? 260 : 180)
      burst(this.scene, x, y, PALETTE.amber, 8, 140)
      ring(this.scene, x, y, PALETTE.red, this.cell * 0.9)
    } else {
      burst(this.scene, x, y, shade(WATER, 0.55), 10, 150)
      ring(this.scene, x, y, PALETTE.cyan, this.cell * 0.7)
    }
  }

  // Brief colored wash over the whole sea (incoming hit) — local, so it never blinds the other board.
  pulse(color: number): void {
    const wash = this.scene.add
      .rectangle(this.left, this.topY, this.size, this.size, color, 0.4)
      .setOrigin(0, 0)
      .setDepth(7)
    this.scene.tweens.add({
      targets: wash,
      alpha: 0,
      duration: 260,
      ease: 'Quad.easeOut',
      onComplete: () => wash.destroy(),
    })
  }

  // Per-frame animation: water shimmer, flame flicker, frame pulse, reticle + last-shot blink.
  tick(time: number): void {
    this.water.forEach((img, i) => {
      const f = Math.floor((time + i * 173) / 720) % 2
      if (f === this.waterFrame[i]) return
      this.waterFrame[i] = f
      img.setTexture(this.tex.water[this.waterVariant[i] ?? 0]?.[f] ?? '')
    })
    this.marks.forEach((m, i) => {
      if (this.mark[i] !== 'hit') return
      const f = Math.floor((time + i * 97) / 150) % 2
      if (f === this.markFrame[i]) return
      this.markFrame[i] = f
      m.setTexture(this.tex.hit[f] ?? '')
    })

    // The frame in play pulses: drawn once per color, then only its alpha changes.
    const active = this.focus === 'active'
    this.glow.setVisible(active)
    if (active) {
      if (this.glow.getData('color') !== this.activeColor) {
        this.glow.setData('color', this.activeColor)
        this.glow.clear()
        this.glow.lineStyle(3, this.activeColor, 1)
        const pad = this.pad
        this.glow.strokeRect(
          this.left - pad - 2,
          this.topY - pad - 2,
          this.size + pad * 2 + 4,
          this.size + pad * 2 + 4,
        )
      }
      this.glow.setAlpha(0.55 + 0.45 * Math.abs(Math.sin(time / 260)))
    }

    const aim =
      this.pending >= 0
        ? this.pending
        : this.aimable
          ? this.keyAim
            ? this.cursor
            : this.hover
          : -1
    // The keyboard cursor stays visible on a cell already fired at (dimmed: it can't fire there).
    const spent = aim >= 0 && this.known.has(aim)
    if (aim >= 0 && (!spent || (this.keyAim && this.pending < 0))) {
      const { x, y } = this.cellXY(aim)
      const blink = this.pending >= 0 ? Math.floor(time / 90) % 2 === 0 : true
      this.reticle
        .setPosition(x, y)
        .setVisible(blink)
        .setAlpha(spent ? 0.35 : 1)
    } else {
      this.reticle.setVisible(false)
    }

    const since = time - this.lastShotAt
    if (this.lastShot >= 0 && since < LAST_SHOT_MS) {
      const { x, y } = this.cellXY(this.lastShot)
      this.lastOutline.setPosition(x, y).setVisible(Math.floor(since / 200) % 2 === 0)
    } else {
      this.lastOutline.setVisible(false)
    }
  }

  // Removes every object of the board (a spectator moving on to another duel gets a fresh pair).
  destroy(): void {
    this.destroyed = true
    for (const o of this.objects) {
      this.scene.tweens.killTweensOf(o)
      o.destroy()
    }
    this.objects.length = 0
  }

  private setMark(cell: number, mark: Mark): void {
    if (this.destroyed) return
    const img = this.marks[cell]
    if (!img) return
    this.mark[cell] = mark
    const key =
      mark === 'miss'
        ? this.tex.splash
        : mark === 'hit'
          ? (this.tex.hit[0] ?? '')
          : mark === 'sunk'
            ? this.tex.wreck
            : ''
    img.setVisible(mark !== 'water')
    if (key) img.setTexture(key)
    this.markFrame[cell] = mark === 'hit' ? 0 : -1
    // Wrecks sit on darker, churned water so the whole sunk fleet reads at a glance.
    this.water[cell]?.setTint(mark === 'sunk' ? 0x8a94b8 : 0xffffff)
  }

  // Fleet destroyed: every hit turns into a sinking wreck, one after another (animated only when it
  // happens live — a relayout just shows the wrecks).
  private revealWrecks(animate: boolean): void {
    const hits = [...this.known.entries()].filter(([, hit]) => hit).map(([cell]) => cell)
    hits.forEach((cell, i) => {
      if (!animate) {
        this.setMark(cell, 'sunk')
        return
      }
      this.scene.time.delayedCall(140 * i, () => {
        if (this.destroyed) return
        this.setMark(cell, 'sunk')
        const { x, y } = this.cellXY(cell)
        burst(this.scene, x, y, 0x8a90a8, 10, 120)
        ring(this.scene, x, y, PALETTE.cyan, this.cell * 0.6)
      })
    })
  }

  private cellAt(px: number, py: number): number {
    const col = Math.floor((px - this.left) / this.cell)
    const row = Math.floor((py - this.topY) / this.cell)
    if (col < 0 || row < 0 || col >= this.n || row >= this.n) return -1
    return row * this.n + col
  }
}

// Big end-of-battle card ("FLEET SUNK — YOU WIN!" + an optional detail line) on a dark backing strip,
// so it stays readable over the boards. The headline wraps and steps its size down to fit phones; it
// slams in via the shared banner. Call show() every frame — it only relayouts when the text changes.
export class NavalEndCard {
  private readonly plate: Phaser.GameObjects.Rectangle
  private readonly banner: Phaser.GameObjects.Text
  private readonly sub: Phaser.GameObjects.Text
  private readonly sizes: readonly number[]
  private shown = ''

  constructor(private readonly scene: Phaser.Scene) {
    const { width, height } = scene.scale
    const compact = Math.min(width, height) < 520
    this.sizes = compact ? [24, 16] : [32, 24]
    this.plate = scene.add
      .rectangle(width / 2, height / 2, width, 100, PALETTE.bg, 0.86)
      .setStrokeStyle(4, PALETTE.frameLit)
      .setDepth(940)
      .setVisible(false)
    this.banner = addBanner(scene).setWordWrapWidth(width * 0.9)
    this.sub = scene.add
      .text(
        width / 2,
        height / 2,
        '',
        bodyStyle(compact ? 13 : 17, PALETTE.text, {
          align: 'center',
          wordWrap: { width: width * 0.86 },
        }),
      )
      .setOrigin(0.5)
      .setDepth(950)
      .setVisible(false)
  }

  get visible(): boolean {
    return this.plate.visible
  }

  show(title: string, color: number, sub = ''): void {
    this.plate.setVisible(true).setStrokeStyle(4, color)
    showBanner(this.scene, this.banner, title, color)
    const key = `${title}|${sub}`
    if (key !== this.shown) {
      this.shown = key
      this.layout(title, sub)
    }
    this.sub.setVisible(sub !== '')
  }

  hide(): void {
    this.shown = ''
    this.plate.setVisible(false)
    this.banner.setVisible(false)
    this.sub.setVisible(false)
  }

  // Picks the largest headline size that keeps the title to two lines, then stacks title + detail
  // around the screen's middle and sizes the backing strip to fit them.
  private layout(title: string, sub: string): void {
    const { height } = this.scene.scale
    this.banner.setText(title)
    for (const size of this.sizes) {
      this.banner.setFontSize(size)
      if (this.banner.height <= size * 2.6) break
    }
    this.sub.setText(sub)
    const gap = sub ? 14 : 0
    const subH = sub ? this.sub.height : 0
    const total = this.banner.height + gap + subH
    const y0 = height / 2 - total / 2
    this.banner.setY(y0 + this.banner.height / 2)
    this.sub.setY(y0 + this.banner.height + gap + subH / 2)
    this.plate.setSize(this.scene.scale.width, total + 48).setY(height / 2)
    this.plate.setOrigin(0.5)
  }
}

// Recolors a text only when the color actually changes (every setColor re-renders the text texture,
// which adds up when called per frame).
export function setTextColor(text: Phaser.GameObjects.Text, color: number): void {
  const css = hexToCss(color)
  if (text.style.color !== css) text.setColor(css)
}

// Sets `value` on a headline text, stepping its font size down through `sizes` (largest first) until
// it fits `maxWidth` — keeps long translations (e.g. Spanish turn banners) inside phone widths.
export function setFittedText(
  text: Phaser.GameObjects.Text,
  value: string,
  maxWidth: number,
  sizes: readonly number[],
): void {
  if (text.text === value && text.getData('fit-w') === maxWidth) return
  text.setData('fit-w', maxWidth)
  text.setText(value)
  for (const size of sizes) {
    text.setFontSize(size)
    if (text.width <= maxWidth) return
  }
}
