import { BRAWL, type BrawlAction, type BrawlFighter, type BrawlSnapshot, PALETTE } from '@pp/shared'
import Phaser from 'phaser'
import { type AvatarExpression, AvatarSprite, avatarPx } from '../avatars'
import { addBanner, burst, eliminate, flash, floatText, shake, showBanner } from '../fx'
import { ensureBevelPanel, ensurePixelGrid, fitFontSize, headlineStyle, shade } from '../pixelStyle'
import { YouMarker } from '../playerMarks'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Street Brawl: a side-view street at night — shop fronts behind, the pavement as the back edge of the
// fight, the road in front. Every fighter is their lobby avatar (turned to face their way, a shadow at
// their feet, a little HP bar overhead), drawn back-to-front by depth. Fists, feet and grabs reach out
// in the fighter's color; pipes and bottles show in hand; items lie on the road. Hits pop "POW!".
// Arrows/WASD move; SPACE/J punch, K kick, L grab — or the d-pad and the three buttons.

const ITEM_ROWS: Record<string, { rows: string[]; legend: Record<string, number> }> = {
  pipe: {
    rows: ['________', 'GG______', '_GGG____', '___GGG__', '_____GGG', '______GG'],
    legend: { G: 0x9aa3b8 },
  },
  bottle: {
    rows: ['__WW__', '__GG__', '_GGGG_', '_GLGG_', '_GLGG_', '_GGGG_'],
    legend: { G: 0x2f9e5a, L: 0x8ef0b0, W: 0xd8dce8 },
  },
  chicken: {
    rows: ['__BBBB__', '_BBBBBB_', 'BBbBBBBB', 'BBBBBBBB', '_BBBBBW_', '______WW'],
    legend: { B: 0xc8772f, b: 0xf2b36b, W: 0xf4f1e8 },
  },
}

// The fighter's face per action (the rest keep the idle face, blinking).
const FACES: Partial<Record<BrawlAction, AvatarExpression>> = {
  hurt: 'hurt',
  down: 'hurt',
  ko: 'ko',
}

interface View {
  avatar: AvatarSprite
  shadow: Phaser.GameObjects.Ellipse
  hp: Phaser.GameObjects.Graphics
  x: number
  y: number
}

export class BrawlScene extends MiniGameScene<BrawlSnapshot> {
  private compact = false
  private street = { x: 0, top: 0, sx: 1, sy: 1 }
  private fighterPx = 0
  private views = new Map<string, View>()
  private limbs?: Phaser.GameObjects.Graphics
  private itemImgs = new Map<number, Phaser.GameObjects.Image>()
  private itemKeys: Record<string, string> = {}
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private marker?: YouMarker
  private keysHeld = { up: false, down: false, left: false, right: false }
  private pad = new Map<number, [number, number]>()
  private sent = ''
  private sentAt = 0
  private lastTick = -1
  private snapAt = 0
  private prev?: BrawlSnapshot

  constructor(...deps: SceneDeps) {
    super('brawl', ...deps)
  }

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.views = new Map()
    this.itemImgs = new Map()
    this.keysHeld = { up: false, down: false, left: false, right: false }
    this.pad = new Map()
    this.sent = ''
    this.sentAt = 0
    this.lastTick = -1
    this.snapAt = 0
    this.prev = undefined

    const stripSize = this.compact ? 11 : 13
    this.strip = new PlayerStrip(this, width / 2, this.top + 8, width - 24, stripSize, 2)
    const areaTop = this.top + 8 + PlayerStrip.rowH(stripSize) * 2

    // Controls: d-pad left, PUNCH / KICK / GRAB right.
    const b = this.compact ? 46 : 40
    const padY = height - 12 - b * 1.5
    const padX = 16 + b * 1.5
    const up = ensureBevelPanel(this, b, b, PALETTE.frameLit, 4, true)
    for (const [dx, dy, label] of [
      [0, -1, '▲'],
      [0, 1, '▼'],
      [-1, 0, '◀'],
      [1, 0, '▶'],
    ] as const) {
      const img = this.add
        .image(padX + dx * b, padY + dy * b, up)
        .setDepth(700)
        .setInteractive()
      this.add
        .text(img.x, img.y, label, headlineStyle(16, PALETTE.text))
        .setOrigin(0.5)
        .setDepth(701)
      img.on('pointerdown', (p: Phaser.Input.Pointer) => this.pad.set(p.id, [dx, dy]))
    }
    const actions = [
      ['punch', PALETTE.orange],
      ['kick', PALETTE.magenta],
      ['grab', PALETTE.cyan],
    ] as const
    const actW = Math.min(150, (width - padX - b * 1.5 - 40) / 3 - 8)
    actions.forEach(([kind, color], i) => {
      const x = width - 16 - actW / 2 - (2 - i) * (actW + 8)
      const key = ensureBevelPanel(this, actW, b * 2, color, 5, true)
      const img = this.add.image(x, padY, key).setDepth(700).setInteractive()
      const label = this.t(`game.brawl.${kind}`)
      this.add
        .text(
          x,
          padY,
          label,
          headlineStyle(fitFontSize(label, actW - 10, this.compact ? 12 : 16), PALETTE.text, {
            stroke: '#10121c',
            strokeThickness: 4,
          }),
        )
        .setOrigin(0.5)
        .setDepth(701)
      img.on('pointerdown', () => this.attack(kind))
    })
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.pad.delete(p.id))
    const kb = this.input.keyboard
    const hold = (names: string[], k: 'up' | 'down' | 'left' | 'right'): void => {
      for (const n of names) {
        kb?.on(`keydown-${n}`, () => {
          this.keysHeld[k] = true
        })
        kb?.on(`keyup-${n}`, () => {
          this.keysHeld[k] = false
        })
      }
    }
    hold(['UP', 'W'], 'up')
    hold(['DOWN', 'S'], 'down')
    hold(['LEFT', 'A'], 'left')
    hold(['RIGHT', 'D'], 'right')
    for (const k of ['SPACE', 'J', 'Z']) this.onKey(k, () => this.attack('punch'))
    for (const k of ['K', 'X']) this.onKey(k, () => this.attack('kick'))
    for (const k of ['L', 'C']) this.onKey(k, () => this.attack('grab'))
    const release = (): void => {
      this.keysHeld = { up: false, down: false, left: false, right: false }
      this.pad.clear()
    }
    this.game.events.on(Phaser.Core.Events.BLUR, release)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.game.events.off(Phaser.Core.Events.BLUR, release),
    )

    // The street: shop fronts, then the fighting band (pavement edge → road).
    const areaBottom = padY - b * 1.5 - 12
    this.fighterPx = avatarPx(
      Math.max(32, Math.min(this.compact ? 32 : 64, Math.round(((width - 24) / BRAWL.w) * 0.12))),
    )
    // Fighters at either end of the street stay fully on screen.
    const sx = (width - 24 - this.fighterPx) / BRAWL.w
    // The depth band is a pseudo-3D strip, not to scale: on a tall screen it takes more of the height.
    const avail = areaBottom - areaTop
    const bandH = Math.min(avail * 0.62, Math.max(BRAWL.depth * sx * 0.9, avail * 0.35))
    const bandTop = areaBottom - bandH - this.fighterPx * 0.2
    this.street = { x: 12 + this.fighterPx / 2, top: bandTop, sx, sy: bandH / BRAWL.depth }
    this.paintStreet(areaTop, bandTop, areaBottom, width)
    this.limbs = this.add.graphics().setDepth(400)
    for (const [k, icon] of Object.entries(ITEM_ROWS)) {
      this.itemKeys[k] = ensurePixelGrid(this, {
        key: `brawl-item-${k}`,
        rows: icon.rows,
        legend: icon.legend,
        pixelSize: this.compact ? 2 : 3,
      })
    }
    this.marker = new YouMarker(this, this.compact ? 8 : 12, 450)
    this.banner = addBanner(this)
  }

  private paintStreet(top: number, bandTop: number, bottom: number, width: number): void {
    const g = this.add.graphics().setDepth(2)
    // Shop fronts with lit windows.
    const shops = 8
    const shopW = (width - 24) / shops
    for (let i = 0; i < shops; i++) {
      const x = 12 + i * shopW
      const h = (bandTop - top) * (0.75 + ((i * 37) % 11) / 44)
      g.fillStyle([0x2a2140, 0x23304a, 0x332238, 0x26283f][i % 4] ?? 0x2a2140, 1)
      g.fillRect(Math.round(x), Math.round(bandTop - h), Math.ceil(shopW), Math.ceil(h))
      for (let w = 0; w < 4; w++) {
        if ((i + w) % 3 === 0) continue
        g.fillStyle(PALETTE.amber, 0.55)
        g.fillRect(
          Math.round(x + 8 + (w % 2) * (shopW / 2)),
          Math.round(bandTop - h + 10 + Math.floor(w / 2) * 22),
          Math.round(shopW / 2 - 16),
          12,
        )
      }
    }
    // Pavement (the back edge of the fight) and the road.
    g.fillStyle(0x4b4f63, 1)
    g.fillRect(12, bandTop - 8, width - 24, 10)
    g.fillStyle(0x2b2e3c, 1)
    g.fillRect(12, bandTop + 2, width - 24, bottom - bandTop - 2)
    g.fillStyle(PALETTE.amber, 0.5)
    for (let x = 12; x < width - 24; x += 48)
      g.fillRect(x, Math.round((bandTop + bottom) / 2), 24, 3)
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.street.x + x * this.street.sx, y: this.street.top + y * this.street.sy }
  }

  private attack(kind: 'punch' | 'kick' | 'grab'): void {
    const me = this.snap?.fighters.find((f) => f.id === this.selfId)
    if (!me || me.action === 'ko' || this.state.final) return
    this.sendInput({ kind })
  }

  private dir(): { dx: number; dy: number } {
    const pad = [...this.pad.values()].at(-1)
    const k = this.keysHeld
    const dx = (k.right ? 1 : 0) - (k.left ? 1 : 0) || (pad?.[0] ?? 0)
    const dy = (k.down ? 1 : 0) - (k.up ? 1 : 0) || (pad?.[1] ?? 0)
    return { dx, dy }
  }

  protected frame(snap: BrawlSnapshot | null, time: number): void {
    const d = this.dir()
    const key = `${d.dx},${d.dy}`
    if ((key !== this.sent || time - this.sentAt > 300) && this.snap && !this.state.final) {
      this.sent = key
      this.sentAt = time
      this.sendInput({ kind: 'move', dx: d.dx, dy: d.dy })
    }
    if (!snap) return
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.snapAt = time
      this.onSnapshot(snap)
    }
    this.paintItems(snap)
    this.paintFighters(snap, time)
  }

  private paintItems(snap: BrawlSnapshot): void {
    const seen = new Set<number>()
    for (const [id, x, y, kind] of snap.items) {
      seen.add(id)
      let img = this.itemImgs.get(id)
      if (!img) {
        img = this.add.image(0, 0, this.itemKeys[kind] ?? '')
        this.itemImgs.set(id, img)
      }
      const p = this.toScreen(x, y)
      img.setPosition(Math.round(p.x), Math.round(p.y)).setDepth(100 + y * 500)
    }
    for (const [id, img] of this.itemImgs) {
      if (seen.has(id)) continue
      img.destroy()
      this.itemImgs.delete(id)
    }
  }

  private paintFighters(snap: BrawlSnapshot, time: number): void {
    const since = (time - this.snapAt) / 1000
    const g = this.limbs as Phaser.GameObjects.Graphics
    g.clear()
    const px = this.fighterPx
    for (const f of snap.fighters) {
      let view = this.views.get(f.id)
      if (!view) {
        // Side view: a street brawler faces left or right.
        const avatar = new AvatarSprite(
          this,
          this.state.avatarOf(f.id),
          this.state.colorOf(f.id),
          px,
          'side',
        )
        avatar.image.setOrigin(0.5, 1)
        const shadow = this.add.ellipse(0, 0, px * 0.9, px * 0.25, 0x000000, 0.35)
        const hp = this.add.graphics()
        view = { avatar, shadow, hp, x: f.x, y: f.y }
        this.views.set(f.id, view)
      }
      // Ease toward the snapshot, dead-reckoning a walk.
      const walking = f.action === 'walk'
      const tx = walking ? f.x + f.dx * BRAWL.speedX * Math.min(0.2, since) : f.x
      const ty = walking ? f.y + f.dy * BRAWL.speedY * Math.min(0.2, since) : f.y
      view.x += (tx - view.x) * 0.35
      view.y += (ty - view.y) * 0.35
      const p = this.toScreen(view.x, view.y)
      const depth = 100 + view.y * 500
      const ms = f.action === 'walk' || f.action === 'idle' ? 0 : f.actionMs + since * 1000
      const bob = f.action === 'walk' ? Math.abs(Math.sin(time / 90)) * -3 : 0
      const lying = f.action === 'down' || f.action === 'ko'
      view.shadow.setPosition(p.x, p.y).setDepth(depth - 1)
      view.avatar
        .face(f.face)
        .setExpression(FACES[f.action] ?? 'idle')
        .tick(time)
      view.avatar.image
        .setPosition(
          Math.round(p.x - (f.action === 'hurt' ? f.face * 4 : 0)),
          Math.round(p.y + bob + (lying ? -px * 0.1 : 0)),
        )
        .setDepth(depth)
        .setAngle(lying ? f.face * -90 : f.action === 'hurt' ? f.face * -8 : 0)
        .setAlpha(f.action === 'ko' ? 0.35 : f.guard ? (Math.floor(time / 90) % 2 ? 0.45 : 1) : 1)
      // A white flash on the frame a hit lands.
      if (f.action === 'hurt' && ms < 120) view.avatar.image.setTintFill(0xffffff)
      else view.avatar.image.clearTint()
      // Limbs and weapons, in the fighter's color.
      const color = this.state.colorOf(f.id)
      const hand = { x: p.x + f.face * px * 0.35, y: p.y - px * 0.45 }
      if (f.action === 'punch' || f.action === 'grab') {
        const reach =
          (f.action === 'grab' ? 0.55 : 0.75) * px * Math.sin(Math.min(1, ms / 160) * Math.PI)
        g.fillStyle(shade(color, -0.3), 1)
        g.fillRect(
          Math.round(Math.min(hand.x, hand.x + f.face * reach)),
          Math.round(hand.y - 3),
          Math.round(Math.abs(reach)),
          6,
        )
        g.fillStyle(color, 1)
        g.fillRect(Math.round(hand.x + f.face * reach - 5), Math.round(hand.y - 6), 10, 12)
      } else if (f.action === 'kick') {
        const reach = px * 0.9 * Math.sin(Math.min(1, ms / 260) * Math.PI)
        g.fillStyle(color, 1)
        g.fillRect(
          Math.round(Math.min(p.x, p.x + f.face * reach)),
          Math.round(p.y - px * 0.22),
          Math.round(Math.abs(reach)) + 6,
          8,
        )
      }
      if (f.weapon && !lying) {
        const w = f.weapon === 'pipe' ? px * 0.7 : px * 0.35
        g.fillStyle(f.weapon === 'pipe' ? 0x9aa3b8 : 0x2f9e5a, 1)
        g.fillRect(
          Math.round(hand.x - (f.face === -1 ? w : 0)),
          Math.round(hand.y - px * 0.25),
          Math.round(w),
          5,
        )
      }
      // HP bar overhead.
      view.hp.clear().setDepth(depth + 1)
      if (f.action !== 'ko') {
        const bw = px * 0.9
        const bx = p.x - bw / 2
        const by = p.y - px - 10
        view.hp.fillStyle(PALETTE.panelAlt, 1).fillRect(bx, by, bw, 4)
        view.hp
          .fillStyle(f.hp > 50 ? PALETTE.lime : f.hp > 25 ? PALETTE.amber : PALETTE.red, 1)
          .fillRect(bx, by, (bw * f.hp) / BRAWL.hp, 4)
      }
      if (f.id === this.selfId) {
        if (f.action === 'ko') this.marker?.hide()
        else this.marker?.place(p.x, p.y - px - 12 + bob, time)
      }
    }
  }

  // Snapshot deltas: hits (POW!), knock-downs, KOs, pick-ups.
  private onSnapshot(snap: BrawlSnapshot): void {
    const prev = this.prev
    this.prev = snap
    const me = snap.fighters.find((f) => f.id === this.selfId)
    const up = snap.fighters.filter((f) => f.action !== 'ko').length
    if (me) this.hud?.setScore(this.t('game.brawl.kos', { n: me.kos }))
    this.hud?.setCenter(
      this.t('game.common.left', { n: up, total: snap.fighters.length }),
      up <= 1 ? PALETTE.red : PALETTE.text,
    )
    this.strip?.set(
      snap.fighters.map((f) => ({
        text: `${this.label(f.id)} ${f.action === 'ko' ? '✗' : `${f.hp}`}`,
        avatar: this.state.avatarOf(f.id),
        color: this.state.colorOf(f.id),
        dim: f.action === 'ko',
      })),
    )
    if (prev && !this.firstSnapshot) {
      const before = new Map(prev.fighters.map((f) => [f.id, f]))
      for (const f of snap.fighters) {
        const was = before.get(f.id)
        if (!was) continue
        const p = this.toScreen(f.x, f.y)
        const head = p.y - this.fighterPx * 0.7
        if (f.hp < was.hp) {
          burst(this, p.x, head, PALETTE.amber, 10, 180)
          floatText(
            this,
            p.x,
            head - 8,
            this.t(f.action === 'down' || f.action === 'ko' ? 'game.brawl.wham' : 'game.brawl.pow'),
            PALETTE.amber,
            this.compact ? 12 : 16,
          )
          if (f.id === this.selfId) {
            this.sfx.wrong()
            flash(this, PALETTE.red, 160, 0.22)
          } else this.sfx.pop()
          if (f.action === 'down') shake(this, 0.006, 140)
        }
        if (f.hp > was.hp) {
          floatText(this, p.x, head - 8, `+${f.hp - was.hp}`, PALETTE.lime, 12)
          if (f.id === this.selfId) this.sfx.coin()
        }
        if (was.action !== 'ko' && f.action === 'ko') {
          eliminate(
            this,
            p.x,
            head,
            this.state.colorOf(f.id),
            this.t('game.brawl.ko'),
            this.compact ? 12 : 16,
          )
          this.sfx.eliminated()
        }
        if (f.id === this.selfId && f.weapon && f.weapon !== was.weapon) this.sfx.coin()
      }
    }
    if (this.state.final && me && this.banner && !this.banner.visible) {
      const won = me.action !== 'ko' && up === 1 && snap.fighters.length > 1
      showBanner(
        this,
        this.banner,
        won
          ? this.t('game.common.youWin')
          : me.action === 'ko'
            ? this.t('game.brawl.ko')
            : this.t('game.brawl.standing'),
        won || me.action !== 'ko' ? PALETTE.lime : PALETTE.red,
      )
    }
  }
}
