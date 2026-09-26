import { type HigherLowerSnapshot, PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { addBanner, burst, flash, floatText, ring, shake, showBanner } from '../fx'
import {
  CARD_INK,
  bodyStyle,
  ensureBevelPanel,
  ensureCardTexture,
  ensurePixelGrid,
  fitText,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const PRESS_PX = 4
const MILESTONE = 5
const MAX_CHIPS = 6
const RANKS: Readonly<Record<number, string>> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }

// 7-cell-wide suit sprites ('s' = ink). Suits are cosmetic only (the server deals bare values 2..14):
// picked from the deck index, so every player sees the same card as the same card.
const SUITS: readonly (readonly string[])[] = [
  ['_ss_ss_', 'sssssss', 'sssssss', 'sssssss', '_sssss_', '__sss__', '___s___'],
  ['___s___', '__sss__', '_sssss_', 'sssssss', '_sssss_', '__sss__', '___s___'],
  ['___s___', '__sss__', '_sssss_', 'sssssss', 'sssssss', '_ss_ss_', '___s___', '__sss__'],
  ['__sss__', '_sssss_', '__sss__', 'ss_s_ss', 'sssssss', 'ss_s_ss', '___s___', '__sss__'],
]
const RED_SUITS = new Set([0, 1])
const CROSS_ROWS = ['xx___xx', 'xxx_xxx', '_xxxxx_', '__xxx__', '_xxxxx_', 'xxx_xxx', 'xx___xx']

// One face-up card: body + rank/suit in two opposite corners + a big rank and suit in the middle.
// Everything lives in a container so the whole card can flip (scaleX) and tilt as one.
class PlayingCard {
  readonly root: Phaser.GameObjects.Container
  private readonly body: Phaser.GameObjects.Image
  private readonly ranks: Phaser.GameObjects.Text[]
  private readonly center: Phaser.GameObjects.Text
  private readonly pips: Phaser.GameObjects.Image[]
  private readonly bigPip: Phaser.GameObjects.Image
  private readonly cross: Phaser.GameObjects.Image

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    w: number,
    h: number,
    private readonly suitKeys: readonly string[],
    crossKey: string,
  ) {
    const ps = Math.max(2, Math.round(w / 40))
    this.body = scene.add.image(
      0,
      0,
      ensureCardTexture(scene, `pp-hl-face-${w}x${h}`, w, h, ps, false),
    )
    const cornerSize = Math.max(8, Math.floor((w * 0.13) / 8) * 8)
    const inset = ps * 5
    const corner = (angle: number, ox: number, oy: number): Phaser.GameObjects.Text =>
      scene.add
        .text(ox, oy, '', headlineStyle(cornerSize, CARD_INK))
        .setOrigin(0, 0)
        .setAngle(angle)
    this.ranks = [
      corner(0, -w / 2 + inset, -h / 2 + inset),
      corner(180, w / 2 - inset, h / 2 - inset),
    ]
    const pipScale = Math.max(1, Math.round(w / 60))
    const pipOffset = cornerSize + ps * 2 + (7 * pipScale) / 2
    this.pips = [
      scene.add
        .image(-w / 2 + inset + cornerSize / 2, -h / 2 + inset + pipOffset, suitKeys[0] ?? '')
        .setScale(pipScale),
      scene.add
        .image(w / 2 - inset - cornerSize / 2, h / 2 - inset - pipOffset, suitKeys[0] ?? '')
        .setScale(pipScale)
        .setAngle(180),
    ]
    this.center = scene.add
      .text(0, -h * 0.1, '', headlineStyle(Math.max(16, Math.floor((w * 0.34) / 8) * 8), CARD_INK))
      .setOrigin(0.5)
    this.bigPip = scene.add
      .image(0, h * 0.2, suitKeys[0] ?? '')
      .setScale(Math.max(2, Math.round(w / 26)))
    this.cross = scene.add
      .image(0, 0, crossKey)
      .setScale(Math.max(3, Math.round(w / 16)))
      .setAlpha(0.6)
      .setVisible(false)
    this.root = scene.add.container(x, y, [
      this.body,
      ...this.ranks,
      ...this.pips,
      this.center,
      this.bigPip,
      this.cross,
    ])
  }

  show(value: number, suit: number): void {
    const rank = RANKS[value] ?? String(value)
    const ink = hexToCss(RED_SUITS.has(suit) ? PALETTE.red : CARD_INK)
    for (const t of this.ranks) t.setText(rank).setColor(ink)
    this.center.setText(rank).setColor(ink)
    const key = this.suitKeys[suit] ?? ''
    for (const p of [...this.pips, this.bigPip]) p.setTexture(key)
  }

  // A busted card: red cross over a dimmed face.
  setBust(bust: boolean): void {
    this.cross.setVisible(bust)
    if (bust) this.body.setTint(0xffc4c4)
    else this.body.clearTint()
  }
}

interface Button {
  shadow: Phaser.GameObjects.Image
  face: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  y: number
}

// Higher or Lower canvas. This player's current card is a pixel playing card in front of the face-down
// deck, with the previous card tilted on the discard pile. HIGHER / LOWER (tap, ▲ ▼ or W/S) guesses the
// next card: a correct guess flips the next card over and extends the streak (cheers every 5), a miss
// busts the card, buzzes, and locks the run with an OUT banner. A chip strip shows every streak.
export class HigherLowerScene extends MiniGameScene<HigherLowerSnapshot> {
  private card?: PlayingCard
  private discard?: PlayingCard
  private buttons: Record<'higher' | 'lower', Button | undefined> = {
    higher: undefined,
    lower: undefined,
  }
  private prompt?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private cardY = 0
  private shown: { index: number; value: number } | null = null
  private wasAlive = true
  private lastStreak = 0

  constructor(...deps: SceneDeps) {
    super('higher-lower', ...deps)
  }

  override create(): void {
    super.create()
    this.shown = null
    this.wasAlive = true
    this.lastStreak = 0
    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const cx = width / 2

    const promptSize = compact ? 16 : 24
    this.prompt = this.add
      .text(
        cx,
        this.top + (compact ? 10 : 14) + promptSize / 2,
        this.t('game.higherLower.prompt'),
        headlineStyle(promptSize, PALETTE.amber, { stroke: '#10121c', strokeThickness: 6 }),
      )
      .setOrigin(0.5)
    fitText(this.prompt, width - 32, promptSize)

    // Bottom-up: chip strip, buttons, status line; the card gets the rest.
    const chipSize = compact ? 11 : 13
    const stripRows = width < 600 ? 2 : 1
    const stripTop = height - (compact ? 12 : 18) - stripRows * PlayerStrip.rowH(chipSize)
    this.strip = new PlayerStrip(
      this,
      cx,
      stripTop + PlayerStrip.rowH(chipSize) / 2,
      width - 32,
      chipSize,
      stripRows,
    )
    const contentW = Math.min(width - 32, 640)
    const gap = compact ? 12 : 18
    const bw = Math.round((contentW - gap) / 2)
    const bh = compact ? 76 : 92
    const by = stripTop - (compact ? 12 : 18) - bh / 2
    this.makeButton('higher', cx - bw / 2 - gap / 2, by, bw, bh, PALETTE.lime, compact)
    this.makeButton('lower', cx + bw / 2 + gap / 2, by, bw, bh, PALETTE.red, compact)
    const statusY = by - bh / 2 - (compact ? 18 : 24)
    this.status = this.add
      .text(cx, statusY, '', bodyStyle(compact ? 13 : 16, PALETTE.dim))
      .setOrigin(0.5)

    const areaTop = this.top + promptSize + (compact ? 28 : 40)
    const areaBottom = statusY - (compact ? 20 : 26)
    const cardH = Math.round(Math.min(areaBottom - areaTop, compact ? 260 : 320))
    const cardW = Math.round(Math.min(cardH * 0.7, width * 0.42))
    this.cardY = areaTop + (areaBottom - areaTop) / 2

    const suitKeys = SUITS.map((rows, i) =>
      ensurePixelGrid(this, {
        key: `pp-hl-suit-${i}`,
        rows,
        legend: { s: RED_SUITS.has(i) ? PALETTE.red : CARD_INK },
        pixelSize: 1,
      }),
    )
    const crossKey = ensurePixelGrid(this, {
      key: 'pp-hl-cross',
      rows: CROSS_ROWS,
      legend: { x: PALETTE.red },
      pixelSize: 1,
    })
    // The face-down deck peeks out behind the card on the right; the discard pile on the left.
    const ps = Math.max(2, Math.round(cardW / 40))
    const backKey = ensureCardTexture(this, `pp-hl-back-${cardW}x${cardH}`, cardW, cardH, ps, true)
    for (let i = 2; i >= 0; i--) {
      this.add
        .image(cx + cardW * 0.3 + i * ps * 2, this.cardY - cardH * 0.04 - i * ps * 2, backKey)
        .setAngle(6)
    }
    this.discard = new PlayingCard(
      this,
      cx - cardW * 0.3,
      this.cardY + cardH * 0.03,
      cardW,
      cardH,
      suitKeys,
      crossKey,
    )
    this.discard.root.setAngle(-9).setAlpha(0.55).setVisible(false)
    this.card = new PlayingCard(this, cx, this.cardY, cardW, cardH, suitKeys, crossKey)
    this.card.root.setVisible(false)

    this.banner = addBanner(this).setFontSize(compact ? 32 : 40)
    this.onKey('UP', () => this.guess('higher'))
    this.onKey('W', () => this.guess('higher'))
    this.onKey('DOWN', () => this.guess('lower'))
    this.onKey('S', () => this.guess('lower'))
  }

  private makeButton(
    dir: 'higher' | 'lower',
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    compact: boolean,
  ): void {
    const shadow = this.add.image(
      x,
      y + PRESS_PX,
      ensureBevelPanel(this, w, h, shade(PALETTE.bg, -0.5), 0, true),
    )
    const face = this.add
      .image(x, y, ensureBevelPanel(this, w, h, color, 4, true))
      .setInteractive({ useHandCursor: true })
    face.on('pointerdown', () => this.guess(dir))
    const label = this.add
      .text(
        x,
        y,
        this.t(`game.higherLower.${dir}`),
        headlineStyle(compact ? 16 : 24, PALETTE.text, { stroke: '#10121c', strokeThickness: 6 }),
      )
      .setOrigin(0.5)
    fitText(label, w - 20, compact ? 16 : 24)
    this.buttons[dir] = { shadow, face, label, y }
  }

  private guess(dir: 'higher' | 'lower'): void {
    const card = this.snap?.cards[this.selfId]
    if (!card || !card.alive || this.snap?.remainingMs === 0) return
    this.sfx.click()
    const b = this.buttons[dir]
    if (b) {
      for (const o of [b.face, b.label]) o.setY(b.y + PRESS_PX)
      this.time.delayedCall(90, () => {
        for (const o of [b.face, b.label]) o.setY(b.y)
      })
    }
    this.sendInput({ kind: 'guess', index: card.index, dir })
  }

  protected frame(snap: HigherLowerSnapshot | null): void {
    if (!snap) return
    const me = this.selfId
    const card = snap.cards[me]
    const streak = snap.scores[me] ?? 0
    this.hud?.setScore(this.t('game.higherLower.streak', { n: streak }))

    const chips = Object.entries(snap.scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CHIPS)
      .map(([id, n]) => {
        const alive = snap.cards[id]?.alive ?? true
        const name = this.label(id).slice(0, 10).toUpperCase()
        return {
          text: alive ? `${name} ${n}` : `${name} ${n} ✕`,
          color: this.state.colorOf(id),
          dim: !alive,
        }
      })
    this.strip?.set(chips)
    if (!card || !this.card) return

    if (!this.shown) {
      this.card.show(card.current, suitOf(card.index, card.current))
      this.card.root.setVisible(true)
    } else if (card.index !== this.shown.index) {
      this.advance(this.shown, card.current, card.index, streak)
    }
    this.shown = { index: card.index, value: card.current }
    this.lastStreak = streak

    if (this.wasAlive && !card.alive) this.bust(this.firstSnapshot)
    this.wasAlive = card.alive
    const alive = card.alive
    for (const b of Object.values(this.buttons)) {
      if (!b) continue
      for (const o of [b.shadow, b.face, b.label]) o.setAlpha(alive ? 1 : 0.3)
    }
    this.status?.setText(alive ? 'A > K > Q > J > 10 … 2' : this.t('game.higherLower.out'))
  }

  // Correct guess: the old card goes to the discard pile, the next one flips over from the deck.
  private advance(
    prev: { index: number; value: number },
    value: number,
    index: number,
    streak: number,
  ): void {
    const main = this.card
    if (!main) return
    this.discard?.show(prev.value, suitOf(prev.index, prev.value))
    this.discard?.root.setVisible(true)
    this.tweens.killTweensOf(main.root)
    main.root.setScale(1)
    this.tweens.add({
      targets: main.root,
      scaleX: 0,
      duration: 70,
      ease: 'Quad.easeIn',
      onComplete: () => {
        main.show(value, suitOf(index, value))
        this.tweens.add({ targets: main.root, scaleX: 1, duration: 90, ease: 'Quad.easeOut' })
      },
    })
    if (streak <= this.lastStreak) return
    const { x } = main.root
    this.sfx.correct()
    ring(this, x, this.cardY, PALETTE.lime, 120)
    floatText(this, x, this.cardY - 40, '+1', PALETTE.lime, 24)
    if (streak % MILESTONE === 0) {
      this.sfx.coin()
      burst(this, x, this.cardY, PALETTE.amber, 24, 300)
      floatText(
        this,
        x,
        this.cardY + 10,
        this.t('game.common.combo', { n: streak }),
        PALETTE.amber,
        24,
      )
    }
  }

  // `quiet`: a relayout restart after the run ended restores the busted card without the buzz.
  private bust(quiet = false): void {
    if (!quiet) {
      this.sfx.wrong()
      shake(this, 0.014, 260)
      flash(this, PALETTE.red, 150)
    }
    this.card?.setBust(true)
    if (this.banner) showBanner(this, this.banner, this.t('game.common.out'), PALETTE.red)
  }
}

function suitOf(index: number, value: number): number {
  return (index * 7 + value) % SUITS.length
}
