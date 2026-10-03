import { PALETTE, type QuickDrawPlayerView, type QuickDrawSnapshot } from '@pp/shared'
import type Phaser from 'phaser'
import { AvatarSprite, avatarPx } from '../avatars'
import { burst, flash, floatText, punch, shake } from '../fx'
import {
  bodyStyle,
  ensurePixelGrid,
  ensurePixelOrb,
  fitText,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Stepped sky bands, top to horizon: a tense dusk while waiting, a blazing sunset once the signal
// fires.
const DUSK = [0x160a18, 0x241022, 0x38142c, 0x521a34, 0x6e2236, 0x8a2d38]
const BLAZE = [0x3a1a52, 0x6e2a6e, 0xb0446a, 0xff7b3d, 0xffa24b, 0xffcf4b]
const SAND = 0x9a6a3a
const WOOD = 0x7a4a26

// Each duelist is the player's lobby avatar in side view, facing the other; drawing pulls this revolver
// (facing right, 10x5 cells at the avatar's pixel size): g steel, d dark steel, w wooden grip.
const REVOLVER = ['__gggggggg', '_gdddddddd', '_wwd______', '_ww_______', '_ww_______']
const CACTUS = [
  '___gg___',
  '__gGgg__',
  '__gGgg_g',
  'g_gGgg_g',
  'g_gGgggg',
  'gggGgg__',
  '__gGgg__',
  '__gGgg__',
  '__gGgg__',
  '__gGgg__',
]
const TUMBLEWEED = [
  '__tttt__',
  '_t_tt_t_',
  't_t__t_t',
  'tt_tt_tt',
  'tt_tt_tt',
  't_t__t_t',
  '_t_tt_t_',
  '__tttt__',
]

type Outcome = 'fastest' | 'oppJumped' | 'jumped' | 'slower' | 'draw' | 'bye'

interface Slinger {
  avatar: AvatarSprite
  gun: Phaser.GameObjects.Image
  name: Phaser.GameObjects.Text
  // Gun-tip offset from the avatar's origin (feet), for the muzzle flash.
  tipX: number
  tipY: number
}

// Generates (and caches by key) a beveled pixel tile at its real size — a stretched square block
// would stretch its bevel too. Light top/left edge, dark bottom/right edge, flat base.
function ensureWoodSign(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  color: number,
  bevel: number,
): string {
  if (scene.textures.exists(key)) return key
  const g = scene.make.graphics({ x: 0, y: 0 })
  g.fillStyle(shade(color, -0.5), 1).fillRect(0, 0, w, h)
  g.fillStyle(shade(color, 0.4), 1).fillRect(0, 0, w - bevel, h - bevel)
  g.fillStyle(color, 1).fillRect(bevel, bevel, w - bevel * 2, h - bevel * 2)
  // Plank seams.
  g.fillStyle(shade(color, -0.3), 1)
  for (let y = Math.round(h / 3); y < h - bevel; y += Math.round(h / 3)) {
    g.fillRect(bevel, y, w - bevel * 2, 2)
  }
  g.generateTexture(key, w, h)
  g.destroy()
  return key
}

// Quick Draw Duel canvas: a pixel-western standoff. You (left) and your opponent (right) face off
// in your identity colors under a dusk sky; a wooden sign says WAIT… until the signal fires — the
// sky blazes, the sign yells FIRE! — then tap anywhere (or Space) to draw. The sign then carries
// the verdict and the line under it explains it (who was faster, who jumped the gun). A tap before
// the signal is a false start. Server-authoritative: the snapshot only ever says whether it has
// fired.
export class QuickDrawScene extends MiniGameScene<QuickDrawSnapshot> {
  private sky?: Phaser.GameObjects.Graphics
  private sign?: Phaser.GameObjects.Image
  private signText?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private me?: Slinger
  private opp?: Slinger
  private signSize = 40
  private signMaxW = 0
  private horizon = 0
  private skyKey = ''
  private wasFired = false
  private outcome?: Outcome
  // Our own valid draw is shown the moment we tap (the verdict still comes from the server).
  private firedLocally = false

  constructor(...deps: SceneDeps) {
    super('quick-draw', ...deps)
  }

  override create(): void {
    super.create({ hud: false })
    this.me = undefined
    this.opp = undefined
    this.skyKey = ''
    this.wasFired = false
    this.outcome = undefined
    this.firedLocally = false
    const { width, height } = this.scale
    const cx = width / 2
    const compact = Math.min(width, height) < 520
    this.horizon = Math.round(height * 0.62)

    this.sky = this.add.graphics().setDepth(-10)
    const sunD = Math.min(width, height) * 0.34
    const sunKey = ensurePixelOrb(this, 'pp-qd-sun', 24, PALETTE.amber)
    this.add.image(cx, this.horizon, sunKey).setDisplaySize(sunD, sunD).setAlpha(0.9).setDepth(-9)
    // Sand, with a darker strip at the horizon and a few pebbles.
    const ground = this.add.graphics().setDepth(-8)
    ground.fillStyle(SAND, 1).fillRect(0, this.horizon, width, height - this.horizon)
    ground.fillStyle(shade(SAND, -0.3), 1).fillRect(0, this.horizon, width, 6)
    ground.fillStyle(shade(SAND, -0.2), 1)
    for (let i = 0; i < 24; i++) {
      const x = (i * 97 + 13) % width
      const y = this.horizon + 14 + ((i * 53) % Math.max(1, height - this.horizon - 20))
      ground.fillRect(x, y, 6, 3)
    }
    const cactusKey = ensurePixelGrid(this, {
      key: 'pp-qd-cactus',
      rows: CACTUS,
      legend: { g: 0x1d5a34, G: 0x2f8a4a },
    })
    const cactusH = Math.min(height * 0.16, 110)
    for (const fx of [0.06, 0.94]) {
      this.add
        .image(width * fx, this.horizon + 4, cactusKey)
        .setOrigin(0.5, 1)
        .setDisplaySize(cactusH * 0.8, cactusH)
        .setDepth(-7)
    }
    this.rollTumbleweed()

    // The signal sign: a wooden plank on two posts, centered up top.
    const signW = Math.round(Math.min(width * 0.8, 480))
    const signH = Math.round(compact ? 76 : 100)
    const signY = Math.round(height * 0.05 + signH / 2 + 8)
    const post = this.add.graphics().setDepth(1)
    post.fillStyle(shade(WOOD, -0.4), 1)
    post.fillRect(cx - signW * 0.3 - 4, signY, 8, signH * 0.9)
    post.fillRect(cx + signW * 0.3 - 4, signY, 8, signH * 0.9)
    this.sign = this.add
      .image(cx, signY, ensureWoodSign(this, `pp-qd-sign-${signW}x${signH}`, signW, signH, WOOD, 5))
      .setDepth(2)
    this.signSize = compact ? 32 : 48
    this.signMaxW = signW - 28
    this.signText = this.add
      .text(
        cx,
        signY,
        '',
        headlineStyle(this.signSize, PALETTE.text, { stroke: '#2a160a', strokeThickness: 6 }),
      )
      .setOrigin(0.5)
      .setDepth(3)
    this.status = this.add
      .text(
        cx,
        signY + signH / 2 + (compact ? 34 : 44),
        '',
        bodyStyle(compact ? 15 : 20, PALETTE.text, {
          align: 'center',
          stroke: '#10121c',
          strokeThickness: 4,
          wordWrap: { width: width * 0.9 },
        }),
      )
      .setOrigin(0.5, 0)
      .setDepth(3)

    this.input.on('pointerdown', () => this.draw())
    this.onKey('SPACE', () => this.draw())
    this.drawSky(DUSK)
    this.setSign(this.t('game.quickDraw.wait'), PALETTE.text)
  }

  // A tumbleweed rolling across the sand on a loop — flavor only, unrelated to the signal timing.
  private rollTumbleweed(): void {
    const { width, height } = this.scale
    const key = ensurePixelGrid(this, {
      key: 'pp-qd-tumbleweed',
      rows: TUMBLEWEED,
      legend: { t: 0xc9a36b },
    })
    const size = Math.min(width, height) * 0.06
    const y = this.horizon + (height - this.horizon) * 0.55
    const weed = this.add.image(-size, y, key).setDisplaySize(size, size).setDepth(-6)
    this.tweens.add({ targets: weed, x: width + size, angle: 720, duration: 7000, repeat: -1 })
    this.tweens.add({
      targets: weed,
      y: y - size * 0.6,
      duration: 350,
      yoyo: true,
      repeat: -1,
      ease: 'Quad.easeOut',
    })
  }

  // Both duelists, once the snapshot names the opponent (or leaves us alone on a bye).
  private buildSlingers(me: QuickDrawPlayerView): void {
    const { width, height } = this.scale
    const size = avatarPx(Math.min(height * 0.26, width * 0.34))
    const feetY = this.horizon + (height - this.horizon) * 0.35
    const cell = size / 16
    const gunKey = ensurePixelGrid(this, {
      key: 'pp-qd-revolver',
      rows: REVOLVER,
      legend: { g: 0xaab2cc, d: 0x6b7390, w: 0x7a4a26 },
      pixelSize: 1,
    })
    const make = (id: string, x: number, flip: boolean): Slinger => {
      const color = this.state.colorOf(id, id === this.selfId ? PALETTE.cyan : PALETTE.magenta)
      const avatar = new AvatarSprite(this, this.state.avatarOf(id), color, size, 'side')
      avatar.face(flip ? -1 : 1)
      avatar.image.setOrigin(0.5, 1).setPosition(x, feetY).setDepth(5)
      // The drawn revolver sticks out in front at belly height (hidden while holstered).
      const dir = flip ? -1 : 1
      const gun = this.add
        .image(x + dir * size * 0.38, feetY - size * 0.36, gunKey)
        .setOrigin(flip ? 1 : 0, 0.5)
        .setScale(cell)
        .setFlipX(flip)
        .setDepth(6)
        .setVisible(false)
      const fontSize = size > 150 ? 16 : 8
      const name = this.add
        .text(
          x,
          feetY - size - 10,
          this.label(id),
          headlineStyle(fontSize, color, { stroke: '#10121c', strokeThickness: 4 }),
        )
        .setOrigin(0.5, 1)
        .setDepth(6)
      fitText(name, width * 0.4, fontSize)
      const tipX = dir * (size * 0.38 + REVOLVER[0].length * cell)
      return { avatar, gun, name, tipX, tipY: -size * 0.36 - cell * 2 }
    }
    const opponent = me.opponentId
    if (opponent === null) {
      this.me = make(this.selfId, width / 2, false)
      return
    }
    this.me = make(this.selfId, width * 0.22, false)
    this.opp = make(opponent, width * 0.78, true)
    this.add
      .text(
        width / 2,
        feetY - size * 0.55,
        this.t('game.quickDraw.vs'),
        headlineStyle(size > 150 ? 32 : 16, PALETTE.amber, {
          stroke: '#10121c',
          strokeThickness: 5,
        }),
      )
      .setOrigin(0.5)
      .setDepth(6)
  }

  private draw(): void {
    const me = this.snap?.players[this.selfId]
    if (!me || me.done || me.youDrew || me.opponentId === null) return
    this.sfx.click()
    this.sendInput({ kind: 'draw' })
    // The signal has already fired, so this draw is valid: pull the gun now instead of a round trip
    // later (the round can end on this very draw, before its outcome is ever rendered).
    if (me.fired && this.me && !this.firedLocally) {
      this.firedLocally = true
      this.fireGun(this.me)
    }
  }

  private drawSky(bands: readonly number[]): void {
    const key = bands.join(',')
    if (key === this.skyKey || !this.sky) return
    this.skyKey = key
    const bandH = this.horizon / bands.length
    this.sky.clear()
    bands.forEach((c, i) => {
      this.sky
        ?.fillStyle(c, 1)
        .fillRect(0, Math.floor(i * bandH), this.scale.width, Math.ceil(bandH) + 1)
    })
  }

  private setSign(text: string, color: number): void {
    if (!this.signText || this.signText.text === text) return
    this.signText.setText(text).setColor(hexToCss(color))
    fitText(this.signText, this.signMaxW, this.signSize)
    if (this.sign) punch(this, this.sign, 0.08, 90)
    punch(this, this.signText, 0.2, 90)
  }

  protected frame(snap: QuickDrawSnapshot | null, time: number): void {
    const me = snap?.players[this.selfId]
    if (!snap || !me) return
    if (!this.me) this.buildSlingers(me)
    this.me?.avatar.tick(time)
    this.opp?.avatar.tick(time)

    // A bye is known from a round's very first snapshot, so it always gets its celebration.
    if (me.opponentId === null) {
      this.drawSky(BLAZE)
      if (!this.outcome) this.resolve('bye', me, undefined)
      return
    }
    // First snapshot (fresh round or relayout restart): adopt the state without replaying fx.
    const fx = !this.firstSnapshot
    if (me.fired && !this.wasFired) {
      this.wasFired = true
      this.drawSky(BLAZE)
      if (!me.done && fx) {
        this.sfx.go()
        flash(this, PALETTE.text, 120)
        shake(this, 0.006, 140)
      }
    }
    const opp = snap.players[me.opponentId]
    if (me.done && !this.outcome) this.resolve(this.outcomeOf(me), me, opp, fx)
    if (this.outcome) return
    this.setSign(
      this.t(me.fired ? 'game.quickDraw.fire' : 'game.quickDraw.wait'),
      me.fired ? PALETTE.amber : PALETTE.text,
    )
    this.status?.setText(this.t(me.fired ? 'game.quickDraw.tapNow' : 'game.quickDraw.instruction'))
  }

  private outcomeOf(me: QuickDrawPlayerView): Outcome {
    if (me.won === true) return me.reactionMs !== null ? 'fastest' : 'oppJumped'
    if (me.won === false) return me.youDrew && me.reactionMs === null ? 'jumped' : 'slower'
    return 'draw'
  }

  // One-shot verdict: poses, the bang, the fall, the sign and the line that explains it.
  // Without `fx` (a relayout after the verdict) only the final poses, sign and line are applied.
  private resolve(
    outcome: Outcome,
    me: QuickDrawPlayerView,
    opp: QuickDrawPlayerView | undefined,
    fx = true,
  ): void {
    this.outcome = outcome
    this.drawSky(BLAZE)
    const oppName = me.opponentId ? this.state.nameOf(me.opponentId) : ''
    const win = outcome === 'fastest' || outcome === 'oppJumped' || outcome === 'bye'
    const lose = outcome === 'jumped' || outcome === 'slower'
    this.setSign(
      this.t(win ? 'game.common.youWin' : lose ? 'game.common.youLose' : 'game.common.draw'),
      win ? PALETTE.lime : lose ? PALETTE.red : PALETTE.amber,
    )
    const line: Record<Outcome, string> = {
      fastest: this.t('game.quickDraw.yourTime', { ms: me.reactionMs ?? 0 }),
      oppJumped: this.t('game.quickDraw.oppJumped', { name: oppName }),
      jumped: this.t('game.quickDraw.tooEarly'),
      slower: this.t('game.quickDraw.slower', { name: oppName, ms: opp?.reactionMs ?? 0 }),
      draw: this.t('game.quickDraw.noDraw'),
      bye: this.t('game.quickDraw.bye'),
    }
    // The loser also hears from the undertaker.
    const epitaph = lose ? `\n${this.quip('game.quickDraw.undertaker', this.selfId)}` : ''
    this.status?.setText(`${line[outcome]}${epitaph}`)

    if (outcome === 'fastest' && this.me) this.shoot(this.me, this.opp, fx)
    if (outcome === 'slower' && this.opp) this.shoot(this.opp, this.me, fx)
    if (outcome === 'jumped' && this.me) this.misfire(this.me, fx)
    if (outcome === 'oppJumped' && this.opp) this.misfire(this.opp, fx)
    if (!fx) return
    if (win) {
      this.sfx.correct()
      const sprite = this.me?.avatar.image
      if (sprite) {
        burst(
          this,
          sprite.x,
          sprite.y - sprite.displayHeight,
          this.state.colorOf(this.selfId, PALETTE.cyan),
          24,
          260,
        )
      }
    } else if (lose) {
      this.sfx.wrong()
      shake(this, 0.012, 240)
    } else {
      this.sfx.tick()
    }
  }

  // `shooter` draws and fires; `target` reels back and drops.
  private shoot(shooter: Slinger, target: Slinger | undefined, fx: boolean): void {
    if (!fx) shooter.gun.setVisible(true)
    else if (shooter !== this.me || !this.firedLocally) this.fireGun(shooter)
    shooter.avatar.setExpression('happy')
    if (!target) return
    target.avatar.setExpression('ko')
    target.gun.setVisible(false)
    const img = target.avatar.image
    const away = img.flipX ? 1 : -1
    const fallen = {
      angle: -away * 80,
      x: img.x - away * img.displayWidth * 0.2,
      alpha: 0.7,
    }
    if (!fx) {
      img.setAngle(fallen.angle).setX(fallen.x).setAlpha(fallen.alpha)
      return
    }
    this.tweens.add({
      targets: img,
      ...fallen,
      duration: 380,
      delay: 80,
      ease: 'Quad.easeIn',
    })
  }

  private fireGun(shooter: Slinger): void {
    shooter.gun.setVisible(true)
    punch(this, shooter.gun, 0.15, 60)
    const x = shooter.avatar.image.x + shooter.tipX
    const y = shooter.avatar.image.y + shooter.tipY
    burst(this, x, y, PALETTE.amber, 16, 240)
    burst(this, x, y, PALETTE.text, 6, 120)
    flash(this, PALETTE.amber, 90)
    floatText(this, x, y - 20, this.t('game.quickDraw.bang'), PALETTE.amber, 24)
  }

  // Jumped the gun: the gun comes out before the signal, the duelist goes grey.
  private misfire(who: Slinger, fx: boolean): void {
    const img = who.avatar.image
    who.gun.setVisible(true).setTint(0x8a8a9a)
    who.avatar.setExpression('hurt')
    img.setTint(0x8a8a9a)
    if (!fx) return
    floatText(
      this,
      img.x,
      img.y - img.displayHeight - 30,
      this.t('game.quickDraw.early'),
      PALETTE.red,
      18,
    )
    punch(this, img, 0.08, 90)
  }
}
