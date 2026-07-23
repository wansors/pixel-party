import type { BombRelaySnapshot, ClientMsg } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'

const RED = 0xff5252
const BLUE = 0x5b8cff

// Bomb Relay canvas. Scene key === the mini-game id so GameClient can start it by id. Team hot-potato
// relay: only the current holder may mash. Reads authoritative snapshots from RoundState and sends one
// MINIGAME_INPUT per press when the local player holds the bomb.
export class BombRelayScene extends Phaser.Scene {
  private side?: Phaser.GameObjects.Rectangle
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
    const { width, height } = this.scale
    this.cx = width / 2
    this.cy = height * 0.44
    this.barW = width * 0.6
    this.barX = (width - this.barW) / 2
    this.barY = height * 0.66

    this.side = this.add.rectangle(this.cx, height / 2, width, height, RED, 0)

    this.timer = this.add
      .text(this.cx, height * 0.12, '', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#06d6a0',
      })
      .setOrigin(0.5)

    this.bomb = this.add.graphics()

    this.prompt = this.add
      .text(this.cx, height * 0.24, '', {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: '#ffd166',
      })
      .setOrigin(0.5)

    this.bar = this.add.graphics()

    this.status = this.add
      .text(this.cx, height * 0.74, '', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#9fb3c8',
        align: 'center',
      })
      .setOrigin(0.5)

    this.redScore = this.add
      .text(this.cx, height * 0.82, '', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ff5252',
      })
      .setOrigin(0.5)
    this.blueScore = this.add
      .text(this.cx, height * 0.86, '', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#5b8cff',
      })
      .setOrigin(0.5)

    this.add
      .text(this.cx, height * 0.94, this.t('game.bombRelay.hint'), {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#5b6b7b',
      })
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
    if (!this.bomb) return
    const g = this.bomb
    g.clear()
    const r = prominent ? 46 : 30
    // fuse
    g.lineStyle(4, 0x9fb3c8, 1)
    g.beginPath()
    g.moveTo(this.cx, this.cy - r)
    g.lineTo(this.cx + r * 0.5, this.cy - r - 22)
    g.strokePath()
    // spark
    g.fillStyle(0xffd166, 1)
    g.fillCircle(this.cx + r * 0.5, this.cy - r - 22, prominent ? 6 : 4)
    // body
    g.fillStyle(color, 1)
    g.fillCircle(this.cx, this.cy, r)
    g.lineStyle(3, 0x0b0f14, 1)
    g.strokeCircle(this.cx, this.cy, r)
  }

  private drawBar(progress: number, color: number): void {
    if (!this.bar) return
    const g = this.bar
    g.clear()
    const h = 20
    g.fillStyle(0x1c2634, 1)
    g.fillRect(this.barX, this.barY, this.barW, h)
    const clamped = Math.max(0, Math.min(1, progress))
    g.fillStyle(color, 1)
    g.fillRect(this.barX, this.barY, this.barW * clamped, h)
    g.lineStyle(2, 0x5b6b7b, 1)
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
      this.drawBomb(0x9fb3c8, false)
      this.prompt?.setText(this.t('game.bombRelay.spectator'))
      this.prompt?.setColor('#9fb3c8')
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
      this.prompt?.setColor('#ffd166')
      this.status?.setText('')
      this.drawBar(view.legProgress / Math.max(1, view.legTarget), color)
    } else {
      this.prompt?.setText(this.t('game.bombRelay.waiting'))
      this.prompt?.setColor('#9fb3c8')
      this.status?.setText(this.t('game.bombRelay.teammateHolds'))
      this.bar?.clear()
    }
  }
}
