import { type FleetBattleSnapshot, PALETTE, type TeamId } from '@pp/shared'
import type Phaser from 'phaser'
import { burst, floatText, punch, shake } from '../fx'
import { bodyStyle, headlineStyle, hexToCss, teamColor } from '../pixelStyle'
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

const MAX_CREW_SHOWN = 5
// Lets the wreck reveal play before the end card covers the middle of the screen.
const END_CARD_DELAY_MS = 1100

const otherTeam = (team: TeamId): TeamId => (team === 'red' ? 'blue' : 'red')

// Who may fire right now, from the local player's seat: their captain's call (`captain` = it's me),
// someone else's call (`aims`), the whole team (`open`), or the other team's turn (`wait`).
type TurnMode = 'captain' | 'aims' | 'open' | 'wait'

// Fleet Battle (team Battleship) canvas. Two pixel seas: ENEMY WATERS (click a cell — or aim with the
// arrows / WASD and fire with SPACE / ENTER — on your team's turn; the first shot uses the turn) and OUR FLEET (the enemy team's shots at us, both
// splashes and hits). Each team turn has a rotating captain who fires alone for the first half; then
// anyone on the team may. Players without a team watch both fleets. The snapshot never carries ship
// positions, only shot results. The turn banner (whose call it is) + bar and the glowing board in play
// show whose shot it is; each board lists its crew in their own identity colors, the captain lit.
export class FleetBattleScene extends MiniGameScene<FleetBattleSnapshot> {
  private target?: NavalBoard
  private own?: NavalBoard
  private card?: NavalEndCard
  private turnText?: Phaser.GameObjects.Text
  private subText?: Phaser.GameObjects.Text
  private hint?: Phaser.GameObjects.Text
  private turnBar?: Phaser.GameObjects.Graphics
  private bar = { x: 0, y: 0, w: 0, h: 0 }
  private boardsTop = 0
  private boardsBottom = 0
  private turnSizes: number[] = []
  private turnMax = 0
  private lastTurn: TeamId | null = null
  private lastMode = ''
  // The turn bar is in its last stretch on your call (its warning beep plays once).
  private urgentTurn = false
  // Crew-row names by player, to light up whoever captains the turn.
  private crewNames = new Map<string, Phaser.GameObjects.Text>()
  private endedAt = -1
  // Which team's fleet each board shows (the target board is the enemy fleet for team members; for
  // spectators it's simply red on one board, blue on the other).
  private targetFleet: TeamId = 'blue'
  private ownFleet: TeamId = 'red'
  private team: TeamId | undefined
  private syncedTick = -1

  constructor(...deps: SceneDeps) {
    super('fleet-battle', ...deps)
  }

  override create(): void {
    super.create()
    this.target = undefined
    this.own = undefined
    this.turnMax = 0
    this.lastTurn = null
    this.lastMode = ''
    this.urgentTurn = false
    this.crewNames = new Map()
    this.endedAt = -1
    this.team = undefined
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
    this.subText = this.add
      .text(
        cx,
        this.bar.y + this.bar.h + 6,
        '',
        bodyStyle(compact ? 12 : big ? 18 : 14, PALETTE.dim),
      )
      .setOrigin(0.5, 0)
    this.boardsTop = this.bar.y + this.bar.h + (compact ? 6 : 10)

    const hintSize = compact ? 11 : big ? 16 : 14
    this.hint = this.add
      .text(
        cx,
        height - 8,
        this.t(compact ? 'game.fleetBattle.hint' : 'game.fleetBattle.hintPc'),
        bodyStyle(hintSize, PALETTE.dim, { align: 'center', wordWrap: { width: width * 0.92 } }),
      )
      .setOrigin(0.5, 1)
    this.boardsBottom = height - hintSize * (compact ? 2.6 : 1.8) - 8
    this.card = new NavalEndCard(this)

    // Keyboard aim whenever you may fire (the mouse works too): the cursor walks the enemy sea.
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

  // Your call right now: your team's turn, and you're its captain or the turn is open.
  private canFire(): boolean {
    const snap = this.snap
    if (!snap || snap.done || !this.team) return false
    const mode = this.modeOf(snap)
    return mode === 'captain' || mode === 'open'
  }

  protected override remainingMs(snap: FleetBattleSnapshot): number {
    return snap.roundRemainingMs
  }

  // Both boards (and the crew rows) are built once, from the first snapshot: team membership is fixed
  // for the round.
  private build(snap: FleetBattleSnapshot): void {
    const { width, height } = this.scale
    this.team = snap.playerTeams[this.selfId]
    this.targetFleet = this.team ? otherTeam(this.team) : 'blue'
    this.ownFleet = this.team ?? 'red'
    // Spectators get a little headroom for the "watching" line under the turn bar.
    const top = this.boardsTop + (this.team ? 0 : 16)
    const rects = layoutBoards(width, height, top, this.boardsBottom)
    const fleetCells = snap.teams.red.fleetCells
    this.target = new NavalBoard(this, rects.target, snap.grid, fleetCells, (cell) =>
      this.fire(cell),
    )
    this.own = new NavalBoard(this, rects.own, snap.grid, fleetCells)
    this.target.setLabels(
      this.team ? this.t('game.fleetBattle.enemyWaters') : this.teamName(this.targetFleet),
      teamColor(this.targetFleet),
    )
    this.own.setLabels(
      this.team ? this.t('game.fleetBattle.ourFleet') : this.teamName(this.ownFleet),
      teamColor(this.ownFleet),
    )
    this.crewRow(this.target, this.targetFleet, snap)
    this.crewRow(this.own, this.ownFleet, snap)
    if (!this.team) {
      this.subText?.setText(this.t('game.fleetBattle.spectator'))
      this.hint?.setVisible(false) // spectators have nothing to tap
    }
  }

  // A team's crew on the board's tag line: each member's name in their own identity color (self first),
  // trimmed to what fits over the board with a "+N" for the rest.
  private crewRow(board: NavalBoard, team: TeamId, snap: FleetBattleSnapshot): void {
    const ids = Object.keys(snap.playerTeams)
      .filter((id) => snap.playerTeams[id] === team)
      .sort((a, b) => (a === this.selfId ? -1 : b === this.selfId ? 1 : a.localeCompare(b)))
    const style = bodyStyle(board.tagSize)
    const gap = 10
    const maxW = Math.min(this.scale.width - 24, board.size * 1.15)
    const parts: Phaser.GameObjects.Text[] = []
    let total = 0
    for (const [i, id] of ids.slice(0, MAX_CREW_SHOWN).entries()) {
      const name = this.add
        .text(0, board.tag.y, this.label(id).toUpperCase(), style)
        .setColor(hexToCss(this.state.colorOf(id, PALETTE.text)))
        .setOrigin(0, 1)
      // Leave room for a "+N" chip if anyone is left after this name.
      const reserve = i < ids.length - 1 ? 40 : 0
      if (parts.length > 0 && total + gap + name.width + reserve > maxW) {
        name.destroy()
        break
      }
      total += (parts.length > 0 ? gap : 0) + name.width
      parts.push(name)
      this.crewNames.set(id, name)
    }
    if (ids.length > parts.length) {
      const more = this.add.text(0, board.tag.y, `+${ids.length - parts.length}`, style)
      total += gap + more.setOrigin(0, 1).width
      parts.push(more)
    }
    let x = board.tag.x - total / 2
    for (const p of parts) {
      p.setX(x)
      x += p.width + gap
    }
  }

  private teamName(team: TeamId): string {
    return this.t(`team.${team}`).toUpperCase()
  }

  private fire(cell: number): void {
    const snap = this.snap
    if (!snap || snap.done || !this.team || this.modeOf(snap) === 'aims') return
    if (snap.turn !== this.team || snap.teams[this.team].shots.some((s) => s.cell === cell)) return
    this.sfx.shoot()
    this.sendInput({ kind: 'fire', cell })
    this.target?.setPending(cell)
  }

  protected frame(snap: FleetBattleSnapshot | null, time: number): void {
    if (!snap) return
    if (!this.target) this.build(snap)
    const target = this.target
    const own = this.own
    if (!target || !own) return

    // A board shows the shots fired AT that fleet, i.e. by the other team (synced per new snapshot).
    const atTarget = snap.teams[otherTeam(this.targetFleet)]
    const atOwn = snap.teams[otherTeam(this.ownFleet)]
    const fleetCells = atTarget.fleetCells
    const sunk = (fleet: TeamId): boolean => snap.teams[fleet].damage.length >= fleetCells
    if (this.state.tick !== this.syncedTick) {
      this.syncedTick = this.state.tick
      const atTargetNew = target.sync(atTarget.shots, sunk(this.targetFleet))
      for (const s of atTargetNew) this.onShot(target, s, true)
      const atOwnNew = own.sync(atOwn.shots, sunk(this.ownFleet))
      for (const s of atOwnNew) this.onShot(own, s, false)
      // The finishing hit sends the whole fleet under: the wrecks go down with a splash.
      if (atTargetNew.some((s) => s.hit) && sunk(this.targetFleet)) this.sinkSfx()
      if (atOwnNew.some((s) => s.hit) && sunk(this.ownFleet)) this.sinkSfx()
    }

    if (this.team) {
      const hits = snap.teams[this.targetFleet].damage.length
      this.hud?.setScore(this.t('game.fleetBattle.hitsChip', { n: hits, total: fleetCells }))
    }
    this.updateTurn(snap)
    this.updateEnd(snap, time)
    target.tick(time)
    own.tick(time)
  }

  private modeOf(snap: FleetBattleSnapshot): TurnMode {
    if (this.team !== snap.turn) return 'wait'
    if (snap.openInMs <= 0) return 'open'
    return snap.captainId === this.selfId ? 'captain' : 'aims'
  }

  private updateTurn(snap: FleetBattleSnapshot): void {
    const target = this.target
    const own = this.own
    if (!target || !own) return
    if (snap.done) {
      target.setFocus('idle')
      own.setFocus('idle')
      target.setAimable(false)
      this.turnText?.setText('')
      if (this.team) this.subText?.setText('')
      this.turnBar?.clear().setData('bar', '')
      for (const name of this.crewNames.values()) name.setAlpha(1)
      return
    }
    const turn = snap.turn
    const mode = this.modeOf(snap)
    if (turn !== this.lastTurn) this.turnMax = 0
    if (`${turn}:${mode}` !== `${this.lastTurn}:${this.lastMode}`) {
      // Your call now (captain, or the turn just opened up): go!
      if (this.lastTurn !== null && (mode === 'captain' || mode === 'open')) this.sfx.go()
      this.lastTurn = turn
      this.lastMode = mode
      if (this.turnText) punch(this, this.turnText, 0.2, 110)
    }
    // The turn team fires at the other team's fleet: that board is the one in play.
    const firedAt = otherTeam(turn)
    const color = teamColor(turn)
    target.setFocus(firedAt === this.targetFleet ? 'active' : this.team ? 'dim' : 'idle', color)
    own.setFocus(firedAt === this.ownFleet ? 'active' : this.team ? 'dim' : 'idle', color)
    target.setAimable(mode === 'captain' || mode === 'open')
    // The captain's name stays lit in the crew row while the call is theirs alone.
    const calling = snap.openInMs > 0 ? snap.captainId : null
    for (const [id, name] of this.crewNames) {
      name.setAlpha(calling === null || snap.playerTeams[id] !== turn || id === calling ? 1 : 0.45)
    }
    if (this.turnText) {
      const captain = snap.captainId ?? ''
      const text =
        mode === 'captain'
          ? this.t('game.fleetBattle.yourShot')
          : mode === 'aims'
            ? this.t('game.fleetBattle.captainAims', { name: this.state.nameOf(captain) })
            : mode === 'open'
              ? this.t('game.fleetBattle.yourTurn', { team: this.teamName(turn) })
              : this.t('game.fleetBattle.waitTurn', { team: this.teamName(turn) })
      setFittedText(this.turnText, text, this.scale.width - 24, this.turnSizes)
      setTextColor(this.turnText, mode === 'aims' ? this.state.colorOf(captain, color) : color)
    }
    // Team members get the countdown to when the whole crew may fire (spectators keep their line).
    if (this.team && this.subText) {
      const s = Math.ceil(snap.openInMs / 1000)
      const sub =
        mode === 'captain'
          ? this.t('game.fleetBattle.crewIn', { s })
          : mode === 'aims'
            ? this.t('game.fleetBattle.youIn', { s })
            : ''
      if (this.subText.text !== sub) this.subText.setText(sub)
    }

    this.turnMax = Math.max(this.turnMax, snap.turnRemainingMs)
    const frac = this.turnMax > 0 ? snap.turnRemainingMs / this.turnMax : 0
    const urgent = mode !== 'wait' && snap.turnRemainingMs < 1500
    // Your call is about to time out: one warning beep as the bar turns amber.
    if (urgent && !this.urgentTurn && (mode === 'captain' || mode === 'open')) this.sfx.urgent()
    this.urgentTurn = urgent
    if (this.turnBar) {
      const { x, y, w, h } = this.bar
      drawSegmentBar(this.turnBar, x, y, w, h, frac, urgent ? PALETTE.amber : color)
    }
  }

  // Battle over: fanfare at once, then (after the wreck reveal) a WIN / LOSE card.
  private updateEnd(snap: FleetBattleSnapshot, time: number): void {
    if (!snap.done) {
      if (this.card?.visible) this.card.hide()
      return
    }
    const won = this.team !== undefined && snap.winner === this.team
    const lost = this.team !== undefined && snap.winner !== null && snap.winner !== this.team
    // Already over on the first snapshot (a relayout restart): straight to the card, no replay.
    if (this.endedAt < 0 && this.firstSnapshot) this.endedAt = Math.max(0, time - END_CARD_DELAY_MS)
    if (this.endedAt < 0) {
      this.endedAt = time
      const c = this.target?.center()
      if (won || (!this.team && snap.winner)) {
        this.sfx.cheer()
        if (won) this.sfx.coin()
        const color = snap.winner ? teamColor(snap.winner) : PALETTE.amber
        if (c) {
          burst(this, c.x, c.y, PALETTE.amber, 28, 320)
          burst(this, c.x, c.y, color, 20, 260)
        }
      } else if (lost) {
        this.sfx.wrong()
        shake(this, 0.012, 260)
      } else {
        this.sfx.tick()
      }
    }
    if (time - this.endedAt < END_CARD_DELAY_MS) return
    if (snap.winner === null) {
      this.card?.show(this.t('game.fleetBattle.draw'), PALETTE.amber)
      return
    }
    // A win on the clock (no fleet sunk) says why: more hits, or as many with fewer shots.
    const loser = otherTeam(snap.winner)
    const sunk = snap.teams[loser].damage.length >= snap.teams[loser].fleetCells
    const hits = (team: TeamId): number => snap.teams[otherTeam(team)].damage.length
    const why = sunk
      ? ''
      : hits(snap.winner) > hits(loser)
        ? this.t('game.fleetBattle.onHits', { a: hits(snap.winner), b: hits(loser) })
        : this.t('game.fleetBattle.onShots')
    if (!this.team) {
      const team = this.teamName(snap.winner)
      this.card?.show(this.t('game.fleetBattle.teamWins', { team }), teamColor(snap.winner), why)
    } else if (won) {
      this.card?.show(
        this.t(sunk ? 'game.fleetBattle.won' : 'game.fleetBattle.wonTime'),
        PALETTE.lime,
        why,
      )
    } else {
      this.card?.show(
        this.t(sunk ? 'game.fleetBattle.lost' : 'game.fleetBattle.lostTime'),
        PALETTE.red,
        why,
      )
    }
  }

  // Shot feedback. For team members the target board is "our shot" (good news on a hit) and the own
  // board is "incoming" (bad news on a hit); spectators get neutral feedback on both.
  private onShot(board: NavalBoard, s: NavalShot, onTarget: boolean): void {
    const incoming = this.team !== undefined && !onTarget
    board.shotFx(s, s.hit)
    const { x, y } = board.cellXY(s.cell)
    const ty = y - board.cell * 0.4
    if (!s.hit) {
      this.sfx.splash()
      floatText(
        this,
        x,
        ty,
        this.t('game.fleetBattle.splash'),
        incoming ? PALETTE.dim : PALETTE.cyan,
        14,
      )
      return
    }
    floatText(this, x, ty, this.t('game.fleetBattle.hit'), incoming ? PALETTE.red : PALETTE.orange)
    this.sfx.explosion()
    if (incoming) {
      this.sfx.hurt()
      shake(this, 0.012, 220)
      board.pulse(PALETTE.red)
    } else {
      shake(this, 0.006, 140)
    }
  }

  // A fleet's last ship goes down (after the finishing explosion has rung out).
  private sinkSfx(): void {
    this.time.delayedCall(320, () => this.sfx.splash())
  }
}
