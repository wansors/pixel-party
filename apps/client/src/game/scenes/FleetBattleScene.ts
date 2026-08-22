import type { ClientMsg, FleetBattleSnapshot, TeamId } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'

const HIT = 0xff5252
const MISS = 0x5b6b7b
const FRAME = 0x5b62a6
const NEUTRAL = 0x1b1e2e
const TEXT = '#eef1f7'
const ACCENT = '#ffcf4b'
const RED = 0xff5252
const BLUE = 0x5b8cff

// Fleet Battle (team Battleship) canvas. Renders two grids: the ENEMY grid (fire at the enemy team's
// fleet, on your team's turn) and OUR FLEET grid (incoming damage). Fires only when it's your team's
// turn. The snapshot is server-authoritative and never carries ship positions. Scene key === id.
export class FleetBattleScene extends Phaser.Scene {
  private turnText?: Phaser.GameObjects.Text
  private infoText?: Phaser.GameObjects.Text
  private resultText?: Phaser.GameObjects.Text
  private targetLabel?: Phaser.GameObjects.Text
  private fleetLabel?: Phaser.GameObjects.Text
  private waitText?: Phaser.GameObjects.Text
  private targetCells: Phaser.GameObjects.Rectangle[] = []
  private fleetCells: Phaser.GameObjects.Rectangle[] = []
  private built = false

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('fleet-battle')
  }

  create(): void {
    this.built = false
    this.targetCells = []
    this.fleetCells = []
    const { width, height } = this.scale
    const cx = width / 2
    this.turnText = this.add
      .text(cx, height * 0.05, '', { fontFamily: 'monospace', fontSize: '24px', color: ACCENT })
      .setOrigin(0.5)
    this.infoText = this.add
      .text(cx, height * 0.11, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: TEXT,
        align: 'center',
      })
      .setOrigin(0.5)
    this.resultText = this.add
      .text(cx, height * 0.05, '', { fontFamily: 'monospace', fontSize: '28px', color: ACCENT })
      .setOrigin(0.5)
      .setVisible(false)
    this.waitText = this.add
      .text(cx, height / 2, '...', { fontFamily: 'monospace', fontSize: '24px', color: TEXT })
      .setOrigin(0.5)
      .setVisible(false)
    this.add
      .text(cx, height * 0.95, this.t('game.fleetBattle.hint'), {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#5b6b7b',
      })
      .setOrigin(0.5)
  }

  // Both grids are built once, when the first snapshot (with a grid side length) arrives.
  private build(snap: FleetBattleSnapshot): void {
    const { width, height } = this.scale
    const n = snap.grid
    const sideBySide = width > height
    if (sideBySide) {
      const area = Math.min(width * 0.42, height * 0.55)
      this.buildGrid(this.targetCells, width * 0.28, height * 0.55, area, n, true)
      this.buildGrid(this.fleetCells, width * 0.72, height * 0.55, area, n, false)
      const labelY = height * 0.55 - area / 2 - 18
      this.targetLabel = this.gridLabel(width * 0.28, labelY, '')
      this.fleetLabel = this.gridLabel(width * 0.72, labelY, '')
    } else {
      const area = Math.min(width * 0.82, height * 0.34)
      this.buildGrid(this.targetCells, width / 2, height * 0.38, area, n, true)
      this.buildGrid(this.fleetCells, width / 2, height * 0.74, area, n, false)
      this.targetLabel = this.gridLabel(width / 2, height * 0.38 - area / 2 - 18, '')
      this.fleetLabel = this.gridLabel(width / 2, height * 0.74 - area / 2 - 18, '')
    }
    this.built = true
  }

  private gridLabel(x: number, y: number, text: string): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, text, { fontFamily: 'monospace', fontSize: '16px', color: TEXT })
      .setOrigin(0.5)
  }

  private buildGrid(
    into: Phaser.GameObjects.Rectangle[],
    ccx: number,
    ccy: number,
    area: number,
    n: number,
    interactive: boolean,
  ): void {
    const gap = area * 0.02
    const size = (area - gap * (n - 1)) / n
    const startX = ccx - area / 2 + size / 2
    const startY = ccy - area / 2 + size / 2
    for (let i = 0; i < n * n; i++) {
      const col = i % n
      const row = Math.floor(i / n)
      const x = startX + col * (size + gap)
      const y = startY + row * (size + gap)
      const rect = this.add.rectangle(x, y, size, size, NEUTRAL).setStrokeStyle(2, FRAME)
      if (interactive) {
        rect.setInteractive({ useHandCursor: true })
        rect.on('pointerdown', () => this.fire(i))
      }
      into.push(rect)
    }
  }

  private myTeam(): TeamId | undefined {
    const snap = this.state.state as FleetBattleSnapshot | null
    if (!snap) return undefined
    return snap.playerTeams[this.state.selfId ?? '']
  }

  private fire(cell: number): void {
    const snap = this.state.state as FleetBattleSnapshot | null
    if (!snap || snap.done) return
    const team = this.myTeam()
    if (!team || snap.turn !== team) return
    const mine = snap.teams[team]
    if (mine.shots.some((s) => s.cell === cell)) return
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'fire', cell } })
  }

  private teamName(team: TeamId): string {
    return team === 'red' ? this.t('team.red') : this.t('team.blue')
  }

  private teamColorCss(team: TeamId): string {
    return `#${(team === 'red' ? RED : BLUE).toString(16).padStart(6, '0')}`
  }

  override update(): void {
    const snap = this.state.state as FleetBattleSnapshot | null
    if (!snap) return
    if (!this.built) this.build(snap)
    const team = this.myTeam()

    if (!team) {
      this.setGridsVisible(false)
      this.waitText?.setVisible(true).setText(this.t('game.fleetBattle.spectator'))
      this.turnText?.setText('')
      this.infoText?.setText('')
      this.resultText?.setVisible(false)
      return
    }
    this.waitText?.setVisible(false)
    this.setGridsVisible(true)

    const enemy: TeamId = team === 'red' ? 'blue' : 'red'
    const mine = snap.teams[team]
    const theirs = snap.teams[enemy]
    this.targetLabel?.setText(this.teamName(enemy))
    this.fleetLabel?.setText(this.teamName(team))

    const roundSecs = Math.ceil(snap.roundRemainingMs / 1000)
    const turnSecs = Math.ceil(snap.turnRemainingMs / 1000)
    const hitsOnEnemy = theirs.damage.length
    const hitsOnUs = mine.damage.length
    this.infoText?.setText(
      `${hitsOnEnemy}/${mine.fleetCells}  vs  ${hitsOnUs}/${mine.fleetCells}\n${turnSecs}s / ${roundSecs}s`,
    )

    if (snap.done) {
      this.turnText?.setVisible(false)
      const key =
        snap.winner === null
          ? 'game.fleetBattle.draw'
          : snap.winner === team
            ? 'game.fleetBattle.won'
            : 'game.fleetBattle.lost'
      this.resultText?.setText(this.t(key)).setVisible(true)
    } else {
      this.resultText?.setVisible(false)
      const yourTurn = snap.turn === team
      this.turnText
        ?.setVisible(true)
        .setText(
          yourTurn
            ? this.t('game.fleetBattle.yourTurn', { team: this.teamName(team) })
            : this.t('game.fleetBattle.waitTurn', { team: this.teamName(snap.turn) }),
        )
        .setColor(this.teamColorCss(snap.turn))
    }

    const shotByCell = new Map<number, boolean>()
    for (const s of mine.shots) shotByCell.set(s.cell, s.hit)
    this.targetCells.forEach((rect, i) => {
      if (shotByCell.has(i)) rect.setFillStyle(shotByCell.get(i) ? HIT : MISS)
      else rect.setFillStyle(NEUTRAL)
    })

    const damaged = new Set(mine.damage)
    this.fleetCells.forEach((rect, i) => {
      rect.setFillStyle(damaged.has(i) ? HIT : NEUTRAL)
    })
  }

  private setGridsVisible(v: boolean): void {
    for (const r of this.targetCells) r.setVisible(v)
    for (const r of this.fleetCells) r.setVisible(v)
    this.targetLabel?.setVisible(v)
    this.fleetLabel?.setVisible(v)
  }
}
