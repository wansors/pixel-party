import {
  PALETTE,
  RPS,
  RPS_HANDS,
  type RpsHand,
  type RpsPlayerView,
  type RpsSnapshot,
  type RpsThrow,
} from '@pp/shared'
import type Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { addBanner, burst, punch, shake, showBanner } from '../fx'
import { bodyStyle, ensureBevelPanel, fitFontSize, headlineStyle, shade } from '../pixelStyle'
import { type DuelSeat, DuelWatch, verdictKey } from './duelWatch'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const GRID = 16

// The hand shapes on a 16×16 grid (true = glove), pointing up; the outline is derived from them.
function handMask(hand: RpsHand | 'fist'): boolean[][] {
  const m = Array.from({ length: GRID }, () => Array<boolean>(GRID).fill(false))
  const set = (x: number, y: number, on: boolean): void => {
    const row = m[y]
    if (row) row[x] = on
  }
  const fill = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, true)
  }
  if (hand === 'rock' || hand === 'fist') {
    fill(3, 5, 12, 13)
    for (const [x, y] of [
      [3, 5],
      [12, 5],
      [3, 13],
      [12, 13],
    ] as const)
      set(x, y, false)
    fill(1, 8, 2, 11) // thumb
  } else if (hand === 'paper') {
    fill(3, 8, 13, 14)
    fill(3, 3, 4, 8)
    fill(6, 1, 7, 8)
    fill(9, 2, 10, 8)
    fill(12, 4, 13, 8)
    fill(1, 9, 2, 12) // thumb
  } else {
    fill(4, 9, 12, 14)
    set(4, 9, false)
    set(12, 9, false)
    // Two fingers in a V.
    for (let y = 1; y <= 9; y++) {
      const lean = Math.floor((9 - y) / 3)
      fill(5 - lean, y, 6 - lean, y)
      fill(9 + lean, y, 10 + lean, y)
    }
  }
  return m
}

// The duels as a spectator picks them.
function seats(snap: RpsSnapshot): Record<string, DuelSeat> {
  const out: Record<string, DuelSeat> = {}
  for (const [id, v] of Object.entries(snap.players)) {
    out[id] = { opponentId: v.opponentId, done: v.phase === 'done' }
  }
  return out
}

interface Side {
  avatar?: AvatarSprite
  glove: Phaser.GameObjects.Image
  name: Phaser.GameObjects.Text
  pips: Phaser.GameObjects.Graphics
  ready: Phaser.GameObjects.Text
  color: number
}

// Rock Paper Scissors (D43): your rival at the top, you at the bottom, each with their lobby avatar, a
// glove in their identity color and three win pips. While a throw is open both gloves shake to the
// chant (ROCK… PAPER… SCISSORS…) as the window drains; pick with the three buttons (or 1 2 3 / ← ↓ →
// / A S D) — your pick is final and shows on your glove at once, the rival's only says READY. The
// reveal swings both hands round: the winning glove punches, the losing one shakes. A strip of past
// throws helps you read your rival. A bye (or a duellist whose duel is over) watches another duel.
export class RockPaperScissorsScene extends MiniGameScene<RpsSnapshot> {
  private compact = false
  private rows = { theirs: 0, rivalGlove: 0, centre: 0, myGlove: 0, mine: 0, buttons: 0 }
  private gloveSize = 64
  private rival?: Side
  private me?: Side
  private chant?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private timer?: Phaser.GameObjects.Graphics
  private historyGfx?: Phaser.GameObjects.Container
  private banner?: Phaser.GameObjects.Text
  private buttons: Phaser.GameObjects.GameObject[] = []
  private readonly watch = new DuelWatch()
  private viewId: string | null | undefined = undefined
  private playing = false
  // The throw we picked for, and what (the snapshot only says we picked).
  private picked = { throwNo: -1, hand: 'rock' as RpsHand }
  private layoutKey = ''
  private chantStep = -1
  private shownReveal = 0

  constructor(...deps: SceneDeps) {
    super('rock-paper-scissors', ...deps)
  }

  protected override remainingMs(snap: RpsSnapshot): number {
    return snap.roundRemainingMs
  }

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.buttons = []
    this.watch.reset()
    this.viewId = undefined
    this.playing = false
    this.picked = { throwNo: -1, hand: 'rock' }
    this.layoutKey = ''
    this.chantStep = -1
    this.shownReveal = 0
    this.rival = undefined
    this.me = undefined

    const top = this.top + 8
    const hintH = this.compact ? 0 : 22
    const h = height - top - hintH - 8
    this.rows = {
      theirs: top + h * 0.06,
      rivalGlove: top + h * 0.24,
      centre: top + h * 0.44,
      myGlove: top + h * 0.62,
      mine: top + h * 0.77,
      buttons: top + h * 0.91,
    }
    this.gloveSize = Math.round(Math.min(h * 0.17, width * 0.22, 160) / 16) * 16
    const size = this.compact ? 12 : 16
    this.chant = this.add
      .text(
        width / 2,
        this.rows.centre - 14,
        '',
        headlineStyle(this.compact ? 16 : 24, PALETTE.amber),
      )
      .setOrigin(0.5)
      .setDepth(10)
    this.status = this.add
      .text(
        width / 2,
        this.rows.centre + (this.compact ? 22 : 28),
        '',
        bodyStyle(size, PALETTE.dim),
      )
      .setOrigin(0.5)
      .setDepth(10)
    this.timer = this.add.graphics().setDepth(9)
    this.historyGfx = this.add.container(0, 0).setDepth(9)
    this.banner = addBanner(this)
    if (!this.compact) {
      this.add
        .text(width / 2, height - 6, this.t('game.rps.keys'), bodyStyle(13, PALETTE.dim))
        .setOrigin(0.5, 1)
    }
    const keys: [string, RpsHand][] = [
      ['ONE', 'rock'],
      ['TWO', 'paper'],
      ['THREE', 'scissors'],
      ['LEFT', 'rock'],
      ['DOWN', 'paper'],
      ['RIGHT', 'scissors'],
      ['A', 'rock'],
      ['S', 'paper'],
      ['D', 'scissors'],
    ]
    for (const [key, hand] of keys) this.onKey(key, () => this.throwHand(hand))
  }

  // A glove texture: the hand in `color` with a dark outline and a lighter knuckle row.
  private gloveTexture(hand: RpsHand | 'fist', color: number): string {
    const key = `pp-rps-${hand}-${color.toString(16)}`
    if (this.textures.exists(key)) return key
    const m = handMask(hand)
    const px = 4
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    const at = (x: number, y: number): boolean => m[y]?.[x] === true
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (at(x, y)) {
          const lit = !at(x, y - 1)
          const dark = !at(x, y + 1) || !at(x + 1, y)
          g.fillStyle(lit ? shade(color, 0.35) : dark ? shade(color, -0.3) : color, 1)
          g.fillRect(x * px, y * px, px, px)
        } else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
          g.fillStyle(shade(color, -0.65), 1)
          g.fillRect(x * px, y * px, px, px)
        }
      }
    }
    g.generateTexture(key, GRID * px, GRID * px)
    g.destroy()
    return key
  }

  private buildSide(id: string, rival: boolean): Side {
    const { width } = this.scale
    const color = this.state.colorOf(id, rival ? PALETTE.magenta : PALETTE.cyan)
    const y = rival ? this.rows.theirs : this.rows.mine
    const avSize = avatarPx(this.compact ? 32 : 48)
    const avatar = new AvatarSprite(this, this.state.avatarOf(id), color, avSize, 'front')
    avatar.image.setPosition(width / 2 - (this.compact ? 90 : 140), y).setDepth(10)
    const name = this.add
      .text(
        width / 2 - (this.compact ? 64 : 104),
        y,
        this.label(id),
        headlineStyle(this.compact ? 10 : 16, color),
      )
      .setOrigin(0, 0.5)
      .setDepth(10)
    const pips = this.add.graphics().setDepth(10)
    const glove = this.add
      .image(
        width / 2,
        rival ? this.rows.rivalGlove : this.rows.myGlove,
        this.gloveTexture('fist', color),
      )
      .setDisplaySize(this.gloveSize, this.gloveSize)
      .setFlipY(rival)
      .setDepth(8)
    const ready = this.add
      .text(
        width / 2 + this.gloveSize * 0.75,
        glove.y,
        this.t('game.rps.ready'),
        headlineStyle(this.compact ? 8 : 12, PALETTE.lime),
      )
      .setOrigin(0, 0.5)
      .setDepth(10)
      .setVisible(false)
    return { avatar, glove, name, pips, ready, color }
  }

  private destroySide(s?: Side): void {
    if (!s) return
    s.avatar?.destroy()
    for (const o of [s.glove, s.name, s.pips, s.ready]) o.destroy()
  }

  private view(): RpsPlayerView | undefined {
    return this.viewId ? this.snap?.players[this.viewId] : undefined
  }

  private canThrow(v: RpsPlayerView | undefined): v is RpsPlayerView {
    return (
      this.playing &&
      !!v?.opponentId &&
      v.phase === 'choose' &&
      !v.youChose &&
      this.picked.throwNo !== v.throwNo &&
      !this.state.final
    )
  }

  private throwHand(hand: RpsHand): void {
    const v = this.view()
    if (!this.canThrow(v)) return
    this.sendInput({ kind: 'throw', hand })
    this.picked = { throwNo: v.throwNo, hand }
    this.sfx.lock()
    if (this.me) {
      this.me.glove.setTexture(this.gloveTexture(hand, this.me.color))
      punch(this, this.me.glove, 0.2, 90)
    }
    this.layoutKey = ''
  }

  // ROCK / PAPER / SCISSORS buttons, each with its glove.
  private buildButtons(v: RpsPlayerView): void {
    for (const o of this.buttons) o.destroy()
    this.buttons = []
    if (!this.canThrow(v)) return
    const { width } = this.scale
    const gap = this.compact ? 8 : 14
    const bw = Math.min(200, (width - 32 - gap * 2) / 3)
    const bh = this.compact ? 60 : 72
    const color = this.me?.color ?? PALETTE.cyan
    RPS_HANDS.forEach((hand, i) => {
      const x = width / 2 + (i - 1) * (bw + gap)
      const y = this.rows.buttons
      const panel = this.add
        .image(x, y, ensureBevelPanel(this, Math.round(bw), bh, PALETTE.frameLit, 5, true))
        .setDepth(700)
        .setInteractive({ useHandCursor: true })
      // A compact glove on the left, the word centred in the rest of the button.
      const iconS = Math.round(bh * 0.62)
      const icon = this.add
        .image(x - bw / 2 + 8 + iconS / 2, y, this.gloveTexture(hand, color))
        .setDisplaySize(iconS, iconS)
        .setDepth(701)
      const label = this.t(`game.rps.${hand}`)
      const textW = bw - iconS - 22
      const text = this.add
        .text(
          x - bw / 2 + iconS + 14 + textW / 2,
          y,
          label,
          headlineStyle(fitFontSize(label, textW, this.compact ? 10 : 16), PALETTE.text, {
            stroke: '#10121c',
            strokeThickness: 4,
          }),
        )
        .setOrigin(0.5)
        .setDepth(701)
      panel.on('pointerdown', () => this.throwHand(hand))
      this.buttons.push(panel, icon, text)
    })
  }

  protected frame(snap: RpsSnapshot | null, time: number): void {
    if (!snap) return
    const own = snap.players[this.selfId]
    const viewId = this.watch.follow(seats(snap), this.selfId, time)
    this.playing = !!own?.opponentId && viewId === this.selfId
    if (viewId !== this.viewId) this.setView(viewId, own)
    const v = viewId === null ? undefined : snap.players[viewId]
    if (!v) return
    const key = `${v.throwNo}:${v.phase}:${v.youChose}:${this.picked.throwNo}`
    if (key !== this.layoutKey) {
      this.layoutKey = key
      this.buildButtons(v)
      this.onPhase(v)
    }
    this.animate(v, time)
  }

  // A new seat to draw: yours, or the duel a spectator watches.
  private setView(viewId: string | null, own: RpsPlayerView | undefined): void {
    this.viewId = viewId
    this.layoutKey = ''
    this.shownReveal = 0
    this.destroySide(this.rival)
    this.destroySide(this.me)
    this.rival = undefined
    this.me = undefined
    const v = viewId ? this.snap?.players[viewId] : undefined
    if (!viewId || !v?.opponentId) {
      if (own && own.opponentId === null) {
        this.chant?.setText(this.t('game.common.duelBye'))
        this.status?.setText(this.t('game.rps.bye'))
      }
      return
    }
    this.me = this.buildSide(viewId, false)
    this.rival = this.buildSide(v.opponentId, true)
    this.shownReveal = v.history.length
    if (!this.playing) {
      this.status?.setText(
        this.t('game.common.duelWatch', {
          a: this.state.nameOf(viewId),
          b: this.state.nameOf(v.opponentId),
        }),
      )
    }
  }

  // Phase changes: a new throw opens, a reveal lands, the duel ends.
  private onPhase(v: RpsPlayerView): void {
    if (!this.me || !this.rival) return
    this.paintPips(v)
    this.paintHistory(v.history)
    if (v.phase === 'choose') {
      this.chantStep = -1
      if (!(this.playing && this.picked.throwNo === v.throwNo)) {
        this.me.glove.setTexture(this.gloveTexture('fist', this.me.color))
      }
      this.rival.glove.setTexture(this.gloveTexture('fist', this.rival.color))
      this.status?.setText(
        this.playing
          ? this.picked.throwNo === v.throwNo || v.youChose
            ? this.t('game.rps.waiting', { name: this.label(v.opponentId as string) })
            : this.t('game.rps.throwNo', { n: v.throwNo })
          : (this.status?.text ?? ''),
      )
      return
    }
    const last = v.history.at(-1)
    if (last && v.history.length > this.shownReveal) {
      this.shownReveal = v.history.length
      this.reveal(last)
    }
    if (v.phase === 'done') this.finish(v)
  }

  private reveal(t: RpsThrow): void {
    const me = this.me
    const rival = this.rival
    if (!me || !rival) return
    me.glove.setTexture(this.gloveTexture(t.mine ?? 'fist', t.mine ? me.color : PALETTE.frame))
    rival.glove.setTexture(
      this.gloveTexture(t.theirs ?? 'fist', t.theirs ? rival.color : PALETTE.frame),
    )
    me.glove.setY(this.rows.myGlove)
    rival.glove.setY(this.rows.rivalGlove)
    me.ready.setVisible(false)
    rival.ready.setVisible(false)
    const key =
      t.outcome === 'win' ? 'youWinThrow' : t.outcome === 'loss' ? 'theyWinThrow' : 'drawThrow'
    const name = this.playing ? '' : this.state.nameOf(this.viewId ?? '')
    const text = this.playing
      ? this.t(`game.rps.${key}`)
      : this.t('game.rps.watchThrow', { name, outcome: this.t(`game.rps.${key}Short`) })
    this.chant
      ?.setText(text)
      .setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 16 : 24))
    this.chant?.setColor(
      t.outcome === 'win' ? '#8be94b' : t.outcome === 'loss' ? '#ff5252' : '#eef1f7',
    )
    this.status?.setText(t.mine === null || t.theirs === null ? this.t('game.rps.tooSlow') : '')
    const winner = t.outcome === 'win' ? me : t.outcome === 'loss' ? rival : null
    const loser = t.outcome === 'win' ? rival : t.outcome === 'loss' ? me : null
    if (winner) {
      punch(this, winner.glove, 0.35, 140)
      burst(this, winner.glove.x, winner.glove.y, winner.color, 18, 200)
    }
    if (loser)
      this.tweens.add({
        targets: loser.glove,
        x: loser.glove.x + 6,
        yoyo: true,
        repeat: 3,
        duration: 50,
      })
    if (this.playing) {
      if (t.outcome === 'win') this.sfx.correct()
      else if (t.outcome === 'loss') {
        this.sfx.wrong()
        shake(this, 0.006, 140)
      } else this.sfx.bounce()
    } else this.sfx.quiet(() => this.sfx.hit(), 0.4)
  }

  private finish(v: RpsPlayerView): void {
    const banner = this.banner
    if (!banner) return
    const text = this.playing
      ? v.oppLeft
        ? this.t('game.common.duelOppLeft', { name: this.label(v.opponentId as string) })
        : this.t(verdictKey(v.won))
      : v.won === null
        ? this.t('game.common.draw')
        : this.t('game.common.duelWinner', {
            name: this.state.nameOf((v.won ? this.viewId : v.opponentId) ?? ''),
          })
    banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
    showBanner(this, banner, text, v.won === false ? PALETTE.red : PALETTE.lime)
    if (this.playing) {
      if (v.won) this.sfx.win()
      this.me?.avatar?.setExpression(v.won ? 'happy' : v.won === false ? 'hurt' : 'idle')
    }
  }

  // Per frame: the chant + draining bar while a throw is open, gloves shaking to the beat.
  private animate(v: RpsPlayerView, time: number): void {
    this.me?.avatar?.tick(time)
    this.rival?.avatar?.tick(time)
    const g = this.timer
    g?.clear()
    if (!this.me || !this.rival || v.phase !== 'choose') return
    const frac = v.chooseMs > 0 ? Math.max(0, Math.min(1, v.msLeft / v.chooseMs)) : 0
    const { width } = this.scale
    const barW = Math.min(360, width * 0.6)
    g?.fillStyle(PALETTE.panelAlt, 1).fillRect(width / 2 - barW / 2, this.rows.centre + 6, barW, 6)
    g?.fillStyle(frac < 0.3 ? PALETTE.red : PALETTE.amber, 1).fillRect(
      width / 2 - barW / 2,
      this.rows.centre + 6,
      barW * frac,
      6,
    )
    const step = Math.min(2, Math.floor((1 - frac) * 3))
    if (step !== this.chantStep) {
      this.chantStep = step
      const word = this.t(`game.rps.chant${step}`)
      this.chant
        ?.setText(word)
        .setColor('#ffcf4b')
        .setFontSize(this.compact ? 16 : 24)
      if (this.playing || step === 0) this.sfx.tick()
    }
    // Fists pump on the chant; a glove that has picked holds still (yours shows the pick).
    const bob = Math.abs(Math.sin(time / 120)) * (this.compact ? 6 : 10)
    const meLocked = this.playing ? this.picked.throwNo === v.throwNo || v.youChose : v.youChose
    this.me.glove.setY(this.rows.myGlove - (meLocked ? 0 : bob))
    this.rival.glove.setY(this.rows.rivalGlove + (v.theyChose ? 0 : bob))
    this.rival.ready.setVisible(v.theyChose)
    this.me.ready.setVisible(!this.playing && v.youChose)
  }

  private paintPips(v: RpsPlayerView): void {
    for (const [side, wins] of [
      [this.me, v.mine],
      [this.rival, v.theirs],
    ] as const) {
      if (!side) continue
      const g = side.pips
      g.clear()
      const r = this.compact ? 5 : 7
      const x0 = side.name.x + side.name.width + 14
      for (let i = 0; i < RPS.winsNeeded; i++) {
        const x = x0 + i * (r * 2 + 6)
        g.fillStyle(shade(side.color, -0.6), 1).fillCircle(x, side.name.y, r + 2)
        g.fillStyle(i < wins ? side.color : PALETTE.bg, 1).fillCircle(x, side.name.y, r)
      }
    }
  }

  // The last throws as tiny glove pairs down the right edge (yours under theirs), newest at the top.
  private paintHistory(history: readonly RpsThrow[]): void {
    const c = this.historyGfx
    const me = this.me
    const rival = this.rival
    if (!c || !me || !rival) return
    c.removeAll(true)
    const { width } = this.scale
    const s = this.compact ? 20 : 28
    const x = width - (this.compact ? 22 : 36)
    history
      .slice(-5)
      .reverse()
      .forEach((t, i) => {
        const y = this.rows.rivalGlove + i * (s * 2 + 8)
        const theirs = this.add
          .image(
            x,
            y,
            this.gloveTexture(t.theirs ?? 'fist', t.theirs ? rival.color : PALETTE.frame),
          )
          .setDisplaySize(s, s)
          .setFlipY(true)
        const mine = this.add
          .image(
            x,
            y + s + 2,
            this.gloveTexture(t.mine ?? 'fist', t.mine ? me.color : PALETTE.frame),
          )
          .setDisplaySize(s, s)
        const tag =
          t.outcome === 'win' ? PALETTE.lime : t.outcome === 'loss' ? PALETTE.red : PALETTE.dim
        const dot = this.add.rectangle(x - s / 2 - 6, y + s / 2, 4, s * 1.6, tag)
        c.add([theirs, mine, dot])
      })
  }
}
