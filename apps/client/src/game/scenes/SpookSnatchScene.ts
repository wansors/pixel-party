import {
  PALETTE,
  SPOOK,
  SPOOK_ITEMS,
  type SpookFigure,
  type SpookSnapshot,
  spookAnswer,
} from '@pp/shared'
import Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { addBanner, burst, floatText, punch, shake, showBanner, speechBubble } from '../fx'
import {
  bodyStyle,
  ensureBevelPanel,
  ensurePixelGrid,
  fitText,
  headlineStyle,
  shade,
} from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const GRID = 16
// Object i's colour (the same order as SPOOK_COLORS).
const COLORS = [0x3d7fd8, 0xe84040, 0x45c04a, 0xffcf4b, 0xa05ce0]

// A little ghost that peeks from the card and shouts on the reveal.
const GHOST = [
  '...oooooo...',
  '..owwwwwwo..',
  '.owwwwwwwwo.',
  '.owwkwwkwwo.',
  '.owwkwwkwwo.',
  '.owwwwwwwwo.',
  '.owwwmmwwwo.',
  '.owwwwwwwwo.',
  '.owwwwwwwwo.',
  '.owowwowwwo.',
  '.oo.oo.ooo..',
]

// The shapes on a 16×16 grid (true = filled): cube, ball, star, triangle, heart.
function shapeMask(shape: number): boolean[][] {
  const inside = (x: number, y: number): boolean => {
    const cx = x + 0.5
    const cy = y + 0.5
    switch (shape) {
      case 0:
        return cx > 2.5 && cx < 13.5 && cy > 2.5 && cy < 13.5
      case 1:
        return (cx - 8) ** 2 + (cy - 8) ** 2 <= 36
      case 2: {
        // Point-in-polygon for a 5-point star.
        const pts: [number, number][] = []
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? 7.2 : 3
          const a = -Math.PI / 2 + (i * Math.PI) / 5
          pts.push([8 + r * Math.cos(a), 8.4 + r * Math.sin(a)])
        }
        let hit = false
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i] as [number, number]
          const [xj, yj] = pts[j] as [number, number]
          if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) hit = !hit
        }
        return hit
      }
      case 3:
        return cy > 2 && cy < 14 && Math.abs(cx - 8) <= (cy - 2) * 0.55
      default:
        return (
          (cx - 5.5) ** 2 + (cy - 6) ** 2 <= 9.5 ||
          (cx - 10.5) ** 2 + (cy - 6) ** 2 <= 9.5 ||
          (cy >= 6 && cy < 14 && Math.abs(cx - 8) <= (14 - cy) * 0.8)
        )
    }
  }
  return Array.from({ length: GRID }, (_, y) =>
    Array.from({ length: GRID }, (_, x) => inside(x, y)),
  )
}

// Spook Snatch (D46): five objects in a row at the bottom (keys 1–5, or tap), a card in the middle — a
// snapshot the ghost took, two figures with shapes and colours mixed up — and a bar draining its
// window. Grab the object shown exactly, or, if none is, the one whose shape and colour appear nowhere.
// Your grab lights up right or wrong at once (the rule is shared, so the screen knows); a wrong one
// locks your buttons for two seconds. On the reveal the right object glows and the ghost shouts. The
// strip on top shows how everyone did on this card (their place, or a cross when they got it wrong).
export class SpookSnatchScene extends MiniGameScene<SpookSnapshot> {
  private compact = false
  private card = { x: 0, y: 0, w: 0, h: 0 }
  private figureImgs: Phaser.GameObjects.Image[] = []
  private buttons: {
    panel: Phaser.GameObjects.Image
    icon: Phaser.GameObjects.Image
    x: number
    y: number
  }[] = []
  private lockShade?: Phaser.GameObjects.Graphics
  private lockText?: Phaser.GameObjects.Text
  private timer?: Phaser.GameObjects.Graphics
  private ghost?: Phaser.GameObjects.Image
  private banner?: Phaser.GameObjects.Text
  private strip?: Phaser.GameObjects.Container
  private glow?: Phaser.GameObjects.Graphics
  private shownCard = -1
  private shownPhase = ''
  private myGrab: { card: number; item: number } | null = null
  private lockUntil = 0
  private stripKey = ''
  private btnSize = 64

  constructor(...deps: SceneDeps) {
    super('spook-snatch', ...deps)
  }

  override create(): void {
    super.create()
    this.figureImgs = []
    this.buttons = []
    this.shownCard = -1
    this.shownPhase = ''
    this.myGrab = null
    this.lockUntil = 0
    this.stripKey = ''
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    const top = this.top + (this.compact ? 34 : 46)
    const hintH = this.compact ? 30 : 34
    const gap = this.compact ? 8 : 14
    this.btnSize = Math.min(this.compact ? 64 : 104, Math.floor((width - 24 - gap * 4) / 5))
    const btnY = height - hintH - this.btnSize / 2 - 8
    // Portrait phones get a taller card (the width is what limits it there).
    const cardH = Math.min(
      btnY - this.btnSize / 2 - top - 40,
      this.compact ? width * 0.8 : width * 0.5,
      380,
    )
    this.card = {
      w: Math.min(width - 32, cardH * 1.6),
      h: cardH,
      x: width / 2,
      y: top + 10 + cardH / 2,
    }

    for (let i = 0; i < SPOOK_ITEMS; i++) this.texture(i, i)
    // The card: an old photo with a white border.
    const g = this.add.graphics()
    const { x, y, w, h } = this.card
    g.fillStyle(0x10121c, 0.6).fillRect(x - w / 2 + 6, y - h / 2 + 8, w, h)
    g.fillStyle(0xf3ead2, 1).fillRect(x - w / 2, y - h / 2, w, h)
    g.fillStyle(0xd9cba4, 1).fillRect(x - w / 2 + 10, y - h / 2 + 10, w - 20, h - 20)
    g.fillStyle(0xe9dfc2, 1).fillRect(x - w / 2 + 14, y - h / 2 + 14, w - 28, h - 28)
    this.glow = this.add.graphics().setDepth(4)
    this.timer = this.add.graphics()
    const ghostKey = ensurePixelGrid(this, {
      key: 'pp-spook-ghost',
      rows: GHOST,
      legend: { o: 0x5a5f80, w: 0xf4f6ff, k: 0x10121c, m: 0xff7b9c },
    })
    this.ghost = this.add
      .image(x + w / 2 - 8, y - h / 2 + 4, ghostKey)
      .setDisplaySize(this.compact ? 36 : 56, this.compact ? 33 : 51)
      .setDepth(6)
    this.tweens.add({
      targets: this.ghost,
      y: this.ghost.y - 6,
      yoyo: true,
      repeat: -1,
      duration: 900,
      ease: 'Sine.easeInOut',
    })

    // The five objects.
    const rowW = this.btnSize * 5 + gap * 4
    for (let i = 0; i < SPOOK_ITEMS; i++) {
      const bx = width / 2 - rowW / 2 + this.btnSize / 2 + i * (this.btnSize + gap)
      const panel = this.add
        .image(
          bx,
          btnY,
          ensureBevelPanel(this, this.btnSize, this.btnSize, PALETTE.panelAlt, 5, true),
        )
        .setInteractive({ useHandCursor: true })
        .setDepth(5)
      const icon = this.add
        .image(bx, btnY - 4, this.texture(i, i))
        .setDisplaySize(this.btnSize * 0.62, this.btnSize * 0.62)
        .setDepth(6)
      if (!this.compact) {
        this.add
          .text(
            bx - this.btnSize / 2 + 8,
            btnY + this.btnSize / 2 - 6,
            String(i + 1),
            headlineStyle(12, PALETTE.dim),
          )
          .setOrigin(0, 1)
          .setDepth(6)
      }
      panel.on('pointerdown', () => this.grab(i))
      this.buttons.push({ panel, icon, x: bx, y: btnY })
    }
    this.lockShade = this.add.graphics().setDepth(8)
    this.lockText = this.add
      .text(
        width / 2,
        btnY,
        '',
        headlineStyle(this.compact ? 12 : 16, PALETTE.red, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setDepth(9)
    const hint = this.add
      .text(
        width / 2,
        height - hintH / 2,
        this.t(this.compact ? 'game.spookSnatch.hintShort' : 'game.spookSnatch.hint'),
        bodyStyle(this.compact ? 10 : 14, PALETTE.dim),
      )
      .setOrigin(0.5)
    fitText(hint, width - 16, this.compact ? 10 : 14)
    this.strip = this.add.container(0, this.top + (this.compact ? 16 : 22))
    this.banner = addBanner(this)
    this.banner.setPosition(width / 2, this.card.y)
    for (const [k, i] of [
      ['ONE', 0],
      ['TWO', 1],
      ['THREE', 2],
      ['FOUR', 3],
      ['FIVE', 4],
    ] as const)
      this.onKey(k, () => this.grab(i))
  }

  // A figure: `shape` drawn in colour `color`, with a dark outline and a lit top edge.
  private texture(shape: number, color: number): string {
    const key = `pp-spook-${shape}-${color}`
    if (this.textures.exists(key)) return key
    const m = shapeMask(shape)
    const c = COLORS[color] ?? 0xffffff
    const at = (x: number, y: number): boolean => m[y]?.[x] === true
    const px = 4
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (at(x, y)) {
          const lit = !at(x, y - 1) || !at(x - 1, y)
          const dark = !at(x, y + 1) || !at(x + 1, y)
          g.fillStyle(lit ? shade(c, 0.35) : dark ? shade(c, -0.3) : c, 1)
          g.fillRect(x * px, y * px, px, px)
        } else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
          g.fillStyle(shade(c, -0.7), 1)
          g.fillRect(x * px, y * px, px, px)
        }
      }
    }
    g.generateTexture(key, GRID * px, GRID * px)
    g.destroy()
    return key
  }

  private grab(item: number): void {
    const snap = this.snap
    if (snap?.phase !== 'card' || this.state.final) return
    const me = snap.players[this.selfId]
    if (!me || me.answered || this.myGrab?.card === snap.cardNo) return
    if (this.time.now < this.lockUntil || me.lockedMs > 0) return
    this.myGrab = { card: snap.cardNo, item }
    this.sendInput({ kind: 'grab', item, card: snap.cardNo })
    const b = this.buttons[item]
    if (!b) return
    const right = item === spookAnswer(snap.figures)
    punch(this, b.icon, 0.25, 90)
    if (right) {
      this.sfx.correct()
      b.panel.setTint(0x8be94b)
      burst(this, b.x, b.y, PALETTE.lime, 12, 160)
    } else {
      this.sfx.wrong()
      b.panel.setTint(0xff5252)
      shake(this, 0.006, 140)
      this.lockUntil = this.time.now + SPOOK.lockMs
    }
  }

  protected frame(snap: SpookSnapshot | null, time: number): void {
    if (!snap) return
    if (snap.cardNo !== this.shownCard) this.showCard(snap)
    if (snap.phase !== this.shownPhase) this.onPhase(snap)
    this.drawTimer(snap)
    this.drawLock(snap, time)
    this.drawStrip(snap)
    const me = snap.players[this.selfId]
    if (me) this.hud?.setScore(this.t('game.common.pts', { n: me.points }))
  }

  private showCard(snap: SpookSnapshot): void {
    this.shownCard = snap.cardNo
    for (const img of this.figureImgs) img.destroy()
    this.figureImgs = []
    for (const b of this.buttons) b.panel.clearTint()
    this.glow?.clear()
    const { x, y, w, h } = this.card
    const size = Math.min(h * 0.62, w * 0.36)
    snap.figures.forEach((f: SpookFigure, i) => {
      const fx = x + (i === 0 ? -1 : 1) * w * 0.2
      const img = this.add
        .image(fx, y, this.texture(f.shape, f.color))
        .setDisplaySize(size * f.scale, size * f.scale)
        .setAngle(f.rot)
        .setDepth(3)
      punch(this, img, 0.15, 90)
      this.figureImgs.push(img)
    })
    if (snap.cardNo > 0) this.sfx.flip()
  }

  private onPhase(snap: SpookSnapshot): void {
    this.shownPhase = snap.phase
    const banner = this.banner
    if (snap.phase === 'ready') {
      if (banner) showBanner(this, banner, this.t('game.spookSnatch.ready'), PALETTE.amber)
      return
    }
    banner?.setVisible(false)
    if (snap.phase !== 'reveal' || snap.answer === undefined) return
    // The right object glows; the ghost shouts.
    const b = this.buttons[snap.answer]
    if (b && this.glow) {
      const s = this.btnSize / 2 + 6
      this.glow.lineStyle(4, PALETTE.lime, 1).strokeRect(b.x - s, b.y - s, s * 2, s * 2)
      punch(this, b.icon, 0.3, 120)
    }
    if (this.ghost) {
      speechBubble(
        this,
        this.ghost.x - 10,
        this.ghost.y - this.ghost.displayHeight / 2,
        this.t('game.spookSnatch.boo'),
        this.compact ? 10 : 14,
        900,
      )
    }
    const me = snap.players[this.selfId]
    if (me?.place && me.place > 0 && b) {
      floatText(
        this,
        b.x,
        b.y - this.btnSize * 0.7,
        this.t('game.spookSnatch.place', { n: me.place }),
        PALETTE.lime,
        this.compact ? 12 : 16,
      )
    } else if (!me?.answered) {
      this.sfx.quiet(() => this.sfx.tick(), 0.5)
    }
  }

  private drawTimer(snap: SpookSnapshot): void {
    const g = this.timer
    if (!g) return
    g.clear()
    if (snap.phase !== 'card') return
    const frac = snap.windowMs > 0 ? Phaser.Math.Clamp(snap.phaseMs / snap.windowMs, 0, 1) : 0
    const { x, y, w, h } = this.card
    g.fillStyle(PALETTE.panelAlt, 1).fillRect(x - w / 2, y + h / 2 + 10, w, 8)
    g.fillStyle(frac < 0.3 ? PALETTE.red : PALETTE.amber, 1).fillRect(
      x - w / 2,
      y + h / 2 + 10,
      w * frac,
      8,
    )
  }

  // A wrong grab greys the buttons out, with the seconds left.
  private drawLock(snap: SpookSnapshot, time: number): void {
    const g = this.lockShade
    if (!g || !this.lockText) return
    // The server's lock wins when it says more (a scene restarted mid-lock).
    const server = snap.players[this.selfId]?.lockedMs ?? 0
    if (server > this.lockUntil - time + 300) this.lockUntil = time + server
    const left = Math.max(0, this.lockUntil - time)
    g.clear()
    if (left <= 0) {
      this.lockText.setVisible(false)
      return
    }
    const first = this.buttons[0]
    const last = this.buttons[SPOOK_ITEMS - 1]
    if (!first || !last) return
    const s = this.btnSize / 2 + 4
    g.fillStyle(0x10121c, 0.7).fillRect(first.x - s, first.y - s, last.x - first.x + s * 2, s * 2)
    this.lockText
      .setText(this.t('game.spookSnatch.locked', { s: (left / 1000).toFixed(1) }))
      .setVisible(true)
  }

  // Everyone's state on this card: avatar + their place, or a cross for a wrong grab.
  private drawStrip(snap: SpookSnapshot): void {
    const c = this.strip
    if (!c) return
    const ids = Object.keys(snap.players)
    const key =
      ids
        .map((id) => {
          const p = snap.players[id]
          return `${id}:${p?.answered}:${p?.place}`
        })
        .join('|') + snap.cardNo
    if (key === this.stripKey) return
    this.stripKey = key
    c.removeAll(true)
    const { width } = this.scale
    const step = Math.min(this.compact ? 30 : 48, (width - 24) / Math.max(1, ids.length))
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
          ),
        )
        .setAlpha(p.answered && p.place === 0 ? 0.45 : 1)
      c.add(icon)
      if (!p.answered) return
      const mark = p.place > 0 ? `${p.place}` : '×'
      c.add(
        this.add
          .text(
            x + (this.compact ? 9 : 14),
            this.compact ? 7 : 10,
            mark,
            headlineStyle(this.compact ? 8 : 12, p.place > 0 ? PALETTE.lime : PALETTE.red, {
              stroke: '#10121c',
              strokeThickness: 3,
            }),
          )
          .setOrigin(0.5),
      )
    })
  }
}
