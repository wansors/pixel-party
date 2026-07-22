import type { ClientMsg, NumberRushSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'

// Number Rush (Schulte grid) canvas. Renders the shared seeded grid; the player taps numbers in order.
// Cells already cleared by this player dim out. Scene key === mini-game id.
export class NumberRushScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private next?: Phaser.GameObjects.Text
  private cells: { rect: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[] = []
  private built = false

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('number-rush')
  }

  create(): void {
    this.built = false
    this.cells = []
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.06, '', { fontFamily: 'monospace', fontSize: '24px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.next = this.add
      .text(cx, height * 0.12, '', { fontFamily: 'monospace', fontSize: '18px', color: '#9fb3c8' })
      .setOrigin(0.5)
  }

  // The grid is built once, the first time a snapshot with a layout arrives.
  private build(snap: NumberRushSnapshot): void {
    const { width, height } = this.scale
    const cx = width / 2
    const n = snap.size
    const area = Math.min(width * 0.9, height * 0.7)
    const gap = area * 0.02
    const cell = (area - gap * (n - 1)) / n
    const startX = cx - area / 2 + cell / 2
    const startY = height * 0.2 + cell / 2
    for (let i = 0; i < snap.grid.length; i++) {
      const col = i % n
      const row = Math.floor(i / n)
      const x = startX + col * (cell + gap)
      const y = startY + row * (cell + gap)
      const rect = this.add
        .rectangle(x, y, cell, cell, 0x1d2740)
        .setStrokeStyle(3, 0x3a4668)
        .setInteractive({ useHandCursor: true })
      rect.on('pointerdown', () => this.tap(i))
      const label = this.add
        .text(x, y, String(snap.grid[i]), {
          fontFamily: 'monospace',
          fontSize: `${Math.floor(cell * 0.4)}px`,
          color: '#e6edf3',
        })
        .setOrigin(0.5)
      this.cells.push({ rect, label })
    }
    this.built = true
  }

  private tap(cell: number): void {
    const snap = this.state.state as NumberRushSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const nextNum = snap.progress[selfId] ?? 1
    if (snap.grid[cell] === nextNum) this.sfx.click()
    else this.sfx.wrong()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'tap', cell } })
  }

  override update(): void {
    const snap = this.state.state as NumberRushSnapshot | null
    if (!snap) return
    if (!this.built) this.build(snap)
    const selfId = this.state.selfId ?? ''
    const nextNum = snap.progress[selfId] ?? 1
    const done = nextNum > snap.grid.length
    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    this.next?.setText(
      done ? this.t('game.numberRush.done') : this.t('game.numberRush.find', { n: nextNum }),
    )
    this.cells.forEach(({ rect, label }, i) => {
      const cleared = (snap.grid[i] ?? 0) < nextNum
      rect.setFillStyle(cleared ? 0x14301f : 0x1d2740)
      label.setColor(cleared ? '#2a9d3f' : '#e6edf3')
      label.setAlpha(cleared ? 0.5 : 1)
    })
  }
}
