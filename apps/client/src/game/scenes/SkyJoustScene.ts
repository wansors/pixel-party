import {
  JOUST,
  JOUST_GROUND,
  JOUST_LEDGES,
  type JoustCmd,
  type JoustRider,
  type JoustWorld,
  joustClone,
  joustDx,
  joustGroundW,
  joustRun,
  joustSnap,
  PALETTE,
  type SkyJoustSnapshot,
} from '@pp/shared'
import Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { addBanner, burst, floatText, ring, shake, showBanner } from '../fx'
import { ServerClock } from '../netcode/ServerClock'
import {
  bodyStyle,
  ensureBevelPanel,
  ensurePixelGrid,
  fitFontSize,
  fitText,
  headlineStyle,
  shade,
} from '../pixelStyle'
import { YouMarker } from '../playerMarks'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const PENDING_TTL_MS = 2000
// Rivals ease toward their predicted spot by this share per frame (their newest flaps reach us late).
const RIVAL_EASE = 0.3
const SKY_TOP = 0x1a1440
const SKY_LOW = 0x8a3a5a
const STONE = 0x6a6478
const MOSS = 0x5a9a4a
const LAVA = 0xff6a1a
const FEATHER = 0xdde2ea
const WING_ROWS = ['__oo__', '_owwo_', 'owwwwo', 'owwwo_', '_ooo__']
// A lance pointing right: a wooden shaft, a steel tip, a pennant in the rider's colour (tinted).
const LANCE_ROWS = ['__pp__________', 'ssppsssssssmm_', '__pp_______mmm', 'ssppsssssssmm_']

interface Rider {
  id: string
  index: number
  mine: boolean
  avatar: AvatarSprite
  wing: Phaser.GameObjects.Image
  lance: Phaser.GameObjects.Image
  // Shown position (rivals ease into the prediction).
  x: number
  y: number
  placed: boolean
  sfxAt: number
}

interface PendingCmd extends JoustCmd {
  seq: number
  sentAt: number
}

// Sky Joust canvas (D51). A dusk sky over a lava pit: floating stone ledges with mossy tops, and two
// ground ledges along the bottom that crumble toward the walls as the round goes on. Every rider is
// their avatar in side view with a flapping wing and a lance (pennant in their colour). The world is
// run forward from the last judged state with every command known — yours on the frame you press, so
// your flight is exact; rivals ease into theirs (their newest flaps reach us a moment late). Jousts
// (who unhorsed whom), clashes and lava dips come from the server's judged state: feathers, sparks and
// splashes. Controls: ← → / A D steer, SPACE / ↑ / W (or a click) flap; on phones, on-screen buttons.
export class SkyJoustScene extends MiniGameScene<SkyJoustSnapshot> {
  private arena = { x: 0, y: 0, unit: 0 }
  private compact = false
  private readonly clock = new ServerClock()
  private base?: SkyJoustSnapshot
  private prevJudged?: JoustWorld
  private pending: PendingCmd[] = []
  private seq = 0
  private lastFlapAt = -1e9
  private lastTick = -1
  private started = false
  private phase: 'ready' | 'go' = 'ready'
  private riders: Rider[] = []
  private ground?: Phaser.GameObjects.Graphics
  private groundW = -1
  private lava?: Phaser.GameObjects.TileSprite
  private you?: YouMarker
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private shownScore = -1
  private held: number[] = []
  private steer = 0

  constructor(...deps: SceneDeps) {
    super('sky-joust', ...deps)
  }

  override create(): void {
    super.create()
    for (const r of this.riders) {
      r.avatar.destroy()
      r.wing.destroy()
      r.lance.destroy()
    }
    this.riders = []
    this.clock.reset()
    this.base = undefined
    this.prevJudged = undefined
    this.pending = []
    this.seq = 0
    this.lastFlapAt = -1e9
    this.lastTick = -1
    this.started = false
    this.phase = 'ready'
    this.groundW = -1
    this.shownScore = -1
    this.held = []
    this.steer = 0

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    const pad = this.compact ? 8 : 16
    const hintH = this.compact ? 20 : 26
    const portrait = height > width
    const btn = Math.round(this.compact ? Math.max(56, Math.min(76, width * 0.18)) : 72)
    const controlsH = portrait ? btn + pad * 2 : 0
    const top = this.top + pad
    const availH = height - top - hintH - pad - controlsH
    const unit = Math.floor(Math.min((width - pad * 2) / JOUST.w, availH))
    // Portrait: the sky at the top, the buttons down where the thumbs are.
    this.arena = {
      x: Math.round((width - unit * JOUST.w) / 2),
      y: portrait ? top : Math.round(top + (availH - unit) / 2),
      unit,
    }

    this.paintSky()
    this.paintLedges()
    this.ground = this.add.graphics().setDepth(6)
    this.you = new YouMarker(this, this.compact ? 8 : 12, 820)
    if (portrait) this.buildButtons(height - hintH - pad - btn / 2, btn)

    const hint = this.add
      .text(
        width / 2,
        height - hintH / 2,
        this.t(this.compact ? 'game.skyJoust.hintShort' : 'game.skyJoust.hint'),
        bodyStyle(this.compact ? 11 : 14, PALETTE.dim),
      )
      .setOrigin(0.5)
      .setDepth(60)
    fitText(hint, width - 16, this.compact ? 11 : 14)
    const midY = this.arena.y + unit * 0.42
    this.banner = addBanner(this)
    this.banner.setPosition(width / 2, midY)
    this.subline = this.add
      .text(
        width / 2,
        midY + (this.compact ? 32 : 44),
        '',
        headlineStyle(this.compact ? 8 : 16, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setDepth(950)
      .setVisible(false)

    for (const k of ['SPACE', 'UP', 'W']) this.onKey(k, () => this.command(true))
    const bind = (keys: string[], dir: number): void => {
      for (const k of keys) {
        this.input.keyboard?.on(`keydown-${k}`, () => this.hold(dir, true))
        this.input.keyboard?.on(`keyup-${k}`, () => this.hold(dir, false))
      }
    }
    bind(['LEFT', 'A'], -1)
    bind(['RIGHT', 'D'], 1)
    this.input.keyboard?.addKeys('LEFT,RIGHT,A,D,SPACE,UP,W')
    this.input.on(
      'pointerdown',
      (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (over.length === 0) this.command(true)
      },
    )
    const release = (): void => {
      this.held = []
      this.updateSteer()
    }
    this.game.events.on(Phaser.Core.Events.BLUR, release)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.game.events.off(Phaser.Core.Events.BLUR, release),
    )
  }

  private sx(x: number): number {
    return this.arena.x + x * this.arena.unit
  }

  private sy(y: number): number {
    return this.arena.y + y * this.arena.unit
  }

  // Dusk gradient, a few stars, far castle hills, and the lava pit along the bottom.
  private paintSky(): void {
    const { x, y, unit } = this.arena
    const w = unit * JOUST.w
    const g = this.add.graphics().setDepth(0)
    const bands = 14
    for (let i = 0; i < bands; i++) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(SKY_TOP),
        Phaser.Display.Color.ValueToColor(SKY_LOW),
        bands - 1,
        i,
      )
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1)
      g.fillRect(x, y + (unit * i) / bands, w, unit / bands + 1)
    }
    const px = Math.max(1, Math.round(unit / 200))
    g.fillStyle(0xffffff, 0.7)
    for (let i = 0; i < 40; i++)
      g.fillRect(x + ((i * 137) % Math.round(w)), y + ((i * 59) % Math.round(unit * 0.5)), px, px)
    // Far hills with a castle or two.
    g.fillStyle(shade(SKY_LOW, -0.45), 1)
    for (let gx = 0; gx < w; gx += 4 * px) {
      const h = unit * (0.1 + 0.05 * Math.abs(Math.sin(gx / (unit * 0.23))))
      g.fillRect(x + gx, y + unit * 0.9 - h, 4 * px, h)
    }
    for (const cx of [0.25, 1.2]) {
      const bx = x + cx * unit
      const by = y + unit * 0.78
      g.fillRect(bx, by - unit * 0.12, unit * 0.12, unit * 0.12)
      g.fillRect(bx - unit * 0.02, by - unit * 0.17, unit * 0.04, unit * 0.17)
      g.fillRect(bx + unit * 0.1, by - unit * 0.17, unit * 0.04, unit * 0.17)
    }
    const lavaTop = this.sy(JOUST_GROUND.y + 0.03)
    this.lava = this.add
      .tileSprite(x, lavaTop, w, y + unit - lavaTop, this.lavaTexture(px))
      .setOrigin(0, 0)
      .setDepth(5)
  }

  private lavaTexture(px: number): string {
    const key = `sj-lava-${px}`
    if (this.textures.exists(key)) return key
    const w = 48 * px
    const h = 24 * px
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(shade(LAVA, -0.35), 1).fillRect(0, 0, w, h)
    g.fillStyle(LAVA, 1).fillRect(0, 0, w, 6 * px)
    g.fillStyle(shade(LAVA, 0.4), 1)
    g.fillRect(4 * px, 2 * px, 8 * px, px)
    g.fillRect(28 * px, 3 * px, 10 * px, px)
    g.fillStyle(LAVA, 1)
    g.fillRect(10 * px, 12 * px, 4 * px, 2 * px)
    g.fillRect(34 * px, 16 * px, 3 * px, 2 * px)
    g.generateTexture(key, w, h)
    g.destroy()
    return key
  }

  // A ledge: a mossy top over a stone slab with a jagged underside.
  private drawLedge(g: Phaser.GameObjects.Graphics, lx: number, ly: number, lw: number): void {
    const { unit } = this.arena
    const x = this.sx(lx)
    const y = this.sy(ly)
    const w = lw * unit
    const h = Math.max(8, Math.round(unit * 0.035))
    const px = Math.max(2, Math.round(unit / 160))
    g.fillStyle(shade(STONE, -0.4), 1).fillRect(x, y, w, h + px)
    g.fillStyle(STONE, 1).fillRect(x + px, y, w - 2 * px, h)
    g.fillStyle(shade(STONE, -0.2), 1)
    for (let bx = x + 4 * px; bx < x + w - 2 * px; bx += 9 * px)
      g.fillRect(bx, y + h / 2, px, h / 2)
    for (let bx = x + 2 * px; bx < x + w - 4 * px; bx += 6 * px)
      g.fillRect(bx, y + h, 3 * px, px * (2 + ((bx / px) % 3)))
    g.fillStyle(MOSS, 1).fillRect(x, y - px, w, 2 * px)
    g.fillStyle(shade(MOSS, 0.3), 1).fillRect(x + px, y - px, w - 2 * px, px)
  }

  private paintLedges(): void {
    const g = this.add.graphics().setDepth(6)
    for (const l of JOUST_LEDGES) {
      // A ledge across the wrap seam draws on both sides.
      this.drawLedge(g, l.x, l.y, Math.min(l.w, JOUST.w - l.x))
      if (l.x + l.w > JOUST.w) this.drawLedge(g, 0, l.y, l.x + l.w - JOUST.w)
    }
  }

  // The two ground ledges, redrawn as they crumble.
  private drawGround(t: number): void {
    const g = this.ground
    if (!g) return
    const w = Math.round(joustGroundW(t) * this.arena.unit)
    if (w === this.groundW) return
    this.groundW = w
    g.clear()
    const lw = w / this.arena.unit
    this.drawLedge(g, 0, JOUST_GROUND.y, lw)
    this.drawLedge(g, JOUST.w - lw, JOUST_GROUND.y, lw)
  }

  private buildButtons(cy: number, btn: number): void {
    const { width } = this.scale
    const key = ensureBevelPanel(this, btn, btn, PALETTE.panelAlt, 4, true)
    const flapKey = ensureBevelPanel(this, btn * 1.8, btn, PALETTE.amber, 4, true)
    const size = this.compact ? 16 : 24
    const mk = (x: number, label: string, tex: string, color: number) => {
      const img = this.add.image(x, cy, tex).setDepth(50).setInteractive({ useHandCursor: true })
      this.add.text(x, cy, label, headlineStyle(size, color)).setOrigin(0.5).setDepth(51)
      return img
    }
    const gap = 10
    const left = mk(gap + btn / 2, '◀', key, PALETTE.text)
    const right = mk(gap * 2 + btn * 1.5, '▶', key, PALETTE.text)
    const flap = mk(width - gap - btn * 0.9, this.t('game.skyJoust.flap'), flapKey, PALETTE.bg)
    for (const [img, dir] of [
      [left, -1],
      [right, 1],
    ] as const) {
      img.on('pointerdown', () => this.hold(dir, true))
      img.on('pointerup', () => this.hold(dir, false))
      img.on('pointerout', () => this.hold(dir, false))
    }
    flap.on('pointerdown', () => this.command(true))
  }

  private hold(dir: number, down: boolean): void {
    this.held = this.held.filter((d) => d !== dir)
    if (down) this.held.push(dir)
    this.updateSteer()
  }

  private updateSteer(): void {
    const steer = this.held.at(-1) ?? 0
    if (steer === this.steer) return
    this.steer = steer
    this.command(false)
  }

  // Round ms at scene time `now`, on the server's clock (frozen once the round is over).
  private roundNow(now: number): number {
    const base = this.base
    if (!base) return 0
    const elapsed = this.state.final ? 0 : this.clock.since(base.remainingMs, now)
    return base.t + elapsed
  }

  // A flap (and the current steer) goes out with the moment it was pressed.
  private command(flap: boolean): void {
    const base = this.base
    if (!base?.ids.includes(this.selfId) || this.state.final) return
    const now = this.time.now
    const rt = this.roundNow(now)
    if (rt < JOUST.startDelayMs) return
    const at = joustSnap(rt)
    const doFlap = flap && at - this.lastFlapAt >= JOUST.minFlapGapMs
    if (flap && !doFlap) return
    if (doFlap) {
      this.lastFlapAt = at
      this.sfx.quiet(() => this.sfx.jump(), 0.5)
    }
    const seq = ++this.seq
    const cmd: JoustCmd = { at, steer: this.steer, ...(doFlap ? { flap: true } : {}) }
    this.pending.push({ ...cmd, seq, sentAt: now })
    this.sendInput({ kind: 'fly', ...cmd, seq })
  }

  // Everyone's known commands, yours with the ones the server hasn't taken yet.
  private allCmds(base: SkyJoustSnapshot): JoustCmd[][] {
    const me = base.ids.indexOf(this.selfId)
    const ack = base.acks[this.selfId] ?? 0
    const mine: JoustCmd[] = this.pending
      .filter((p) => p.seq > ack)
      .map(({ at, flap, steer }) => ({ at, ...(flap ? { flap } : {}), steer }))
    if (me < 0 || mine.length === 0) return base.cmds
    return base.cmds.map((list, i) =>
      i === me ? [...list, ...mine].sort((a, b) => a.at - b.at) : list,
    )
  }

  protected frame(snap: SkyJoustSnapshot | null, time: number): void {
    if (!snap) return
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.onSnapshot(snap)
    }
    this.render(this.time.now, time)
  }

  private buildRiders(snap: SkyJoustSnapshot): void {
    const size = avatarPx(Math.max(16, JOUST.radius * 2 * this.arena.unit * 1.2))
    const wingKey = ensurePixelGrid(this, {
      key: 'sj-wing',
      rows: WING_ROWS,
      legend: { o: shade(PALETTE.text, -0.5), w: PALETTE.text },
    })
    snap.ids.forEach((id, index) => {
      const mine = id === this.selfId
      const color = this.state.colorOf(id, PALETTE.lime)
      const avatar = new AvatarSprite(this, this.state.avatarOf(id), color, size, 'side')
      avatar.image.setDepth(mine ? 31 : 21)
      const lanceKey = ensurePixelGrid(this, {
        key: `sj-lance-${color.toString(16)}`,
        rows: LANCE_ROWS,
        legend: { s: 0x9a6a3a, m: 0xd8dce6, p: color },
        pixelSize: 1,
      })
      const lance = this.add
        .image(0, 0, lanceKey)
        .setDisplaySize(size * 0.95, Math.max(3, size * 0.2))
        .setDepth(mine ? 32 : 22)
      const wing = this.add
        .image(0, 0, wingKey)
        .setDisplaySize(size * 0.5, size * 0.42)
        .setDepth(mine ? 32 : 22)
      this.riders.push({
        id,
        index,
        mine,
        avatar,
        wing,
        lance,
        x: 0,
        y: 0,
        placed: false,
        sfxAt: -1e9,
      })
    })
    this.warmAvatars(snap.ids, [
      ['side', 'idle', 0],
      ['side', 'happy', 0],
      ['side', 'ko', 0],
    ])
  }

  private onSnapshot(snap: SkyJoustSnapshot): void {
    if (this.riders.length === 0) this.buildRiders(snap)
    this.clock.sync(snap.remainingMs, this.time.now)
    const first = !this.started
    this.started = true
    this.base = snap
    const ack = snap.acks[this.selfId]
    if (ack !== undefined) {
      const now = this.time.now
      this.pending = this.pending.filter((p) => p.seq > ack && now - p.sentAt < PENDING_TTL_MS)
      if (first) this.seq = Math.max(this.seq, ack)
    }
    if (!first) this.moments(snap.world)
    this.prevJudged = snap.world
  }

  private render(now: number, time: number): void {
    const base = this.base
    if (!base) return
    const rt = this.roundNow(now)
    this.updatePhase(rt)
    const w = joustClone(base.world)
    // Carried forward without rider-on-rider hits: those come from the server's judged state.
    joustRun(w, Math.max(joustSnap(Math.max(0, rt)), w.t), this.allCmds(base), false)
    this.drawGround(w.t)
    if (this.lava) this.lava.tilePositionX = time * 0.02
    for (const view of this.riders) {
      const r = w.riders[view.index]
      if (r) this.place(view, r, w.t, time)
    }
  }

  private place(view: Rider, r: JoustRider, t: number, time: number): void {
    if (!view.placed || view.mine) {
      view.x = r.x
      view.y = r.y
      view.placed = true
    } else {
      const dx = joustDx(view.x, r.x)
      const dy = r.y - view.y
      // Far off (back on a ledge, across the wrap): jump there; otherwise glide in.
      if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) {
        view.x = r.x
        view.y = r.y
      } else {
        view.x = (((view.x + dx * RIVAL_EASE) % JOUST.w) + JOUST.w) % JOUST.w
        view.y += dy * RIVAL_EASE
      }
    }
    const down = r.downUntil > t
    const x = this.sx(view.x)
    const y = this.sy(Math.min(view.y, 1))
    const img = view.avatar.image
    const size = img.displayWidth
    view.avatar
      .setPose('side')
      .face(r.face)
      .setExpression(down ? 'ko' : 'idle')
    let alpha = 1
    if (r.safeUntil > t && Math.floor(time / 90) % 2) alpha = 0.35
    // Tumbling out of the bottom of the sky: gone until they're back on a ledge.
    if (view.y - JOUST.radius > 1) alpha = 0
    img
      .setPosition(x, y)
      .setAngle(down ? (time / 3) % 360 : 0)
      .setAlpha(alpha)
    view.avatar.tick(time)
    const flapping = t - r.flapAt < 140 || (!r.ground && !down && Math.floor(time / 160) % 2 === 0)
    view.wing
      .setPosition(x - r.face * size * 0.18, y - size * 0.12)
      .setFlipX(r.face < 0)
      .setFlipY(flapping)
      .setVisible(!down)
      .setAlpha(alpha)
    view.lance
      .setPosition(x + r.face * size * 0.42, y + size * 0.08)
      .setFlipX(r.face < 0)
      .setVisible(!down)
      .setAlpha(alpha)
    if (view.mine) {
      if (!down) this.you?.place(x, y - size / 2 - 4, time)
      else this.you?.hide()
      if (r.score !== this.shownScore) {
        this.shownScore = r.score
        this.hud?.setScore(this.t('game.skyJoust.score', { n: r.score }))
      }
    }
  }

  // Jousts, clashes and lava dips, from the server's judged world (compared with the last one).
  private moments(world: JoustWorld): void {
    const prev = this.prevJudged
    if (!prev) return
    const now = this.time.now
    const size = this.compact ? 10 : 14
    for (const view of this.riders) {
      const r = world.riders[view.index]
      const p = prev.riders[view.index]
      if (!r || !p) continue
      const x = this.sx(view.x)
      const y = this.sy(Math.min(view.y, 1))
      const loud = view.mine
      const rivalSfx = !loud && now - view.sfxAt > 180
      if (rivalSfx && (r.wins > p.wins || r.losses > p.losses || r.lava > p.lava)) view.sfxAt = now
      if (r.wins > p.wins) {
        if (loud) {
          this.sfx.coin()
          floatText(this, x, y - this.arena.unit * 0.06, '+1', PALETTE.lime, size + 4)
          view.avatar.setExpression('happy')
        } else if (rivalSfx) this.sfx.quiet(() => this.sfx.hit(0.6), 0.3)
      }
      if (r.losses > p.losses) {
        burst(this, x, y, FEATHER, loud ? 14 : 8, 180)
        if (loud) {
          this.sfx.hurt()
          shake(this, 0.008, 160)
          floatText(
            this,
            x,
            y - this.arena.unit * 0.06,
            this.quip('game.skyJoust.unhorsed', `${this.selfId}:${r.losses}`),
            PALETTE.red,
            size,
          )
        }
      }
      if (r.lava > p.lava) {
        burst(this, x, this.sy(0.97), LAVA, loud ? 14 : 8, 200)
        if (loud) {
          this.sfx.splash()
          floatText(this, x, this.sy(0.85), `-${JOUST.lavaCost}`, PALETTE.red, size + 4)
        } else if (rivalSfx) this.sfx.quiet(() => this.sfx.splash(), 0.3)
      }
      if (r.clashes > p.clashes && (loud || rivalSfx)) {
        ring(this, x, y, PALETTE.amber, this.arena.unit * 0.05)
        if (loud) this.sfx.hit(0.8)
      }
    }
  }

  // GET READY until GO.
  private updatePhase(rt: number): void {
    if (this.phase !== 'ready') return
    const banner = this.banner
    if (rt < JOUST.startDelayMs && !this.state.final) {
      if (banner && !banner.visible) {
        const text = this.t('game.skyJoust.ready')
        banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
        showBanner(this, banner, text, PALETTE.amber)
        this.subline?.setText(this.t('game.skyJoust.readySub')).setVisible(true)
        if (this.subline) fitText(this.subline, this.scale.width * 0.9, this.compact ? 8 : 16)
      }
      return
    }
    this.phase = 'go'
    banner?.setVisible(false)
    this.subline?.setVisible(false)
    if (rt < JOUST.startDelayMs + 300) this.sfx.go()
  }
}
