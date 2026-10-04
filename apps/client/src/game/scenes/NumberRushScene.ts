import { NUMBER_RUSH_WRONG_COOLDOWN_MS, type NumberRushSnapshot, PALETTE } from '@pp/shared'
import Phaser from 'phaser'
import { addBanner, burst, floatText, punch, ring, showBanner } from '../fx'
import { bodyStyle, ensureBevelPanel, fitText, headlineStyle, hexToCss, shade } from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const OPEN_COLOR = PALETTE.panelAlt
const CLEARED_COLOR = shade(PALETTE.lime, -0.72)
const WRONG_COLOR = shade(PALETTE.red, -0.35)
const MILESTONE = 5
// Every player gets a chip; rooms bigger than this get an extra strip row.
const CHIPS_PER_ROW = 6
// The chip strip is rebuilt at most this often.
const STRIP_EVERY_MS = 250
// A number counted locally that the server still hasn't confirmed after this long was dropped (it
// should never be): the scene falls back to the server's progress.
const CONFIRM_MS = 1200
// A rival finishing gets a crowd cheer, at most this often (a pack crossing the line cheers once).
const CHEER_EVERY_MS = 1500

interface Cell {
  image: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  x: number
  cleared: boolean
}

// Number Rush (Schulte grid) canvas. Renders the shared seeded 5x5 grid on a framed board; the player
// clicks 1..25 in order (mouse only on a PC: the hunt is spatial, and a keyboard cursor over 25 cells
// would only be slower). A right number counts at once (optimistic); cleared numbers sink into dark-lime
// tiles; a wrong one wiggles red and costs a short cooldown (the board dims and a red bar drains under
// the prompt), so sweeping every cell is slower than looking. Every 5th number pops a milestone, and a
// strip of player chips shows how far everyone else has got.
export class NumberRushScene extends MiniGameScene<NumberRushSnapshot> {
  private cells: Cell[] = []
  private prompt?: Phaser.GameObjects.Text
  private hint?: Phaser.GameObjects.Text
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private openKey = ''
  private clearedKey = ''
  private wrongKey = ''
  private cellSize = 0
  private boardTop = 0
  private boardBottom = 0
  private promptSize = 0
  // Optimistic next target: a correct tap counts at once, before the server's snapshot confirms it.
  private localNext = 1
  private localAt = 0
  private lastNext = 1
  // Wrong-number cooldown on the local clock: started by the tap itself, kept in step with the
  // server's (never ending before it) on each fresh snapshot.
  private cooldownEndsAt = 0
  private lastTick = -1
  private cooling = false
  private cooldownBar?: Phaser.GameObjects.Graphics
  private barBox = { x: 0, y: 0, w: 0, h: 0 }
  private barShown = false
  private chipsKey = ''
  private chipsAt = Number.NEGATIVE_INFINITY
  // Players already seen done (cheered once), and when the last cheer played.
  private readonly finishers = new Set<string>()
  private cheerAt = Number.NEGATIVE_INFINITY

  constructor(...deps: SceneDeps) {
    super('number-rush', ...deps)
  }

  override create(): void {
    super.create()
    this.cells = []
    this.localNext = 1
    this.localAt = 0
    this.lastNext = 1
    this.cooldownEndsAt = 0
    this.lastTick = -1
    this.cooling = false
    this.barShown = false
    this.chipsKey = ''
    this.chipsAt = Number.NEGATIVE_INFINITY
    this.finishers.clear()
    this.cheerAt = Number.NEGATIVE_INFINITY
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const cx = width / 2
    const promptSize = compact ? 24 : 32
    this.promptSize = promptSize
    this.prompt = this.add
      .text(
        cx,
        this.top + (compact ? 10 : 14) + promptSize / 2,
        '',
        headlineStyle(promptSize, PALETTE.amber, { stroke: '#10121c', strokeThickness: 6 }),
      )
      .setOrigin(0.5)
      .setDepth(5)
    this.boardTop = this.top + promptSize + (compact ? 26 : 34)
    const barW = Math.round(Math.min(width - 32, 620) * 0.6)
    const barH = compact ? 6 : 8
    this.barBox = { x: cx - barW / 2, y: this.boardTop - (compact ? 14 : 18), w: barW, h: barH }
    this.cooldownBar = this.add.graphics().setDepth(6)

    const chipSize = compact ? 11 : height >= 900 ? 16 : 13
    const roster = Object.keys(this.state.names).length
    const stripRows = (width < 600 ? 2 : 1) + (roster > CHIPS_PER_ROW ? 1 : 0)
    const hintY = height - (compact ? 14 : 18)
    this.hint = this.add.text(cx, hintY, '', bodyStyle(compact ? 12 : 16)).setOrigin(0.5)
    const stripY = hintY - 14 - stripRows * PlayerStrip.rowH(chipSize)
    this.strip = new PlayerStrip(
      this,
      cx,
      stripY + PlayerStrip.rowH(chipSize) / 2,
      width - 32,
      chipSize,
      stripRows,
    )
    this.cellSize = 0
    this.boardBottom = stripY - 10
    this.banner = addBanner(this).setFontSize(compact ? 24 : 32)
  }

  // The grid is built once, the first time a snapshot with a layout arrives.
  private build(snap: NumberRushSnapshot): void {
    const { width } = this.scale
    const n = snap.size
    const side = Math.floor(Math.min(width - 32, this.boardBottom - this.boardTop, 760))
    // Centered in the free band (on phones that also brings it closer to the thumbs).
    this.boardTop += Math.max(0, (this.boardBottom - this.boardTop - side) / 2)
    const pad = Math.max(8, Math.round(side * 0.025))
    const gap = Math.max(3, Math.round(side * 0.012))
    const cell = Math.floor((side - pad * 2 - gap * (n - 1)) / n)
    const boardW = cell * n + gap * (n - 1) + pad * 2
    const cx = width / 2
    const left = cx - boardW / 2
    this.add.image(
      cx,
      this.boardTop + boardW / 2,
      ensureBevelPanel(this, boardW, boardW, PALETTE.panel, 5, true),
    )
    this.cellSize = cell
    this.hint?.setText(this.t('game.numberRush.hint', { n: snap.grid.length }))
    this.openKey = ensureBevelPanel(this, cell, cell, OPEN_COLOR, 4, true)
    this.clearedKey = ensureBevelPanel(this, cell, cell, CLEARED_COLOR, 0, true)
    this.wrongKey = ensureBevelPanel(this, cell, cell, WRONG_COLOR, 4, true)
    const font = Math.max(8, Math.floor((cell * 0.36) / 8) * 8)
    for (let i = 0; i < snap.grid.length; i++) {
      const x = left + pad + (i % n) * (cell + gap) + cell / 2
      const y = this.boardTop + pad + Math.floor(i / n) * (cell + gap) + cell / 2
      const image = this.add.image(x, y, this.openKey).setInteractive({ useHandCursor: true })
      image.on('pointerdown', () => this.tap(i))
      const label = this.add
        .text(x, y, String(snap.grid[i]), headlineStyle(font, PALETTE.text))
        .setOrigin(0.5)
      this.cells.push({ image, label, x, cleared: false })
    }
  }

  private next(snap: NumberRushSnapshot): number {
    return Math.max(snap.progress[this.selfId] ?? 1, this.localNext)
  }

  private tap(index: number): void {
    const snap = this.snap
    const cell = this.cells[index]
    if (!snap || !cell || snap.remainingMs <= 0 || !(this.selfId in snap.progress)) return
    const target = this.next(snap)
    if (target > snap.grid.length || cell.cleared || this.time.now < this.cooldownEndsAt) return
    this.sendInput({ kind: 'tap', cell: index })
    if (snap.grid[index] === target) {
      this.localNext = target + 1
      this.localAt = this.time.now
      // The number clicks into place.
      this.sfx.lock()
      punch(this, cell.image, 0.12, 70)
      ring(
        this,
        cell.image.x,
        cell.image.y,
        this.state.colorOf(this.selfId, PALETTE.lime),
        this.cellSize * 0.6,
      )
    } else {
      this.sfx.wrong()
      this.cooldownEndsAt = this.time.now + NUMBER_RUSH_WRONG_COOLDOWN_MS
      this.tweens.killTweensOf([cell.image, cell.label])
      cell.image.setX(cell.x).setTexture(this.wrongKey)
      cell.label.setX(cell.x)
      this.tweens.add({
        targets: [cell.image, cell.label],
        x: cell.x + 5,
        duration: 40,
        yoyo: true,
        repeat: 2,
      })
      this.time.delayedCall(260, () => {
        cell.image.setX(cell.x).setTexture(cell.cleared ? this.clearedKey : this.openKey)
        cell.label.setX(cell.x)
      })
    }
  }

  protected frame(snap: NumberRushSnapshot | null): void {
    if (!snap) return
    // A fresh build adopts the current progress silently (no bursts for cells cleared before it).
    const fresh = this.cells.length === 0
    if (fresh) this.build(snap)
    const total = snap.grid.length
    // A counted number the server never confirmed (dropped, e.g. inside its own cooldown): resync.
    const server = snap.progress[this.selfId] ?? 1
    if (server < this.localNext && this.time.now - this.localAt > CONFIRM_MS)
      this.localNext = server
    const next = this.next(snap)
    const cleared = Math.min(total, next - 1)
    const done = next > total
    this.hud?.setScore(`${cleared}/${total}`)

    this.trackFinishers(snap, total)

    if (next !== this.lastNext) {
      // A fresh build (mid-round relayout) only replays the end state, not every milestone.
      if (!fresh || done) this.onAdvance(next, total)
      this.lastNext = next
    }

    this.cells.forEach((cell, i) => {
      const isCleared = (snap.grid[i] ?? 0) < next
      if (isCleared === cell.cleared) return
      cell.cleared = isCleared
      cell.image.setTexture(isCleared ? this.clearedKey : this.openKey)
      cell.label
        .setColor(hexToCss(isCleared ? PALETTE.lime : PALETTE.text))
        .setAlpha(isCleared ? 0.45 : 1)
      if (isCleared && !fresh) burst(this, cell.image.x, cell.image.y, PALETTE.lime, 6, 120)
    })

    // Rivals' chips change only when someone's progress does, and are rebuilt at most every
    // STRIP_EVERY_MS (each rebuild re-creates a dozen chips).
    const chipsKey =
      this.time.now - this.chipsAt < STRIP_EVERY_MS
        ? this.chipsKey
        : Object.values(snap.progress).join(',')
    if (chipsKey !== this.chipsKey) {
      this.chipsKey = chipsKey
      this.chipsAt = this.time.now
      const chips = Object.entries(snap.progress)
        .sort((a, b) => b[1] - a[1])
        .map(([id, p]) => {
          const name = this.label(id).slice(0, 10).toUpperCase()
          const n = Math.min(total, p - 1)
          return {
            text: `${name} ${n}/${total}${p > total ? '✓' : ''}`,
            avatar: this.state.avatarOf(id),
            color: this.state.colorOf(id),
          }
        })
      this.strip?.set(chips)
    }

    this.trackCooldown(snap.cooldowns[this.selfId] ?? 0)
    const cooling = !done && this.time.now < this.cooldownEndsAt
    this.renderCooldown(cooling)
    if (done) {
      this.setPrompt(this.t('game.numberRush.done'), PALETTE.lime)
      this.hint?.setText(this.t('game.common.waiting'))
    } else if (cooling) {
      this.setPrompt(this.t('game.numberRush.cooldown'), PALETTE.red)
    } else {
      this.setPrompt(this.t('game.numberRush.find', { n: next }), PALETTE.amber)
    }
  }

  // A rival clearing the grid cheers (throttled); the first snapshot only learns who is already done.
  private trackFinishers(snap: NumberRushSnapshot, total: number): void {
    for (const [id, p] of Object.entries(snap.progress)) {
      if (p <= total || this.finishers.has(id)) continue
      this.finishers.add(id)
      if (this.firstSnapshot || id === this.selfId) continue
      if (this.time.now - this.cheerAt < CHEER_EVERY_MS) continue
      this.cheerAt = this.time.now
      this.sfx.cheer()
    }
  }

  private trackCooldown(ms: number): void {
    if (this.state.tick === this.lastTick) return
    this.lastTick = this.state.tick
    if (ms > 0) this.cooldownEndsAt = Math.max(this.cooldownEndsAt, this.time.now + ms)
  }

  // Cooling down: the board dims and a red bar drains under the prompt until taps count again.
  private renderCooldown(cooling: boolean): void {
    const g = this.cooldownBar
    if (g && (cooling || this.barShown)) {
      g.clear()
      this.barShown = cooling
      if (cooling) {
        const { x, y, w, h } = this.barBox
        const left = this.cooldownEndsAt - this.time.now
        const frac = Phaser.Math.Clamp(left / NUMBER_RUSH_WRONG_COOLDOWN_MS, 0, 1)
        g.fillStyle(PALETTE.panelAlt, 1).fillRect(x, y, w, h)
        g.fillStyle(Math.floor(this.time.now / 120) % 2 ? PALETTE.red : shade(PALETTE.red, 0.25), 1)
        g.fillRect(x, y, Math.round(w * frac), h)
      }
    }
    if (cooling === this.cooling) return
    this.cooling = cooling
    for (const c of this.cells) {
      c.image.setAlpha(cooling ? 0.45 : 1)
      if (!c.cleared) c.label.setAlpha(cooling ? 0.45 : 1)
    }
  }

  private setPrompt(text: string, color: number): void {
    const p = this.prompt
    if (!p || p.text === text) return
    p.setText(text).setColor(hexToCss(color))
    fitText(p, this.scale.width - 32, this.promptSize)
  }

  private onAdvance(next: number, total: number): void {
    const cleared = next - 1
    if (this.prompt) punch(this, this.prompt, 0.12, 80)
    if (next > total) {
      // Across the finish line: the crowd roars.
      this.sfx.cheer()
      this.sfx.coin()
      this.cheerAt = this.time.now
      const { width, height } = this.scale
      burst(this, width / 2, height / 2, PALETTE.amber, 30, 320)
      burst(this, width / 2, height / 2, PALETTE.lime, 20, 260)
      if (this.banner) showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.lime)
      return
    }
    if (cleared > 0 && cleared % MILESTONE === 0 && this.prompt) {
      // Every 5th number pays out an arpeggio that grows with the milestone.
      this.sfx.lineClear(Math.min(4, cleared / MILESTONE))
      floatText(this, this.prompt.x, this.prompt.y + 24, `${cleared}/${total}`, PALETTE.lime, 18)
    }
  }
}
