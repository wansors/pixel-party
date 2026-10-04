import {
  decodeShot,
  PALETTE,
  type SinkTheFleetDuelView,
  type SinkTheFleetSnapshot,
} from '@pp/shared'
import type Phaser from 'phaser'
import { burst, floatText, punch, shake } from '../fx'
import { bodyStyle, headlineStyle } from '../pixelStyle'
import { DuelWatch, verdictKey } from './duelWatch'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'
import {
  drawSegmentBar,
  layoutBoards,
  NavalBoard,
  NavalEndCard,
  type NavalShot,
  setFittedText,
  setTextColor,
} from './navalGrid'

// Lets the wreck reveal play before the end card covers the middle of the screen.
const END_CARD_DELAY_MS = 1100
// How long the bye's "no rival" card stays up before it starts watching a duel.
const BYE_CARD_MS = 3000

// Sink the Fleet (Battleship duel) canvas. Two pixel seas: ENEMY WATERS (click a cell — or aim with the
// arrows / WASD and fire with SPACE / ENTER — on your turn only; a hit shoots again) and YOUR FLEET (the
// rival's shots at you). The snapshot never carries ship positions — only shot results — so every
// splash, fire and wreck here is exactly what the server resolved. A turn banner + draining turn bar
// and a glowing frame on the board in play make whose-shot-it-is obvious. The bye (or a player who
// joined mid-round) watches another duel instead: the same two seas, named after the two admirals,
// read-only — and so does a duellist a few seconds after their own duel is over, their verdict kept in
// the HUD.
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
  // The turn bar is in its last stretch on your shot (its warning beep plays once).
  private urgentTurn = false
  private endedAt = -1
  private boardsHidden = false
  private readonly watch = new DuelWatch()
  // Whose duel the boards show: yours while you play, else the duellist being watched.
  private viewId: string | null = null
  private playing = false
  private byeCardUntil = -1
  private syncedTick = -1

  constructor(...deps: SceneDeps) {
    super('sink-the-fleet', ...deps)
  }

  override create(): void {
    super.create()
    this.target = undefined
    this.own = undefined
    this.turnMax = 0
    this.wasMyTurn = null
    this.urgentTurn = false
    this.endedAt = -1
    this.boardsHidden = false
    this.watch.reset()
    this.viewId = null
    this.playing = false
    this.byeCardUntil = -1
    this.syncedTick = -1
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const cx = width / 2

    const big = Math.min(width, height) >= 900
    const turnSize = compact ? 16 : big ? 32 : 24
    this.turnSizes = compact ? [16, 12, 8] : big ? [32, 24, 16] : [24, 16]
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

    const hintSize = compact ? 11 : big ? 16 : 14
    this.hint = this.add
      .text(
        cx,
        height - 8,
        this.t(compact ? 'game.sinkTheFleet.hint' : 'game.sinkTheFleet.hintPc'),
        bodyStyle(hintSize, PALETTE.dim, { align: 'center', wordWrap: { width: width * 0.92 } }),
      )
      .setOrigin(0.5, 1)
    this.boardsBottom = height - hintSize * (compact ? 2.6 : 1.8) - 8
    this.card = new NavalEndCard(this)

    // Keyboard aim on your own turn (the mouse works too): the cursor walks the enemy sea.
    const aim = (dx: number, dy: number) => () => {
      if (this.canFire()) this.target?.moveCursor(dx, dy)
    }
    for (const [keys, dx, dy] of [
      [['LEFT', 'A'], -1, 0],
      [['RIGHT', 'D'], 1, 0],
      [['UP', 'W'], 0, -1],
      [['DOWN', 'S'], 0, 1],
    ] as const) {
      for (const key of keys) this.onKey(key, aim(dx, dy), { repeat: true })
    }
    const fire = (): void => {
      if (this.canFire() && this.target?.fireCursor() === false) this.sfx.tick()
    }
    this.onKey('SPACE', fire)
    this.onKey('ENTER', fire)
  }

  // Your own duel, your turn, still running.
  private canFire(): boolean {
    const me = this.snap?.players[this.selfId]
    return this.playing && !!me && !me.done && me.yourTurn && me.opponentId !== null
  }

  // Both boards are built once the first snapshot says how big the sea is — and again, fresh, for each
  // duel a spectator moves on to (the old pair is destroyed). Only your own duel's sea takes shots.
  private build(snap: SinkTheFleetSnapshot, fleetCells: number): void {
    const { width, height } = this.scale
    const rects = layoutBoards(width, height, this.boardsTop, this.boardsBottom)
    this.target?.destroy()
    this.own?.destroy()
    this.card?.hide()
    const onFire = this.playing ? (cell: number) => this.fire(cell) : undefined
    this.target = new NavalBoard(this, rects.target, snap.grid, fleetCells, onFire)
    this.own = new NavalBoard(this, rects.own, snap.grid, fleetCells)
    this.boardsHidden = false
    this.wasMyTurn = null
    this.turnMax = 0
    this.endedAt = -1
    this.syncedTick = -1
  }

  protected override remainingMs(snap: SinkTheFleetSnapshot): number {
    return snap.roundRemainingMs
  }

  private fire(cell: number): void {
    const me = this.snap?.players[this.selfId]
    if (!me || me.done || !me.yourTurn || me.opponentId === null) return
    if (me.shots.some((s) => decodeShot(s).cell === cell)) return
    this.sfx.shoot()
    this.sendInput({ kind: 'fire', cell })
    this.target?.setPending(cell)
  }

  protected frame(snap: SinkTheFleetSnapshot | null, time: number): void {
    if (!snap) return
    const seat = snap.players[this.selfId]
    const bye = seat?.opponentId === null
    const viewId = this.watch.follow(snap.players, this.selfId, time)
    this.playing = !!seat && !bye && viewId === this.selfId
    const me = viewId === null ? undefined : snap.players[viewId]
    if (!me?.opponentId) {
      this.hint?.setVisible(false)
      this.hideBoards()
      if (bye) {
        this.card?.show(
          this.t('game.common.duelBye'),
          PALETTE.amber,
          this.t('game.sinkTheFleet.bye'),
        )
      } else {
        this.card?.show(this.t('game.common.waiting'), PALETTE.dim)
      }
      return
    }
    if (!this.target || viewId !== this.viewId) {
      this.viewId = viewId
      this.build(snap, me.fleetCells)
    }
    const target = this.target
    const own = this.own
    if (!target || !own) return
    if (this.boardsHidden) {
      this.boardsHidden = false
      target.setVisible(true)
      own.setVisible(true)
    }

    const rivalColor = this.state.colorOf(me.opponentId, PALETTE.red)
    if (this.playing) {
      this.hint?.setVisible(!me.done) // nothing to tap once the duel is over
      this.hud?.setScore(
        this.t('game.sinkTheFleet.hitsChip', { n: me.hitsOnOpponent, total: me.fleetCells }),
      )
      const selfColor = this.state.colorOf(this.selfId, PALETTE.cyan)
      target.setLabels(
        this.t('game.sinkTheFleet.target'),
        PALETTE.text,
        this.state.nameOf(me.opponentId),
        rivalColor,
      )
      own.setLabels(this.t('game.sinkTheFleet.yourFleet'), selfColor)
    } else {
      const viewed = viewId ?? ''
      // A duellist watching after their own duel keeps their verdict in the HUD.
      this.hud?.setScore(
        bye
          ? this.t('game.common.duelBye')
          : seat?.opponentId && seat.done
            ? this.t(verdictKey(seat.won))
            : '',
      )
      const watching = this.t('game.common.duelWatch', {
        a: this.state.nameOf(viewed),
        b: this.state.nameOf(me.opponentId),
      })
      if (this.hint?.text !== watching) this.hint?.setText(watching)
      this.hint?.setVisible(true)
      target.setLabels(this.state.nameOf(me.opponentId), rivalColor)
      own.setLabels(this.state.nameOf(viewed), this.state.colorOf(viewed, PALETTE.cyan))
    }

    // Shots (on each new snapshot): the viewed player's land on the rival's sea, the rival's (from the
    // public snapshot) on theirs.
    if (this.state.tick !== this.syncedTick) {
      this.syncedTick = this.state.tick
      const incoming: readonly NavalShot[] = (snap.players[me.opponentId]?.shots ?? []).map(
        decodeShot,
      )
      const rivalSunk = me.hitsOnOpponent >= me.fleetCells
      const ownSunk = me.hitsOnYou >= me.fleetCells
      const mine = target.sync(me.shots.map(decodeShot), rivalSunk)
      for (const s of mine) this.onMyShot(s, rivalSunk)
      const theirs = own.sync(incoming, ownSunk)
      for (const s of theirs) this.onIncoming(s)
      // The finishing hit sends the whole fleet under: the wrecks go down with a splash.
      if ((rivalSunk && mine.some((s) => s.hit)) || (ownSunk && theirs.some((s) => s.hit))) {
        this.time.delayedCall(320, () => this.battle(() => this.sfx.splash()))
      }
    }

    this.updateTurn(me, rivalColor)
    // A bye first hears that it scores a draw, then watches.
    if (bye && this.byeCardUntil < 0) this.byeCardUntil = time + BYE_CARD_MS
    if (time < this.byeCardUntil) {
      this.card?.show(this.t('game.common.duelBye'), PALETTE.amber, this.t('game.sinkTheFleet.bye'))
    } else {
      this.updateEnd(snap, me, time)
    }
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
      this.turnBar?.clear().setData('bar', '')
      return
    }
    const mine = me.yourTurn
    if (mine !== this.wasMyTurn) {
      if (this.wasMyTurn !== null && mine && this.playing) this.sfx.go()
      this.turnMax = 0
      this.wasMyTurn = mine
      if (this.turnText) punch(this, this.turnText, 0.2, 110)
    }
    target.setFocus(mine ? 'active' : 'dim', PALETTE.amber)
    own.setFocus(mine ? 'idle' : 'active', PALETTE.red)
    target.setAimable(mine && this.playing)
    if (this.turnText) {
      const shooter = mine ? (this.viewId ?? '') : (me.opponentId ?? '')
      const text = !this.playing
        ? this.t('game.sinkTheFleet.turnOf', { name: this.state.nameOf(shooter) })
        : mine
          ? this.t('game.sinkTheFleet.yourTurn')
          : this.t('game.sinkTheFleet.waitTurn')
      setFittedText(this.turnText, text, this.scale.width - 24, this.turnSizes)
      setTextColor(
        this.turnText,
        this.playing ? (mine ? PALETTE.amber : rivalColor) : this.state.colorOf(shooter),
      )
    }

    this.turnMax = Math.max(this.turnMax, me.turnRemainingMs)
    const frac = this.turnMax > 0 ? me.turnRemainingMs / this.turnMax : 0
    const urgent = mine && this.playing && me.turnRemainingMs < 1500
    // Your shot is about to time out: one warning beep as the bar turns red.
    if (urgent && !this.urgentTurn) this.sfx.urgent()
    this.urgentTurn = urgent
    const color = mine ? (urgent ? PALETTE.red : PALETTE.amber) : PALETTE.frameLit
    if (this.turnBar) {
      const { x, y, w, h } = this.bar
      drawSegmentBar(this.turnBar, x, y, w, h, frac, color)
    }
  }

  // Duel over (others may still be playing): celebrate / commiserate at once, then — after the wreck
  // reveal has had a moment to play — hold a WIN / LOSE card until the round ends. A spectator gets the
  // winner's name instead.
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
      if (!this.playing) {
        this.sfx.tick()
      } else if (me.won === true) {
        this.sfx.cheer()
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
    const waiting = snap.roundRemainingMs > 0 ? this.t('game.common.waiting') : ''
    if (!this.playing) {
      const winner = me.won === null ? null : me.won ? this.viewId : me.opponentId
      this.card?.show(
        winner
          ? this.t('game.common.duelWinner', { name: this.state.nameOf(winner) })
          : this.t('game.sinkTheFleet.draw'),
        winner ? this.state.colorOf(winner, PALETTE.amber) : PALETTE.amber,
      )
      return
    }
    // A fleet sent to the bottom gets its own headline; a duel decided at the bell or by a walkout
    // just a win or a loss.
    const [key, color] =
      me.won === true
        ? [
            me.hitsOnOpponent >= me.fleetCells ? 'game.sinkTheFleet.won' : 'game.common.youWin',
            PALETTE.lime,
          ]
        : me.won === false
          ? [
              me.hitsOnYou >= me.fleetCells ? 'game.sinkTheFleet.lost' : 'game.common.youLose',
              PALETTE.red,
            ]
          : ['game.sinkTheFleet.draw', PALETTE.amber]
    const sub =
      me.oppLeft && me.opponentId
        ? this.t('game.common.duelOppLeft', { name: this.state.nameOf(me.opponentId) })
        : waiting
    this.card?.show(this.t(key), color, sub)
  }

  // A shot by the viewed player (you, while you play). A hit that doesn't finish the fleet shoots again.
  private onMyShot(s: NavalShot, sunk: boolean): void {
    const target = this.target
    if (!target) return
    target.shotFx(s, true)
    const { x, y } = target.cellXY(s.cell)
    if (s.hit) {
      this.battle(() => this.sfx.explosion())
      shake(this, 0.006, 140)
      floatText(this, x, y - target.cell * 0.4, this.t('game.sinkTheFleet.hit'), PALETTE.orange)
      if (!sunk) {
        floatText(
          this,
          x,
          y + target.cell * 0.3,
          this.t('game.sinkTheFleet.again'),
          PALETTE.amber,
          16,
        )
      }
    } else {
      this.battle(() => this.sfx.splash())
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
      this.battle(() => this.sfx.explosion())
      if (this.playing) this.sfx.hurt()
      shake(this, 0.012, 220)
      own.pulse(PALETTE.red)
      floatText(this, x, y - own.cell * 0.4, this.t('game.sinkTheFleet.hit'), PALETTE.red)
    } else {
      this.battle(() => this.sfx.splash())
      floatText(this, x, y - own.cell * 0.4, this.t('game.sinkTheFleet.splash'), PALETTE.dim, 14)
    }
  }

  // A shot's sound: full volume in your own duel, quieter for a duel you're only watching.
  private battle(sound: () => void): void {
    if (this.playing) sound()
    else this.sfx.quiet(sound, 0.5)
  }

  private hideBoards(): void {
    if (this.boardsHidden) return
    this.boardsHidden = true
    this.target?.setVisible(false)
    this.own?.setVisible(false)
    this.turnText?.setText('')
    this.turnBar?.clear().setData('bar', '')
  }
}
