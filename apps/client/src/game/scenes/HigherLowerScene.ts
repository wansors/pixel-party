import { type HigherLowerCard, type HigherLowerSnapshot, PALETTE } from '@pp/shared'
import type Phaser from 'phaser'
import { addBanner, burst, flash, floatText, ring, shake, showBanner } from '../fx'
import {
  bodyStyle,
  CARD_INK,
  ensureBevelPanel,
  ensureCardTexture,
  ensurePixelGrid,
  fitText,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { type PlayerChip, PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const PRESS_PX = 4
const MILESTONE = 5
// Every player gets a chip; rooms bigger than this get an extra strip row.
const CHIPS_PER_ROW = 6
// The chip strip is rebuilt at most this often.
const STRIP_EVERY_MS = 250
const RANKS: Readonly<Record<number, string>> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }

type Action = 'higher' | 'lower' | 'bank'

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
  // Its PC keys ("↑ / W"…): under the label, or at the right end of a short button (hidden on phones).
  key: Phaser.GameObjects.Text
  y: number
}

// Higher or Lower canvas. This player's current card is a pixel playing card in front of the face-down
// deck (their own deck), with the previous card tilted on the discard pile. HIGHER / LOWER (click, ↑ ↓ or
// W / S) guesses the next card: a correct guess flips the next card over and extends the streak (cheers
// every 5); a miss flips over the card that beat it, busts it, halves the streak and ends the run with
// an OUT banner. BANK (click, Enter or B — never Space, so a stray "start" press can't end the run at
// 0) stops and keeps the streak — then the card that wasn't risked
// turns over on the deck. A chip strip shows every player's streak and status (never their cards).
export class HigherLowerScene extends MiniGameScene<HigherLowerSnapshot> {
  private card?: PlayingCard
  private discard?: PlayingCard
  // The card that wasn't risked, turned over on the deck after a BANK.
  private peek?: PlayingCard
  private buttons: Record<Action, Button | undefined> = {
    higher: undefined,
    lower: undefined,
    bank: undefined,
  }
  private prompt?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private cardY = 0
  private shown: { index: number; value: number } | null = null
  private wasPlaying = true
  private lastStreak = 0
  // Whether the buttons are drawn live (null until the first snapshot).
  private buttonsLive: boolean | null = null
  private chipsKey = ''
  private chipsAt = Number.NEGATIVE_INFINITY

  constructor(...deps: SceneDeps) {
    super('higher-lower', ...deps)
  }

  override create(): void {
    super.create()
    this.shown = null
    this.wasPlaying = true
    this.lastStreak = 0
    this.buttonsLive = null
    this.chipsKey = ''
    this.chipsAt = Number.NEGATIVE_INFINITY
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

    // Bottom-up: chip strip, BANK, HIGHER / LOWER, status line; the card gets the rest.
    const chipSize = compact ? 11 : height >= 900 ? 16 : 13
    const roster = Object.keys(this.state.names).length
    const stripRows = (width < 600 ? 2 : 1) + (roster > CHIPS_PER_ROW ? 1 : 0)
    const stripTop = height - (compact ? 12 : 18) - stripRows * PlayerStrip.rowH(chipSize)
    this.strip = new PlayerStrip(
      this,
      cx,
      stripTop + PlayerStrip.rowH(chipSize) / 2,
      width - 32,
      chipSize,
      stripRows,
    )
    // A big (1080p) screen gets a bigger card and buttons: it's read from across the room.
    const big = !compact && height >= 900
    const contentW = Math.min(width - 32, big ? 800 : 640)
    const gap = compact ? 12 : 18
    const bw = Math.round((contentW - gap) / 2)
    const bh = compact ? 76 : big ? 104 : 92
    const bankH = compact ? 48 : 56
    const bankY = stripTop - gap - bankH / 2
    this.makeButton('bank', cx, bankY, contentW, bankH, PALETTE.amber, compact)
    const by = bankY - bankH / 2 - gap - bh / 2
    this.makeButton('higher', cx - bw / 2 - gap / 2, by, bw, bh, PALETTE.lime, compact)
    this.makeButton('lower', cx + bw / 2 + gap / 2, by, bw, bh, PALETTE.red, compact)
    const statusY = by - bh / 2 - (compact ? 18 : 24)
    this.status = this.add
      .text(cx, statusY, '', bodyStyle(compact ? 13 : 16, PALETTE.dim))
      .setOrigin(0.5)

    const areaTop = this.top + promptSize + (compact ? 28 : 40)
    const areaBottom = statusY - (compact ? 20 : 26)
    const cardH = Math.round(Math.min(areaBottom - areaTop, compact ? 260 : big ? 400 : 320))
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
    this.peek = new PlayingCard(
      this,
      cx + cardW * 0.62,
      this.cardY - cardH * 0.06,
      cardW,
      cardH,
      suitKeys,
      crossKey,
    )
    this.peek.root.setAngle(8).setScale(0.8).setAlpha(0.9).setVisible(false)

    this.banner = addBanner(this).setFontSize(compact ? 32 : 40)
    this.onKey('UP', () => this.act('higher'))
    this.onKey('W', () => this.act('higher'))
    this.onKey('DOWN', () => this.act('lower'))
    this.onKey('S', () => this.act('lower'))
    this.onKey('ENTER', () => this.act('bank'))
    this.onKey('B', () => this.act('bank'))
  }

  private makeButton(
    action: Action,
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
    face.on('pointerdown', () => this.act(action))
    // Tall buttons stack label over keys; the short BANK bar keeps its keys at its right end.
    const stacked = h >= 80
    const label = this.add
      .text(
        x,
        stacked && !compact ? y - h * 0.12 : y,
        this.t(`game.higherLower.${action}`),
        headlineStyle(compact ? 16 : 24, PALETTE.text, { stroke: '#10121c', strokeThickness: 6 }),
      )
      .setOrigin(0.5)
    fitText(label, w - 20, compact ? 16 : 24)
    const key = this.add
      .text(
        stacked ? x : x + w / 2 - 18,
        stacked ? y + h * 0.26 : y,
        this.t(`game.higherLower.${action}Key`),
        headlineStyle(16, shade(color, -0.65)),
      )
      .setOrigin(stacked ? 0.5 : 1, 0.5)
      .setVisible(!compact)
    this.buttons[action] = { shadow, face, label, key, y }
  }

  private act(action: Action): void {
    const card = this.snap?.cards[this.selfId]
    if (card?.status !== 'playing' || this.snap?.remainingMs === 0) return
    this.sfx.click()
    const b = this.buttons[action]
    if (b) {
      for (const o of [b.face, b.label, b.key]) o.y += PRESS_PX
      this.time.delayedCall(90, () => {
        for (const o of [b.face, b.label, b.key]) o.y -= PRESS_PX
      })
    }
    this.sendInput(
      action === 'bank' ? { kind: 'bank' } : { kind: 'guess', index: card.index, dir: action },
    )
  }

  protected frame(snap: HigherLowerSnapshot | null): void {
    if (!snap) return
    const card = snap.cards[this.selfId]
    const streak = snap.scores[this.selfId] ?? 0
    this.hud?.setScore(this.t('game.higherLower.streak', { n: streak }))
    // Chips change with someone's streak or status, rebuilt at most every STRIP_EVERY_MS (every
    // rebuild re-creates a dozen chips).
    if (this.time.now - this.chipsAt >= STRIP_EVERY_MS) {
      let key = ''
      for (const [id, c] of Object.entries(snap.cards)) key += `${snap.scores[id]}${c.status[0]},`
      if (key !== this.chipsKey) {
        this.chipsKey = key
        this.chipsAt = this.time.now
        this.strip?.set(this.chips(snap))
      }
    }
    if (!card || !this.card) return

    if (!this.shown) {
      this.card.show(card.current, suitOf(card.index, card.current))
      this.card.root.setVisible(true)
    } else if (card.index !== this.shown.index) {
      this.advance(this.shown, card.current, card.index, streak)
    }
    this.shown = { index: card.index, value: card.current }

    const playing = card.status === 'playing'
    if (this.wasPlaying && !playing) this.endRun(card, streak, this.firstSnapshot)
    this.wasPlaying = playing
    this.lastStreak = streak
    if (playing !== this.buttonsLive) {
      this.buttonsLive = playing
      for (const b of Object.values(this.buttons)) {
        for (const o of b ? [b.shadow, b.face, b.label, b.key] : []) o.setAlpha(playing ? 1 : 0.3)
      }
      this.status?.setText(playing ? 'A > K > Q > J > 10 … 2' : this.t('game.higherLower.out'))
    }
  }

  // Every player's streak and how their run stands (✓ banked, ✕ bust) — never their cards.
  private chips(snap: HigherLowerSnapshot): PlayerChip[] {
    return Object.entries(snap.scores)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => {
        const status = snap.cards[id]?.status ?? 'playing'
        const mark = status === 'banked' ? '✓' : status === 'bust' ? '✕' : ''
        return {
          text: `${this.label(id).slice(0, 10).toUpperCase()} ${n}${mark}`,
          avatar: this.state.avatarOf(id),
          color: this.state.colorOf(id),
          dim: status === 'bust',
        }
      })
  }

  // Turns the main card over to a new face (a quick scaleX flip), then runs `then`.
  private flipTo(value: number, index: number, then?: () => void): void {
    const main = this.card
    if (!main) return
    this.sfx.flip()
    this.tweens.killTweensOf(main.root)
    main.root.setScale(1)
    this.tweens.add({
      targets: main.root,
      scaleX: 0,
      duration: 70,
      ease: 'Quad.easeIn',
      onComplete: () => {
        main.show(value, suitOf(index, value))
        then?.()
        this.tweens.add({ targets: main.root, scaleX: 1, duration: 90, ease: 'Quad.easeOut' })
      },
    })
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
    this.flipTo(value, index)
    if (streak <= this.lastStreak) return
    const { x } = main.root
    // Every MILESTONE in a row pays out as a combo arpeggio instead of the plain chime.
    if (streak % MILESTONE === 0) this.sfx.lineClear(Math.min(4, streak / MILESTONE))
    else this.sfx.correct()
    ring(this, x, this.cardY, PALETTE.lime, 120)
    floatText(this, x, this.cardY - 40, '+1', PALETTE.lime, 24)
    if (streak % MILESTONE === 0) {
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

  // The run is over. A bust turns over the card that beat the guess and halves the streak; a bank
  // turns over, on the deck, the card that wasn't risked. `quiet`: a relayout restart restores the end
  // state without the buzz.
  private endRun(card: HigherLowerCard, streak: number, quiet: boolean): void {
    const main = this.card
    if (!main) return
    if (card.status === 'bust') {
      if (card.next !== null) {
        this.discard?.show(card.current, suitOf(card.index, card.current))
        this.discard?.root.setVisible(true)
        if (quiet) main.show(card.next, suitOf(card.index + 1, card.next))
        else this.flipTo(card.next, card.index + 1)
      }
      main.setBust(true)
      if (!quiet) {
        this.sfx.wrong()
        shake(this, 0.014, 260)
        flash(this, PALETTE.red, 150)
        const lost = this.lastStreak - streak
        if (lost > 0) floatText(this, main.root.x, this.cardY - 40, `-${lost}`, PALETTE.red, 24)
      }
      if (this.banner) showBanner(this, this.banner, this.t('game.common.out'), PALETTE.red)
      return
    }
    this.showPeek(card, quiet)
    if (!quiet) {
      this.sfx.coin()
      burst(this, main.root.x, this.cardY, PALETTE.amber, 24, 300)
    }
    if (this.banner) showBanner(this, this.banner, this.t('game.higherLower.banked'), PALETTE.lime)
  }

  private showPeek(card: HigherLowerCard, quiet: boolean): void {
    const peek = this.peek
    if (!peek || card.next === null) return
    peek.show(card.next, suitOf(card.index + 1, card.next))
    peek.root.setVisible(true)
    if (quiet) return
    const { x, y } = peek.root
    peek.root.setPosition(x - 30, y + 20).setAlpha(0)
    this.tweens.add({ targets: peek.root, x, y, alpha: 0.9, duration: 220, ease: 'Back.easeOut' })
  }
}

function suitOf(index: number, value: number): number {
  return (index * 7 + value) % SUITS.length
}
