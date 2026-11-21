import {
  BRICK,
  BRICK_WIDE,
  type BrickAim,
  type BrickBoardView,
  type BrickBody,
  type BrickBusterSnapshot,
  brickClone,
  brickHalfW,
  brickRun,
  brickSnap,
  PALETTE,
} from '@pp/shared'
import Phaser from 'phaser'
import { AvatarSprite, avatarPx, ensureAvatarTexture } from '../avatars'
import { addBanner, burst, flash, floatText, punch, showBanner } from '../fx'
import { ServerClock } from '../netcode/ServerClock'
import {
  bodyStyle,
  ensureBevelPanel,
  ensurePixelOrb,
  fitFontSize,
  fitText,
  headlineStyle,
  shade,
} from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const PENDING_TTL_MS = 2000
// Paddle aims go out at most this often, and only when they moved this much.
const AIM_EVERY_MS = 35
const AIM_STEP = 0.004
const ROW_COLORS = [0xff5252, 0xff7b3d, 0xffcf4b, 0x8be94b, 0x29d3f2, 0x5b8cff, 0xb06bff]
const HARD = 0xc4cad8
const BOARD_BG = 0x141a33
const CAP_COLORS = [PALETTE.cyan, PALETTE.magenta]
const CAP_GLYPH = ['W', 'M']

interface PendingAim extends BrickAim {
  seq: number
  sentAt: number
}

interface Mini {
  id: string
  x: number
  y: number
  w: number
  bricks: Phaser.GameObjects.Graphics
  label: Phaser.GameObjects.Text
  shownBricks: string
  shownScore: number
}

// Brick Buster canvas (D49). Your board fills the middle: a framed well with the wall at the top, your
// paddle in your colour at the bottom with your avatar riding under it. Everything on it is predicted
// with the shared board rules from the last judged state and the aims you've sent, so the paddle answers
// the mouse / finger / keys on the frame and the ball bounces exactly where the server will judge it.
// Rivals play the same walls on mini boards down the sides (bricks, balls and paddle, carried forward
// on their own aims) — on a phone, a strip of scores instead. Bricks burst in their colour, capsules
// (W = WIDE, M = MULTI) tumble down, a lost ball flashes red, a cleared wall gets a banner.
// Controls: mouse / drag anywhere, or ← → / A D.
export class BrickBusterScene extends MiniGameScene<BrickBusterSnapshot> {
  private board = { x: 0, y: 0, unit: 0 }
  private side = 0
  private compact = false
  private readonly clock = new ServerClock()
  private base?: BrickBusterSnapshot
  private pending: PendingAim[] = []
  private seq = 0
  private lastTick = -1
  private started = false
  private phase: 'ready' | 'go' = 'ready'
  private brickImgs: Phaser.GameObjects.Image[] = []
  private brickKeys: string[] = []
  private hardKey = ''
  private ballImgs: Phaser.GameObjects.Image[] = []
  private capImgs: { img: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text }[] = []
  private paddle?: Phaser.GameObjects.Image
  private paddleKeys: [string, string] = ['', '']
  private rider?: AvatarSprite
  private minis: Mini[] = []
  private miniDyn?: Phaser.GameObjects.Graphics
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private bannerUntil = 0
  // What the frame before showed (to turn changes into sounds and bursts).
  private prev?: BrickBody
  private shownBricks = ''
  private shownScore = -1
  // Where the player wants the paddle (0..1), what went out last and when.
  private want = 0.5
  private sentAim = 0.5
  private sentAt = -1e9
  private held: string[] = []
  private keyed = false
  private riderMoodUntil = 0

  constructor(...deps: SceneDeps) {
    super('brick-buster', ...deps)
  }

  override create(): void {
    super.create()
    this.clock.reset()
    this.base = undefined
    this.pending = []
    this.seq = 0
    this.lastTick = -1
    this.started = false
    this.phase = 'ready'
    this.brickImgs = []
    this.ballImgs = []
    this.capImgs = []
    this.minis = []
    this.strip = undefined
    this.prev = undefined
    this.shownBricks = ''
    this.shownScore = -1
    this.want = 0.5
    this.sentAim = 0.5
    this.sentAt = -1e9
    this.held = []
    this.keyed = false
    this.bannerUntil = 0
    this.riderMoodUntil = 0

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    const pad = this.compact ? 8 : 16
    const hintH = this.compact ? 20 : 26
    const top = this.top + pad
    const availH = height - top - hintH - pad
    const portrait = height > width
    // Portrait leaves room under the board for the rivals' strip.
    const stripRoom = portrait ? PlayerStrip.rowH(this.compact ? 11 : 13) * 3 + pad : 0
    const unit = Math.floor(
      Math.min((availH - stripRoom) / BRICK.h, portrait ? width - pad * 2 : width * 0.46),
    )
    this.board = { x: Math.round((width - unit) / 2), y: top, unit }
    this.side = Math.floor((width - unit) / 2 - pad * 2)

    this.paintBoard()
    this.buildPieces()

    const hint = this.add
      .text(
        width / 2,
        height - hintH / 2,
        this.t(this.compact ? 'game.brickBuster.hintShort' : 'game.brickBuster.hint'),
        bodyStyle(this.compact ? 11 : 14, PALETTE.dim),
      )
      .setOrigin(0.5)
    fitText(hint, width - 16, this.compact ? 11 : 14)
    const midY = top + unit * 0.75
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
    if (portrait) {
      this.strip = new PlayerStrip(
        this,
        width / 2,
        top + unit * BRICK.h + pad + PlayerStrip.rowH(this.compact ? 11 : 13) / 2,
        width - pad * 2,
        this.compact ? 11 : 13,
        3,
      )
    }

    // Mouse / finger: the paddle follows the pointer's x anywhere on the canvas.
    const follow = (p: Phaser.Input.Pointer): void => {
      this.keyed = false
      this.want = (p.x - this.board.x) / this.board.unit
    }
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown || !this.compact) follow(p)
    })
    this.input.on('pointerdown', follow)
    const bind = (keys: string[], dir: string): void => {
      for (const k of keys) {
        this.input.keyboard?.on(`keydown-${k}`, () => {
          if (!this.held.includes(dir)) this.held.push(dir)
        })
        this.input.keyboard?.on(`keyup-${k}`, () => {
          this.held = this.held.filter((d) => d !== dir)
        })
      }
    }
    bind(['LEFT', 'A'], 'left')
    bind(['RIGHT', 'D'], 'right')
    this.input.keyboard?.addKeys('LEFT,RIGHT,A,D')
    const release = (): void => {
      this.held = []
    }
    this.game.events.on(Phaser.Core.Events.BLUR, release)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.game.events.off(Phaser.Core.Events.BLUR, release),
    )
  }

  private sx(x: number): number {
    return this.board.x + x * this.board.unit
  }

  private sy(y: number): number {
    return this.board.y + y * this.board.unit
  }

  // The well: a dark, gridded field inside a riveted metal frame.
  private paintBoard(): void {
    const { x, y, unit } = this.board
    const h = Math.round(unit * BRICK.h)
    const g = this.add.graphics().setDepth(1)
    const rim = Math.max(4, Math.round(unit * 0.018))
    g.fillStyle(0x5a6078, 1).fillRect(x - rim, y - rim, unit + rim * 2, h + rim)
    g.fillStyle(0x8a92ac, 1).fillRect(x - rim, y - rim, unit + rim * 2, Math.ceil(rim / 2))
    g.fillStyle(0x3a3f52, 1)
    for (let ry = y + rim * 2; ry < y + h; ry += rim * 6) {
      g.fillRect(x - rim + 1, ry, rim - 2, rim - 2)
      g.fillRect(x + unit + 1, ry, rim - 2, rim - 2)
    }
    g.fillStyle(BOARD_BG, 1).fillRect(x, y, unit, h)
    g.fillStyle(shade(BOARD_BG, 0.12), 1)
    const step = Math.max(8, Math.round(unit / 20))
    for (let gx = x + step; gx < x + unit; gx += step) g.fillRect(gx, y, 1, h)
    for (let gy = y + step; gy < y + h; gy += step) g.fillRect(x, gy, unit, 1)
    // The danger line under the paddle.
    g.fillStyle(PALETTE.red, 0.35).fillRect(x, y + h - 3, unit, 3)
  }

  private buildPieces(): void {
    const { unit } = this.board
    const bw = unit / BRICK.cols
    const bh = BRICK.brickH * unit
    const bevel = Math.max(2, Math.round(bh / 6))
    this.brickKeys = ROW_COLORS.map((c) => ensureBevelPanel(this, bw - 2, bh - 2, c, bevel))
    this.hardKey = ensureBevelPanel(this, bw - 2, bh - 2, HARD, bevel)
    for (let i = 0; i < BRICK.rows * BRICK.cols; i++) {
      const col = i % BRICK.cols
      const row = Math.floor(i / BRICK.cols)
      this.brickImgs.push(
        this.add
          .image(this.sx(col / BRICK.cols) + bw / 2, this.sy(BRICK.top) + row * bh + bh / 2, '')
          .setDepth(5)
          .setVisible(false),
      )
    }
    const color = this.state.colorOf(this.selfId, PALETTE.lime)
    const ph = Math.max(6, Math.round(BRICK.paddleH * unit))
    this.paddleKeys = [
      ensureBevelPanel(this, BRICK.paddleW * unit, ph, color, Math.max(2, Math.round(ph / 4))),
      ensureBevelPanel(this, BRICK.wideW * unit, ph, color, Math.max(2, Math.round(ph / 4))),
    ]
    this.paddle = this.add
      .image(this.sx(0.5), this.sy(BRICK.paddleY) + ph / 2, this.paddleKeys[0])
      .setDepth(8)
    const size = avatarPx(Math.max(16, (BRICK.h - BRICK.paddleY - BRICK.paddleH) * unit * 0.95))
    this.rider = new AvatarSprite(this, this.state.avatarOf(this.selfId), color, size, 'back')
    this.rider.image.setDepth(7)
    const ballPx = Math.max(6, Math.round(BRICK.ballR * 2 * unit))
    const ballKey = ensurePixelOrb(this, `bb-ball-${ballPx}`, 6, 0xf4f4f8, Math.max(1, ballPx / 6))
    for (let i = 0; i < BRICK.maxBalls; i++)
      this.ballImgs.push(
        this.add.image(0, 0, ballKey).setDisplaySize(ballPx, ballPx).setDepth(9).setVisible(false),
      )
    this.miniDyn = this.add.graphics().setDepth(12)
  }

  private capView(i: number): { img: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text } {
    let view = this.capImgs[i]
    if (!view) {
      const { unit } = this.board
      view = {
        img: this.add.image(0, 0, '').setDepth(8),
        label: this.add
          .text(
            0,
            0,
            '',
            headlineStyle(Math.max(8, Math.round((BRICK.capsuleH * unit) / 8) * 8 - 8), PALETTE.bg),
          )
          .setOrigin(0.5)
          .setDepth(8.5),
      }
      this.capImgs[i] = view
    }
    return view
  }

  // Rivals' mini boards down both sides (when there's room).
  private buildMinis(snap: BrickBusterSnapshot): void {
    const ids = Object.keys(snap.boards).filter((id) => id !== this.selfId)
    if (ids.length === 0 || this.side < 80) return
    const perSide = Math.ceil(ids.length / 2)
    const cols = perSide > 3 ? 2 : 1
    const rows = Math.ceil(perSide / cols)
    const gap = this.compact ? 6 : 10
    const labelH = this.compact ? 14 : 20
    const availH = BRICK.h * this.board.unit
    let w = Math.min(150, (this.side - (cols - 1) * gap) / cols)
    if (rows * (w * BRICK.h + labelH + gap) > availH) w = (availH / rows - labelH - gap) / BRICK.h
    w = Math.floor(w)
    if (w < 40) return
    const block = cols * w + (cols - 1) * gap
    ids.forEach((id, i) => {
      const left = i % 2 === 0
      const k = Math.floor(i / 2)
      const sideX = left ? this.board.x - 16 - this.side : this.board.x + this.board.unit + 16
      const x = Math.round(sideX + (this.side - block) / 2 + (k % cols) * (w + gap))
      const y = Math.round(
        this.board.y + Math.floor(k / cols) * (w * BRICK.h + labelH + gap) + labelH,
      )
      const color = this.state.colorOf(id, PALETTE.lime)
      const frame = this.add.graphics().setDepth(10)
      frame.fillStyle(shade(color, -0.45), 1).fillRect(x - 2, y - 2, w + 4, w * BRICK.h + 4)
      frame.fillStyle(BOARD_BG, 1).fillRect(x, y, w, w * BRICK.h)
      const icon = ensureAvatarTexture(this, this.state.avatarOf(id), color, 1, 'front', 'idle', 0)
      this.add
        .image(x, y - labelH / 2 - 1, icon)
        .setOrigin(0, 0.5)
        .setDisplaySize(16, 16)
        .setDepth(10)
      const label = this.add
        .text(x + 20, y - labelH / 2 - 1, '', bodyStyle(this.compact ? 10 : 13, color))
        .setOrigin(0, 0.5)
        .setDepth(10)
      this.minis.push({
        id,
        x,
        y,
        w,
        bricks: this.add.graphics().setDepth(11),
        label,
        shownBricks: '',
        shownScore: -1,
      })
    })
  }

  // Round ms at scene time `now`, on the server's clock (frozen once the round is over).
  private roundNow(now: number): number {
    const base = this.base
    if (!base) return 0
    const elapsed = this.state.final ? 0 : this.clock.since(base.remainingMs, now)
    return base.t + elapsed
  }

  private myAims(view: BrickBoardView): BrickAim[] {
    const mine = this.pending.filter((p) => p.seq > view.ack).map((p) => ({ at: p.at, x: p.x }))
    return mine.length ? [...view.aims, ...mine].sort((a, b) => a.at - b.at) : view.aims
  }

  // Keys steer toward a side while held and stop the paddle where it is on release; the pointer sets
  // the aim directly. A changed aim goes out at most every AIM_EVERY_MS.
  private steer(rt: number, px: number): void {
    const dir = this.held.at(-1)
    if (dir) {
      this.keyed = true
      this.want = dir === 'left' ? 0 : 1
    } else if (this.keyed) {
      this.keyed = false
      this.want = px
    }
    const base = this.base
    if (!base?.boards[this.selfId] || this.state.final || rt < BRICK.startDelayMs) return
    const want = Math.min(1, Math.max(0, this.want))
    const at = brickSnap(rt)
    if (Math.abs(want - this.sentAim) < AIM_STEP || at - this.sentAt < AIM_EVERY_MS) return
    const seq = ++this.seq
    this.sentAim = want
    this.sentAt = at
    this.pending.push({ seq, at, x: want, sentAt: this.time.now })
    this.sendInput({ kind: 'aim', x: want, at, seq })
  }

  protected frame(snap: BrickBusterSnapshot | null, time: number): void {
    if (!snap) return
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.onSnapshot(snap)
    }
    this.render(this.time.now, time)
  }

  private onSnapshot(snap: BrickBusterSnapshot): void {
    if (!this.started) this.buildMinis(snap)
    this.clock.sync(snap.remainingMs, this.time.now)
    const first = !this.started
    this.started = true
    this.base = snap
    const me = snap.boards[this.selfId]
    if (me) {
      const now = this.time.now
      this.pending = this.pending.filter((p) => p.seq > me.ack && now - p.sentAt < PENDING_TTL_MS)
      if (first) this.seq = Math.max(this.seq, me.ack)
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
    this.updatePhase(rt, now)
    const t = brickSnap(Math.max(0, rt))
    const view = base.boards[this.selfId]
    if (view) {
      const body = brickClone(view.body)
      brickRun(body, Math.max(t, body.t), this.myAims(view), base.walls)
      this.steer(rt, body.px)
      this.drawMine(body, now, time)
      this.moments(body)
      this.prev = body
    }
    this.drawMinis(base, t)
  }

  private drawMine(b: BrickBody, now: number, time: number): void {
    const { unit } = this.board
    if (b.bricks !== this.shownBricks) {
      this.shownBricks = b.bricks
      this.brickImgs.forEach((img, i) => {
        const cell = b.bricks[i]
        if (cell === '0' || cell === undefined) {
          img.setVisible(false)
          return
        }
        const row = Math.floor(i / BRICK.cols)
        img
          .setTexture(cell === '2' ? this.hardKey : (this.brickKeys[row] as string))
          .setVisible(true)
      })
    }
    const wide = b.t < b.wideUntil
    const paddle = this.paddle
    if (paddle) {
      const key = this.paddleKeys[wide ? 1 : 0]
      if (paddle.texture.key !== key) paddle.setTexture(key)
      paddle.setX(this.sx(b.px))
      // WIDE blinks in its last two seconds.
      paddle.setAlpha(wide && b.wideUntil - b.t < 2000 && Math.floor(time / 120) % 2 ? 0.6 : 1)
    }
    const rider = this.rider
    if (rider) {
      const size = rider.image.displayHeight
      rider.image.setPosition(this.sx(b.px), this.sy(BRICK.paddleY + BRICK.paddleH) + size / 2 + 1)
      if (now > this.riderMoodUntil) rider.setPose('back').setExpression('idle')
      rider.tick(time)
    }
    this.ballImgs.forEach((img, i) => {
      const ball = b.balls[i]
      img.setVisible(!!ball)
      if (ball) img.setPosition(this.sx(ball.x), this.sy(ball.y))
    })
    b.caps.forEach((cap, i) => {
      const v = this.capView(i)
      const key = ensureBevelPanel(
        this,
        BRICK.capsuleW * unit,
        BRICK.capsuleH * unit,
        CAP_COLORS[cap.kind] as number,
        2,
        true,
      )
      if (v.img.texture.key !== key) v.img.setTexture(key)
      v.img.setPosition(this.sx(cap.x), this.sy(cap.y)).setVisible(true)
      v.label
        .setText(CAP_GLYPH[cap.kind] as string)
        .setPosition(this.sx(cap.x), this.sy(cap.y))
        .setVisible(true)
    })
    for (let i = b.caps.length; i < this.capImgs.length; i++) {
      const v = this.capImgs[i]
      v?.img.setVisible(false)
      v?.label.setVisible(false)
    }
    if (b.score !== this.shownScore) {
      this.shownScore = b.score
      this.hud?.setScore(this.t('game.brickBuster.score', { n: b.score }))
    }
  }

  // What changed since the last frame: bricks hit, returns, capsules, a lost ball, a cleared wall.
  private moments(b: BrickBody): void {
    const prev = this.prev
    if (!prev) return
    const now = this.time.now
    const { unit } = this.board
    if (b.wall > prev.wall) {
      this.sfx.fanfare()
      this.showLine(this.t('game.brickBuster.cleared', { n: BRICK.clearBonus }), PALETTE.lime, now)
      this.rider?.setPose('front').setExpression('happy')
      this.riderMoodUntil = now + 900
      return
    }
    if (b.hits > prev.hits) {
      // A hard brick only chips (a click); a brick that goes pops.
      let broke = false
      for (let i = 0; i < b.bricks.length; i++) {
        const was = prev.bricks[i]
        if (was === b.bricks[i] || was === undefined || was === '0') continue
        const row = Math.floor(i / BRICK.cols)
        const x = this.sx(((i % BRICK.cols) + 0.5) / BRICK.cols)
        const y = this.sy(BRICK.top + (row + 0.5) * BRICK.brickH)
        burst(
          this,
          x,
          y,
          was === '2' ? HARD : (ROW_COLORS[row] as number),
          was === '2' ? 5 : 9,
          160,
        )
        if (was === '1') broke = true
      }
      if (broke) this.sfx.pop()
      else this.sfx.tick()
    }
    if (b.returns > prev.returns) {
      this.sfx.bounce(0.45)
      if (this.paddle) punch(this, this.paddle, 0.12, 80)
    }
    if (b.caught > prev.caught) {
      this.sfx.powerUp()
      const wide = b.wideUntil > prev.wideUntil
      floatText(
        this,
        this.sx(b.px),
        this.sy(BRICK.paddleY) - unit * 0.06,
        this.t(wide ? 'game.brickBuster.wide' : 'game.brickBuster.multi'),
        CAP_COLORS[wide ? BRICK_WIDE : 1] as number,
        this.compact ? 12 : 16,
      )
    }
    if (b.drops > prev.drops) {
      this.sfx.wrong()
      flash(this, PALETTE.red, 140)
      floatText(
        this,
        this.sx(b.px),
        this.sy(BRICK.paddleY) - unit * 0.1,
        this.quip('game.brickBuster.dropped', `${this.selfId}:${b.drops}`),
        PALETTE.red,
        this.compact ? 10 : 14,
      )
      this.rider?.setPose('front').setExpression('hurt')
      this.riderMoodUntil = now + 700
    }
  }

  private drawMinis(base: BrickBusterSnapshot, t: number): void {
    const g = this.miniDyn
    if (!g || this.minis.length === 0) return
    g.clear()
    for (const mini of this.minis) {
      const view = base.boards[mini.id]
      if (!view) continue
      const b = brickClone(view.body)
      brickRun(b, Math.max(t, b.t), view.aims, base.walls)
      const s = mini.w
      if (b.bricks !== mini.shownBricks) {
        mini.shownBricks = b.bricks
        const bg = mini.bricks
        bg.clear()
        const bw = s / BRICK.cols
        const bh = BRICK.brickH * s
        for (let i = 0; i < b.bricks.length; i++) {
          const cell = b.bricks[i]
          if (cell === '0' || cell === undefined) continue
          const row = Math.floor(i / BRICK.cols)
          bg.fillStyle(cell === '2' ? HARD : (ROW_COLORS[row] as number), 1)
          bg.fillRect(
            mini.x + (i % BRICK.cols) * bw + 0.5,
            mini.y + (BRICK.top + row * BRICK.brickH) * s + 0.5,
            Math.max(1, bw - 1),
            Math.max(1, bh - 1),
          )
        }
      }
      if (b.score !== mini.shownScore) {
        mini.shownScore = b.score
        mini.label.setText(`${this.label(mini.id)} ★${b.score}`)
        fitText(mini.label, s - 20, this.compact ? 10 : 13)
      }
      const color = this.state.colorOf(mini.id, PALETTE.lime)
      const half = brickHalfW(b)
      g.fillStyle(color, 1)
      g.fillRect(
        mini.x + (b.px - half) * s,
        mini.y + BRICK.paddleY * s,
        half * 2 * s,
        Math.max(2, BRICK.paddleH * s),
      )
      g.fillStyle(0xf4f4f8, 1)
      const r = Math.max(1.5, BRICK.ballR * s)
      for (const ball of b.balls)
        g.fillRect(mini.x + ball.x * s - r, mini.y + ball.y * s - r, r * 2, r * 2)
    }
  }

  private showLine(text: string, color: number, now: number): void {
    const banner = this.banner
    if (!banner) return
    banner.setFontSize(fitFontSize(text, this.board.unit * 1.1, this.compact ? 16 : 24))
    showBanner(this, banner, text, color)
    this.bannerUntil = now + 1400
  }

  // GET READY until GO; then banners fade on their own.
  private updatePhase(rt: number, now: number): void {
    const banner = this.banner
    if (this.phase === 'ready') {
      if (rt < BRICK.startDelayMs && !this.state.final) {
        if (banner && !banner.visible) {
          const text = this.t('game.brickBuster.ready')
          banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
          showBanner(this, banner, text, PALETTE.amber)
          this.subline?.setText(this.t('game.brickBuster.readySub')).setVisible(true)
          if (this.subline) fitText(this.subline, this.scale.width * 0.9, this.compact ? 8 : 16)
        }
        return
      }
      this.phase = 'go'
      banner?.setVisible(false)
      this.subline?.setVisible(false)
      if (rt < BRICK.startDelayMs + 300) this.sfx.go()
      return
    }
    if (this.bannerUntil && now > this.bannerUntil) {
      this.bannerUntil = 0
      banner?.setVisible(false)
    }
  }
}
