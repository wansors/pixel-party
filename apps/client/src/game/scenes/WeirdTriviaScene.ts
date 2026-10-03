import {
  PALETTE,
  type WeirdTriviaLang,
  type WeirdTriviaReveal,
  type WeirdTriviaSnapshot,
} from '@pp/shared'
import type Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { floatText } from '../fx'
import { hexToCss } from '../pixelStyle'
import type { PlayerChip } from '../playerStrip'
import type { SceneDeps } from './MiniGameScene'
import { QuizSceneBase, type QuizView } from './QuizSceneBase'

// Picker heads perched on the answer tiles at the reveal (32 px = a crisp 2x avatar).
const PICK_PX = 32
const PICK_PIXEL = PICK_PX / 16

// Weird Trivia canvas on the shared quiz-show board (QuizSceneBase). The question ships in both
// languages and the scene shows the player's. Locking an answer gives no verdict; the reveal phase does
// it for everybody at once: the right tile lights up, each player's avatar pops onto the tile they
// picked (grinning or wincing), the board turns into the fun fact and the crowd gets a quip ("NOBODY
// KNEW!", "3 FELL FOR IT!").
export class WeirdTriviaScene extends QuizSceneBase<WeirdTriviaSnapshot> {
  protected override timeUpOnAdvance = false
  private revealedIndex = -1
  private pickIcons: Phaser.GameObjects.Image[] = []

  constructor(...deps: SceneDeps) {
    super('weird-trivia', ...deps)
  }

  override create(): void {
    super.create()
    this.revealedIndex = -1
    this.pickIcons = []
  }

  // The bundle's own language code (Phaser scenes only see the translate function).
  private lang(): WeirdTriviaLang {
    return this.t('lang.code') === 'es' ? 'es' : 'en'
  }

  protected view(snap: WeirdTriviaSnapshot): QuizView {
    const text = snap.text?.[this.lang()] ?? null
    return {
      index: snap.index,
      total: snap.total,
      question: text?.q ?? null,
      choices: text?.choices ?? [],
      open: snap.phase === 'question',
      answered: snap.answeredCurrent,
      scores: snap.scores,
    }
  }

  // The clock is the answer window; the reveal has none.
  protected override remainingMs(snap: WeirdTriviaSnapshot): number | null {
    if (snap.phase === 'done') return 0
    return snap.phase === 'question' ? snap.phaseRemainingMs : null
  }

  protected judge(snap: WeirdTriviaSnapshot, v: QuizView): void {
    const reveal = snap.reveal
    if (!reveal || this.revealedIndex === v.index) return
    this.revealedIndex = v.index
    this.showReveal(reveal, Object.keys(snap.scores), v)
  }

  private showReveal(reveal: WeirdTriviaReveal, players: string[], v: QuizView): void {
    const me = this.selfId
    const mine = reveal.picks[me]
    // A restart mid-reveal (relayout) redraws it without replaying the cheers.
    const quiet = this.firstSnapshot
    this.revealed = true
    this.progress?.setText(this.t('game.weirdTrivia.trueStory')).setColor(hexToCss(PALETTE.lime))
    this.question?.setColor(hexToCss(PALETTE.amber))
    this.fitBoardText(reveal.fact[this.lang()])

    if (mine === undefined) {
      this.markTile(reveal.correct, true)
      if (!quiet) this.timeUp()
    } else if (quiet) {
      this.markTile(mine, mine === reveal.correct)
      if (mine !== reveal.correct) this.markTile(reveal.correct, true)
    } else {
      this.revealPick(v.index, mine, reveal.gained[me] ?? 0)
      if (mine !== reveal.correct) this.markTile(reveal.correct, true)
    }
    this.perchPickers(reveal, players)
    if (!quiet) this.crowdQuip(reveal, players)
  }

  // Each player's avatar pops onto the top edge of the tile they picked, right to left.
  private perchPickers(reveal: WeirdTriviaReveal, players: string[]): void {
    this.tiles.forEach((tile, slot) => {
      const pickers = players.filter((id) => reveal.picks[id] === slot)
      if (pickers.length === 0) return
      const room = tile.w - 24
      const step = Math.min(PICK_PX + 4, (room - PICK_PX) / Math.max(1, pickers.length - 1))
      const right = slot === reveal.correct
      pickers.forEach((id, i) => {
        const key = ensureAvatarTexture(
          this,
          this.state.avatarOf(id),
          this.state.colorOf(id),
          PICK_PIXEL,
          'front',
          right ? 'happy' : 'hurt',
        )
        const x = Math.round(tile.x + tile.w / 2 - 12 - PICK_PX / 2 - i * step)
        // Perched on the top edge, clear of the label and (mostly) of the tile above.
        const y = Math.round(tile.y - tile.h / 2 + (this.compact ? 8 : 2))
        const icon = this.add.image(x, y, key).setDepth(5).setScale(0)
        this.tweens.add({
          targets: icon,
          scale: 1,
          duration: 160,
          delay: 120 + i * 70,
          ease: 'Back.easeOut',
        })
        this.pickIcons.push(icon)
      })
    })
  }

  // One line for the room: nobody knew, everybody knew, or how many fell for the same decoy.
  private crowdQuip(reveal: WeirdTriviaReveal, players: string[]): void {
    const picks = players.map((id) => reveal.picks[id]).filter((p) => p !== undefined)
    const rightCount = picks.filter((p) => p === reveal.correct).length
    const decoys = new Map<number, number>()
    for (const p of picks) if (p !== reveal.correct) decoys.set(p, (decoys.get(p) ?? 0) + 1)
    const fooled = Math.max(0, ...decoys.values())
    let line = ''
    if (rightCount === 0) line = this.t('game.weirdTrivia.nobody')
    else if (players.length > 1 && rightCount === players.length)
      line = this.t('game.weirdTrivia.everybody')
    else if (fooled >= 2) line = this.t('game.weirdTrivia.fooled', { n: fooled })
    if (!line) return
    const { x, y, w } = this.panelBox
    floatText(this, x + w / 2, y + 4, line, PALETTE.amber, this.compact ? 16 : 20)
  }

  protected override onQuestionShown(): void {
    for (const icon of this.pickIcons) icon.destroy()
    this.pickIcons = []
  }

  // At the reveal the lights become the verdict: lit = scored this question.
  protected override chips(v: QuizView): PlayerChip[] {
    const reveal = this.snap?.reveal
    if (!reveal) return super.chips(v)
    return Object.keys(v.scores).map((id) => {
      const gained = reveal.gained[id] ?? 0
      const name = this.label(id).slice(0, 10).toUpperCase()
      return {
        text: gained > 0 ? `${name} +${gained}` : name,
        avatar: this.state.avatarOf(id),
        color: this.state.colorOf(id),
        dim: gained <= 0,
      }
    })
  }

  // At the reveal: the right tile and this player's pick stay lit, the rest fade.
  protected override paintTiles(v: QuizView, locked: boolean, time: number): void {
    const reveal = this.snap?.reveal
    if (!reveal) {
      super.paintTiles(v, locked, time)
      return
    }
    const mine = reveal.picks[this.selfId]
    this.tiles.forEach((tile, i) => {
      const alpha = i === reveal.correct || i === mine ? 1 : 0.3
      for (const o of [tile.shadow, tile.face, tile.badge, tile.label]) o.setAlpha(alpha)
    })
  }

  protected override statusText(v: QuizView, locked: boolean): string {
    if (this.snap?.phase !== 'reveal') {
      if (v.question !== null && !locked) return this.t('game.weirdTrivia.hint')
      return super.statusText(v, locked)
    }
    return v.index + 1 < v.total ? this.t('game.trivia.getReady') : ''
  }
}
