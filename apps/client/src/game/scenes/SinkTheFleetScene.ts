import { PALETTE } from '@pp/shared'
import type { ClientMsg, SinkTheFleetSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { addArcadeBackdrop, bodyStyle, ensurePixelBlock, headlineStyle } from '../pixelStyle'

const HIT = PALETTE.red
const MISS = PALETTE.dim
const NEUTRAL = PALETTE.panel

// Sink the Fleet (Battleship duel) canvas. Renders two grids: the TARGET grid (fire at the opponent)
// and YOUR FLEET grid (incoming damage). Fires on the local player's turn only. The snapshot is
// server-authoritative and never carries ship positions. Scene key === mini-game id.
export class SinkTheFleetScene extends Phaser.Scene {
  private turnText?: Phaser.GameObjects.Text
  private infoText?: Phaser.GameObjects.Text
  private resultText?: Phaser.GameObjects.Text
  private targetLabel?: Phaser.GameObjects.Text
  private fleetLabel?: Phaser.GameObjects.Text
  private waitText?: Phaser.GameObjects.Text
  private targetCells: Phaser.GameObjects.Image[] = []
  private fleetCells: Phaser.GameObjects.Image[] = []
  private built = false
  private neutralKey = ''
  private hitKey = ''
  private missKey = ''

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('sink-the-fleet')
  }

  create(): void {
    addArcadeBackdrop(this)
    this.built = false
    this.targetCells = []
    this.fleetCells = []
    const { width, height } = this.scale
    const cx = width / 2
    this.turnText = this.add
      .text(cx, height * 0.05, '', headlineStyle(24, PALETTE.amber))
      .setOrigin(0.5)
    this.infoText = this.add
      .text(cx, height * 0.11, '', bodyStyle(16, PALETTE.text, { align: 'center' }))
      .setOrigin(0.5)
    this.resultText = this.add
      .text(cx, height * 0.05, '', headlineStyle(28, PALETTE.amber))
      .setOrigin(0.5)
      .setVisible(false)
    this.waitText = this.add
      .text(cx, height / 2, '...', headlineStyle(24, PALETTE.text))
      .setOrigin(0.5)
      .setVisible(false)
    this.add
      .text(cx, height * 0.95, this.t('game.sinkTheFleet.hint'), bodyStyle(14, PALETTE.dim))
      .setOrigin(0.5)
  }

  // Both grids are built once, when the first snapshot (with a grid side length) arrives.
  private build(snap: SinkTheFleetSnapshot): void {
    const { width, height } = this.scale
    const n = snap.grid
    const sideBySide = width > height
    if (sideBySide) {
      const area = Math.min(width * 0.42, height * 0.55)
      this.buildGrid(this.targetCells, width * 0.28, height * 0.55, area, n, true)
      this.buildGrid(this.fleetCells, width * 0.72, height * 0.55, area, n, false)
      const labelY = height * 0.55 - area / 2 - 18
      this.targetLabel = this.gridLabel(width * 0.28, labelY, this.t('game.sinkTheFleet.target'))
      this.fleetLabel = this.gridLabel(width * 0.72, labelY, this.t('game.sinkTheFleet.yourFleet'))
    } else {
      const area = Math.min(width * 0.82, height * 0.34)
      this.buildGrid(this.targetCells, width / 2, height * 0.38, area, n, true)
      this.buildGrid(this.fleetCells, width / 2, height * 0.74, area, n, false)
      this.targetLabel = this.gridLabel(
        width / 2,
        height * 0.38 - area / 2 - 18,
        this.t('game.sinkTheFleet.target'),
      )
      this.fleetLabel = this.gridLabel(
        width / 2,
        height * 0.74 - area / 2 - 18,
        this.t('game.sinkTheFleet.yourFleet'),
      )
    }
    this.built = true
  }

  private gridLabel(x: number, y: number, text: string): Phaser.GameObjects.Text {
    return this.add.text(x, y, text, bodyStyle(16, PALETTE.text)).setOrigin(0.5)
  }

  private buildGrid(
    into: Phaser.GameObjects.Image[],
    ccx: number,
    ccy: number,
    area: number,
    n: number,
    interactive: boolean,
  ): void {
    const gap = area * 0.02
    const size = (area - gap * (n - 1)) / n
    const cellPx = Math.max(4, Math.round(size))
    this.neutralKey = ensurePixelBlock(this, `pp-fleet-cell-neutral-${cellPx}`, cellPx, NEUTRAL)
    this.hitKey = ensurePixelBlock(this, `pp-fleet-cell-hit-${cellPx}`, cellPx, HIT)
    this.missKey = ensurePixelBlock(this, `pp-fleet-cell-miss-${cellPx}`, cellPx, MISS)
    const startX = ccx - area / 2 + size / 2
    const startY = ccy - area / 2 + size / 2
    for (let i = 0; i < n * n; i++) {
      const col = i % n
      const row = Math.floor(i / n)
      const x = startX + col * (size + gap)
      const y = startY + row * (size + gap)
      const img = this.add.image(x, y, this.neutralKey).setDisplaySize(size, size)
      if (interactive) {
        img.setInteractive({ useHandCursor: true })
        img.on('pointerdown', () => this.fire(i))
      }
      into.push(img)
    }
  }

  private fire(cell: number): void {
    const snap = this.state.state as SinkTheFleetSnapshot | null
    if (!snap) return
    const me = snap.players[this.state.selfId ?? '']
    if (!me || me.done || !me.yourTurn) return
    if (me.opponentId === null) return
    if (me.shots.some((s) => s.cell === cell)) return
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'fire', cell } })
  }

  override update(): void {
    const snap = this.state.state as SinkTheFleetSnapshot | null
    if (!snap) return
    if (!this.built) this.build(snap)
    const me = snap.players[this.state.selfId ?? '']
    if (!me) {
      this.setGridsVisible(false)
      this.waitText?.setVisible(true)
      this.turnText?.setText('')
      this.infoText?.setText('')
      this.resultText?.setVisible(false)
      return
    }
    this.waitText?.setVisible(false)
    this.setGridsVisible(true)

    if (me.opponentId === null) {
      this.turnText?.setText(this.t('game.sinkTheFleet.bye'))
      this.infoText?.setText('')
      this.resultText?.setVisible(false)
      return
    }

    const roundSecs = Math.ceil(snap.roundRemainingMs / 1000)
    const turnSecs = Math.ceil(me.turnRemainingMs / 1000)
    this.infoText?.setText(
      `${me.hitsOnOpponent}/${me.fleetCells}  vs  ${me.hitsOnYou}/${me.fleetCells}\n${turnSecs}s / ${roundSecs}s`,
    )

    if (me.done) {
      this.turnText?.setVisible(false)
      const key =
        me.won === true
          ? 'game.sinkTheFleet.won'
          : me.won === false
            ? 'game.sinkTheFleet.lost'
            : 'game.sinkTheFleet.draw'
      this.resultText?.setText(this.t(key)).setVisible(true)
    } else {
      this.resultText?.setVisible(false)
      this.turnText
        ?.setVisible(true)
        .setText(
          me.yourTurn ? this.t('game.sinkTheFleet.yourTurn') : this.t('game.sinkTheFleet.waitTurn'),
        )
    }

    const shotByCell = new Map<number, boolean>()
    for (const s of me.shots) shotByCell.set(s.cell, s.hit)
    this.targetCells.forEach((img, i) => {
      img.setTexture(
        shotByCell.has(i) ? (shotByCell.get(i) ? this.hitKey : this.missKey) : this.neutralKey,
      )
    })

    const damaged = new Set(me.damage)
    this.fleetCells.forEach((img, i) => {
      img.setTexture(damaged.has(i) ? this.hitKey : this.neutralKey)
    })
  }

  private setGridsVisible(v: boolean): void {
    for (const r of this.targetCells) r.setVisible(v)
    for (const r of this.fleetCells) r.setVisible(v)
    this.targetLabel?.setVisible(v)
    this.fleetLabel?.setVisible(v)
  }
}
