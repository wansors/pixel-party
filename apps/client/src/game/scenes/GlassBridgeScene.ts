import {
  type GlassBridgePlayer,
  type GlassBridgeSnapshot,
  type GlassSide,
  PALETTE,
} from '@pp/shared'
import Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import {
  addBanner,
  burst,
  eliminate,
  flash,
  floatText,
  punch,
  ring,
  showBanner,
  speechBubble,
} from '../fx'
import {
  bodyStyle,
  ensureBevelPanel,
  fitFontSize,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { YouMarker } from '../playerMarks'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Glass Bridge: a vertical bridge over a dark abyss — start platform at the bottom, goal at the top,
// one LEFT and one RIGHT glass panel per row. The server owns the bridge; this scene draws every player
// as their lobby avatar (queue on the start platform, the active runner on the glass, survivors at the
// goal), animates jumps, shattering falls and auto-walks, lights the lightning glint and shows everyone's
// heckle arrows. LEFT/RIGHT (keys, the two big buttons or a tap on a panel) jumps when it's your turn
// and points the way when it isn't.

const JUMP_ANIM_MS = 420
const FALL_ANIM_MS = 950
const SPARKLE_MS = 200

interface Spot {
  x: number
  y: number
}

interface Runner {
  avatar: AvatarSprite
  vest: Phaser.GameObjects.Text
  x: number
  y: number
}

// Panel textures, generated at the panel's real size: clear glass, glass known to hold (lime frame),
// and a shattered frame with jagged shards left in the corners.
function ensureGlass(
  scene: Phaser.Scene,
  w: number,
  h: number,
  kind: 'glass' | 'safe' | 'broken',
): string {
  const key = `gb-${kind}-${w}x${h}`
  if (scene.textures.exists(key)) return key
  const g = scene.make.graphics({ x: 0, y: 0 })
  const frame = kind === 'safe' ? PALETTE.lime : shade(PALETTE.cyan, 0.35)
  if (kind === 'broken') {
    g.fillStyle(0x05060b, 0.85)
    g.fillRect(2, 2, w - 4, h - 4)
    g.fillStyle(shade(PALETTE.cyan, 0.2), 0.8)
    const s = Math.max(6, Math.round(Math.min(w, h) * 0.3))
    g.fillTriangle(2, 2, 2 + s, 2, 2, 2 + s)
    g.fillTriangle(w - 2, h - 2, w - 2 - s, h - 2, w - 2, h - 2 - s)
    g.fillTriangle(w - 2, 2, w - 2 - s * 0.6, 2, w - 2, 2 + s * 0.8)
  } else {
    g.fillStyle(PALETTE.cyan, kind === 'safe' ? 0.32 : 0.24)
    g.fillRect(2, 2, w - 4, h - 4)
    // Two diagonal reflections.
    g.fillStyle(0xffffff, 0.35)
    for (let i = 0; i < Math.min(w, h) * 0.5; i += 2) {
      g.fillRect(6 + i, h - 8 - i, 2, 2)
      g.fillRect(14 + i, h - 8 - i, 2, 2)
    }
  }
  g.lineStyle(2, frame, 1)
  g.strokeRect(1, 1, w - 2, h - 2)
  g.generateTexture(key, w, h)
  g.destroy()
  return key
}

export class GlassBridgeScene extends MiniGameScene<GlassBridgeSnapshot> {
  private compact = false
  private rows = 0
  private slotH = 0
  private panelW = 0
  private panelH = 0
  private railW = 0
  private avatarSize = 0
  private cx = 0
  private areaTop = 0
  private areaBottom = 0
  private platW = 0
  private prompt?: Phaser.GameObjects.Text
  private strip?: PlayerStrip
  private stripY = 0
  private banner?: Phaser.GameObjects.Text
  private panels: { L: Phaser.GameObjects.Image; R: Phaser.GameObjects.Image }[] = []
  private rowKeys: string[] = []
  private targetBox?: Phaser.GameObjects.Graphics
  private timerBar?: Phaser.GameObjects.Graphics
  private arrows?: Phaser.GameObjects.Graphics
  private arrowKey = ''
  private marker?: YouMarker
  // A pulsing ring in the active runner's color under their feet (the ▼ is only ever "you").
  private spotlight?: Phaser.GameObjects.Graphics
  private nameTag?: Phaser.GameObjects.Text
  private runners = new Map<string, Runner>()
  private buttons: {
    side: GlassSide
    img: Phaser.GameObjects.Image
    text: Phaser.GameObjects.Text
  }[] = []
  private buttonKeys = { up: '', down: '', jumpUp: '' }
  private buttonMode = ''
  // Event trackers (snapshot deltas → sounds and effects).
  private prevStatus = new Map<string, GlassBridgePlayer['status']>()
  private lastGlint = 0
  private jumpAnim?: { id: string; from: Spot; to: Spot; at: number }
  private lastPhaseKey = ''
  private lastTickSecond = -1
  private hiddenFor = new Set<string>()
  private lastLanding = ''
  private lastPrompt = ''

  constructor(...deps: SceneDeps) {
    super('glass-bridge', ...deps)
  }

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.rows = 0
    this.panels = []
    this.rowKeys = []
    this.runners = new Map()
    this.buttons = []
    this.buttonMode = ''
    this.prevStatus = new Map()
    this.lastGlint = 0
    this.jumpAnim = undefined
    this.lastPhaseKey = ''
    this.lastTickSecond = -1
    this.hiddenFor = new Set()
    this.arrowKey = ''
    this.lastLanding = ''
    this.lastPrompt = ''

    const promptSize = this.compact ? 12 : 16
    this.prompt = this.add
      .text(width / 2, this.top + promptSize / 2 + 2, '', headlineStyle(promptSize, PALETTE.amber))
      .setOrigin(0.5)
      .setDepth(500)
    this.stripY = this.prompt.y + promptSize + (this.compact ? 8 : 12)
    const stripSize = this.compact ? 11 : 13
    this.strip = new PlayerStrip(this, width / 2, this.stripY, width - 24, stripSize, 2)
    this.areaTop = this.stripY + PlayerStrip.rowH(stripSize) * 2

    // Bottom controls: two big LEFT / RIGHT buttons (jump on your turn, point otherwise).
    const btnH = this.compact ? 84 : 68
    const gap = this.compact ? 10 : 16
    const padW = Math.min(width - 16, 620)
    const btnW = (padW - gap) / 2
    const btnY = height - (this.compact ? 12 : 20) - btnH / 2
    this.buttonKeys = {
      up: ensureBevelPanel(this, btnW, btnH, PALETTE.frameLit, 5, true),
      down: ensureBevelPanel(this, btnW, btnH, PALETTE.frame, 5, true),
      jumpUp: ensureBevelPanel(this, btnW, btnH, PALETTE.orange, 5, true),
    }
    for (const side of ['L', 'R'] as const) {
      const x = width / 2 + (side === 'L' ? -1 : 1) * (btnW / 2 + gap / 2)
      const img = this.add.image(x, btnY, this.buttonKeys.up).setDepth(700).setInteractive()
      const text = this.add
        .text(
          x,
          btnY,
          '',
          headlineStyle(this.compact ? 16 : 24, PALETTE.text, {
            stroke: '#10121c',
            strokeThickness: 4,
          }),
        )
        .setOrigin(0.5)
        .setDepth(701)
      img.on('pointerdown', () => this.act(side))
      this.buttons.push({ side, img, text })
    }
    this.areaBottom = btnY - btnH / 2 - (this.compact ? 10 : 14)
    this.onKey('LEFT', () => this.act('L'))
    this.onKey('A', () => this.act('L'))
    this.onKey('RIGHT', () => this.act('R'))
    this.onKey('D', () => this.act('R'))

    this.banner = addBanner(this)
  }

  // The bridge is sized from the snapshot (row count), so it is built on the first one.
  private buildBridge(rows: number): void {
    const { width } = this.scale
    this.rows = rows
    const areaH = this.areaBottom - this.areaTop
    this.slotH = Math.min(this.compact ? 60 : 64, Math.floor(areaH / (rows + 2)))
    this.panelH = Math.max(18, Math.round(this.slotH * 0.78))
    this.panelW = Math.min(Math.round(this.panelH * 1.5), Math.floor((width - 40) / 2) - 12)
    this.avatarSize = avatarPx(Math.max(24, Math.min(48, Math.round(this.slotH * 0.85))))
    this.railW = Math.max(4, Math.round(this.panelW * 0.12))
    this.cx = width / 2
    // Center the whole stack vertically in the area when there is slack.
    const used = this.slotH * (rows + 2)
    this.areaBottom -= Math.max(0, Math.floor((areaH - used) / 2))
    this.platW = Math.min(width - 16, Math.max(this.panelW * 4, 10 * this.avatarSize * 1.1))

    const g = this.add.graphics().setDepth(10)
    const bottomY = this.slotY(0) + this.slotH / 2
    const topY = this.slotY(rows + 1) - this.slotH / 2
    // The abyss: a near-black shaft with faint, far-away lights (deterministic dots).
    const shaftW = Math.min(width - 8, this.platW + 40)
    g.fillStyle(0x07080f, 1)
    g.fillRect(this.cx - shaftW / 2, topY, shaftW, bottomY - topY)
    for (let i = 0; i < 70; i++) {
      const x = this.cx - shaftW / 2 + ((i * 97) % 101) * (shaftW / 101)
      const y = topY + ((i * 53) % 89) * ((bottomY - topY) / 89)
      g.fillStyle(i % 7 === 0 ? PALETTE.amber : PALETTE.frame, i % 7 === 0 ? 0.35 : 0.5)
      g.fillRect(Math.round(x), Math.round(y), 2, 2)
    }
    // Steel rails: outer edges + the centre beam, riveted at every row.
    const railW = this.railW
    const span = this.panelW * 2 + railW * 3
    const rail = (x: number): void => {
      g.fillStyle(0x5c6378, 1)
      g.fillRect(Math.round(x - railW / 2), topY, railW, bottomY - topY)
      g.fillStyle(0x8a93ab, 1)
      g.fillRect(Math.round(x - railW / 2), topY, 2, bottomY - topY)
    }
    rail(this.cx - span / 2 + railW / 2)
    rail(this.cx)
    rail(this.cx + span / 2 - railW / 2)
    for (let r = 0; r < rows; r++) {
      const y = this.slotY(r + 1)
      g.fillStyle(0x2c3142, 1)
      for (const x of [this.cx - span / 2 + railW / 2, this.cx, this.cx + span / 2 - railW / 2]) {
        g.fillRect(Math.round(x - 1), Math.round(y - this.slotH / 2), 2, 2)
      }
    }
    // Platforms.
    const platH = Math.round(this.slotH * 0.9)
    const platKey = ensureBevelPanel(this, this.platW, platH, PALETTE.panelAlt, 4, true)
    const goalKey = ensureBevelPanel(this, this.platW, platH, shade(PALETTE.lime, -0.55), 4, true)
    this.add.image(this.cx, this.slotY(0), platKey).setDepth(20)
    this.add.image(this.cx, this.slotY(rows + 1), goalKey).setDepth(20)
    // Platform names sit in the abyss beside the bridge (the platforms themselves hold the avatars).
    const tagX = this.cx - span / 2 - 10
    const tag = (y: number, key: string, color: number, originY: number): void => {
      this.add
        .text(tagX, y, this.t(key), headlineStyle(this.compact ? 8 : 12, color))
        .setOrigin(1, originY)
        .setDepth(21)
    }
    tag(this.slotY(0) - platH / 2 - 6, 'game.glassBridge.start', PALETTE.dim, 1)
    tag(this.slotY(rows + 1) + platH / 2 + 6, 'game.glassBridge.goal', PALETTE.lime, 0)

    const glass = ensureGlass(this, this.panelW, this.panelH, 'glass')
    for (let r = 0; r < rows; r++) {
      const y = this.slotY(r + 1)
      const mk = (side: GlassSide): Phaser.GameObjects.Image => {
        const img = this.add.image(this.panelX(side), y, glass).setDepth(30).setInteractive()
        img.on('pointerdown', () => {
          if (this.snap?.target === r) this.act(side)
        })
        return img
      }
      this.panels.push({ L: mk('L'), R: mk('R') })
      this.rowKeys.push('')
    }
    this.targetBox = this.add.graphics().setDepth(35)
    this.arrows = this.add.graphics().setDepth(36)
    this.timerBar = this.add.graphics().setDepth(36)
    this.marker = new YouMarker(this, this.compact ? 12 : 16, 62)
    this.spotlight = this.add.graphics().setDepth(59)
    this.nameTag = this.add
      .text(0, 0, '', bodyStyle(this.compact ? 11 : 13, PALETTE.text, { fontStyle: 'bold' }))
      .setOrigin(0, 0.5)
      .setDepth(62)
      .setVisible(false)
  }

  private slotY(slot: number): number {
    return this.areaBottom - (slot + 0.5) * this.slotH
  }

  // Panels sit between the centre beam and the outer rails.
  private panelX(side: GlassSide): number {
    return this.cx + (side === 'L' ? -1 : 1) * (this.railW / 2 + this.panelW / 2)
  }

  // Where a player stands: queue/goal spots are spread along the platforms in vest order.
  private spotOf(p: GlassBridgePlayer, snap: GlassBridgeSnapshot): Spot | null {
    if (p.status === 'fallen') return null
    if (p.pos >= 0 && p.pos < this.rows) {
      const side = snap.rows[p.pos]?.safe ?? 'L'
      return { x: this.panelX(side), y: this.slotY(p.pos + 1) - this.avatarSize * 0.18 }
    }
    const onGoal = p.pos >= this.rows
    const group = snap.players.filter((q) =>
      onGoal
        ? q.status === 'crossed'
        : q.status !== 'crossed' && q.status !== 'fallen' && q.pos < 0,
    )
    const i = group.findIndex((q) => q.id === p.id)
    const step = Math.min(this.avatarSize * 1.25, (this.platW - 16) / Math.max(1, group.length))
    const x = this.cx + (i - (group.length - 1) / 2) * step
    return { x, y: this.slotY(onGoal ? this.rows + 1 : 0) + this.avatarSize * 0.38 }
  }

  private me(snap: GlassBridgeSnapshot): GlassBridgePlayer | undefined {
    return snap.players.find((p) => p.id === this.selfId)
  }

  // LEFT/RIGHT: jump when it's your turn to decide, otherwise raise/lower your heckle arrow.
  private act(side: GlassSide): void {
    const snap = this.snap
    if (!snap || snap.phase === 'done' || this.state.final) return
    const btn = this.buttons.find((b) => b.side === side)
    if (btn) {
      btn.img.setTexture(this.buttonKeys.down)
      punch(this, btn.img, -0.06, 60)
      this.time.delayedCall(90, () => {
        if (this.snap) this.paintButtons(this.snap, true)
      })
    }
    if (snap.active === this.selfId) {
      if (snap.phase !== 'decide') return
      this.sfx.click()
      this.sendInput({ kind: 'jump', side })
      return
    }
    const mine = snap.pointers.find((p) => p.id === this.selfId)?.side ?? null
    this.sfx.click()
    this.sendInput({ kind: 'point', side: mine === side ? null : side })
  }

  protected frame(snap: GlassBridgeSnapshot | null, time: number, delta: number): void {
    if (!snap) return
    if (this.rows === 0) this.buildBridge(snap.rows.length)
    if (this.firstSnapshot) {
      for (const p of snap.players) {
        this.prevStatus.set(p.id, p.status)
        if (p.status === 'fallen') this.hiddenFor.add(p.id)
      }
      this.lastGlint = snap.glint?.id ?? 0
    }
    this.paintRows(snap)
    this.paintTarget(snap, time)
    this.paintArrows(snap)
    this.detectEvents(snap, time)
    this.placeRunners(snap, time, delta)
    this.paintChrome(snap)
  }

  private paintRows(snap: GlassBridgeSnapshot): void {
    snap.rows.forEach((row, r) => {
      const key = `${row.safe ?? '-'}${row.broken ?? '-'}`
      if (key === this.rowKeys[r]) return
      this.rowKeys[r] = key
      const pair = this.panels[r]
      if (!pair) return
      for (const side of ['L', 'R'] as const) {
        const img = pair[side]
        const kind = row.broken === side ? 'broken' : row.safe === side ? 'safe' : 'glass'
        img.setTexture(ensureGlass(this, this.panelW, this.panelH, kind))
        // A row whose tempered side is known: the other intact panel is a trap — fade it.
        img.setAlpha(row.safe && row.safe !== side && row.broken !== side ? 0.45 : 1)
      }
    })
  }

  private paintTarget(snap: GlassBridgeSnapshot, time: number): void {
    const box = this.targetBox
    const bar = this.timerBar
    if (!box || !bar) return
    box.clear()
    bar.clear()
    if (snap.target === null || snap.phase === 'done') return
    const y = this.slotY(snap.target + 1)
    const pulse = 0.55 + 0.45 * Math.sin(time / 120)
    box.lineStyle(3, PALETTE.amber, snap.phase === 'decide' ? pulse : 0.5)
    for (const side of ['L', 'R'] as const) {
      const x = this.panelX(side)
      box.strokeRect(
        x - this.panelW / 2 - 3,
        y - this.panelH / 2 - 3,
        this.panelW + 6,
        this.panelH + 6,
      )
    }
    if (snap.phase !== 'decide' || snap.decideTotalMs <= 0) return
    // Jump timer: a draining strip just under the row being decided.
    const frac = Math.max(0, Math.min(1, snap.decideMs / snap.decideTotalMs))
    const w = this.panelX('R') - this.panelX('L') + this.panelW
    const color = frac < 0.3 ? PALETTE.red : frac < 0.6 ? PALETTE.amber : PALETTE.lime
    bar.fillStyle(PALETTE.panelAlt, 1)
    bar.fillRect(this.cx - w / 2, y + this.panelH / 2 + 4, w, 4)
    bar.fillStyle(color, 1)
    bar.fillRect(this.cx - w / 2, y + this.panelH / 2 + 4, Math.round(w * frac), 4)
  }

  // Everyone's heckle arrows, in their color, stacked beside the panel they point at.
  private paintArrows(snap: GlassBridgeSnapshot): void {
    const g = this.arrows
    if (!g) return
    const key = `${snap.target}:${snap.pointers.map((p) => p.id + p.side).join(',')}`
    if (key === this.arrowKey) return
    this.arrowKey = key
    g.clear()
    if (snap.target === null) return
    const y = this.slotY(snap.target + 1)
    const size = Math.max(8, Math.round(this.panelH * 0.34))
    const counts = { L: 0, R: 0 }
    for (const p of snap.pointers) {
      const n = counts[p.side]++
      const color = this.state.colorOf(p.id)
      const col = Math.floor(n / 3)
      const rowOff = ((n % 3) - 1) * (size * 1.1)
      // Arrows sit outside the rails and point in at the panel.
      const dir = p.side === 'L' ? -1 : 1
      const tip = this.panelX(p.side) + dir * (this.panelW / 2 + this.railW + 4 + col * (size + 4))
      const back = tip + dir * size
      const pts = [
        tip,
        y + rowOff,
        back,
        y + rowOff - size * 0.7,
        back,
        y + rowOff + size * 0.7,
      ] as const
      g.fillStyle(color, 1)
      g.lineStyle(2, 0x10121c, 1)
      g.fillTriangle(...pts)
      g.strokeTriangle(...pts)
    }
  }

  private detectEvents(snap: GlassBridgeSnapshot, time: number): void {
    // Lightning: one flash per glint id, with a sparkle on the tempered panel.
    if (snap.glint && snap.glint.id !== this.lastGlint) {
      this.lastGlint = snap.glint.id
      if (!this.firstSnapshot) this.lightning(snap.glint.row, snap.glint.side)
    }
    // A jump started: animate the active runner from where they stand to the chosen panel.
    const phaseKey = `${snap.phase}:${snap.active}:${snap.target}:${snap.jumpSide}`
    if (phaseKey !== this.lastPhaseKey) {
      if (snap.phase === 'jump' && snap.active && snap.target !== null && snap.jumpSide) {
        const r = this.runners.get(snap.active)
        if (r) {
          this.jumpAnim = {
            id: snap.active,
            from: { x: r.x, y: r.y },
            to: {
              x: this.panelX(snap.jumpSide),
              y: this.slotY(snap.target + 1) - this.avatarSize * 0.18,
            },
            at: time,
          }
        }
      }
      if (snap.phase === 'decide' && snap.active === this.selfId && !this.firstSnapshot) {
        this.sfx.go()
      }
      this.lastPhaseKey = phaseKey
      this.lastTickSecond = -1
    }
    // Your own jump timer ticks through its last seconds.
    if (snap.phase === 'decide' && snap.active === this.selfId) {
      const s = Math.ceil(snap.decideMs / 1000)
      if (s !== this.lastTickSecond && s <= 3 && s > 0 && this.lastTickSecond !== -1)
        this.sfx.tick()
      this.lastTickSecond = s
    }
    // Status changes: a safe landing, a fall, a crossing.
    for (const p of snap.players) {
      const prev = this.prevStatus.get(p.id)
      this.prevStatus.set(p.id, p.status)
      if (this.firstSnapshot || prev === p.status) continue
      if (p.status === 'fallen') this.onFall(p)
      else if (p.status === 'crossed') this.onCross(p)
    }
    // A runner landed on a new row (pos advanced while active): ping it.
    if (snap.phase === 'decide' && snap.active && snap.target !== null && snap.target > 0) {
      const landed = snap.target - 1
      const key = `land:${snap.active}:${landed}`
      if (this.lastLanding !== key && !this.firstSnapshot) {
        const side = snap.rows[landed]?.safe
        if (side && this.jumpAnim?.id === snap.active) {
          ring(this, this.panelX(side), this.slotY(landed + 1), PALETTE.lime, this.panelW * 0.7)
          if (snap.active === this.selfId) this.sfx.correct()
          else this.sfx.click()
        }
      }
      this.lastLanding = key
    }
  }

  private lightning(row: number, side: GlassSide): void {
    flash(this, 0xdfe8ff, 220, 0.3)
    this.sfx.thunder()
    const pair = this.panels[row]
    if (!pair) return
    const img = pair[side]
    // The glint: a tiny pixel sparkle in the tempered panel's upper corner — easy to miss.
    const sx = img.x - this.panelW / 2 + Math.max(6, this.panelW * 0.22)
    const sy = img.y - this.panelH / 2 + Math.max(6, this.panelH * 0.28)
    const u = Math.max(2, Math.round(this.panelH / 14))
    const sparkle = this.add.graphics({ x: sx, y: sy }).setDepth(40)
    sparkle.fillStyle(0xffffff, 1)
    sparkle.fillRect(-u / 2, -u * 2.5, u, u * 5)
    sparkle.fillRect(-u * 2.5, -u / 2, u * 5, u)
    this.tweens.add({
      targets: sparkle,
      alpha: 0,
      delay: SPARKLE_MS * 0.4,
      duration: SPARKLE_MS * 0.6,
      onComplete: () => sparkle.destroy(),
    })
  }

  private onFall(p: GlassBridgePlayer): void {
    const r = this.runners.get(p.id)
    const pair = this.panels[p.pos]
    const side = this.snap?.rows[p.pos]?.broken ?? 'L'
    const x = pair ? pair[side].x : (r?.x ?? this.cx)
    const y = pair ? pair[side].y : (r?.y ?? this.slotY(0))
    burst(this, x, y, PALETTE.cyan, 26, 260)
    eliminate(
      this,
      x,
      y - this.panelH,
      this.state.colorOf(p.id),
      this.quip('game.common.stamps', p.id),
      this.compact ? 12 : 16,
    )
    this.sfx.pop()
    this.sfx.eliminated()
    // The crowd still waiting on the start platform has an opinion.
    this.time.delayedCall(650, () =>
      speechBubble(
        this,
        this.cx,
        this.slotY(0) - this.avatarSize * 0.6,
        this.quip('game.glassBridge.crowd', p.id),
        this.compact ? 12 : 16,
      ),
    )
    if (r) {
      this.hiddenFor.add(p.id)
      r.vest.setVisible(false)
      r.avatar.setExpression('ko').tick(0)
      const img = r.avatar.image
      this.tweens.add({
        targets: img,
        x,
        y: y + this.slotH * 2.2,
        angle: 300,
        scale: img.scale * 0.25,
        alpha: 0,
        duration: FALL_ANIM_MS,
        ease: 'Quad.easeIn',
        onComplete: () => img.setVisible(false),
      })
    }
    // Leave the faller's name at the hole they made.
    this.add
      .text(
        x,
        y,
        this.state.nameOf(p.id).slice(0, 8),
        bodyStyle(this.compact ? 9 : 10, this.state.colorOf(p.id), { fontStyle: 'bold' }),
      )
      .setOrigin(0.5)
      .setAlpha(0.8)
      .setDepth(31)
  }

  private onCross(p: GlassBridgePlayer): void {
    const goal = { x: this.cx, y: this.slotY(this.rows + 1) }
    burst(this, goal.x, goal.y, this.state.colorOf(p.id), 18, 200)
    if (p.id === this.selfId) {
      this.sfx.win()
      floatText(
        this,
        goal.x,
        goal.y - this.slotH * 0.6,
        this.t('game.glassBridge.safe'),
        PALETTE.lime,
        this.compact ? 16 : 24,
      )
    } else {
      this.sfx.coin()
    }
  }

  // Avatars glide toward their spot (the snapshot only arrives a few times a second); the active
  // runner hops when jumping.
  private placeRunners(snap: GlassBridgeSnapshot, time: number, delta: number): void {
    const k = Math.min(1, delta / 90)
    for (const p of snap.players) {
      let r = this.runners.get(p.id)
      const spot = this.spotOf(p, snap)
      if (!r) {
        const start = spot ?? { x: this.cx, y: this.slotY(0) }
        const avatar = new AvatarSprite(
          this,
          this.state.avatarOf(p.id),
          this.state.colorOf(p.id),
          this.avatarSize,
        )
        avatar.image.setOrigin(0.5, 0.85).setPosition(start.x, start.y).setDepth(60)
        const vest = this.add
          .text(
            start.x,
            start.y,
            `${p.vest}`,
            headlineStyle(8, PALETTE.text, { stroke: '#10121c', strokeThickness: 3 }),
          )
          .setOrigin(0.5, 1)
          .setDepth(61)
        r = { avatar, vest, x: start.x, y: start.y }
        this.runners.set(p.id, r)
        if (p.status === 'fallen') {
          avatar.image.setVisible(false)
          vest.setVisible(false)
        }
      }
      if (this.hiddenFor.has(p.id) || !spot) continue
      // Waiting on the platform facing the crowd; back to the camera while out on the glass; a happy
      // face once across.
      r.avatar
        .setPose(p.status === 'active' ? 'back' : 'front')
        .setExpression(p.status === 'crossed' ? 'happy' : 'idle')
        .tick(time)
      const img = r.avatar.image
      const anim = this.jumpAnim
      if (anim && anim.id === p.id && time - anim.at < JUMP_ANIM_MS) {
        const f = (time - anim.at) / JUMP_ANIM_MS
        r.x = Phaser.Math.Linear(anim.from.x, anim.to.x, f)
        r.y =
          Phaser.Math.Linear(anim.from.y, anim.to.y, f) - Math.sin(f * Math.PI) * this.slotH * 0.6
        const s = 1 + Math.sin(f * Math.PI) * 0.35
        img.setDisplaySize(this.avatarSize * s, this.avatarSize * s)
      } else if (anim && anim.id === p.id && snap.phase === 'jump') {
        // Landed, waiting for the server's verdict on that panel.
        r.x = anim.to.x
        r.y = anim.to.y
        img.setDisplaySize(this.avatarSize, this.avatarSize)
      } else {
        r.x += (spot.x - r.x) * k
        r.y += (spot.y - r.y) * k
        img.setDisplaySize(this.avatarSize, this.avatarSize)
      }
      img.setPosition(Math.round(r.x), Math.round(r.y))
      r.vest.setPosition(Math.round(r.x), Math.round(r.y - this.avatarSize * 0.85 - 2))
      img.setAlpha(p.status === 'queue' ? 0.85 : 1)
    }
    // You: the standard ▼ over your own avatar (above your vest number).
    const mine = this.runners.get(this.selfId)
    if (mine && snap.phase !== 'done' && !this.hiddenFor.has(this.selfId))
      this.marker?.place(mine.x, mine.y - this.avatarSize * 0.85 - 12, time)
    else this.marker?.hide()
    // The active runner's spotlight, plus their name beside the bridge while they are on the glass.
    const activeId = snap.active ?? ''
    const active = this.runners.get(activeId)
    const tag = this.nameTag
    if (active && snap.phase !== 'done' && !this.hiddenFor.has(activeId)) {
      const pulse = 0.55 + 0.45 * Math.sin(time / 140)
      this.spotlight
        ?.clear()
        .lineStyle(2, this.state.colorOf(activeId), pulse)
        .strokeEllipse(
          Math.round(active.x),
          Math.round(active.y + this.avatarSize * 0.1),
          this.avatarSize * 0.95,
          this.avatarSize * 0.34,
        )
      const onGlass = active.y < this.slotY(0) - this.slotH / 2
      if (tag && onGlass) {
        const label = this.label(activeId)
        if (tag.text !== label) tag.setText(label)
        tag.setColor(hexToCss(this.state.colorOf(activeId)))
        const right = this.panelX('R') + this.panelW / 2 + this.railW + 10
        const fitsRight = right + tag.width < this.scale.width - 4
        tag
          .setOrigin(fitsRight ? 0 : 1, 0.5)
          .setPosition(
            fitsRight ? right : this.panelX('L') - this.panelW / 2 - this.railW - 10,
            active.y - this.avatarSize * 0.4,
          )
          .setVisible(true)
      } else tag?.setVisible(false)
    } else {
      this.spotlight?.clear()
      tag?.setVisible(false)
    }
  }

  private paintChrome(snap: GlassBridgeSnapshot): void {
    const me = this.me(snap)
    const alive = snap.players.filter((p) => p.status !== 'fallen').length
    this.hud?.setScore(me ? this.t('game.glassBridge.vest', { n: me.vest }) : '')
    this.hud?.setCenter(
      this.t('game.common.left', { n: alive, total: snap.players.length }),
      alive <= 1 ? PALETTE.red : PALETTE.text,
    )
    this.strip?.set(
      snap.players.map((p) => ({
        text: `#${p.vest} ${this.label(p.id)}${p.status === 'crossed' ? ' ✓' : p.status === 'fallen' ? ' ✗' : p.status === 'active' ? ' ▶' : ''}`,
        avatar: this.state.avatarOf(p.id),
        color: this.state.colorOf(p.id),
        dim: p.status === 'fallen',
      })),
    )
    this.paintButtons(snap, false)
    const prompt = this.promptFor(snap, me)
    if (this.prompt && prompt !== this.lastPrompt) {
      this.lastPrompt = prompt
      this.prompt.setText(prompt)
      this.prompt.setFontSize(fitFontSize(prompt, this.scale.width - 24, this.compact ? 12 : 16))
    }
    if (snap.phase === 'done' && this.banner) {
      const text =
        me?.status === 'crossed'
          ? this.t('game.glassBridge.safe')
          : me?.status === 'fallen'
            ? this.t('game.common.out')
            : this.t('game.glassBridge.timeUp')
      showBanner(this, this.banner, text, me?.status === 'crossed' ? PALETTE.lime : PALETTE.red)
    }
  }

  private promptFor(snap: GlassBridgeSnapshot, me: GlassBridgePlayer | undefined): string {
    if (!me || snap.phase === 'done') return ''
    if (snap.active === me.id) {
      return snap.phase === 'decide'
        ? this.t('game.glassBridge.yourJump')
        : snap.phase === 'walk'
          ? this.t('game.glassBridge.walking')
          : ''
    }
    if (me.status === 'crossed') return this.t('game.glassBridge.crossedHint')
    if (me.status === 'fallen') return this.t('game.glassBridge.fallenHint')
    const ahead = snap.players.filter(
      (p) => p.vest < me.vest && (p.status === 'queue' || p.status === 'active'),
    ).length
    return ahead <= 1
      ? this.t('game.glassBridge.nextUp')
      : this.t('game.glassBridge.waitTurn', { n: ahead })
  }

  // Button faces follow the role: orange JUMP buttons on your turn, POINT buttons otherwise, your
  // raised arrow's side lit.
  private paintButtons(snap: GlassBridgeSnapshot, force: boolean): void {
    const jumping = snap.active === this.selfId
    const mine = snap.pointers.find((p) => p.id === this.selfId)?.side ?? null
    const live = snap.phase !== 'done' && !this.state.final
    const mode = `${jumping}:${snap.phase === 'decide'}:${mine}:${live}`
    if (mode === this.buttonMode && !force) return
    this.buttonMode = mode
    for (const b of this.buttons) {
      const label = jumping
        ? this.t(b.side === 'L' ? 'game.glassBridge.jumpLeft' : 'game.glassBridge.jumpRight')
        : this.t(b.side === 'L' ? 'game.glassBridge.pointLeft' : 'game.glassBridge.pointRight')
      b.text.setText(label)
      b.text.setFontSize(fitFontSize(label, b.img.width - 16, this.compact ? 16 : 24))
      const lit = jumping ? snap.phase === 'decide' : mine === b.side
      b.img.setTexture(
        jumping && lit ? this.buttonKeys.jumpUp : lit ? this.buttonKeys.down : this.buttonKeys.up,
      )
      const enabled = live && (!jumping || snap.phase === 'decide')
      b.img.setAlpha(enabled ? 1 : 0.45)
      b.text.setAlpha(enabled ? 1 : 0.45)
    }
  }
}
