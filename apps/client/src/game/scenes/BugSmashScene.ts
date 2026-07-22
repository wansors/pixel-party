import type { BugSmashSnapshot, ClientMsg } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'

// Bug Smash (whack-a-mole) canvas. Renders a grid of holes; live bugs/bombs from the shared snapshot
// pop up, and tapping a hole smashes whatever is there. A bug just smashed by this player is hidden
// optimistically until it expires. Scene key === mini-game id.
export class BugSmashScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private score?: Phaser.GameObjects.Text
  private markers: { rect: Phaser.GameObjects.Rectangle; face: Phaser.GameObjects.Arc }[] = []
  private built = false
  // Spawn indices this player has already smashed (optimistic local hide).
  private readonly localHit = new Set<number>()

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('bug-smash')
  }

  create(): void {
    this.built = false
    this.markers = []
    this.localHit.clear()
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.06, '', { fontFamily: 'monospace', fontSize: '24px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.score = this.add
      .text(cx, height * 0.12, '', { fontFamily: 'monospace', fontSize: '18px', color: '#9fb3c8' })
      .setOrigin(0.5)
  }

  private build(snap: BugSmashSnapshot): void {
    const { width, height } = this.scale
    const cx = width / 2
    const n = Math.round(Math.sqrt(snap.holes))
    const area = Math.min(width * 0.9, height * 0.72)
    const gap = area * 0.04
    const cell = (area - gap * (n - 1)) / n
    const startX = cx - area / 2 + cell / 2
    const startY = height * 0.2 + cell / 2
    for (let i = 0; i < snap.holes; i++) {
      const col = i % n
      const row = Math.floor(i / n)
      const x = startX + col * (cell + gap)
      const y = startY + row * (cell + gap)
      const rect = this.add
        .rectangle(x, y, cell, cell, 0x14100c)
        .setStrokeStyle(4, 0x3a2f22)
        .setInteractive({ useHandCursor: true })
      rect.on('pointerdown', () => this.smash(i))
      const face = this.add.circle(x, y, cell * 0.32, 0x2a9d3f).setVisible(false)
      this.markers.push({ rect, face })
    }
    this.built = true
  }

  private smash(hole: number): void {
    const snap = this.state.state as BugSmashSnapshot | null
    if (!snap) return
    const bug = snap.live.find((b) => b.hole === hole && !this.localHit.has(b.index))
    if (!bug) return
    this.localHit.add(bug.index)
    if (bug.kind === 'bug') this.sfx.correct()
    else this.sfx.wrong()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'smash', hole } })
  }

  override update(): void {
    const snap = this.state.state as BugSmashSnapshot | null
    if (!snap) return
    if (!this.built) this.build(snap)
    const selfId = this.state.selfId ?? ''
    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    this.score?.setText(this.t('game.common.pts', { n: snap.scores[selfId] ?? 0 }))
    // Reset all faces, then show the live bug per hole (skipping ones this player already smashed).
    for (const m of this.markers) m.face.setVisible(false)
    for (const b of snap.live) {
      if (this.localHit.has(b.index)) continue
      const marker = this.markers[b.hole]
      if (!marker) continue
      marker.face.setFillStyle(b.kind === 'bug' ? 0x2a9d3f : 0xe63946).setVisible(true)
    }
  }
}
