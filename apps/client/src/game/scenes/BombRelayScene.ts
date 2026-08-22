import { PALETTE, hexToCss } from '@pp/shared'
import type { BombRelaySnapshot, ClientMsg } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { addArcadeBackdrop, bodyStyle, ensurePixelOrb, headlineStyle } from '../pixelStyle'

// Bespoke team colors — kept as-is, not PALETTE tokens (see pixelStyle.ts task notes).
const RED = 0xff5252
const BLUE = 0x5b8cff

// Bomb Relay canvas. Scene key === the mini-game id so GameClient can start it by id. Team hot-potato
// relay: only the current holder may mash. Reads authoritative snapshots from RoundState and sends one
// MINIGAME_INPUT per press when the local player holds the bomb.
export class BombRelayScene extends Phaser.Scene {
  private side?: Phaser.GameObjects.Rectangle
  private bombBody?: Phaser.GameObjects.Image
  private bomb?: Phaser.GameObjects.Graphics
  private prompt?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private bar?: Phaser.GameObjects.Graphics
  private redScore?: Phaser.GameObjects.Text
  private blueScore?: Phaser.GameObjects.Text
  private timer?: Phaser.GameObjects.Text
  private cx = 0
  private cy = 0
  private barX = 0
  private barY = 0
  private barW = 0
  private prevRelays = 0
  private prevExplosions = 0

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('bomb-relay')
  }

  create(): void {
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    this.cx = width / 2
    this.cy = height * 0.44
    this.barW = width * 0.6
    this.barX = (width - this.barW) / 2
    this.barY = height * 0.66

    this.side = this.add.rectangle(this.cx, height / 2, width, height, RED, 0)

    this.timer = this.add
      .text(this.cx, height * 0.12, '', headlineStyle(28, PALETTE.lime))
      .setOrigin(0.5)

    this.bombBody = this.add.image(
      this.cx,
      this.cy,
      ensurePixelOrb(this, 'pp-bomb-body-dim', 20, PALETTE.dim),
    )
    this.bomb = this.add.graphics()

    this.prompt = this.add
      .text(this.cx, height * 0.24, '', headlineStyle(40, PALETTE.amber))
      .setOrigin(0.5)

    this.bar = this.add.graphics()

    this.status = this.add
      .text(this.cx, height * 0.74, '', bodyStyle(18, PALETTE.dim, { align: 'center' }))
      .setOrigin(0.5)

    this.redScore = this.add.text(this.cx, height * 0.82, '', bodyStyle(18, RED)).setOrigin(0.5)
    this.blueScore = this.add.text(this.cx, height * 0.86, '', bodyStyle(18, BLUE)).setOrigin(0.5)

    this.add
      .text(this.cx, height * 0.94, this.t('game.bombRelay.hint'), bodyStyle(16, PALETTE.dim))
      .setOrigin(0.5)

    this.input.on('pointerdown', () => this.mash())
    this.input.keyboard?.on('keydown-SPACE', () => this.mash())
  }

  private myTeam(): 'red' | 'blue' | undefined {
    const snap = this.state.state as BombRelaySnapshot | null
    if (!snap) return undefined
    return snap.playerTeam[this.state.selfId ?? '']
  }

  private amHolder(): boolean {
    const snap = this.state.state as BombRelaySnapshot | null
    const team = this.myTeam()
    if (!snap || !team) return false
    return snap.teams[team].holderId === (this.state.selfId ?? '')
  }

  private mash(): void {
    if (!this.amHolder()) return
    const snap = this.state.state as BombRelaySnapshot | null
    if (!snap || snap.roundRemainingMs <= 0) return
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'mash' } })
  }

  private drawBomb(color: number, prominent: boolean): void {
    if (!this.bomb || !this.bombBody) return
    const g = this.bomb
    g.clear()
    const r = prominent ? 46 : 30
    // fuse
    g.lineStyle(4, PALETTE.dim, 1)
    g.beginPath()
    g.moveTo(this.cx, this.cy - r)
    g.lineTo(this.cx + r * 0.5, this.cy - r - 22)
    g.strokePath()
    // spark
    g.fillStyle(PALETTE.amber, 1)
    g.fillCircle(this.cx + r * 0.5, this.cy - r - 22, prominent ? 6 : 4)
    // body
    const key = ensurePixelOrb(this, `pp-bomb-body-${color}`, 20, color)
    this.bombBody
      .setTexture(key)
      .setDisplaySize(r * 2, r * 2)
      .setPosition(this.cx, this.cy)
  }

  private drawBar(progress: number, color: number): void {
    if (!this.bar) return
    const g = this.bar
    g.clear()
    const h = 20
    g.fillStyle(PALETTE.panelAlt, 1)
    g.fillRect(this.barX, this.barY, this.barW, h)
    const clamped = Math.max(0, Math.min(1, progress))
    g.fillStyle(color, 1)
    g.fillRect(this.barX, this.barY, this.barW * clamped, h)
    g.lineStyle(2, PALETTE.dim, 1)
    g.strokeRect(this.barX, this.barY, this.barW, h)
  }

  override update(): void {
    const snap = this.state.state as BombRelaySnapshot | null
    if (!snap || typeof snap.roundRemainingMs !== 'number') return

    this.timer?.setText(`${Math.max(0, Math.ceil(snap.roundRemainingMs / 1000))}s`)

    const red = snap.teams.red
    const blue = snap.teams.blue
    this.redScore?.setText(
      `${this.t('team.red')}  ${this.t('game.bombRelay.relays')} ${red.relays}  ${this.t('game.bombRelay.booms')} ${red.explosions}`,
    )
    this.blueScore?.setText(
      `${this.t('team.blue')}  ${this.t('game.bombRelay.relays')} ${blue.relays}  ${this.t('game.bombRelay.booms')} ${blue.explosions}`,
    )

    const team = this.myTeam()
    if (!team) {
      this.side?.setFillStyle(RED, 0)
      this.drawBomb(PALETTE.dim, false)
      this.prompt?.setText(this.t('game.bombRelay.spectator'))
      this.prompt?.setColor(hexToCss(PALETTE.dim))
      this.status?.setText('')
      this.bar?.clear()
      return
    }

    const view = snap.teams[team]
    const color = team === 'red' ? RED : BLUE
    this.side?.setFillStyle(color, 0.08)

    // Sound feedback when the local team relays or explodes.
    if (view.relays > this.prevRelays) this.sfx.coin()
    if (view.explosions > this.prevExplosions) this.sfx.wrong()
    this.prevRelays = view.relays
    this.prevExplosions = view.explosions

    const over = snap.roundRemainingMs <= 0
    const holder = this.amHolder()

    this.drawBomb(color, holder && !over)

    if (holder && !over) {
      this.prompt?.setText(this.t('game.bombRelay.mash'))
      this.prompt?.setColor(hexToCss(PALETTE.amber))
      this.status?.setText('')
      this.drawBar(view.legProgress / Math.max(1, view.legTarget), color)
    } else {
      this.prompt?.setText(this.t('game.bombRelay.waiting'))
      this.prompt?.setColor(hexToCss(PALETTE.dim))
      this.status?.setText(this.t('game.bombRelay.teammateHolds'))
      this.bar?.clear()
    }
  }
}
