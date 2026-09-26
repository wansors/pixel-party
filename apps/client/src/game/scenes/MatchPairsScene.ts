import { type MatchSnapshot, PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { addBanner, burst, floatText, ring, showBanner } from '../fx'
import { CARD_INK, ensureCardTexture, ensurePixelGrid, fitText, headlineStyle } from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const CARD_ASPECT = 0.78 // width / height
const FLIP_MS = 70
const MAX_CHIPS = 6

// One pixel icon + color per pairId: shapes differ, not just colors, so pairs stay tellable apart
// without color vision. 'h' = the pair color, 'w' = white, 'b' = ink.
const ICONS: readonly { rows: readonly string[]; color: number }[] = [
  {
    color: PALETTE.red,
    rows: [
      '_hh___hh_',
      'hhhh_hhhh',
      'hhhhhhhhh',
      'hhhhhhhhh',
      '_hhhhhhh_',
      '__hhhhh__',
      '___hhh___',
      '____h____',
    ],
  },
  {
    color: PALETTE.amber,
    rows: [
      '____h____',
      '____h____',
      '___hhh___',
      'hhhhhhhhh',
      '_hhhhhhh_',
      '__hhhhh__',
      '__hh_hh__',
      '_hh___hh_',
    ],
  },
  {
    color: PALETTE.cyan,
    rows: [
      '__hhhhh__',
      '_hhwhhhh_',
      'hhwhhhhhh',
      '_hhhhhhh_',
      '__hhhhh__',
      '___hhh___',
      '____h____',
    ],
  },
  {
    color: PALETTE.magenta,
    rows: [
      '___hhh___',
      '_hhwhhhh_',
      'hhhhhhwhh',
      'hwhhhhhhh',
      'hhhhhhhhh',
      '___www___',
      '___www___',
      '__wwwww__',
    ],
  },
  {
    color: 0xb06bff,
    rows: [
      '___hhh___',
      '_hhhhhhh_',
      'hhwwhwwhh',
      'hhwbhwbhh',
      'hhhhhhhhh',
      'hhhhhhhhh',
      'hhhhhhhhh',
      'h_hh_hh_h',
    ],
  },
  {
    color: PALETTE.lime,
    rows: [
      '_____hhh_',
      '____hhh__',
      '___hhh___',
      '__hhhhhh_',
      '_hhhhhh__',
      '____hhh__',
      '___hh____',
      '__h______',
    ],
  },
  {
    color: PALETTE.orange,
    rows: ['_hhh_____', 'h___h____', 'h___hhhhh', 'h___h_h_h', '_hhh_____'],
  },
  {
    color: 0x5b8cff,
    rows: ['h___h___h', 'hh_hhh_hh', 'hhhhhhhhh', 'hhhhhhhhh', 'hwhhwhhwh', 'hhhhhhhhh'],
  },
]

type Face = 'down' | 'up' | 'matched'

interface Card {
  root: Phaser.GameObjects.Container
  body: Phaser.GameObjects.Image
  icon: Phaser.GameObjects.Image
  outline: Phaser.GameObjects.Rectangle
  x: number
  y: number
  face: Face
  pairId: number
}

// Match (memory pairs) canvas. This player's own 4x4 board of pixel playing cards: tap a face-down card
// to flip it (a real flip — the card squashes to its edge and opens on its pixel icon). A match pops
// both cards and locks them with a lime frame; a mismatch shakes both with a red frame until the next
// flip clears them (server rule). Only cards the server reveals ever show a face. A chip strip shows
// everyone's pair count.
export class MatchPairsScene extends MiniGameScene<MatchSnapshot> {
  private cards: Card[] = []
  private prompt?: Phaser.GameObjects.Text
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private backKey = ''
  private faceKey = ''
  private iconKeys: string[] = []
  private areaTop = 0
  private areaBottom = 0
  private prevMatched = 0
  private prevAttempts = 0
  private finished = false
  private promptSize = 0

  constructor(...deps: SceneDeps) {
    super('match-pairs', ...deps)
  }

  override create(): void {
    super.create()
    this.cards = []
    this.prevMatched = 0
    this.prevAttempts = 0
    this.finished = false
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const cx = width / 2
    this.promptSize = compact ? 16 : 24
    this.prompt = this.add
      .text(
        cx,
        this.top + (compact ? 10 : 14) + this.promptSize / 2,
        this.t('game.matchPairs.prompt'),
        headlineStyle(this.promptSize, PALETTE.amber, { stroke: '#10121c', strokeThickness: 6 }),
      )
      .setOrigin(0.5)
      .setDepth(5)
    fitText(this.prompt, width - 32, this.promptSize)
    this.areaTop = this.top + this.promptSize + (compact ? 26 : 34)

    const chipSize = compact ? 11 : 13
    const stripRows = width < 600 ? 2 : 1
    const stripTop = height - (compact ? 12 : 18) - stripRows * PlayerStrip.rowH(chipSize)
    this.strip = new PlayerStrip(
      this,
      cx,
      stripTop + PlayerStrip.rowH(chipSize) / 2,
      width - 32,
      chipSize,
    )
    this.areaBottom = stripTop - 12
    this.iconKeys = ICONS.map((icon, i) =>
      ensurePixelGrid(this, {
        key: `pp-match-icon-${i}`,
        rows: icon.rows,
        legend: { h: icon.color, w: PALETTE.text, b: CARD_INK },
        pixelSize: 1,
      }),
    )
    this.banner = addBanner(this).setFontSize(compact ? 24 : 32)
  }

  // The board is laid out once, from the first snapshot's cols x rows.
  private build(snap: MatchSnapshot): void {
    const { width } = this.scale
    const gap = Math.max(6, Math.round(width * 0.012))
    const availW = Math.min(width - 32, 760)
    const availH = this.areaBottom - this.areaTop
    const cardH = Math.floor(
      Math.min(
        (availH - gap * (snap.rows - 1)) / snap.rows,
        (availW - gap * (snap.cols - 1)) / snap.cols / CARD_ASPECT,
      ),
    )
    const cardW = Math.floor(cardH * CARD_ASPECT)
    const gridW = cardW * snap.cols + gap * (snap.cols - 1)
    const gridH = cardH * snap.rows + gap * (snap.rows - 1)
    const left = width / 2 - gridW / 2
    const top = this.areaTop + Math.max(0, (availH - gridH) / 2)
    const ps = Math.max(2, Math.round(cardW / 30))
    this.backKey = ensureCardTexture(
      this,
      `pp-match-back-${cardW}x${cardH}`,
      cardW,
      cardH,
      ps,
      true,
    )
    this.faceKey = ensureCardTexture(
      this,
      `pp-match-face-${cardW}x${cardH}`,
      cardW,
      cardH,
      ps,
      false,
    )
    const iconScale = Math.max(1, Math.floor((cardW * 0.62) / 9))
    for (let i = 0; i < snap.cols * snap.rows; i++) {
      const x = left + (i % snap.cols) * (cardW + gap) + cardW / 2
      const y = top + Math.floor(i / snap.cols) * (cardH + gap) + cardH / 2
      const body = this.add.image(0, 0, this.backKey).setInteractive({ useHandCursor: true })
      body.on('pointerdown', () => this.flip(i))
      const icon = this.add
        .image(0, 0, this.iconKeys[0] ?? '')
        .setScale(iconScale)
        .setVisible(false)
      const outline = this.add
        .rectangle(0, 0, cardW + 6, cardH + 6)
        .setStrokeStyle(3, PALETTE.lime)
        .setVisible(false)
      const root = this.add.container(x, y, [body, icon, outline])
      this.cards.push({ root, body, icon, outline, x, y, face: 'down', pairId: 0 })
    }
  }

  private flip(index: number): void {
    const board = this.snap?.boards[this.selfId]
    const card = this.cards[index]
    if (!board || !card || board.done || this.snap?.remainingMs === 0) return
    if (board.matched.includes(index)) return
    this.sfx.click()
    if (card.face === 'down') this.hop(card, 6)
    this.sendInput({ kind: 'flip', index })
  }

  protected frame(snap: MatchSnapshot | null): void {
    if (!snap) return
    const fresh = this.cards.length === 0
    if (fresh) this.build(snap)
    const me = this.selfId
    const board = snap.boards[me]
    const total = (snap.cols * snap.rows) / 2
    const chips = Object.entries(snap.boards)
      .map(([id, b]) => ({ id, pairs: b.matched.length / 2, done: b.done }))
      .sort((a, b) => b.pairs - a.pairs)
      .slice(0, MAX_CHIPS)
      .map(({ id, pairs, done }) => ({
        text: `${this.label(id).slice(0, 10).toUpperCase()} ${pairs}/${total}${done ? ' ✓' : ''}`,
        color: this.state.colorOf(id),
      }))
    this.strip?.set(chips)
    if (!board) return

    const pairs = board.matched.length / 2
    this.hud?.setScore(this.t('game.matchPairs.pairs', { n: pairs, total }))
    const reveal = snap.reveal[me] ?? {}
    const up = new Set(board.up)
    const matched = new Set(board.matched)
    this.cards.forEach((card, i) => {
      const face: Face = matched.has(i) ? 'matched' : up.has(i) ? 'up' : 'down'
      if (face !== card.face) this.turn(card, face, reveal[i] ?? 0, !fresh)
    })

    const mismatch = board.up.length === 2
    for (const i of board.up)
      this.cards[i]?.outline.setVisible(mismatch).setStrokeStyle(3, PALETTE.red)
    if (!fresh && board.matched.length > this.prevMatched)
      this.onMatch(board.matched.slice(this.prevMatched))
    // A quick third tap may already have cleared the mismatch (up = [third]): buzz, don't shake.
    if (!fresh && board.attempts > this.prevAttempts) this.onMismatch(mismatch ? board.up : [])
    this.prevMatched = board.matched.length
    this.prevAttempts = board.attempts

    if (board.done && !this.finished) {
      this.finished = true
      if (!fresh) this.sfx.coin()
      const { width, height } = this.scale
      burst(this, width / 2, height / 2, PALETTE.amber, 30, 320)
      if (this.banner) showBanner(this, this.banner, this.t('game.common.finished'), PALETTE.lime)
      if (this.prompt) {
        this.prompt.setText(this.t('game.common.waiting'))
        fitText(this.prompt, width - 32, this.promptSize)
      }
    }
  }

  // Flip a card to a new face: squash to its edge, swap art, open back up (instant on a fresh build).
  private turn(card: Card, face: Face, pairId: number, animate: boolean): void {
    const apply = (): void => {
      const shown = face !== 'down'
      card.body.setTexture(shown ? this.faceKey : this.backKey)
      card.icon.setTexture(this.iconKeys[pairId % this.iconKeys.length] ?? '').setVisible(shown)
      card.outline.setVisible(face === 'matched').setStrokeStyle(3, PALETTE.lime)
      card.root.setAlpha(face === 'matched' ? 0.8 : 1)
    }
    const wasDown = card.face === 'down'
    card.face = face
    card.pairId = pairId
    // up -> matched keeps the face showing: no flip, just the lock-in.
    if (!animate || (!wasDown && face !== 'down')) {
      apply()
      return
    }
    this.tweens.killTweensOf(card.root)
    card.root.setScale(1).setPosition(card.x, card.y)
    this.tweens.add({
      targets: card.root,
      scaleX: 0,
      duration: FLIP_MS,
      ease: 'Quad.easeIn',
      onComplete: () => {
        apply()
        this.tweens.add({ targets: card.root, scaleX: 1, duration: FLIP_MS, ease: 'Quad.easeOut' })
      },
    })
  }

  private onMatch(indices: number[]): void {
    this.sfx.correct()
    for (const i of indices) {
      const card = this.cards[i]
      if (!card) continue
      const color = ICONS[card.pairId % ICONS.length]?.color ?? PALETTE.lime
      // Let the second card finish flipping open before the pop.
      this.time.delayedCall(FLIP_MS * 2, () => {
        this.hop(card, 10)
        ring(this, card.x, card.y, PALETTE.lime, card.body.width * 0.7)
        burst(this, card.x, card.y, color, 12, 200)
      })
    }
    const last = this.cards[indices[indices.length - 1] ?? -1]
    if (last) floatText(this, last.x, last.y - last.body.height / 2, '+1', PALETTE.lime, 24)
  }

  // A little jump (position only, so it never fights a flip's scale tween).
  private hop(card: Card, px: number): void {
    this.tweens.add({
      targets: card.root,
      y: card.y - px,
      duration: 70,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => card.root.setY(card.y),
    })
  }

  private onMismatch(indices: number[]): void {
    this.sfx.wrong()
    for (const i of indices) {
      const card = this.cards[i]
      if (!card) continue
      this.time.delayedCall(FLIP_MS * 2, () => {
        this.tweens.add({
          targets: card.root,
          x: card.x + 5,
          duration: 40,
          yoyo: true,
          repeat: 2,
          onComplete: () => card.root.setX(card.x),
        })
      })
    }
  }
}
