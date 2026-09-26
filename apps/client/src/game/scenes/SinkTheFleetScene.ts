import { PALETTE, type SinkTheFleetDuelView, type SinkTheFleetSnapshot } from '@pp/shared'
import type Phaser from 'phaser'
import { burst, floatText, punch, shake } from '../fx'
import { bodyStyle, headlineStyle } from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'
import {
  NavalBoard,
  NavalEndCard,
  type NavalShot,
  drawSegmentBar,
  layoutBoards,
  setFittedText,
  setTextColor,
} from './navalGrid'

// Lets the wreck reveal play before the end card covers the middle of the screen.
const END_CARD_DELAY_MS = 1100

// Sink the Fleet (Battleship duel) canvas. Two pixel seas: ENEMY WATERS (tap a cell to fire, on your
// turn only) and YOUR FLEET (the rival's shots at you). The snapshot never carries ship positions —
// only shot results — so every splash, fire and wreck here is exactly what the server resolved. A turn
// banner + draining turn bar and a glowing frame on the board in play make whose-shot-it-is obvious.
export class SinkTheFleetScene extends MiniGameScene<SinkTheFleetSnapshot> {
  private target?: NavalBoard
  private own?: NavalBoard
  private card?: NavalEndCard
  private turnText?: Phaser.GameObjects.Text
  private turnBar?: Phaser.GameObjects.Graphics
  private hint?: Phaser.GameObjects.Text
  private bar = { x: 0, y: 0, w: 0, h: 0 }
  private boardsTop = 0
  private boardsBottom = 0
  private turnSizes: number[] = []
  private turnMax = 0
  private wasMyTurn: boolean | null = null
  private endedAt = -1
  private boardsHidden = false

  constructor(...deps: SceneDeps) {
    super('sink-the-fleet', ...deps)
  }

  override create(): void {
    super.create()
    this.target = undefined
    this.own = undefined
    this.turnMax = 0
    this.wasMyTurn = null
    this.endedAt = -1
    this.boardsHidden = false
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const cx = width / 2

    const turnSize = compact ? 16 : 24
    this.turnSizes = compact ? [16, 12, 8] : [24, 16]
    this.turnText = this.add
      .text(cx, this.top + turnSize / 2 + 4, '', headlineStyle(turnSize, PALETTE.amber))
      .setOrigin(0.5)
    this.bar = {
      w: Math.min(width * (compact ? 0.7 : 0.4), 380),
      h: compact ? 6 : 8,
      x: 0,
      y: this.top + turnSize + (compact ? 12 : 16),
    }
    this.bar.x = cx - this.bar.w / 2
    this.turnBar = this.add.graphics()
    this.boardsTop = this.bar.y + this.bar.h + (compact ? 6 : 10)

    const hintSize = compact ? 11 : 14
    this.hint = this.add
      .text(
        cx,
        height - 8,
        this.t('game.sinkTheFleet.hint'),
        bodyStyle(hintSize, PALETTE.dim, { align: 'center', wordWrap: { width: width * 0.92 } }),
      )
      .setOrigin(0.5, 1)
    this.boardsBottom = height - hintSize * (compact ? 2.6 : 1.8) - 8
    this.card = new NavalEndCard(this)
  }

  // Both boards are built once the first snapshot says how big the sea is.
  private build(snap: SinkTheFleetSnapshot, fleetCells: number): void {
    const { width, height } = this.scale
    const rects = layoutBoards(width, height, this.boardsTop, this.boardsBottom)
    this.target = new NavalBoard(this, rects.target, snap.grid, fleetCells, (cell) =>
      this.fire(cell),
    )
    this.own = new NavalBoard(this, rects.own, snap.grid, fleetCells)
  }

  protected override remainingMs(snap: SinkTheFleetSnapshot): number {
    return snap.roundRemainingMs
  }

  private fire(cell: number): void {
    const me = this.snap?.players[this.selfId]
    if (!me || me.done || !me.yourTurn || me.opponentId === null) return
    if (me.shots.some((s) => s.cell === cell)) return
    this.sfx.click()
    this.sendInput({ kind: 'fire', cell })
    this.target?.setPending(cell)
  }

  protected frame(snap: SinkTheFleetSnapshot | null, time: number): void {
    if (!snap) return
    const me = snap.players[this.selfId]
    this.hint?.setVisible(!!me && !me.done) // nothing to tap once the duel is over (or on a bye)
    if (!me) {
      this.hideBoards()
      this.card?.show(this.t('game.common.waiting'), PALETTE.dim)
      return
    }
    if (me.opponentId === null) {
      this.hideBoards()
      this.hud?.setScore('')
      this.card?.show(this.t('game.common.youWin'), PALETTE.lime, this.t('game.sinkTheFleet.bye'))
      return
    }
    if (!this.target) this.build(snap, me.fleetCells)
    const target = this.target
    const own = this.own
    if (!target || !own) return
    if (this.boardsHidden) {
      this.boardsHidden = false
      target.setVisible(true)
      own.setVisible(true)
    }

    this.hud?.setScore(
      this.t('game.sinkTheFleet.hitsChip', { n: me.hitsOnOpponent, total: me.fleetCells }),
    )
    const rivalColor = this.state.colorOf(me.opponentId, PALETTE.red)
    const selfColor = this.state.colorOf(this.selfId, PALETTE.cyan)
    target.setLabels(
      this.t('game.sinkTheFleet.target'),
      PALETTE.text,
      this.state.nameOf(me.opponentId),
      rivalColor,
    )
    own.setLabels(this.t('game.sinkTheFleet.yourFleet'), selfColor)

    // Shots: mine land on the rival's sea, theirs (from the public snapshot) on mine.
    const incoming: readonly NavalShot[] =
      snap.players[me.opponentId]?.shots ?? me.damage.map((cell) => ({ cell, hit: true }))
    for (const s of target.sync(me.shots, me.hitsOnOpponent >= me.fleetCells)) this.onMyShot(s)
    for (const s of own.sync(incoming, me.hitsOnYou >= me.fleetCells)) this.onIncoming(s)

    this.updateTurn(me, rivalColor)
    this.updateEnd(snap, me, time)
    target.tick(time)
    own.tick(time)
  }

  private updateTurn(me: SinkTheFleetDuelView, rivalColor: number): void {
    const target = this.target
    const own = this.own
    if (!target || !own) return
    if (me.done) {
      target.setFocus('idle')
      own.setFocus('idle')
      target.setAimable(false)
      this.turnText?.setText('')
      this.turnBar?.clear()
      return
    }
    const mine = me.yourTurn
    if (mine !== this.wasMyTurn) {
      if (this.wasMyTurn !== null && mine) this.sfx.go()
      this.turnMax = 0
      this.wasMyTurn = mine
      if (this.turnText) punch(this, this.turnText, 0.2, 110)
    }
    target.setFocus(mine ? 'active' : 'dim', PALETTE.amber)
    own.setFocus(mine ? 'idle' : 'active', PALETTE.red)
    target.setAimable(mine)
    if (this.turnText) {
      const text = mine
        ? this.t('game.sinkTheFleet.yourTurn')
        : this.t('game.sinkTheFleet.waitTurn')
      setFittedText(this.turnText, text, this.scale.width - 24, this.turnSizes)
      setTextColor(this.turnText, mine ? PALETTE.amber : rivalColor)
    }

    this.turnMax = Math.max(this.turnMax, me.turnRemainingMs)
    const frac = this.turnMax > 0 ? me.turnRemainingMs / this.turnMax : 0
    const urgent = mine && me.turnRemainingMs < 1500
    const color = mine ? (urgent ? PALETTE.red : PALETTE.amber) : PALETTE.frameLit
    if (this.turnBar) {
      const { x, y, w, h } = this.bar
      drawSegmentBar(this.turnBar, x, y, w, h, frac, color)
    }
  }

  // Duel over (others may still be playing): celebrate / commiserate at once, then — after the wreck
  // reveal has had a moment to play — hold a WIN / LOSE card until the round ends.
  private updateEnd(snap: SinkTheFleetSnapshot, me: SinkTheFleetDuelView, time: number): void {
    if (!me.done) {
      if (this.card?.visible) this.card.hide()
      return
    }
    // Already over on the first snapshot (a relayout restart): straight to the card, no replay.
    if (this.endedAt < 0 && this.firstSnapshot) this.endedAt = Math.max(0, time - END_CARD_DELAY_MS)
    if (this.endedAt < 0) {
      this.endedAt = time
      const c = this.target?.center()
      if (me.won === true) {
        this.sfx.coin()
        if (c) {
          burst(this, c.x, c.y, PALETTE.amber, 28, 320)
          burst(this, c.x, c.y, PALETTE.lime, 20, 260)
        }
      } else if (me.won === false) {
        this.sfx.wrong()
        shake(this, 0.012, 260)
      } else {
        this.sfx.tick()
      }
    }
    if (time - this.endedAt < END_CARD_DELAY_MS) return
    const [key, color] =
      me.won === true
        ? ['game.sinkTheFleet.won', PALETTE.lime]
        : me.won === false
          ? ['game.sinkTheFleet.lost', PALETTE.red]
          : ['game.sinkTheFleet.draw', PALETTE.amber]
    const waiting = snap.roundRemainingMs > 0 ? this.t('game.common.waiting') : ''
    this.card?.show(this.t(key), color, waiting)
  }

  private onMyShot(s: NavalShot): void {
    const target = this.target
    if (!target) return
    target.shotFx(s, true)
    const { x, y } = target.cellXY(s.cell)
    if (s.hit) {
      this.sfx.correct()
      shake(this, 0.006, 140)
      floatText(this, x, y - target.cell * 0.4, this.t('game.sinkTheFleet.hit'), PALETTE.orange)
    } else {
      this.sfx.pop()
      floatText(
        this,
        x,
        y - target.cell * 0.4,
        this.t('game.sinkTheFleet.splash'),
        PALETTE.cyan,
        16,
      )
    }
  }

  private onIncoming(s: NavalShot): void {
    const own = this.own
    if (!own) return
    own.shotFx(s, s.hit)
    const { x, y } = own.cellXY(s.cell)
    if (s.hit) {
      this.sfx.wrong()
      shake(this, 0.012, 220)
      own.pulse(PALETTE.red)
      floatText(this, x, y - own.cell * 0.4, this.t('game.sinkTheFleet.hit'), PALETTE.red)
    } else {
      this.sfx.pop()
      floatText(this, x, y - own.cell * 0.4, this.t('game.sinkTheFleet.splash'), PALETTE.dim, 14)
    }
  }

  private hideBoards(): void {
    this.boardsHidden = true
    this.target?.setVisible(false)
    this.own?.setVisible(false)
    this.turnText?.setText('')
    this.turnBar?.clear()
  }
}
