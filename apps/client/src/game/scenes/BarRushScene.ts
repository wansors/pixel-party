import {
  AVATARS,
  BAR,
  BAR_DRINK,
  BAR_SLIDE,
  type BarBoardView,
  type BarBody,
  type BarCmd,
  type BarRushSnapshot,
  barClone,
  barRun,
  barSnap,
  PALETTE,
} from '@pp/shared'
import type Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { addBanner, burst, flash, floatText, showBanner } from '../fx'
import { ServerClock } from '../netcode/ServerClock'
import {
  bodyStyle,
  ensurePixelGrid,
  fitFontSize,
  fitText,
  headlineStyle,
  shade,
} from '../pixelStyle'
import { YouMarker } from '../playerMarks'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const PENDING_TTL_MS = 2000
const WALL = 0x3a2418
const WOOD = 0x8a5226
const WOOD_LIT = 0xb4743a
const BRASS = 0xd8a63a
// Customers wear muted colours, so they never pass for a player.
const CROWD_COLORS = [0x9a8f7a, 0x7a8a9a, 0x8a7a9a, 0x7a9a86]
const MUG_ROWS = [
  '_wwwww___',
  'wwwwwwk__',
  'kaaaaakkk',
  'kaaaaak_k',
  'kaaaaak_k',
  'kaaaaakkk',
  'kaaaaak__',
  '_kkkkk___',
]

interface PendingCmd extends BarCmd {
  seq: number
  sentAt: number
}

// Bar Rush canvas (D52). Your bar, side on: four wooden counters stacked down the room, a swinging door
// at the left end of each and a brass tap at the right, where you stand (your avatar, facing the
// room). Customers (the avatar set in muted colours) walk in from the doors; drinks slide down to them
// and empties slide back. The bar is predicted with the shared rules from the last judged state and
// the commands you've sent, so a serve leaves the tap on the frame you press it. Serves pop, caught
// empties chime, smashed glass flies in shards and an angry customer flashes red. Rivals' scores run
// along a strip at the bottom. Controls: ↑ ↓ / W S change bar, SPACE / ← / A serve; or tap a bar (tap
// the one you're on to serve).
export class BarRushScene extends MiniGameScene<BarRushSnapshot> {
  private bar = { x: 0, y: 0, w: 0, laneH: 0 }
  private compact = false
  private readonly clock = new ServerClock()
  private base?: BarRushSnapshot
  private pending: PendingCmd[] = []
  private seq = 0
  private lastTick = -1
  private started = false
  private phase: 'ready' | 'go' = 'ready'
  private crowd = new Map<number, AvatarSprite>()
  private glassImgs: Phaser.GameObjects.Image[] = []
  private keeper?: AvatarSprite
  private you?: YouMarker
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private prev?: BarBody
  private shownScore = -1
  // The bar you're shown at (eases to the real one) and the one your commands last moved you to.
  private shownLane = 0
  private lane = 0
  private moodUntil = 0

  constructor(...deps: SceneDeps) {
    super('bar-rush', ...deps)
  }

  override create(): void {
    super.create()
    for (const a of this.crowd.values()) a.destroy()
    this.crowd = new Map()
    this.glassImgs = []
    this.clock.reset()
    this.base = undefined
    this.pending = []
    this.seq = 0
    this.lastTick = -1
    this.started = false
    this.phase = 'ready'
    this.prev = undefined
    this.shownScore = -1
    this.shownLane = 0
    this.lane = 0
    this.moodUntil = 0

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    const pad = this.compact ? 8 : 16
    const hintH = this.compact ? 20 : 26
    const stripSize = this.compact ? 11 : 13
    const stripH = PlayerStrip.rowH(stripSize) * (height > width ? 3 : 2) + pad
    const top = this.top + pad
    const availH = height - top - hintH - pad - stripH
    const w = Math.round(Math.min(width - pad * 2, availH * 1.9))
    // Never taller than a narrow (portrait) bar can carry.
    const laneH = Math.floor(Math.min(availH / BAR.lanes, w * 0.3))
    this.bar = { x: Math.round((width - w) / 2), y: top, w, laneH }

    this.paintRoom()
    this.keeper = new AvatarSprite(
      this,
      this.state.avatarOf(this.selfId),
      this.state.colorOf(this.selfId, PALETTE.lime),
      avatarPx(laneH * 0.52),
      'side',
    )
    this.keeper.image.setDepth(11)
    this.keeper.face(-1)
    this.you = new YouMarker(this, this.compact ? 8 : 12, 820)
    this.strip = new PlayerStrip(
      this,
      width / 2,
      top + laneH * BAR.lanes + pad + PlayerStrip.rowH(stripSize) / 2,
      width - pad * 2,
      stripSize,
      3,
    )

    const hint = this.add
      .text(
        width / 2,
        height - hintH / 2,
        this.t(this.compact ? 'game.barRush.hintShort' : 'game.barRush.hint'),
        bodyStyle(this.compact ? 11 : 14, PALETTE.dim),
      )
      .setOrigin(0.5)
      .setDepth(60)
    fitText(hint, width - 16, this.compact ? 11 : 14)
    const midY = top + laneH * 2
    this.banner = addBanner(this)
    this.banner.setPosition(width / 2, midY - (this.compact ? 14 : 20))
    this.subline = this.add
      .text(
        width / 2,
        midY + (this.compact ? 18 : 26),
        '',
        headlineStyle(this.compact ? 8 : 16, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setDepth(950)
      .setVisible(false)

    for (const k of ['UP', 'W'])
      this.onKey(k, () => this.command(Math.max(0, this.lane - 1), false))
    for (const k of ['DOWN', 'S'])
      this.onKey(k, () => this.command(Math.min(BAR.lanes - 1, this.lane + 1), false))
    for (const k of ['SPACE', 'LEFT', 'A', 'ENTER']) this.onKey(k, () => this.command(null, true))
    this.input.keyboard?.addKeys('UP,DOWN,LEFT,W,S,A,SPACE,ENTER')
    // Tap a bar: go there — or, on the bar you're at, serve.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const lane = Math.floor((p.y - this.bar.y) / this.bar.laneH)
      if (lane < 0 || lane >= BAR.lanes) return
      if (lane === this.lane) this.command(null, true)
      else this.command(lane, false)
    })
  }

  private gx(x: number): number {
    return this.bar.x + this.bar.w * (0.08 + x * 0.82)
  }

  private counterY(lane: number): number {
    return this.bar.y + this.bar.laneH * (lane + 0.68)
  }

  // The room: panelled back wall with shelves of bottles, and for each bar a counter, a door, a tap.
  private paintRoom(): void {
    const { x, y, w, laneH } = this.bar
    const g = this.add.graphics().setDepth(0)
    const px = Math.max(2, Math.round(laneH / 40))
    g.fillStyle(WALL, 1).fillRect(x, y, w, laneH * BAR.lanes)
    for (let lane = 0; lane < BAR.lanes; lane++) {
      const top = y + lane * laneH
      // Wall panels and a shelf of bottles behind each bar.
      g.fillStyle(shade(WALL, 0.12), 1)
      for (let px0 = x + w * 0.1; px0 < x + w * 0.9; px0 += w * 0.12)
        g.fillRect(px0, top + laneH * 0.06, w * 0.1, laneH * 0.3)
      g.fillStyle(shade(WOOD, -0.3), 1).fillRect(x + w * 0.12, top + laneH * 0.3, w * 0.76, px * 2)
      for (let i = 0; i < 14; i++) {
        const bx = x + w * (0.14 + i * 0.053)
        const colors = [0x3caa5a, 0xb04a3a, 0xd8b04a, 0x4a7ab0]
        g.fillStyle(colors[(i + lane) % 4] as number, 0.85)
        g.fillRect(bx, top + laneH * 0.3 - px * 7, px * 3, px * 7)
        g.fillRect(bx + px, top + laneH * 0.3 - px * 9, px, px * 2)
      }
    }
    const fg = this.add.graphics().setDepth(12)
    for (let lane = 0; lane < BAR.lanes; lane++) {
      const cy = this.counterY(lane)
      const left = this.gx(0) - w * 0.02
      const right = this.gx(BAR.tapX) + w * 0.03
      // The counter: a lit top edge over the wood front.
      fg.fillStyle(shade(WOOD, -0.45), 1).fillRect(left, cy, right - left, laneH * 0.3)
      fg.fillStyle(WOOD, 1).fillRect(left, cy + px, right - left, laneH * 0.28)
      fg.fillStyle(WOOD_LIT, 1).fillRect(left, cy, right - left, px * 2)
      fg.fillStyle(shade(WOOD, -0.25), 1)
      for (let bx = left + w * 0.06; bx < right; bx += w * 0.08)
        fg.fillRect(bx, cy + laneH * 0.06, px, laneH * 0.2)
      // The swinging door at the room's end.
      const dx = x + w * 0.015
      const dy = y + lane * laneH + laneH * 0.22
      fg.fillStyle(shade(WOOD, -0.5), 1).fillRect(dx, dy, w * 0.05, laneH * 0.6)
      fg.fillStyle(WOOD_LIT, 1).fillRect(dx + px, dy + laneH * 0.12, w * 0.05 - 2 * px, laneH * 0.3)
      // The tap at your end.
      const tx = this.gx(BAR.tapX) + w * 0.035
      fg.fillStyle(BRASS, 1).fillRect(tx, cy - laneH * 0.32, px * 3, laneH * 0.32)
      fg.fillStyle(shade(BRASS, 0.3), 1).fillRect(tx - px * 3, cy - laneH * 0.32, px * 7, px * 3)
    }
  }

  private mugKey(full: boolean): string {
    return ensurePixelGrid(this, {
      key: full ? 'br-mug-full' : 'br-mug-empty',
      rows: full ? MUG_ROWS : MUG_ROWS.map((r) => r.replace(/w/g, '_')),
      legend: { w: 0xfff6e0, a: full ? 0xffb02e : 0x9fd0e8, k: full ? 0x7a4a1a : 0x5a7a8a },
      pixelSize: 1,
    })
  }

  private glassImg(i: number): Phaser.GameObjects.Image {
    let img = this.glassImgs[i]
    if (!img) {
      const h = Math.round(this.bar.laneH * 0.26)
      img = this.add
        .image(0, 0, this.mugKey(true))
        .setDisplaySize(Math.round((h * 9) / 8), h)
        .setOrigin(0.5, 1)
        .setDepth(14)
      this.glassImgs[i] = img
    }
    return img
  }

  // Round ms at scene time `now`, on the server's clock (frozen once the round is over).
  private roundNow(now: number): number {
    const base = this.base
    if (!base) return 0
    const elapsed = this.state.final ? 0 : this.clock.since(base.remainingMs, now)
    return base.t + elapsed
  }

  private myCmds(view: BarBoardView): BarCmd[] {
    const mine = this.pending
      .filter((p) => p.seq > view.ack)
      .map(({ at, lane, serve }) => ({
        at,
        ...(lane !== undefined ? { lane } : {}),
        ...(serve ? { serve } : {}),
      }))
    return mine.length ? [...view.cmds, ...mine].sort((a, b) => a.at - b.at) : view.cmds
  }

  // Move to bar `lane` (null = stay) and/or serve, with the moment it was pressed.
  private command(lane: number | null, serve: boolean): void {
    const base = this.base
    if (!base?.boards[this.selfId] || this.state.final) return
    const now = this.time.now
    const rt = this.roundNow(now)
    if (rt < BAR.startDelayMs) return
    const at = barSnap(rt)
    if (lane !== null) this.lane = lane
    const cmd: BarCmd = { at, ...(lane !== null ? { lane } : {}), ...(serve ? { serve } : {}) }
    const seq = ++this.seq
    this.pending.push({ ...cmd, seq, sentAt: now })
    this.sendInput({ kind: 'bar', ...cmd, seq })
  }

  protected frame(snap: BarRushSnapshot | null, time: number): void {
    if (!snap) return
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.onSnapshot(snap)
    }
    this.render(this.time.now, time)
  }

  private onSnapshot(snap: BarRushSnapshot): void {
    if (!this.started) {
      this.warmAvatars(
        [this.selfId],
        [
          ['side', 'idle', 0],
          ['side', 'happy', 0],
          ['side', 'hurt', 0],
        ],
      )
    }
    this.clock.sync(snap.remainingMs, this.time.now)
    const first = !this.started
    this.started = true
    this.base = snap
    const me = snap.boards[this.selfId]
    if (me) {
      const now = this.time.now
      this.pending = this.pending.filter((p) => p.seq > me.ack && now - p.sentAt < PENDING_TTL_MS)
      if (first) {
        this.seq = Math.max(this.seq, me.ack)
        this.lane = me.body.lane
        this.shownLane = me.body.lane
      }
    }
    this.strip?.set(
      Object.keys(snap.boards)
        .sort((a, b) => (snap.progress[b] ?? 0) - (snap.progress[a] ?? 0))
        .map((id) => ({
          text: `${this.label(id)} ${snap.progress[id] ?? 0}`,
          color: this.state.colorOf(id, PALETTE.lime),
          avatar: this.state.avatarOf(id),
        })),
    )
  }

  private render(now: number, time: number): void {
    const base = this.base
    if (!base) return
    const rt = this.roundNow(now)
    this.updatePhase(rt)
    const view = base.boards[this.selfId]
    if (!view) return
    const b = barClone(view.body)
    barRun(b, Math.max(barSnap(Math.max(0, rt)), b.t), this.myCmds(view), base.arrivals)
    this.drawCrowd(b, base, time)
    this.drawGlasses(b)
    this.lane = b.lane
    this.drawKeeper(b, now, time)
    this.moments(b, now)
    this.prev = b
  }

  private drawCrowd(b: BarBody, base: BarRushSnapshot, time: number): void {
    const size = avatarPx(this.bar.laneH * 0.48)
    const seen = new Set<number>()
    for (const c of b.customers) {
      seen.add(c.id)
      let a = this.crowd.get(c.id)
      if (!a) {
        const look = base.arrivals[c.id]?.look ?? 0
        a = new AvatarSprite(
          this,
          AVATARS[look % AVATARS.length] as (typeof AVATARS)[number],
          CROWD_COLORS[Math.floor(look / AVATARS.length) % CROWD_COLORS.length] as number,
          size,
          'side',
        )
        a.image.setDepth(10).setOrigin(0.5, 1)
        this.crowd.set(c.id, a)
      }
      const sliding = c.state === BAR_SLIDE
      const drinking = c.state === BAR_DRINK
      a.setPose('side')
        .face(1)
        .walk(!sliding && !drinking, time, 170)
        .setExpression(drinking ? 'happy' : sliding ? 'hurt' : 'idle')
      // Close to your end, they look cross.
      if (!sliding && !drinking && c.x > BAR.angryX - 0.18) a.setExpression('hurt')
      a.image.setPosition(this.gx(c.x), this.counterY(c.lane) + this.bar.laneH * 0.04)
      a.tick(time)
    }
    for (const [id, a] of this.crowd) {
      if (seen.has(id)) continue
      a.destroy()
      this.crowd.delete(id)
    }
  }

  private drawGlasses(b: BarBody): void {
    b.glasses.forEach((g, i) => {
      const img = this.glassImg(i)
      const key = this.mugKey(g.full)
      if (img.texture.key !== key) img.setTexture(key)
      img
        .setPosition(this.gx(g.x), this.counterY(g.lane) + 1)
        .setFlipX(!g.full)
        .setVisible(true)
    })
    for (let i = b.glasses.length; i < this.glassImgs.length; i++)
      this.glassImgs[i]?.setVisible(false)
  }

  private drawKeeper(b: BarBody, now: number, time: number): void {
    const k = this.keeper
    if (!k) return
    this.shownLane += (b.lane - this.shownLane) * 0.45
    if (Math.abs(b.lane - this.shownLane) < 0.02) this.shownLane = b.lane
    const x = this.gx(BAR.tapX) + this.bar.w * 0.065
    const y = this.bar.y + this.bar.laneH * (this.shownLane + 0.55)
    const pouring = b.t - b.servedAt < 150
    k.setPose('side').face(-1)
    if (now > this.moodUntil) k.setExpression('idle')
    k.image.setPosition(x - (pouring ? 3 : 0), y)
    k.tick(time)
    this.you?.place(x, y - k.image.displayHeight / 2 - 2, time)
    if (b.score !== this.shownScore) {
      this.shownScore = b.score
      this.hud?.setScore(this.t('game.barRush.score', { n: b.score }))
    }
  }

  // What changed since the last frame: serves, catches, smashes, angry customers.
  private moments(b: BarBody, now: number): void {
    const prev = this.prev
    if (!prev) return
    const size = this.compact ? 12 : 16
    const keeperX = this.gx(BAR.tapX)
    if (b.servedAt > prev.servedAt) this.sfx.quiet(() => this.sfx.whoosh(), 0.35)
    if (b.served > prev.served) {
      this.sfx.pop()
      // At the customer who just caught it.
      const c = b.customers.find(
        (x) =>
          x.state === BAR_SLIDE &&
          !prev.customers.some((p) => p.id === x.id && p.state === BAR_SLIDE),
      )
      if (c)
        floatText(
          this,
          this.gx(c.x),
          this.counterY(c.lane) - this.bar.laneH * 0.5,
          '+1',
          PALETTE.lime,
          size,
        )
    }
    if (b.caught > prev.caught) {
      this.sfx.coin()
      floatText(
        this,
        keeperX,
        this.counterY(b.lane) - this.bar.laneH * 0.4,
        '+1',
        PALETTE.lime,
        size,
      )
      this.keeper?.setExpression('happy')
      this.moodUntil = now + 500
    }
    if (b.smashed > prev.smashed) {
      this.sfx.shatter()
      // Where it smashed: a glass that was there last frame and isn't now, at either end.
      const gone = prev.glasses.find(
        (g) =>
          (g.full ? g.x < 0.05 : g.x > BAR.tapX - 0.05) &&
          !b.glasses.some(
            (n) => n.lane === g.lane && n.full === g.full && Math.abs(n.x - g.x) < 0.05,
          ),
      )
      const lane = gone?.lane ?? b.lane
      const x = this.gx(gone?.full ? 0 : BAR.tapX)
      burst(this, x, this.counterY(lane), 0xbfe6ff, 12, 200)
      floatText(
        this,
        x,
        this.counterY(lane) - this.bar.laneH * 0.4,
        `${BAR.points.smash}`,
        PALETTE.red,
        size,
      )
    }
    if (b.angry > prev.angry) {
      this.sfx.wrong()
      flash(this, PALETTE.red, 140)
      floatText(
        this,
        keeperX - this.bar.w * 0.1,
        this.counterY(b.lane) - this.bar.laneH * 0.5,
        this.quip('game.barRush.angry', `${this.selfId}:${b.angry}`),
        PALETTE.red,
        this.compact ? 10 : 14,
      )
      this.keeper?.setExpression('hurt')
      this.moodUntil = now + 700
    }
  }

  // GET READY until GO.
  private updatePhase(rt: number): void {
    if (this.phase !== 'ready') return
    const banner = this.banner
    if (rt < BAR.startDelayMs && !this.state.final) {
      if (banner && !banner.visible) {
        const text = this.t('game.barRush.ready')
        banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
        showBanner(this, banner, text, PALETTE.amber)
        this.subline?.setText(this.t('game.barRush.readySub')).setVisible(true)
        if (this.subline) fitText(this.subline, this.scale.width * 0.9, this.compact ? 8 : 16)
      }
      return
    }
    this.phase = 'go'
    banner?.setVisible(false)
    this.subline?.setVisible(false)
    if (rt < BAR.startDelayMs + 300) this.sfx.go()
  }
}
