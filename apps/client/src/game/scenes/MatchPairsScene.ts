import type { ClientMsg, MatchSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'

// Match (memory pairs) canvas. Renders this player's own board (a cols×rows grid of face-down cards);
// tapping a face-down card sends a flip. Cards the server reports face-up or matched show their pairId
// (colour + number); matched cards are dimmed and locked. SFX are driven by diffing the board frame to
// frame. Scene key === mini-game id.
export class MatchPairsScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private score?: Phaser.GameObjects.Text
  private cards: { rect: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[] = []
  private built = false
  private prevMatched = 0
  private prevAttempts = 0
  // One distinct colour per pairId.
  private readonly palette = [
    0xe63946, 0x06d6a0, 0xffd166, 0x118ab2, 0xef476f, 0x8338ec, 0x2a9d3f, 0xff9f1c,
  ]

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('match-pairs')
  }

  create(): void {
    this.built = false
    this.cards = []
    this.prevMatched = 0
    this.prevAttempts = 0
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.06, '', { fontFamily: 'monospace', fontSize: '24px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.score = this.add
      .text(cx, height * 0.12, '', { fontFamily: 'monospace', fontSize: '18px', color: '#9fb3c8' })
      .setOrigin(0.5)
  }

  private build(snap: MatchSnapshot): void {
    const { width, height } = this.scale
    const cx = width / 2
    const area = Math.min(width * 0.9, height * 0.72)
    const gap = area * 0.03
    const cell = (area - gap * (snap.cols - 1)) / snap.cols
    const startX = cx - area / 2 + cell / 2
    const startY = height * 0.2 + cell / 2
    for (let i = 0; i < snap.cols * snap.rows; i++) {
      const col = i % snap.cols
      const row = Math.floor(i / snap.cols)
      const x = startX + col * (cell + gap)
      const y = startY + row * (cell + gap)
      const rect = this.add
        .rectangle(x, y, cell, cell, 0x14100c)
        .setStrokeStyle(4, 0x3a2f22)
        .setInteractive({ useHandCursor: true })
      rect.on('pointerdown', () => this.flip(i))
      const label = this.add
        .text(x, y, '', { fontFamily: 'monospace', fontSize: `${Math.floor(cell * 0.4)}px` })
        .setOrigin(0.5)
        .setVisible(false)
      this.cards.push({ rect, label })
    }
    this.built = true
  }

  private flip(index: number): void {
    const snap = this.state.state as MatchSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const board = snap.boards[selfId]
    if (!board || board.done) return
    if (board.matched.includes(index)) return
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'flip', index } })
  }

  override update(): void {
    const snap = this.state.state as MatchSnapshot | null
    if (!snap) return
    if (!this.built) this.build(snap)
    const selfId = this.state.selfId ?? ''
    const board = snap.boards[selfId]
    const reveal = snap.reveal[selfId] ?? {}
    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    if (!board) return
    const matchedCount = board.matched.length
    this.score?.setText(this.t('game.common.pts', { n: matchedCount / 2 }))
    if (matchedCount > this.prevMatched) this.sfx.correct()
    if (board.attempts > this.prevAttempts) this.sfx.wrong()
    this.prevMatched = matchedCount
    this.prevAttempts = board.attempts
    const upSet = new Set(board.up)
    const matchedSet = new Set(board.matched)
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i]
      if (!card) continue
      const isMatched = matchedSet.has(i)
      const isUp = upSet.has(i)
      if (isMatched || isUp) {
        const pairId = reveal[i] ?? 0
        const color = this.palette[pairId % this.palette.length] as number
        card.rect.setFillStyle(color, isMatched ? 0.4 : 1)
        card.label.setText(`${pairId}`).setVisible(true)
      } else {
        card.rect.setFillStyle(0x14100c, 1)
        card.label.setVisible(false)
      }
    }
  }
}
