import { PALETTE } from '@pp/shared'
import type { ClientMsg, TugOfWarSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import {
  addArcadeBackdrop,
  bodyStyle,
  ensurePixelBlock,
  headlineStyle,
  hexToCss,
} from '../pixelStyle'

const RED = 0xff5252
const BLUE = 0x5b8cff
const AMBER = PALETTE.amber

// Tug of War canvas. Scene key === the mini-game id so GameClient can start it by id. Reads
// authoritative snapshots from RoundState and sends one MINIGAME_INPUT per pull (team members only).
export class TugOfWarScene extends Phaser.Scene {
  private rope?: Phaser.GameObjects.Graphics
  private prompt?: Phaser.GameObjects.Text
  private teamText?: Phaser.GameObjects.Text
  private scoreText?: Phaser.GameObjects.Text
  private timer?: Phaser.GameObjects.Text
  private trackX = 0
  private trackW = 0
  private trackY = 0
  private knot?: Phaser.GameObjects.Image
  private knotSide: 'red' | 'blue' | 'amber' | undefined
  private knotKeys: Record<'red' | 'blue' | 'amber', string> = { red: '', blue: '', amber: '' }

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('tug-of-war')
  }

  create(): void {
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    const cx = width / 2
    this.trackW = width * 0.8
    this.trackX = (width - this.trackW) / 2
    this.trackY = height * 0.5
    this.knot = undefined
    this.knotSide = undefined

    this.add
      .text(this.trackX, height * 0.3, this.t('team.red'), headlineStyle(28, RED))
      .setOrigin(0, 0.5)
    this.add
      .text(this.trackX + this.trackW, height * 0.3, this.t('team.blue'), headlineStyle(28, BLUE))
      .setOrigin(1, 0.5)

    this.scoreText = this.add
      .text(cx, height * 0.3, '0 — 0', headlineStyle(24, PALETTE.text))
      .setOrigin(0.5)

    this.rope = this.add.graphics()

    const knotSize = 32
    this.knotKeys = {
      red: ensurePixelBlock(this, 'pp-tug-knot-red', knotSize, RED),
      blue: ensurePixelBlock(this, 'pp-tug-knot-blue', knotSize, BLUE),
      amber: ensurePixelBlock(this, 'pp-tug-knot-amber', knotSize, AMBER),
    }
    this.knot = this.add.image(cx, this.trackY, this.knotKeys.amber).setDisplaySize(24, 32)

    this.prompt = this.add
      .text(cx, height * 0.68, this.t('game.tugOfWar.pull'), headlineStyle(48, PALETTE.text))
      .setOrigin(0.5)

    this.teamText = this.add.text(cx, height * 0.8, '', bodyStyle(18, PALETTE.dim)).setOrigin(0.5)

    this.timer = this.add
      .text(cx, height * 0.14, '', headlineStyle(28, PALETTE.lime))
      .setOrigin(0.5)

    this.add
      .text(cx, height * 0.9, this.t('game.tugOfWar.hint'), bodyStyle(16, PALETTE.dim))
      .setOrigin(0.5)

    this.input.on('pointerdown', () => this.pull())
    this.input.keyboard?.on('keydown-SPACE', () => this.pull())
  }

  private myTeam(): 'red' | 'blue' | undefined {
    const snap = this.state.state as TugOfWarSnapshot | null
    if (!snap) return undefined
    return snap.teams[this.state.selfId ?? '']
  }

  private pull(): void {
    if (!this.myTeam()) return
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'pull' } })
  }

  private drawRope(offset: number): void {
    if (!this.rope) return
    const g = this.rope
    g.clear()
    const cx = this.trackX + this.trackW / 2
    g.lineStyle(6, PALETTE.dim, 1)
    g.beginPath()
    g.moveTo(this.trackX, this.trackY)
    g.lineTo(this.trackX + this.trackW, this.trackY)
    g.strokePath()
    // center line
    g.lineStyle(2, PALETTE.dim, 1)
    g.beginPath()
    g.moveTo(cx, this.trackY - 30)
    g.lineTo(cx, this.trackY + 30)
    g.strokePath()
    // knot marker driven by offset in [-1, 1]
    const clamped = Math.max(-1, Math.min(1, offset))
    const knotX = cx + (clamped * this.trackW) / 2
    const side = clamped < 0 ? 'red' : clamped > 0 ? 'blue' : 'amber'
    if (side !== this.knotSide) {
      this.knotSide = side
      this.knot?.setTexture(this.knotKeys[side])
    }
    this.knot?.setPosition(knotX, this.trackY)
  }

  override update(): void {
    const snap = this.state.state as TugOfWarSnapshot | null
    if (!snap || typeof snap.remainingMs !== 'number') return

    this.drawRope(snap.offset)
    this.scoreText?.setText(`${snap.red} — ${snap.blue}`)
    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)

    const team = this.myTeam()
    if (team) {
      const color = team === 'red' ? RED : BLUE
      this.prompt?.setText(this.t('game.tugOfWar.pull'))
      this.prompt?.setColor(hexToCss(color))
      const name = team === 'red' ? this.t('team.red') : this.t('team.blue')
      this.teamText?.setText(`${this.t('game.tugOfWar.team')} ${name}`)
    } else {
      this.prompt?.setText(this.t('game.tugOfWar.spectator'))
      this.prompt?.setColor(hexToCss(PALETTE.dim))
      this.teamText?.setText('')
    }
  }
}
