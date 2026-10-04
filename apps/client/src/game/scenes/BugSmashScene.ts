import { type BugSmashLiveBug, type BugSmashSnapshot, PALETTE } from '@pp/shared'
import Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { addBanner, burst, flash, floatText, punch, ring, shake, showBanner } from '../fx'
import { bodyStyle, ensurePixelGrid, headlineStyle, hexToCss, shade } from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const GRASS = 0x24502e
// A create() within this long of the scene's own shutdown is a relayout restart mid-round (a new round
// only starts seconds after the previous one stopped) — the one case where localHit may carry over.
const RELAYOUT_GAP_MS = 1000
const GOO = 0x5fcf3a
// A swing at an empty hole leaves the mallet stuck in the dirt this long. Aimed whacks barely notice;
// rolling a hand over all nine keys (smash whatever pops up, bombs included) stops paying.
const WHIFF_STUN_MS = 400
const BUG_LEGEND = {
  o: 0x0f2a15,
  b: 0x2a9d3f,
  h: PALETTE.lime,
  k: 0x173a20,
  e: PALETTE.text,
  l: 0x0f2a15,
}

// 15x14 beetle: round shell with a centre seam + highlight, dark head with white eyes, antennae and
// three legs a side. The two frames swap the leg pose so live bugs visibly scuttle.
function bugRows(frame: 0 | 1): string[] {
  const w = 15
  const h = 14
  const grid = Array.from({ length: h }, () => new Array<string>(w).fill('_'))
  const set = (x: number, y: number, c: string): void => {
    const row = grid[y]
    if (row && x >= 0 && x < w) row[x] = c
  }
  for (const [i, ly] of [7, 9, 11].entries()) {
    const dy = (i % 2 === 0) === (frame === 0) ? -1 : 1
    for (const [inner, outer] of [
      [2, 1],
      [w - 3, w - 2],
    ] as const) {
      set(inner, ly, 'l')
      set(outer, ly + dy, 'l')
    }
  }
  set(4, 0, 'l')
  set(5, 1, 'l')
  set(10, 0, 'l')
  set(9, 1, 'l')
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5 - 7.5) / 5.2
      const sy = (y + 0.5 - 8.9) / 4.6
      const shell = sx * sx + sy * sy
      if (shell <= 1) {
        const highlight = sx < -0.15 && sy < -0.05 && shell < 0.5
        set(x, y, shell > 0.7 || (x === 7 && y > 5) ? 'o' : highlight ? 'h' : 'b')
        continue
      }
      const hx = x + 0.5 - 7.5
      const hy = y + 0.5 - 3.6
      const head = Math.sqrt(hx * hx + hy * hy)
      if (head <= 2.6) set(x, y, head > 1.8 ? 'o' : 'k')
    }
  }
  set(6, 3, 'e')
  set(8, 3, 'e')
  return grid.map((row) => row.join(''))
}

// 13x13 cartoon bomb: dark body, hot red rim, fuse curling up-right, spark on the tip ('S').
function bombRows(): string[] {
  const rows = ['__________S__', '_________f___', '________f____']
  const r = 5
  for (let y = 0; y < 10; y++) {
    let row = ''
    for (let x = 0; x < 13; x++) {
      const dx = x + 0.5 - 6.5
      const dy = y + 0.5 - r
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > r) row += y === 0 && x === 7 ? 'f' : '_'
      else if (d > r - 1.1) row += 'R'
      else if (dx < -1 && dy < -1 && d < r * 0.55) row += 'w'
      else row += 'b'
    }
    rows.push(row)
  }
  return rows
}

// Squashed-bug goo splat (16x8), fixed drop pattern so every splat reads the same.
const SPLAT_ROWS = [
  '__g_______G___g_',
  '_____gggggg_____',
  '_g_gggGGgggggg__',
  '__gggGGggggGggg_',
  '_ggggggggGGgggg_',
  '__gggoogggggg_g_',
  'g___gggggggg____',
  '______g____g____',
]

// Dirt hole (16x8): lit mound rim, darker dirt, near-black opening.
const HOLE_ROWS = [
  '____rrrrrrrr____',
  '__rrddddddddrr__',
  '_rddkkkkkkkkddr_',
  'rddkkkkkkkkkkddr',
  'dddkkkkkkkkkkddd',
  '_dddkkkkkkkkddd_',
  '__dddddddddddd__',
  '____dddddddd____',
]

// Mallet (12x16): wooden head with a steel band, handle below. Pivot = bottom of the handle.
const MALLET_ROWS = [
  '_oooooooooo_',
  'ohhhhssshhho',
  'obbbbsssbbbo',
  'obbbbsssbbbo',
  'obbbbsssbbbo',
  '_oooooooooo_',
  '_____oo_____',
  '_____hb_____',
  '_____hb_____',
  '_____hb_____',
  '_____hb_____',
  '_____hb_____',
  '_____hb_____',
  '_____hb_____',
  '_____hb_____',
  '_____oo_____',
]

// Keyboard: the 3x3 lawn maps onto the Q W E / A S D / Z X C block and onto the numpad (7 8 9 on top),
// row by row. The letter is printed in each tile's corner on keyboard-sized screens.
const HOLE_KEYS: readonly (readonly string[])[] = [
  ['Q', 'NUMPAD_SEVEN'],
  ['W', 'NUMPAD_EIGHT'],
  ['E', 'NUMPAD_NINE'],
  ['A', 'NUMPAD_FOUR'],
  ['S', 'NUMPAD_FIVE'],
  ['D', 'NUMPAD_SIX'],
  ['Z', 'NUMPAD_ONE'],
  ['X', 'NUMPAD_TWO'],
  ['C', 'NUMPAD_THREE'],
]

// Beveled grass tile at its real size with a few deterministic tufts.
function ensureGrassTile(scene: Phaser.Scene, key: string, w: number, h: number): string {
  if (scene.textures.exists(key)) return key
  const g = scene.make.graphics({ x: 0, y: 0 })
  const bevel = 4
  g.fillStyle(shade(GRASS, -0.45), 1).fillRect(0, 0, w, h)
  g.fillStyle(shade(GRASS, 0.3), 1).fillRect(0, 0, w - bevel, h - bevel)
  g.fillStyle(GRASS, 1).fillRect(bevel, bevel, w - bevel * 2, h - bevel * 2)
  g.fillStyle(shade(GRASS, 0.35), 1)
  for (let i = 0; i < 9; i++) {
    const x = bevel + ((i * 37 + 11) % Math.max(1, w - bevel * 2 - 6))
    const y = bevel + ((i * 53 + 7) % Math.max(1, h - bevel * 2 - 6))
    g.fillRect(x, y + 2, 2, 4).fillRect(x + 3, y, 2, 6)
  }
  g.generateTexture(key, w, h)
  g.destroy()
  return key
}

interface Hole {
  x: number
  y: number
  sprite: Phaser.GameObjects.Image
  // Spawn index currently drawn in this hole (null = empty).
  shown: number | null
}

interface Chip {
  id: string
  text: Phaser.GameObjects.Text
  // The player's avatar, just left of the text.
  icon: Phaser.GameObjects.Image
  // Score on the chip (null until first drawn; bombs can take it below zero).
  score: number | null
}

// Bug Smash (whack-a-mole) canvas. A 3x3 lawn of dirt holes; the shared seeded timeline pops pixel
// beetles (and the odd bomb) out of them. Click/tap a hole (or press its key: Q W E / A S D / Z X C or
// the numpad) to swing the mallet: a bug squashes into goo
// (+1), a bomb blows up in your face (-1, even below zero). A bug this player just smashed is hidden
// optimistically (the server confirms through the score). A whiff at an empty hole sticks the mallet
// for a moment, so mashing every key is worse than aiming. Other players' scores run along the top in
// their colors.
export class BugSmashScene extends MiniGameScene<BugSmashSnapshot> {
  private holes: Hole[] = []
  private chips: Chip[] = []
  private banner?: Phaser.GameObjects.Text
  private keys = { bugA: '', bugB: '', bombA: '', bombB: '', splat: '', mallet: '', hole: '' }
  private cell = { w: 0, h: 0 }
  private spriteSize = 0
  private built = false
  private scoreSnap?: BugSmashSnapshot
  // Until when the mallet is stuck after a whiff.
  private stunUntil = 0
  // Reused every frame: hole -> the live spawn shown there.
  private readonly live = new Map<number, BugSmashLiveBug>()
  // Spawn indices this player has already smashed (optimistic local hide). Kept across a relayout
  // restart, or a bug smashed a moment ago would pop back up — and "score" again, locally.
  private readonly localHit = new Set<number>()
  private stoppedAt = Number.NEGATIVE_INFINITY

  constructor(...deps: SceneDeps) {
    super('bug-smash', ...deps)
  }

  override create(): void {
    super.create()
    this.built = false
    this.holes = []
    this.chips = []
    this.scoreSnap = undefined
    this.stunUntil = 0
    if (this.game.getTime() - this.stoppedAt > RELAYOUT_GAP_MS) this.localHit.clear()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stoppedAt = this.game.getTime()
    })
    this.keys = {
      bugA: ensurePixelGrid(this, { key: 'pp-bug-a', rows: bugRows(0), legend: BUG_LEGEND }),
      bugB: ensurePixelGrid(this, { key: 'pp-bug-b', rows: bugRows(1), legend: BUG_LEGEND }),
      bombA: this.bombKey(PALETTE.amber, 0),
      bombB: this.bombKey(PALETTE.red, 1),
      splat: ensurePixelGrid(this, {
        key: 'pp-bug-splat',
        rows: SPLAT_ROWS,
        legend: { g: GOO, G: shade(GOO, 0.45), o: 0x0f2a15 },
      }),
      mallet: ensurePixelGrid(this, {
        key: 'pp-bug-mallet',
        rows: MALLET_ROWS,
        legend: { o: 0x3b2413, h: 0xc98d52, b: 0x8a5a2e, s: 0xaab2cc },
      }),
      hole: ensurePixelGrid(this, {
        key: 'pp-bug-hole',
        rows: HOLE_ROWS,
        legend: { r: 0x8a5a2e, d: 0x5a3a1e, k: 0x120c08 },
      }),
    }
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    this.add
      .text(
        width / 2,
        height - 10,
        this.t(compact ? 'game.bugSmash.hint' : 'game.bugSmash.keys'),
        bodyStyle(compact ? 12 : 16),
      )
      .setOrigin(0.5, 1)
    this.banner = addBanner(this)
    this.banner.setFontSize(compact ? 24 : 34).setWordWrapWidth(width * 0.9)
  }

  private bombKey(spark: number, i: number): string {
    return ensurePixelGrid(this, {
      key: `pp-bug-bomb-${i}`,
      rows: bombRows(),
      legend: { R: PALETTE.red, b: 0x3a3d56, w: 0x9aa2cc, f: 0xc9a36b, S: spark },
    })
  }

  // Lays the lawn out once the first snapshot says how many holes (and which players) there are.
  private build(snap: BugSmashSnapshot): void {
    this.built = true
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const chipsBottom = this.buildChips(Object.keys(snap.scores))
    const n = Math.max(1, Math.round(Math.sqrt(snap.holes)))
    const rows = Math.ceil(snap.holes / n)
    const gap = compact ? 8 : 14
    const areaTop = chipsBottom + (compact ? 10 : 14)
    const areaH = height - areaTop - (compact ? 30 : 40)
    const maxCellH = (areaH - gap * (rows - 1)) / rows
    const maxCellW = (width * 0.94 - gap * (n - 1)) / n
    const cw = Math.floor(Math.min(maxCellW, maxCellH * 1.25))
    const ch = Math.floor(Math.min(maxCellH, cw * 1.35))
    this.cell = { w: cw, h: ch }
    const gridW = n * cw + gap * (n - 1)
    const gridH = rows * ch + gap * (rows - 1)
    const x0 = width / 2 - gridW / 2 + cw / 2
    const y0 = areaTop + (areaH - gridH) / 2 + ch / 2
    const tile = ensureGrassTile(this, `pp-bug-grass-${cw}x${ch}`, cw, ch)
    const holeW = cw * 0.82
    this.spriteSize = Math.min(cw * 0.66, ch * 0.62)
    for (let i = 0; i < snap.holes; i++) {
      const cx = x0 + (i % n) * (cw + gap)
      const cy = y0 + Math.floor(i / n) * (ch + gap)
      this.add.image(cx, cy, tile)
      // Hole a little below centre so hole + popped-up bug sit centred in the tile.
      const hy = cy + this.spriteSize * 0.32
      this.add.image(cx, hy, this.keys.hole).setDisplaySize(holeW, holeW / 2)
      const sprite = this.add
        .image(cx, hy + holeW * 0.08, this.keys.bugA)
        .setOrigin(0.5, 0.92)
        .setVisible(false)
        .setDepth(5)
      this.holes.push({ x: cx, y: hy, sprite, shown: null })
      this.add
        .zone(cx, cy, cw + gap, ch + gap)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.smash(i))
      // Keys only map a 3x3 lawn (the board the server deals); the corner letter names the key.
      const keys = snap.holes === HOLE_KEYS.length ? HOLE_KEYS[i] : undefined
      for (const k of keys ?? []) this.onKey(k, () => this.smash(i))
      if (keys && !compact) {
        this.add
          .text(cx - cw / 2 + 10, cy - ch / 2 + 8, keys[0] ?? '', headlineStyle(16, PALETTE.text))
          .setAlpha(0.55)
      }
    }
  }

  // One chip per player (own included) with the live score, in the player's color. Returns its
  // bottom.
  private buildChips(ids: string[]): number {
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const perRow = Math.max(
      1,
      Math.min(ids.length, Math.floor((width * 0.94) / (compact ? 96 : 150))),
    )
    const chipW = (width * 0.94) / perRow
    const rowH = compact ? 20 : 26
    ids.forEach((id, i) => {
      const row = Math.floor(i / perRow)
      const inRow = Math.min(perRow, ids.length - row * perRow)
      const x = width / 2 - (inRow * chipW) / 2 + (i % perRow) * chipW + chipW / 2
      const y = this.top + row * rowH + rowH / 2
      const color = this.state.colorOf(id, PALETTE.dim)
      const text = this.add.text(x + 9, y, '', bodyStyle(compact ? 12 : 15, color)).setOrigin(0.5)
      if (id === this.selfId) text.setBackgroundColor(hexToCss(PALETTE.panelAlt))
      const icon = this.add
        .image(x, y, ensureAvatarTexture(this, this.state.avatarOf(id), color, 1))
        .setOrigin(1, 0.5)
      this.chips.push({ id, text, icon, score: null })
    })
    return this.top + Math.ceil(ids.length / perRow) * rowH
  }

  private smash(i: number): void {
    const snap = this.snap
    const hole = this.holes[i]
    // A spectator (not in this round) has no score to play for.
    if (!snap || !hole || snap.remainingMs <= 0 || !(this.selfId in snap.scores)) return
    const now = this.time.now
    if (now < this.stunUntil) {
      // Still prying the mallet out of the dirt: a dull tick, no swing.
      this.sfx.tick()
      return
    }
    this.swingMallet(hole)
    const bug = snap.live.find((b) => b.hole === i && !this.localHit.has(b.index))
    if (!bug) {
      this.stunUntil = now + WHIFF_STUN_MS
      // The mallet thuds into empty dirt.
      this.sfx.land()
      burst(this, hole.x, hole.y, 0x8a5a2e, 8, 110)
      floatText(this, hole.x, hole.y - this.spriteSize * 0.5, '×', PALETTE.dim, 16)
      return
    }
    this.localHit.add(bug.index)
    this.sendInput({ kind: 'smash', hole: i })
    this.tweens.killTweensOf(hole.sprite)
    hole.sprite.setVisible(false)
    const top = hole.y - this.spriteSize * 0.7
    if (bug.kind === 'bug') {
      // A solid mallet smack on the bug.
      this.sfx.hit(1.1)
      this.splat(hole)
      burst(this, hole.x, hole.y - this.spriteSize * 0.3, GOO, 16, 200)
      ring(this, hole.x, hole.y - this.spriteSize * 0.3, PALETTE.lime, this.spriteSize * 0.8)
      floatText(this, hole.x, top, '+1', PALETTE.lime, 22)
    } else {
      // Whacked a bomb: it goes off.
      this.sfx.boom()
      burst(this, hole.x, hole.y - this.spriteSize * 0.3, PALETTE.orange, 26, 320)
      burst(this, hole.x, hole.y - this.spriteSize * 0.3, PALETTE.red, 12, 200)
      shake(this, 0.014, 260)
      flash(this, PALETTE.red, 160)
      floatText(this, hole.x, top, '-1', PALETTE.red, 24)
    }
  }

  private swingMallet(hole: Hole): void {
    const h = Math.min(this.cell.w, this.cell.h) * 0.72
    const reach = h * 0.8
    const angle = -35
    const rad = (angle * Math.PI) / 180
    const px = hole.x - Math.sin(rad) * reach
    const py = hole.y - this.spriteSize * 0.3 + Math.cos(rad) * reach
    const mallet = this.add
      .image(px, py, this.keys.mallet)
      .setOrigin(0.5, 1)
      .setDisplaySize(h * 0.75, h)
      .setAngle(25)
      .setDepth(20)
    this.tweens.add({
      targets: mallet,
      angle,
      duration: 70,
      ease: 'Quad.easeIn',
      onComplete: () =>
        this.tweens.add({
          targets: mallet,
          alpha: 0,
          delay: 90,
          duration: 140,
          onComplete: () => mallet.destroy(),
        }),
    })
  }

  private splat(hole: Hole): void {
    const s = this.spriteSize
    const goo = this.add
      .image(hole.x, hole.y - s * 0.1, this.keys.splat)
      .setDisplaySize(s * 1.2, s * 0.6)
      .setDepth(4)
    this.tweens.add({
      targets: goo,
      alpha: 0,
      delay: 350,
      duration: 300,
      onComplete: () => goo.destroy(),
    })
  }

  protected frame(snap: BugSmashSnapshot | null, time: number): void {
    if (!snap) return
    if (!this.built) this.build(snap)
    if (snap !== this.scoreSnap) {
      this.scoreSnap = snap
      this.hud?.setScore(this.t('game.common.pts', { n: snap.scores[this.selfId] ?? 0 }))
      this.renderChips(snap)
    }

    const live = this.live
    live.clear()
    for (const b of snap.live) {
      if (!this.localHit.has(b.index)) live.set(b.hole, b)
    }
    this.holes.forEach((hole, i) => {
      const bug = live.get(i)
      const next = bug?.index ?? null
      if (next !== hole.shown) {
        // A spawn this player didn't smash ducks back down; a new one pops up out of the dirt.
        if (hole.shown !== null && !this.localHit.has(hole.shown)) this.duck(hole)
        hole.shown = next
        if (bug) this.popUp(hole, bug.kind)
      }
      if (!bug || !hole.sprite.visible) return
      if (bug.kind === 'bug') {
        hole.sprite.setTexture(Math.floor(time / 140 + i) % 2 ? this.keys.bugA : this.keys.bugB)
      } else {
        hole.sprite.setTexture(Math.floor(time / 110) % 2 ? this.keys.bombA : this.keys.bombB)
        hole.sprite.setAngle(Math.sin(time / 90 + i) * 7)
      }
    })

    if (snap.remainingMs <= 0 && this.banner) {
      showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.lime)
    }
  }

  private popUp(hole: Hole, kind: BugSmashLiveBug['kind']): void {
    const sprite = hole.sprite
    this.tweens.killTweensOf(sprite)
    sprite.setTexture(kind === 'bug' ? this.keys.bugA : this.keys.bombA).setAngle(0)
    const scale = this.spriteSize / sprite.frame.width
    sprite.setVisible(true).setAlpha(1).setScale(scale, 0)
    this.tweens.add({ targets: sprite, scaleY: scale, duration: 120, ease: 'Back.easeOut' })
  }

  private duck(hole: Hole): void {
    const sprite = hole.sprite
    this.tweens.killTweensOf(sprite)
    this.tweens.add({
      targets: sprite,
      scaleY: 0,
      duration: 90,
      ease: 'Quad.easeIn',
      onComplete: () => sprite.setVisible(false),
    })
  }

  private renderChips(snap: BugSmashSnapshot): void {
    const compact = Math.min(this.scale.width, this.scale.height) < 520
    for (const chip of this.chips) {
      const score = snap.scores[chip.id] ?? 0
      if (score === chip.score) continue
      const gained = chip.score !== null && score > chip.score
      chip.score = score
      chip.text.setText(` ${this.label(chip.id).slice(0, compact ? 6 : 10)} ${score} `)
      chip.icon.setX(Math.round(chip.text.x - chip.text.width / 2 - 2))
      if (gained && chip.id !== this.selfId) punch(this, chip.text, 0.2, 80)
    }
  }
}
