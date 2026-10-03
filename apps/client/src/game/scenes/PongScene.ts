import { PALETTE, type PongPlayerView, type PongSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import { addBanner, burst, floatText, punch, ring, shake, showBanner } from '../fx'
import { SnapshotInterpolator, lerp } from '../netcode/SnapshotInterpolator'
import {
  bodyStyle,
  ensurePixelGrid,
  ensurePixelOrb,
  fitFontSize,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'
import { DuelWatch } from './duelWatch'

// Mirrors the server's pong.ts: paddles sit at x = 0.04 / 0.96 and return the ball when its centre is
// within ±PAD_HALF of the paddle centre; first to WIN_SCORE takes the duel.
const PAD_X = 0.04
const PAD_HALF = 0.13
const WIN_SCORE = 5
const KEY_SPEED = 1.4 // normalized field heights per second with the keyboard
const TRAIL = 8
// How long the bye's "no rival" card and the GOLDEN POINT call stay over the court.
const BYE_CARD_MS = 3000
const GOLDEN_CARD_MS = 1600

// Pixel paddle, 4 cells thick: outlined pill with a lit and a shaded edge. Drawn upright; transposed
// for the portrait (paddles-at-the-ends) layout.
function paddleRows(): string[] {
  const rows = ['_oo_', 'ohbo']
  for (let i = 0; i < 14; i++) rows.push('ohbd')
  rows.push('obdo', '_oo_')
  return rows
}

function transpose(rows: string[]): string[] {
  const w = rows[0]?.length ?? 0
  return Array.from({ length: w }, (_, x) => rows.map((r) => r[x] ?? '_').join(''))
}

interface Side {
  paddle: Phaser.GameObjects.Image
  digit: Phaser.GameObjects.Text
  name: Phaser.GameObjects.Text
  color: number
}

// Pixel Pong canvas (Phase 5, duel). The server simulates the ball; "your" paddle is always on your
// end (the server mirrors the ball for the right-side player) and is moved locally for zero-lag feel,
// while the ball + opponent paddle come from the snapshot, smoothed by the interpolator. Landscape
// screens play left↔right; portrait phones rotate the court so you defend the bottom edge and slide the
// paddle with your thumb. The mapping is purely visual — the wire stays normalized (x along, y across).
// A tie at the bell plays a golden point. The bye (or a player who joined mid-round) watches someone
// else's duel, read-only, from that duellist's end of the court.
export class PongScene extends MiniGameScene<PongSnapshot> {
  private me?: Side
  private opp?: Side
  private ball?: Phaser.GameObjects.Image
  private trailGfx?: Phaser.GameObjects.Graphics
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private hint?: Phaser.GameObjects.Text
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private readonly interp = new SnapshotInterpolator<PongSnapshot>(100)
  private trail: { x: number; y: number }[] = []
  private lastTick = -1
  private padY = 0.5
  private lastSentY = -1
  private lastSentAt = 0
  private synced = false
  private lastScoreYou = 0
  private lastScoreOpp = 0
  private lastBallX = 0.5
  private lastBallY = 0.5
  private lastDir = 0
  private wasDone = false
  private wasGolden = false
  // undefined = not applied yet, so the first view (even a bye's null) always runs setOpponent.
  private oppId: string | null | undefined = undefined
  // Whose end of the court is drawn as "yours": you while you play, else the duellist being watched.
  private viewId: string | null | undefined = undefined
  private playing = false
  // Only a human move sends the paddle (an untouched paddle must not count as playing).
  private touched = false
  private byeShown = false
  private readonly watch = new DuelWatch()
  private vertical = false
  private compact = false
  // Court geometry. "Along" = the server's x axis (your paddle → theirs), "across" = its y axis.
  private court = { x: 0, y: 0, w: 0, h: 0 }
  private alongStart = 0
  private alongLen = 0
  private acrossStart = 0
  private acrossLen = 0
  private ballR = 0
  private padT = 0

  constructor(...deps: SceneDeps) {
    super('pixel-pong', ...deps)
  }

  protected override remainingMs(snap: PongSnapshot): number | null {
    return snap.roundRemainingMs
  }

  override create(): void {
    super.create()
    this.interp.reset()
    this.trail = []
    this.lastTick = -1
    this.padY = 0.5
    this.lastSentY = -1
    this.synced = false
    this.lastScoreYou = 0
    this.lastScoreOpp = 0
    this.lastBallX = 0.5
    this.lastBallY = 0.5
    this.lastDir = 0
    this.wasDone = false
    this.wasGolden = false
    this.oppId = undefined
    this.viewId = undefined
    this.playing = false
    this.touched = false
    this.byeShown = false
    this.watch.reset()

    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.vertical = height > width * 1.1
    const pad = this.compact ? 10 : 18
    const hintH = this.compact ? 24 : 30
    this.court = {
      x: pad,
      y: this.top + 6,
      w: width - pad * 2,
      h: height - this.top - 6 - hintH,
    }
    const { x, y, w, h } = this.court
    this.ballR = Math.max(5, Math.round(Math.min(w, h) * 0.02))
    this.padT = Math.max(8, Math.round(Math.min(w, h) * 0.024))
    const wall = this.compact ? 6 : 8
    const alongSize = this.vertical ? h : w
    const acrossSize = this.vertical ? w : h
    // Paddle faces land exactly at x = PAD_X / 1 - PAD_X; walls stop the ball's edge at y = 0 / 1.
    const margin = this.padT + this.ballR + 4
    this.alongLen = (alongSize - margin * 2) / (1 - PAD_X * 2)
    this.alongStart = margin - PAD_X * this.alongLen
    this.acrossStart = wall + this.ballR
    this.acrossLen = acrossSize - (wall + this.ballR) * 2

    this.drawCourt(wall)

    const selfColor = this.state.colorOf(this.selfId, PALETTE.lime)
    this.me = this.makeSide(selfColor, 'me', this.t('game.common.you'))
    this.opp = this.makeSide(PALETTE.red, 'opp', '')

    this.trailGfx = this.add.graphics().setDepth(18)
    const ballKey = ensurePixelOrb(this, 'pp-pong-ball', 10, PALETTE.amber)
    this.ball = this.add
      .image(x + w / 2, y + h / 2, ballKey)
      .setDisplaySize(this.ballR * 2, this.ballR * 2)
      .setDepth(20)

    this.hint = this.add
      .text(
        width / 2,
        height - hintH / 2,
        this.t('game.pixelPong.hint', { n: WIN_SCORE }),
        bodyStyle(this.compact ? 11 : 14, PALETTE.dim),
      )
      .setOrigin(0.5)

    this.banner = addBanner(this)
    this.subline = this.add
      .text(
        width / 2,
        height / 2 + (this.compact ? 34 : 46),
        '',
        headlineStyle(this.compact ? 8 : 16, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
          align: 'center',
          wordWrap: { width: width * 0.9 },
        }),
      )
      .setOrigin(0.5)
      .setDepth(950)
      .setVisible(false)

    this.cursors = this.input.keyboard?.createCursorKeys()
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.aim(p))
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.aim(p)
    })
  }

  // Screen position of a normalized court point (along = server x, across = server y).
  private toScreen(along: number, across: number): { x: number; y: number } {
    const a = this.alongStart + along * this.alongLen
    const c = this.acrossStart + across * this.acrossLen
    const { x, y, h } = this.court
    return this.vertical ? { x: x + c, y: y + h - a } : { x: x + a, y: y + c }
  }

  private drawCourt(wall: number): void {
    const { x, y, w, h } = this.court
    const g = this.add.graphics()
    g.fillStyle(shade(PALETTE.panel, -0.15), 1)
    g.fillRect(x, y, w, h)
    // Side walls (the across bounds) as beveled bars.
    const bar = (bx: number, by: number, bw: number, bh: number): void => {
      g.fillStyle(PALETTE.frame, 1)
      g.fillRect(bx, by, bw, bh)
      g.fillStyle(PALETTE.frameLit, 1)
      g.fillRect(bx, by, bw, Math.min(bh, 2))
      g.fillRect(bx, by, Math.min(bw, 2), bh)
    }
    if (this.vertical) {
      bar(x, y, wall, h)
      bar(x + w - wall, y, wall, h)
    } else {
      bar(x, y, w, wall)
      bar(x, y + h - wall, w, wall)
    }
    // Dashed centre net.
    g.fillStyle(PALETTE.dim, 0.55)
    const dash = this.compact ? 10 : 14
    if (this.vertical) {
      for (let dx = x + wall + 4; dx < x + w - wall - dash / 2; dx += dash * 2) {
        g.fillRect(dx, y + h / 2 - 2, dash, 4)
      }
    } else {
      for (let dy = y + wall + 4; dy < y + h - wall - dash / 2; dy += dash * 2) {
        g.fillRect(x + w / 2 - 2, dy, 4, dash)
      }
    }
  }

  private makeSide(color: number, which: 'me' | 'opp', label: string): Side {
    const key = this.paddleKey(color)
    const len = PAD_HALF * 2 * this.acrossLen
    const paddle = this.add
      .image(0, 0, key)
      .setDisplaySize(this.vertical ? len : this.padT, this.vertical ? this.padT : len)
      .setDepth(15)
    // Big translucent score digit in each half of the court, the player's label under it.
    const along = which === 'me' ? 0.28 : 0.72
    const pos = this.toScreen(along, this.vertical ? 0.5 : 0.18)
    const digit = this.add
      .text(pos.x, pos.y, '0', headlineStyle(this.compact ? 40 : 64, color))
      .setOrigin(0.5)
      .setAlpha(0.45)
      .setDepth(2)
    const name = this.add
      .text(
        pos.x,
        pos.y + (this.compact ? 34 : 52),
        label,
        headlineStyle(this.compact ? 8 : 16, color),
      )
      .setOrigin(0.5)
      .setAlpha(0.8)
      .setDepth(2)
    return { paddle, digit, name, color }
  }

  private paddleKey(color: number): string {
    const rows = this.vertical ? transpose(paddleRows()) : paddleRows()
    return ensurePixelGrid(this, {
      key: `pp-pong-paddle-${color.toString(16)}-${this.vertical ? 'v' : 'h'}`,
      rows,
      legend: { o: shade(color, -0.6), h: shade(color, 0.45), b: color, d: shade(color, -0.3) },
    })
  }

  // Paddle centre on screen: its face sits exactly one ball radius short of the contact line.
  private paddlePos(mine: boolean, across: number): { x: number; y: number } {
    const along = mine ? PAD_X : 1 - PAD_X
    const offset = (this.ballR + this.padT / 2) / this.alongLen
    return this.toScreen(mine ? along - offset : along + offset, across)
  }

  private aim(p: Phaser.Input.Pointer): void {
    if (!this.playing) return
    this.touched = true
    const { x, y } = this.court
    const c = this.vertical ? p.x - x : p.y - y
    this.padY = Phaser.Math.Clamp((c - this.acrossStart) / this.acrossLen, 0, 1)
  }

  private maybeSend(now: number): void {
    if (!this.playing || !this.touched) return
    if (now - this.lastSentAt < 60 || Math.abs(this.padY - this.lastSentY) < 0.01) return
    this.lastSentAt = now
    this.lastSentY = this.padY
    this.sendInput({ kind: 'move', y: this.padY })
  }

  protected frame(snap: PongSnapshot | null, time: number, delta: number): void {
    const now = this.time.now
    if (snap && this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.interp.push(snap, now)
      const own = snap.players[this.selfId]
      this.playing = !!own && own.opponentId !== null
      const viewId = this.playing
        ? this.selfId
        : this.watch.pick(snap.players, time, (_, v) => v.side === 'left')
      if (viewId !== this.viewId) this.setView(viewId, own?.opponentId === null)
      const view = viewId === null ? undefined : snap.players[viewId]
      if (view) this.onView(view)
    }

    if (this.playing) {
      const step = (KEY_SPEED * delta) / 1000
      const back = this.vertical ? this.cursors?.left : this.cursors?.up
      const fwd = this.vertical ? this.cursors?.right : this.cursors?.down
      if (back?.isDown || fwd?.isDown) this.touched = true
      if (back?.isDown) this.padY -= step
      if (fwd?.isDown) this.padY += step
      this.padY = Phaser.Math.Clamp(this.padY, 0, 1)
      this.maybeSend(now)
    }

    const viewId = this.viewId
    const latest = viewId ? this.interp.latest()?.players[viewId] : undefined
    if (!viewId || !latest) {
      const mePos = this.paddlePos(true, this.padY)
      this.me?.paddle.setPosition(mePos.x, mePos.y)
      return
    }
    // Interpolate ball + paddles from the snapshot (yours is local while you play) — except across a
    // point (the ball teleports back to serve).
    let ballX = latest.ballX
    let ballY = latest.ballY
    let oppY = latest.oppY
    let youY = latest.youY
    const sample = this.interp.sample(now)
    const from = sample?.from.players[viewId]
    const to = sample?.to.players[viewId]
    if (sample && from && to) {
      oppY = lerp(from.oppY, to.oppY, sample.t)
      youY = lerp(from.youY, to.youY, sample.t)
      const served = from.scoreYou !== to.scoreYou || from.scoreOpp !== to.scoreOpp
      ballX = served ? to.ballX : lerp(from.ballX, to.ballX, sample.t)
      ballY = served ? to.ballY : lerp(from.ballY, to.ballY, sample.t)
    }
    const mePos = this.paddlePos(true, this.playing ? this.padY : youY)
    this.me?.paddle.setPosition(mePos.x, mePos.y)
    const oppPos = this.paddlePos(false, oppY)
    this.opp?.paddle.setPosition(oppPos.x, oppPos.y)
    const b = this.toScreen(ballX, ballY)
    this.ball?.setPosition(b.x, b.y).setVisible(!latest.done)
    this.drawTrail(b, !latest.done)
  }

  // A new viewpoint: your own duel on the first snapshot, or the next duel a spectator watches. The
  // near end takes the viewed duellist's colors; a bye first hears it scores a draw, then watches.
  private setView(viewId: string | null, bye: boolean): void {
    this.viewId = viewId
    this.synced = false
    this.wasDone = false
    this.wasGolden = false
    this.trail = []
    this.banner?.setVisible(false)
    this.subline?.setVisible(false)
    this.hud?.setCenter('')
    const me = this.me
    if (me && viewId) {
      const color = this.state.colorOf(viewId, PALETTE.lime)
      me.color = color
      me.paddle.setTexture(this.paddleKey(color))
      me.digit.setColor(hexToCss(color))
      me.name.setText(this.label(viewId)).setColor(hexToCss(color))
    }
    if (this.playing) return
    this.hud?.setScore(bye ? this.t('game.common.duelBye') : '')
    if (bye && !this.byeShown && this.banner) {
      this.byeShown = true
      const text = this.t('game.common.duelBye')
      showBanner(this, this.banner, text, PALETTE.amber)
      this.subline?.setText(this.t('game.pixelPong.bye')).setVisible(true)
      this.time.delayedCall(BYE_CARD_MS, () => {
        if (this.banner?.text !== text) return
        this.banner.setVisible(false)
        this.subline?.setVisible(false)
      })
    }
  }

  private drawTrail(b: { x: number; y: number }, live: boolean): void {
    const g = this.trailGfx
    if (!g) return
    const last = this.trail[this.trail.length - 1]
    // A jump of more than a quarter court means a serve reset: start a fresh trail.
    if (last && Math.hypot(b.x - last.x, b.y - last.y) > this.alongLen * 0.25) this.trail = []
    this.trail.push(b)
    if (this.trail.length > TRAIL) this.trail.shift()
    g.clear()
    if (!live) return
    this.trail.forEach((p, i) => {
      const k = (i + 1) / this.trail.length
      const s = this.ballR * 2 * (0.3 + 0.5 * k)
      g.fillStyle(shade(PALETTE.amber, 0.3), 0.45 * k)
      g.fillRect(p.x - s / 2, p.y - s / 2, s, s)
    })
  }

  // Discrete events from each fresh snapshot: points, paddle returns, golden point, the final result.
  private onView(view: PongPlayerView): void {
    if (view.opponentId !== this.oppId) this.setOpponent(view.opponentId)
    if (this.playing) this.hud?.setScore(this.t('game.common.pts', { n: view.scoreYou }))
    else if (view.opponentId) {
      this.hint?.setText(
        this.t('game.common.duelWatch', {
          a: this.state.nameOf(this.viewId ?? ''),
          b: this.state.nameOf(view.opponentId),
        }),
      )
    }
    this.me?.digit.setText(String(view.scoreYou))
    this.opp?.digit.setText(String(view.scoreOpp))
    if (!this.synced) {
      this.synced = true
      this.lastScoreYou = view.scoreYou
      this.lastScoreOpp = view.scoreOpp
      this.lastBallX = view.ballX
      this.lastBallY = view.ballY
      this.wasDone = view.done
      this.wasGolden = view.golden
      if (view.golden) this.hud?.setCenter(this.t('game.pixelPong.golden'), PALETTE.amber)
      if (view.done && view.opponentId) this.showResult(view, false)
      return
    }

    const scored = view.scoreYou > this.lastScoreYou
    const conceded = view.scoreOpp > this.lastScoreOpp
    if (scored) this.onPoint(true)
    if (conceded) this.onPoint(false)
    if (!scored && !conceded) {
      const dx = view.ballX - this.lastBallX
      const dir = Math.abs(dx) < 0.002 ? this.lastDir : Math.sign(dx)
      if (this.lastDir < 0 && dir > 0) this.onReturn(true, view.ballY)
      else if (this.lastDir > 0 && dir < 0) this.onReturn(false, view.ballY)
      this.lastDir = dir
    } else {
      this.lastDir = 0
    }
    this.lastScoreYou = view.scoreYou
    this.lastScoreOpp = view.scoreOpp
    this.lastBallX = view.ballX
    this.lastBallY = view.ballY

    if (view.golden && !this.wasGolden) this.onGolden()
    this.wasGolden = view.golden
    if (view.done && !this.wasDone) this.showResult(view, true)
    this.wasDone = view.done
  }

  // Tied at the bell: a quick call over the court, then a GOLDEN POINT chip while it lasts.
  private onGolden(): void {
    const golden = this.t('game.pixelPong.golden')
    this.hud?.setCenter(golden, PALETTE.amber)
    this.sfx.go()
    if (!this.banner) return
    showBanner(this, this.banner, golden, PALETTE.amber)
    this.subline?.setText(this.t('game.pixelPong.goldenHint')).setVisible(true)
    this.time.delayedCall(GOLDEN_CARD_MS, () => {
      if (this.banner?.text !== golden) return
      this.banner.setVisible(false)
      this.subline?.setVisible(false)
    })
  }

  private setOpponent(id: string | null): void {
    this.oppId = id
    const opp = this.opp
    if (!opp) return
    const color = id ? this.state.colorOf(id, PALETTE.red) : PALETTE.frame
    opp.color = color
    opp.paddle.setTexture(this.paddleKey(color)).setVisible(id !== null)
    opp.digit.setColor(hexToCss(color))
    opp.name.setText(id ? this.state.nameOf(id) : '—').setColor(hexToCss(color))
  }

  private onPoint(mine: boolean): void {
    const side = mine ? this.me : this.opp
    // The ball left the court past the loser's paddle, at its last known height.
    const exit = this.toScreen(mine ? 1 - PAD_X : PAD_X, this.lastBallY)
    this.trail = []
    if (side) punch(this, side.digit, 0.5, 140)
    if (!this.playing) {
      // Watching: a neutral pop for either end.
      this.sfx.pop()
      burst(this, exit.x, exit.y, side?.color ?? PALETTE.amber, 20, 260)
    } else if (mine) {
      this.sfx.correct()
      burst(this, exit.x, exit.y, this.me?.color ?? PALETTE.lime, 20, 260)
      floatText(
        this,
        exit.x + (this.vertical ? 0 : -40),
        exit.y + (this.vertical ? 40 : 0),
        '+1',
        PALETTE.lime,
        24,
      )
    } else {
      this.sfx.wrong()
      shake(this, 0.008, 200)
      burst(this, exit.x, exit.y, this.opp?.color ?? PALETTE.red, 20, 260)
    }
  }

  private onReturn(mine: boolean, across: number): void {
    const side = mine ? this.me : this.opp
    if (!side) return
    this.sfx.pad(mine ? 2 : 1)
    const hit = this.toScreen(mine ? PAD_X : 1 - PAD_X, across)
    ring(this, hit.x, hit.y, side.color, this.ballR * 4)
    punch(this, side.paddle, 0.15, 70)
  }

  private showResult(view: PongPlayerView, withFx: boolean): void {
    const banner = this.banner
    if (!banner) return
    this.hud?.setCenter('')
    if (!this.playing) {
      // Watching: who took the duel (the bye's own result is its draw, said up front).
      const winner = view.won === null ? null : view.won ? this.viewId : (view.opponentId ?? null)
      const text = winner
        ? this.t('game.common.duelWinner', { name: this.state.nameOf(winner) })
        : this.t('game.common.draw')
      banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 40))
      showBanner(this, banner, text, winner ? this.state.colorOf(winner) : PALETTE.amber)
      this.subline?.setVisible(false)
      if (withFx) this.sfx.tick()
      return
    }
    const text =
      view.won === null
        ? this.t('game.common.draw')
        : view.won
          ? this.t('game.common.youWin')
          : this.t('game.common.youLose')
    const color = view.won === null ? PALETTE.amber : view.won ? PALETTE.lime : PALETTE.red
    banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 40))
    showBanner(this, banner, text, color)
    const sub =
      view.oppLeft && view.opponentId
        ? this.t('game.common.duelOppLeft', { name: this.state.nameOf(view.opponentId) })
        : this.t('game.common.waiting')
    this.subline?.setText(sub).setVisible(true)
    if (!withFx) return
    if (view.won) {
      this.sfx.coin()
      const { width, height } = this.scale
      burst(this, width / 2, height / 2, PALETTE.amber, 24, 300)
      burst(this, width / 2, height / 2, this.me?.color ?? PALETTE.lime, 18, 240)
    } else if (view.won === null) {
      this.sfx.tick()
    }
  }
}
