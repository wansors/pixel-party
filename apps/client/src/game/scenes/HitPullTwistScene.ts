import {
  HPT,
  HPT_ACTIONS,
  HPT_FREEZE,
  type HptOrder,
  type HptSnapshot,
  hptExpected,
  hptOrder,
  hptWindowMs,
  PALETTE,
} from '@pp/shared'
import type Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { addBanner, burst, flash, punch, shake, showBanner } from '../fx'
import {
  bodyStyle,
  ensureBevelPanel,
  ensurePixelGrid,
  fitFontSize,
  fitText,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Action colours and arrow directions: HIT ↑ red, PULL → blue, TWIST ← green, SHAKE ↓ yellow.
const COLORS = [0xe84040, 0x3d7fd8, 0x45c04a, 0xffcf4b]
const ANGLES = [-90, 0, 180, 90]
const KEYS: [string, number][] = [
  ['UP', 0],
  ['W', 0],
  ['RIGHT', 1],
  ['D', 1],
  ['LEFT', 2],
  ['A', 2],
  ['DOWN', 3],
  ['S', 3],
]

// An arrow pointing right (turned per action), and an open hand for FREEZE.
const ARROW = [
  '......o.....',
  '......oo....',
  '......owo...',
  'ooooooowwo..',
  'owwwwwwwwwo.',
  'owwwwwwwwwwo',
  'owwwwwwwwwo.',
  'ooooooowwo..',
  '......owo...',
  '......oo....',
  '......o.....',
]
const HAND = [
  '..o.o.o.....',
  '.owowowo....',
  '.owowowo.o..',
  '.owowowoowo.',
  '.owwwwwwowo.',
  '.owwwwwwwwo.',
  '.owwwwwwwo..',
  '.owwwwwwwo..',
  '..owwwwwo...',
  '..owwwwwo...',
  '...ooooo....',
]

// Hit, Pull, Twist (D47): the order in the middle — an arrow and a word, painted in some action's
// colour (obey the word and the arrow, not the paint) — over a bar draining its window; four buttons
// below in the arrow-key layout (↑ on top, ← ↓ → under it; the keys or a tap). Your orders run on this
// screen from the shared seed: a right move shows the next order a moment later, a wrong one or the
// bar running out is OUT at once (the server keeps the same clock and confirms). UPSIDE DOWN!
// stretches flip every move; on FREEZE! touch nothing until it passes. The strip on top shows how far
// everyone has got.
export class HitPullTwistScene extends MiniGameScene<HptSnapshot> {
  private compact = false
  private cardBox = { x: 0, y: 0, w: 0, h: 0 }
  private cardGfx?: Phaser.GameObjects.Graphics
  private icon?: Phaser.GameObjects.Image
  private word?: Phaser.GameObjects.Text
  private flipText?: Phaser.GameObjects.Text
  private timer?: Phaser.GameObjects.Graphics
  private banner?: Phaser.GameObjects.Text
  private subline?: Phaser.GameObjects.Text
  private strip?: Phaser.GameObjects.Container
  private buttons: { panel: Phaser.GameObjects.Image; x: number; y: number }[] = []
  private seed = 0
  private k = 0
  // Scene time order k shows.
  private shownAt = 0
  private alive = true
  private synced = false
  private drawnKey = ''
  private stripKey = ''
  private readyShown = false

  constructor(...deps: SceneDeps) {
    super('hit-pull-twist', ...deps)
  }

  override create(): void {
    super.create()
    this.buttons = []
    this.k = 0
    this.alive = true
    this.synced = false
    this.drawnKey = ''
    this.stripKey = ''
    this.readyShown = false
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    const hintH = this.compact ? 0 : 26
    const top = this.top + (this.compact ? 40 : 52)
    const size = Math.min(this.compact ? 84 : 110, (width - 48) / 3.4)
    const gap = this.compact ? 8 : 12
    const rowB = height - hintH - 10 - size / 2
    const rowA = rowB - size - gap
    const cardH = Math.min(rowA - size / 2 - top - 34, 260)
    this.cardBox = { x: width / 2, y: top + 24 + cardH / 2, w: Math.min(width - 32, 460), h: cardH }

    const arrowKey = (c: number) =>
      ensurePixelGrid(this, {
        key: `pp-hpt-arrow-${c.toString(16)}`,
        rows: ARROW,
        legend: { o: shade(c, -0.6), w: c },
      })
    for (const c of COLORS) arrowKey(c)
    ensurePixelGrid(this, { key: 'pp-hpt-hand', rows: HAND, legend: { o: 0x5a5f80, w: 0xf4f6ff } })

    this.cardGfx = this.add.graphics()
    const { x, y, h } = this.cardBox
    this.icon = this.add
      .image(x, y - h * 0.12, arrowKey(COLORS[0] as number))
      .setDisplaySize(h * 0.5, h * 0.46)
    this.word = this.add
      .text(
        x,
        y + h * 0.3,
        '',
        headlineStyle(this.compact ? 24 : 40, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 6,
        }),
      )
      .setOrigin(0.5)
    this.flipText = this.add
      .text(
        x,
        this.cardBox.y - h / 2 - 16,
        this.t('game.hpt.flipped'),
        headlineStyle(this.compact ? 12 : 16, PALETTE.magenta, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setVisible(false)
    this.timer = this.add.graphics()

    // Buttons: ↑ on top; ← ↓ → under it.
    const spots: [number, number, number][] = [
      [0, x, rowA],
      [2, x - size - gap, rowB],
      [3, x, rowB],
      [1, x + size + gap, rowB],
    ]
    this.buttons = new Array(4)
    for (const [a, bx, by] of spots) {
      const c = COLORS[a] as number
      const panel = this.add
        .image(
          bx,
          by,
          ensureBevelPanel(this, Math.round(size), Math.round(size), shade(c, -0.25), 6, true),
        )
        .setInteractive({ useHandCursor: true })
      this.add
        .image(bx, by - size * 0.12, arrowKey(0xf4f6ff))
        .setAngle(ANGLES[a] as number)
        .setDisplaySize(size * 0.42, size * 0.38)
      const label = this.t(`game.hpt.${HPT_ACTIONS[a]}`)
      this.add
        .text(
          bx,
          by + size * 0.3,
          label,
          headlineStyle(fitFontSize(label, size - 10, this.compact ? 8 : 12), PALETTE.text, {
            stroke: '#10121c',
            strokeThickness: 3,
          }),
        )
        .setOrigin(0.5)
      panel.on('pointerdown', () => this.press(a))
      this.buttons[a] = { panel, x: bx, y: by }
    }
    if (hintH) {
      const hint = this.add
        .text(width / 2, height - hintH / 2, this.t('game.hpt.hint'), bodyStyle(13, PALETTE.dim))
        .setOrigin(0.5)
      fitText(hint, width - 16, 13)
    }
    this.strip = this.add.container(0, this.top + (this.compact ? 18 : 24))
    this.banner = addBanner(this)
    this.banner.setPosition(width / 2, this.cardBox.y)
    this.subline = this.add
      .text(
        width / 2,
        this.cardBox.y + (this.compact ? 34 : 46),
        '',
        headlineStyle(this.compact ? 8 : 16, PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setDepth(950)
      .setVisible(false)
    for (const [key, a] of KEYS) this.onKey(key, () => this.press(a))
    this.input.keyboard?.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D')
  }

  private order(): HptOrder {
    return hptOrder(this.seed, this.k)
  }

  private press(action: number): void {
    if (!this.synced || !this.alive || this.state.final) return
    const now = this.time.now
    if (now < this.shownAt - 80) return
    const order = this.order()
    this.sendInput({ kind: 'act', k: this.k, action })
    const b = this.buttons[action]
    if (b) punch(this, b.panel, 0.12, 70)
    if (order.action === HPT_FREEZE || action !== hptExpected(order)) {
      this.knockOut(order.action === HPT_FREEZE ? 'game.hpt.moved' : 'game.hpt.wrong')
      return
    }
    this.sfx.pad(action)
    if (b) burst(this, b.x, b.y, COLORS[action] as number, 8, 110)
    this.k += 1
    this.shownAt = now + HPT.gapMs
    this.hud?.setScore(this.t('game.hpt.streak', { n: this.k }))
  }

  private knockOut(reasonKey: string): void {
    if (!this.alive) return
    this.alive = false
    this.sfx.wrong()
    this.sfx.eliminated()
    shake(this, 0.012, 240)
    flash(this, PALETTE.red, 140)
    const banner = this.banner
    if (banner) {
      const text = this.t('game.common.out')
      banner.setFontSize(fitFontSize(text, this.scale.width * 0.9, this.compact ? 24 : 32))
      showBanner(this, banner, text, PALETTE.red)
    }
    this.subline?.setText(this.t(reasonKey)).setVisible(true)
    if (this.subline) fitText(this.subline, this.scale.width * 0.9, this.compact ? 8 : 16)
  }

  protected frame(snap: HptSnapshot | null, time: number): void {
    if (!snap) return
    const me = snap.players[this.selfId]
    const now = this.time.now
    if (me && (!this.synced || me.k > this.k)) {
      // First look (or the server got further): take its order and clock.
      this.seed = snap.seed
      this.k = me.k
      this.shownAt = now + me.orderInMs
      this.synced = true
      this.hud?.setScore(this.t('game.hpt.streak', { n: this.k }))
    }
    if (me && !me.alive && this.alive) this.knockOut('game.hpt.slow')
    this.drawStrip(snap)
    if (!this.synced) return
    this.advance(now)
    this.drawOrder(now, time)
  }

  // A FREEZE passes when its window ends; any other order running out is OUT.
  private advance(now: number): void {
    while (this.alive && !this.state.final) {
      const order = this.order()
      const end = this.shownAt + hptWindowMs(this.k)
      if (now < end) return
      if (order.action !== HPT_FREEZE) {
        this.knockOut('game.hpt.slow')
        return
      }
      this.sfx.correct()
      this.k += 1
      this.shownAt = end + HPT.gapMs
    }
  }

  private drawOrder(now: number, time: number): void {
    const g = this.cardGfx
    const t = this.timer
    if (!g || !t || !this.icon || !this.word) return
    const ready = now < this.shownAt
    const banner = this.banner
    if (this.k === 0 && ready && !this.readyShown && banner) {
      this.readyShown = true
      showBanner(this, banner, this.t('game.hpt.ready'), PALETTE.amber)
    } else if (this.k === 0 && !ready && this.alive && banner?.visible) {
      banner.setVisible(false)
      this.sfx.go()
    }
    const order = this.order()
    const key = `${this.k}:${ready}:${this.alive}`
    if (key !== this.drawnKey) {
      this.drawnKey = key
      const { x, y, w, h } = this.cardBox
      g.clear()
      g.fillStyle(0x10121c, 0.6).fillRect(x - w / 2 + 6, y - h / 2 + 8, w, h)
      g.fillStyle(PALETTE.panelAlt, 1).fillRect(x - w / 2, y - h / 2, w, h)
      g.lineStyle(4, order.flipped && !ready ? PALETTE.magenta : PALETTE.frameLit, 1)
      g.strokeRect(x - w / 2, y - h / 2, w, h)
      const show = !ready && this.alive
      this.icon.setVisible(show)
      this.word.setVisible(show)
      this.flipText?.setVisible(show && order.flipped)
      if (show) {
        const paint = COLORS[order.paint] as number
        if (order.action === HPT_FREEZE) {
          this.icon.setTexture('pp-hpt-hand').setAngle(0)
          this.word.setText(this.t('game.hpt.freeze')).setColor(hexToCss(0xf4f6ff))
        } else {
          this.icon
            .setTexture(`pp-hpt-arrow-${paint.toString(16)}`)
            .setAngle(ANGLES[order.action] as number)
          this.word
            .setText(this.t(`game.hpt.${HPT_ACTIONS[order.action]}Call`))
            .setColor(hexToCss(paint))
        }
        this.word.setFontSize(fitFontSize(this.word.text, w - 24, this.compact ? 24 : 40))
        punch(this, this.icon, 0.18, 80)
        // An UPSIDE-DOWN stretch starts: a whoosh to go with the banner.
        if (order.flipped && !hptOrder(this.seed, this.k - 1).flipped) this.sfx.whoosh()
      }
    }
    // The window draining.
    t.clear()
    if (ready || !this.alive) return
    const frac = Math.max(0, Math.min(1, 1 - (now - this.shownAt) / hptWindowMs(this.k)))
    const { x, y, w, h } = this.cardBox
    t.fillStyle(PALETTE.bg, 1).fillRect(x - w / 2, y + h / 2 + 10, w, 8)
    t.fillStyle(
      order.action === HPT_FREEZE ? 0xf4f6ff : frac < 0.3 ? PALETTE.red : PALETTE.amber,
      1,
    )
    t.fillRect(x - w / 2, y + h / 2 + 10, w * frac, 8)
    if (order.flipped) this.flipText?.setAlpha(Math.floor(time / 180) % 2 ? 1 : 0.55)
  }

  // Everyone: avatar + orders done (dimmed once out).
  private drawStrip(snap: HptSnapshot): void {
    const c = this.strip
    if (!c) return
    const ids = Object.keys(snap.players)
    const key = ids.map((id) => `${id}:${snap.players[id]?.k}:${snap.players[id]?.alive}`).join('|')
    if (key === this.stripKey) return
    this.stripKey = key
    c.removeAll(true)
    const { width } = this.scale
    const step = Math.min(this.compact ? 30 : 52, (width - 24) / Math.max(1, ids.length))
    const x0 = width / 2 - (step * (ids.length - 1)) / 2
    ids.forEach((id, i) => {
      const p = snap.players[id]
      if (!p) return
      const x = x0 + i * step
      const icon = this.add
        .image(
          x,
          0,
          ensureAvatarTexture(
            this,
            this.state.avatarOf(id),
            this.state.colorOf(id),
            this.compact ? 1 : 2,
            'front',
            p.alive ? 'idle' : 'ko',
          ),
        )
        .setAlpha(p.alive ? 1 : 0.45)
      const n = this.add
        .text(
          x,
          this.compact ? 13 : 20,
          String(p.k),
          headlineStyle(this.compact ? 8 : 12, p.alive ? PALETTE.lime : PALETTE.dim, {
            stroke: '#10121c',
            strokeThickness: 3,
          }),
        )
        .setOrigin(0.5)
      c.add([icon, n])
    })
  }
}
