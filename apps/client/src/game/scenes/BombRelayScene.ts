import { type BombRelaySnapshot, type BombRelayTeamView, PALETTE, type TeamId } from '@pp/shared'
import type Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { burst, flash, floatText, punch, ring, shake } from '../fx'
import {
  bodyStyle,
  ensurePixelGrid,
  headlineStyle,
  hexToCss,
  shade,
  teamColor,
} from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const TEAM_ORDER: readonly TeamId[] = ['red', 'blue']

// Mirrors bombRelay.ts's FUSE_MIN_MS: a fresh fuse never blows sooner than this. The real fuse length is
// hidden (never on the wire), so the drawn fuse burns down over this guaranteed-safe window and then
// just sputters — "it could go any moment now" — without leaking anything the server keeps secret.
const SAFE_FUSE_MS = 2500
const FUSE_STUB = 0.15
const MAX_CHAIN = 8
// While you hold a bomb past its safe window, the fuse hisses at you this often.
const HISS_EVERY_MS = 450

// Classic cartoon bomb, 14 cells wide: metal cap, dark body with a highlight and a band in the team's
// color so each side's bomb reads as theirs.
function bombRows(): string[] {
  const rows = ['_____mmmm_____', '_____MMMM_____']
  const r = 7
  for (let y = 0; y < 14; y++) {
    let row = ''
    for (let x = 0; x < 14; x++) {
      const dx = x + 0.5 - r
      const dy = y + 0.5 - r
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > r) row += '_'
      else if (d > r - 1.1) row += 'o'
      else if (y === 7 || y === 8) row += 'c'
      else if (dx < -1 && dy < -1 && d < r * 0.62) row += 'w'
      else row += 'b'
    }
    rows.push(row)
  }
  return rows
}

// Fuse spark: two flicker frames.
const SPARK_ROWS = [
  ['__a__', '_aya_', 'ayyya', '_aya_', '__a__'],
  ['a___a', '_aya_', '_yyy_', '_aya_', 'a___a'],
]

interface Column {
  team: TeamId
  cx: number
  w: number
  panel: Phaser.GameObjects.Graphics
  panelRect: { x: number; y: number; w: number; h: number }
  panelMode?: 'ours' | 'theirs'
  bomb: Phaser.GameObjects.Image
  bombY: number
  bombSize: number
  fuse: Phaser.GameObjects.Graphics
  spark: Phaser.GameObjects.Image
  holder: Phaser.GameObjects.Text
  stats: Phaser.GameObjects.Text
  bar: Phaser.GameObjects.Graphics
  barKey: string
  barGlow: Phaser.GameObjects.Rectangle
  chainKey: string
  barX: number
  barY: number
  barW: number
  chain: Phaser.GameObjects.Graphics
  // One avatar per chain member (pooled, MAX_CHAIN).
  chainIcons: Phaser.GameObjects.Image[]
  chainY: number
  legStartedAt: number
  relays: number
  explosions: number
  progress: number
  holderId: string
  respawnUntil: number
}

// Bomb Relay (team hot potato) canvas: each team's bomb side by side — red left, blue right — with a
// fuse that burns while its holder mashes (click / tap / SPACE / ENTER) to fill the leg and pass it on;
// your own mashes light the leg bar at once (the snapshot catches up). Shows who holds
// each bomb (name in their identity color + the relay chain), the leg progress, passes and booms, and
// a big explosion + shake when a fuse blows. Only the current holder's mashes count (server-checked).
export class BombRelayScene extends MiniGameScene<BombRelaySnapshot> {
  private columns: Column[] = []
  private prompt?: Phaser.GameObjects.Text
  private sub?: Phaser.GameObjects.Text
  private hint?: Phaser.GameObjects.Text
  private sparkKeys: string[] = []
  private primed = false
  private promptMode = ''
  // Mashes sent since the last snapshot, while holding the bomb: drawn on the leg bar right away.
  private pendingMashes = 0
  private lastTick = -1
  // The sputtering fuse of the bomb in your hands: when it last hissed, and whether it's past safe.
  private hissAt = 0
  private hissing = false
  // A big screen (1080p and up): larger bombs, labels and chain avatars.
  private big = false

  constructor(...deps: SceneDeps) {
    super('bomb-relay', ...deps)
  }

  override create(): void {
    super.create()
    this.columns = []
    this.primed = false
    this.promptMode = ''
    this.pendingMashes = 0
    this.lastTick = -1
    this.hissAt = 0
    this.hissing = false
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    this.big = Math.min(width, height) >= 900
    const top = this.top
    const avail = height - top

    this.sparkKeys = SPARK_ROWS.map((rows, i) =>
      ensurePixelGrid(this, {
        key: `pp-bomb-spark-${i}`,
        rows,
        legend: { a: PALETTE.amber, y: 0xfff1a8 },
        pixelSize: 1,
      }),
    )

    const colTop = top + (compact ? 6 : 12)
    const colH = avail * (compact ? 0.66 : 0.68)
    const colW = width / 2 - (compact ? 12 : 28)
    for (const [i, team] of TEAM_ORDER.entries()) {
      const cx = i === 0 ? width / 4 + (compact ? 2 : 8) : (width * 3) / 4 - (compact ? 2 : 8)
      this.columns.push(this.buildColumn(team, cx, colTop, colW, colH, compact))
    }

    const colBottom = Math.max(...this.columns.map((c) => c.panelRect.y + c.panelRect.h))
    const promptY = colBottom + (height - colBottom) * 0.3
    this.prompt = this.add
      .text(
        width / 2,
        promptY,
        '',
        headlineStyle(compact ? 24 : 32, PALETTE.amber, {
          align: 'center',
          wordWrap: { width: width * 0.92 },
        }),
      )
      .setOrigin(0.5)
    this.sub = this.add
      .text(
        width / 2,
        promptY + 44,
        '',
        bodyStyle(compact ? 13 : 16, PALETTE.dim, { align: 'center' }),
      )
      .setOrigin(0.5, 0)
    this.hint = this.add
      .text(
        width / 2,
        height - 10,
        this.t(compact ? 'game.bombRelay.hint' : 'game.bombRelay.hintPc'),
        bodyStyle(compact ? 12 : this.big ? 16 : 15, PALETTE.dim, {
          align: 'center',
          wordWrap: { width: width * 0.92 },
        }),
      )
      .setOrigin(0.5, 1)

    this.input.on('pointerdown', () => this.mash())
    this.onKey('SPACE', () => this.mash())
    this.onKey('ENTER', () => this.mash())
  }

  private buildColumn(
    team: TeamId,
    cx: number,
    y: number,
    w: number,
    h: number,
    compact: boolean,
  ): Column {
    const color = teamColor(team)
    const panel = this.add.graphics()
    const big = this.big

    this.add
      .text(
        cx,
        y + (compact ? 16 : big ? 32 : 24),
        this.t(`team.${team}`).toUpperCase(),
        headlineStyle(big ? 24 : 16, color),
      )
      .setOrigin(0.5)
    const statsY = y + (compact ? 34 : big ? 64 : 48)
    const stats = this.add
      .text(cx, statsY, '', bodyStyle(compact ? 11 : big ? 20 : 15, PALETTE.text))
      .setOrigin(0.5)

    const bombKey = ensurePixelGrid(this, {
      key: `pp-bomb-body-${team}`,
      rows: bombRows(),
      legend: {
        m: 0x9aa2cc,
        M: 0x5b6280,
        o: 0x10121c,
        b: 0x3a3d56,
        w: 0x9aa2cc,
        c: color,
      },
      pixelSize: 1,
    })
    // The fuse curls up above the cap, so the bomb sits one fuse-height below the stats line.
    const bombSize = Math.min(w * (compact ? 0.58 : 0.46), h * 0.3, big ? 210 : 140)
    const bombY = statsY + (compact ? 14 : 20) + bombSize * 0.62 + (bombSize * 8) / 14
    const bomb = this.add
      .image(cx, bombY, bombKey)
      .setDisplaySize(bombSize, bombSize * (16 / 14))
      .setDepth(5)
    const fuse = this.add.graphics().setDepth(4)
    const spark = this.add
      .image(0, 0, this.sparkKeys[0] ?? '')
      .setScale(Math.max(3, Math.round(bombSize / 22)))
      .setDepth(6)

    const holder = this.add
      .text(cx, bombY + bombSize * 0.66 + 6, '', headlineStyle(big ? 24 : 16, PALETTE.text))
      .setOrigin(0.5, 0)
    const barW = w * 0.8
    const barY = holder.y + (compact ? 20 : big ? 42 : 30)
    const bar = this.add.graphics()
    const barH = this.barH()
    const barGlow = this.add
      .rectangle(cx, barY + barH / 2, barW + 6, barH + 6)
      .setStrokeStyle(2, PALETTE.amber)
      .setVisible(false)
    const chain = this.add.graphics()
    const chainY = barY + (compact ? 26 : big ? 56 : 34)
    const chainIcons = Array.from({ length: MAX_CHAIN }, () =>
      this.add
        .image(cx, chainY, ensureAvatarTexture(this, 'cat', PALETTE.dim, 1))
        .setVisible(false),
    )
    return {
      team,
      cx,
      w,
      panel,
      // The panel hugs its content (bounded by the space it was given).
      panelRect: {
        x: cx - w / 2,
        y,
        w,
        h: Math.min(h, chainY + (compact ? 22 : big ? 48 : 30) - y),
      },
      bomb,
      bombY,
      bombSize,
      fuse,
      spark,
      holder,
      stats,
      bar,
      barKey: '',
      barGlow,
      chainKey: '',
      barX: cx - barW / 2,
      barY,
      barW,
      chain,
      chainIcons,
      chainY,
      legStartedAt: 0,
      relays: 0,
      explosions: 0,
      progress: 0,
      holderId: '',
      respawnUntil: 0,
    }
  }

  private barH(): number {
    return Math.min(this.scale.width, this.scale.height) < 520 ? 10 : this.big ? 20 : 14
  }

  protected override remainingMs(snap: BombRelaySnapshot): number {
    return snap.roundRemainingMs
  }

  private myTeam(): TeamId | undefined {
    return this.snap?.playerTeam[this.selfId]
  }

  private amHolder(): boolean {
    const snap = this.snap
    const team = this.myTeam()
    return !!snap && !!team && snap.teams[team]?.holderId === this.selfId
  }

  private mash(): void {
    const snap = this.snap
    if (!snap || snap.roundRemainingMs <= 0 || !this.amHolder()) return
    this.sfx.click()
    this.sendInput({ kind: 'mash' })
    this.pendingMashes++
    const col = this.columns.find((c) => c.team === this.myTeam())
    if (col) punch(this, col.bomb, 0.06, 50)
  }

  protected frame(snap: BombRelaySnapshot | null, time: number): void {
    if (!snap) return
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.pendingMashes = 0
    }
    const mine = this.myTeam()
    this.hint?.setVisible(mine !== undefined) // spectators have nothing to press
    for (const col of this.columns) {
      const view = snap.teams[col.team]
      if (!view) continue
      this.trackColumn(col, view, time, col.team === mine)
      this.drawColumn(col, view, time, col.team === mine)
    }
    const myView = mine ? snap.teams[mine] : undefined
    if (myView) {
      this.hud?.setScore(`${this.t('game.bombRelay.relays')}: ${myView.relays}`)
    }
    this.updatePrompt(myView)
    // Primed only after the first prompt, so the opening (or post-relayout) MASH doesn't play "go".
    this.primed = true
  }

  // Snapshot deltas for one team → pass / boom feedback (louder for the local player's own team).
  private trackColumn(col: Column, view: BombRelayTeamView, time: number, ours: boolean): void {
    if (!this.primed) {
      col.relays = view.relays
      col.explosions = view.explosions
      col.legStartedAt = time
    }
    if (view.relays > col.relays) {
      col.legStartedAt = time
      burst(this, col.cx, col.bombY, teamColor(col.team), 16, 220)
      ring(this, col.cx, col.bombY, PALETTE.lime, col.bombSize * 0.8)
      floatText(
        this,
        col.cx,
        col.bombY - col.bombSize * 0.7,
        this.t('game.bombRelay.pass'),
        PALETTE.lime,
      )
      this.tweens.add({
        targets: col.bomb,
        y: col.bombY - col.bombSize * 0.25,
        duration: 110,
        yoyo: true,
      })
      punch(this, col.holder, 0.3, 90)
      // Passed on: the fuse fizzes back to life in the next pair of hands.
      if (ours) {
        this.sfx.coin()
        this.sfx.fuse()
      }
    }
    if (view.explosions > col.explosions) {
      col.legStartedAt = time
      col.respawnUntil = time + 450
      this.explode(col, ours, col.holderId === this.selfId)
    } else if (view.relays === col.relays && view.holderId !== col.holderId && this.primed) {
      // A new holder without a pass or a boom: the server skipped an idle holder (or one who left —
      // they're gone from the chain, so no jeer for them). Either way the fuse starts over.
      col.legStartedAt = time
      if (view.members.includes(col.holderId)) this.skipped(col, ours, col.holderId === this.selfId)
    }
    if (ours && view.legProgress > col.progress && view.holderId === this.selfId) {
      punch(this, col.bomb, 0.04, 40)
    }
    col.relays = view.relays
    col.explosions = view.explosions
    col.progress = view.legProgress
    col.holderId = view.holderId
  }

  private skipped(col: Column, ours: boolean, wasMe: boolean): void {
    floatText(
      this,
      col.cx,
      col.bombY - col.bombSize * 0.7,
      this.t('game.bombRelay.tooSlow'),
      PALETTE.amber,
    )
    this.tweens.add({ targets: col.bomb, x: col.cx + col.bombSize * 0.2, duration: 90, yoyo: true })
    if (wasMe) {
      this.sfx.wrong()
      shake(this, 0.01, 200)
    } else if (ours) {
      this.sfx.fuse()
    }
  }

  private explode(col: Column, ours: boolean, wasMe: boolean): void {
    const { cx, bombY: y, bombSize: s } = col
    burst(this, cx, y, PALETTE.orange, 34, 380)
    burst(this, cx, y, PALETTE.red, 18, 260)
    burst(this, cx, y, PALETTE.amber, 14, 200)
    burst(this, cx, y, PALETTE.dim, 10, 90)
    ring(this, cx, y, PALETTE.orange, s * 1.2)
    ring(this, cx, y, PALETTE.amber, s * 0.7)
    floatText(this, cx, y - s * 0.3, this.t('game.bombRelay.boom'), PALETTE.red, 28)
    if (ours) {
      this.sfx.boom()
      this.sfx.wrong()
      shake(this, wasMe ? 0.022 : 0.014, 320)
      if (wasMe) flash(this, PALETTE.orange, 180)
    } else {
      // The other team's bomb goes off across the room: heard, but not in your face.
      this.sfx.quiet(() => this.sfx.boom(), 0.5)
      shake(this, 0.006, 160)
    }
    // A fresh bomb pops back in for the next holder.
    const base = col.bomb.getData('pp-base-sx') ?? col.bomb.scaleX
    col.bomb.setData('pp-base-sx', base).setData('pp-base-sy', base)
    this.tweens.killTweensOf(col.bomb)
    col.bomb.setScale(0).setY(y)
    this.tweens.add({
      targets: col.bomb,
      scale: base,
      delay: 300,
      duration: 220,
      ease: 'Back.easeOut',
    })
  }

  private drawColumn(col: Column, view: BombRelayTeamView, time: number, ours: boolean): void {
    const color = teamColor(col.team)
    const panelMode = ours ? 'ours' : 'theirs'
    if (col.panelMode !== panelMode) {
      // The local player's team gets the lit frame.
      col.panelMode = panelMode
      const { x, y, w, h } = col.panelRect
      col.panel.clear()
      col.panel.fillStyle(shade(color, ours ? -0.74 : -0.85), 1)
      col.panel.fillRect(x, y, w, h)
      col.panel.lineStyle(ours ? 4 : 2, ours ? color : shade(color, -0.4), 1)
      col.panel.strokeRect(x, y, w, h)
    }
    const elapsed = time - col.legStartedAt
    const danger = elapsed > SAFE_FUSE_MS && time > col.respawnUntil
    const respawning = time < col.respawnUntil
    const live = !this.state.final && (this.snap?.roundRemainingMs ?? 0) > 0
    if (ours && view.holderId === this.selfId) this.hiss(danger && live, time)

    // Hot bomb: the last stretch blinks red and trembles.
    const hot = danger && Math.floor(time / 110) % 2 === 0
    col.bomb.setTint(hot ? 0xff9a8a : 0xffffff)
    if (!this.tweens.isTweening(col.bomb)) {
      const jitter = danger ? Math.round(Math.sin(time / 23) * 2) : 0
      col.bomb.setPosition(col.cx + jitter, col.bombY)
    }

    // The fuse burns down over the guaranteed-safe window, then sputters as a short stub.
    const frac = danger
      ? FUSE_STUB * (0.8 + 0.2 * Math.sin(time / 40))
      : 1 - (1 - FUSE_STUB) * Math.min(1, elapsed / SAFE_FUSE_MS)
    const g = col.fuse
    g.clear()
    col.spark.setVisible(!respawning)
    if (!respawning) this.drawFuse(col, frac, danger, time)

    // Who holds it: name in their identity color (YOU for the local player).
    const holderColor = this.state.colorOf(view.holderId, PALETTE.text)
    const label = view.holderId ? `▲ ${this.label(view.holderId).toUpperCase()}` : ''
    if (col.holder.text !== label) {
      const size = this.big ? 24 : 16
      col.holder.setText(label).setFontSize(size)
      if (col.holder.width > col.w * 0.92) col.holder.setFontSize(size - 8)
    }
    const holderCss = hexToCss(holderColor)
    if (col.holder.style.color !== holderCss) col.holder.setColor(holderCss)

    if (col.stats.getData('n') !== `${view.relays}:${view.explosions}`) {
      col.stats.setData('n', `${view.relays}:${view.explosions}`)
      col.stats.setText(
        `${this.t('game.bombRelay.relays')}: ${view.relays} · ${this.t('game.bombRelay.booms')}: ${view.explosions}`,
      )
    }

    // Leg progress: one segment per mash still needed to pass (your own mashes count at once).
    const mineNow = ours && view.holderId === this.selfId
    const progress = Math.min(view.legTarget, view.legProgress + (mineNow ? this.pendingMashes : 0))
    const segs = Math.max(1, view.legTarget)
    const barKey = `${segs}:${progress}`
    if (barKey !== col.barKey) {
      col.barKey = barKey
      const gap = 2
      const h = this.barH()
      const segW = (col.barW - gap * (segs - 1)) / segs
      col.bar.clear()
      for (let i = 0; i < segs; i++) {
        col.bar.fillStyle(i < progress ? color : PALETTE.panelAlt, 1)
        col.bar.fillRect(
          Math.round(col.barX + i * (segW + gap)),
          col.barY,
          Math.max(1, Math.round(segW)),
          h,
        )
      }
    }
    col.barGlow
      .setVisible(mineNow)
      .setAlpha(mineNow ? 0.6 + 0.4 * Math.abs(Math.sin(time / 150)) : 0)

    // Relay chain: every member's avatar in pass order; the holder is bigger, framed and scared stiff
    // (hurt face), the next one outlined. Rebuilt only when the chain or its holder changes.
    const chainKey = `${view.holderId}|${view.members.join(',')}`
    if (chainKey === col.chainKey) return
    col.chainKey = chainKey
    const members = view.members.slice(0, MAX_CHAIN)
    const pip = this.big ? 32 : 16
    const step = pip + (this.big ? 14 : 10)
    const x0 = col.cx - ((members.length - 1) * step) / 2
    const holderIdx = view.members.indexOf(view.holderId)
    const nextIdx = members.length > 1 ? (holderIdx + 1) % view.members.length : -1
    col.chain.clear()
    col.chainIcons.forEach((icon, i) => icon.setVisible(i < members.length))
    members.forEach((id, i) => {
      const x = x0 + i * step
      const c = this.state.colorOf(id, PALETTE.dim)
      const isHolder = i === holderIdx
      const size = isHolder ? pip * 1.5 : pip
      col.chainIcons[i]
        ?.setTexture(
          ensureAvatarTexture(
            this,
            this.state.avatarOf(id),
            c,
            this.big ? 2 : 1,
            'front',
            isHolder ? 'hurt' : 'idle',
          ),
        )
        .setDisplaySize(size, size)
        .setPosition(Math.round(x), Math.round(col.chainY))
        .setAlpha(isHolder ? 1 : 0.8)
        .setVisible(true)
      if (isHolder) {
        col.chain.lineStyle(2, PALETTE.amber, 1)
        col.chain.strokeRect(x - size / 2 - 3, col.chainY - size / 2 - 3, size + 6, size + 6)
      } else if (i === nextIdx) {
        col.chain.lineStyle(2, PALETTE.text, 0.5)
        col.chain.strokeRect(x - size / 2 - 2, col.chainY - size / 2 - 2, size + 4, size + 4)
      }
      if (id === this.selfId) {
        col.chain.fillStyle(PALETTE.text, 1)
        col.chain.fillRect(Math.round(x - 2), Math.round(col.chainY + size / 2 + 5), 4, 4)
      }
    })
  }

  // The bomb in your own hands past its safe window: a warning beep as it turns, then the fuse hisses.
  private hiss(danger: boolean, time: number): void {
    if (danger && !this.hissing) this.sfx.urgent()
    if (danger && time - this.hissAt >= HISS_EVERY_MS) {
      this.hissAt = time
      this.sfx.fuse()
    }
    this.hissing = danger
  }

  // Fuse: a pixel cord curling up from the cap (shorter as it burns) with a flickering spark at its tip.
  private drawFuse(col: Column, frac: number, danger: boolean, time: number): void {
    const g = col.fuse
    const cell = Math.max(3, Math.round(col.bombSize / 22))
    const capX = col.bomb.x
    const capY = col.bomb.y - col.bomb.displayHeight / 2
    const len = col.bombSize * 0.7
    let tip = { x: capX, y: capY }
    const steps = Math.max(2, Math.round((len * frac) / cell))
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * frac
      const x = capX + Math.sin(t * 2.4) * len * 0.42
      const y = capY - t * len * 0.8
      g.fillStyle(0x4a3520, 1)
      g.fillRect(Math.round(x - cell / 2), Math.round(y - cell / 2) + 1, cell, cell)
      g.fillStyle(0xc9a36b, 1)
      g.fillRect(Math.round(x - cell / 2), Math.round(y - cell / 2), cell, cell - 1)
      tip = { x, y }
    }
    const flicker = Math.floor(time / (danger ? 50 : 90)) % 2
    const sparkKey = this.sparkKeys[flicker] ?? ''
    if (col.spark.texture.key !== sparkKey) col.spark.setTexture(sparkKey)
    col.spark
      .setPosition(Math.round(tip.x), Math.round(tip.y))
      .setScale(Math.max(3, Math.round(col.bombSize / 22)) * (danger ? 1.4 : 1))
  }

  // The one "what do I do now" line: MASH while you hold it, get ready if you're next, else wait.
  private updatePrompt(view: BombRelayTeamView | undefined): void {
    const prompt = this.prompt
    const sub = this.sub
    if (!prompt || !sub) return
    let mode: string
    if (!view) mode = 'spectator'
    else if (view.holderId === this.selfId) mode = 'mash'
    else {
      const idx = view.members.indexOf(view.holderId)
      const next = view.members[(idx + 1) % view.members.length]
      mode = next === this.selfId ? 'next' : 'wait'
    }
    if (mode === 'mash') {
      prompt.setAlpha(0.75 + 0.25 * Math.abs(Math.sin(this.time.now / 120)))
    } else {
      prompt.setAlpha(1)
    }
    if (mode === this.promptMode) return
    this.promptMode = mode
    const waiting = this.t('game.bombRelay.teammateHolds')
    const [text, color, detail] =
      mode === 'spectator'
        ? [this.t('game.bombRelay.spectator'), PALETTE.dim, '']
        : mode === 'mash'
          ? [this.t('game.bombRelay.mash'), PALETTE.amber, '']
          : mode === 'next'
            ? [this.t('game.bombRelay.getReady'), PALETTE.lime, waiting]
            : [this.t('game.bombRelay.waiting'), PALETTE.text, waiting]
    // The spectator line is a sentence, not a call to action: smaller so it stays on one or two lines.
    const compact = Math.min(this.scale.width, this.scale.height) < 520
    const size = mode === 'spectator' ? (compact ? 16 : 24) : compact ? 24 : 32
    prompt.setText(text).setColor(hexToCss(color)).setFontSize(size)
    sub.setText(detail)
    punch(this, prompt, 0.2, 100)
    if (mode === 'mash' && this.primed) this.sfx.go()
  }
}
