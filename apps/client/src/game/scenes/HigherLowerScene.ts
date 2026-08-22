import { PALETTE } from '@pp/shared'
import type { ClientMsg, HigherLowerSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'
import { addArcadeBackdrop, bodyStyle, ensurePixelBlock, headlineStyle } from '../pixelStyle'

// Higher or Lower canvas. Shows this player's current card + HIGHER / LOWER buttons; a correct guess
// extends the streak, a miss locks the run. Scene key === mini-game id.
export class HigherLowerScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text
  private card?: Phaser.GameObjects.Text
  private cardBox?: Phaser.GameObjects.Rectangle
  private streak?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private higherBtn?: Phaser.GameObjects.Image
  private lowerBtn?: Phaser.GameObjects.Image
  private higherLabel?: Phaser.GameObjects.Text
  private lowerLabel?: Phaser.GameObjects.Text
  private wasAlive = true
  private lastStreak = 0

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('higher-lower')
  }

  create(): void {
    this.wasAlive = true
    this.lastStreak = 0
    addArcadeBackdrop(this)
    const { width, height } = this.scale
    const cx = width / 2
    this.timer = this.add
      .text(cx, height * 0.08, '', headlineStyle(24, PALETTE.lime))
      .setOrigin(0.5)
    this.streak = this.add
      .text(cx, height * 0.15, '', headlineStyle(20, PALETTE.amber))
      .setOrigin(0.5)
    this.cardBox = this.add
      .rectangle(cx, height * 0.38, width * 0.34, height * 0.24, PALETTE.panelAlt)
      .setStrokeStyle(4, 0xffffff)
    this.card = this.add.text(cx, height * 0.38, '', headlineStyle(72, PALETTE.text)).setOrigin(0.5)
    this.status = this.add.text(cx, height * 0.56, '', bodyStyle(18)).setOrigin(0.5)

    const bw = width * 0.38
    const bh = height * 0.13
    const by = height * 0.78
    const higherKey = ensurePixelBlock(this, 'pp-higherlower-higher-btn', 16, PALETTE.lime)
    this.higherBtn = this.add
      .image(cx - bw / 2 - width * 0.02, by, higherKey)
      .setDisplaySize(bw, bh)
      .setInteractive({ useHandCursor: true })
    this.higherBtn.on('pointerdown', () => this.guess('higher'))
    this.higherLabel = this.add
      .text(
        cx - bw / 2 - width * 0.02,
        by,
        this.t('game.higherLower.higher'),
        headlineStyle(22, PALETTE.bg),
      )
      .setOrigin(0.5)

    const lowerKey = ensurePixelBlock(this, 'pp-higherlower-lower-btn', 16, PALETTE.red)
    this.lowerBtn = this.add
      .image(cx + bw / 2 + width * 0.02, by, lowerKey)
      .setDisplaySize(bw, bh)
      .setInteractive({ useHandCursor: true })
    this.lowerBtn.on('pointerdown', () => this.guess('lower'))
    this.lowerLabel = this.add
      .text(
        cx + bw / 2 + width * 0.02,
        by,
        this.t('game.higherLower.lower'),
        headlineStyle(22, PALETTE.bg),
      )
      .setOrigin(0.5)
  }

  private guess(dir: 'higher' | 'lower'): void {
    const snap = this.state.state as HigherLowerSnapshot | null
    const card = snap?.cards[this.state.selfId ?? '']
    if (!card || !card.alive) return
    this.sfx.click()
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'guess', index: card.index, dir } })
  }

  override update(): void {
    const snap = this.state.state as HigherLowerSnapshot | null
    if (!snap) return
    const selfId = this.state.selfId ?? ''
    const card = snap.cards[selfId]
    const myStreak = snap.scores[selfId] ?? 0
    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    this.streak?.setText(this.t('game.higherLower.streak', { n: myStreak }))
    if (!card) return

    // A growing streak = a correct guess; the alive -> dead transition = a miss.
    if (myStreak > this.lastStreak) this.sfx.correct()
    this.lastStreak = myStreak
    if (this.wasAlive && !card.alive) {
      this.sfx.wrong()
      this.wasAlive = false
    }

    this.card?.setText(String(card.current))
    const alive = card.alive
    this.cardBox?.setStrokeStyle(4, alive ? 0xffffff : 0x8b1e2d)
    this.status?.setText(this.t(alive ? 'game.higherLower.prompt' : 'game.higherLower.out'))
    this.higherBtn?.setAlpha(alive ? 1 : 0.3)
    this.lowerBtn?.setAlpha(alive ? 1 : 0.3)
  }
}
