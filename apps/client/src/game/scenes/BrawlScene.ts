import {
  BRAWL,
  type BrawlAction,
  type BrawlFighter,
  type BrawlItemKind,
  type BrawlSnapshot,
  type BrawlWeapon,
  PALETTE,
} from '@pp/shared'
import Phaser from 'phaser'
import { type AvatarExpression, AvatarSprite, avatarPx } from '../avatars'
import { addBanner, burst, eliminate, flash, floatText, punch, shake, showBanner } from '../fx'
import {
  ensureBevelPanel,
  ensurePixelGrid,
  fitFontSize,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { YouMarker } from '../playerMarks'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Street Brawl: a side-view street at night — shop fronts behind, the pavement as the back edge of the
// fight, the road in front. Every fighter is their lobby avatar (turned to face their way, a shadow at
// their feet, a little HP bar overhead), drawn back-to-front by depth. Fists, feet and grabs reach out
// in the fighter's color; items lie on the road. A picked-up pipe, bat or bottle is held up in the hand
// and PUNCH swings it (the PUNCH button turns into it, "BAT ×4"); a fuel can is hugged to the chest and
// PUNCH throws it — it spins down the street and goes up in a fireball. Hits pop "POW!" (or the weapon's
// "CLANG!" / "HOME RUN!" / "SMASH!"). The HUD counts your KO credit (half for the finisher, half shared
// by damage — "1.5 KO").
// Your own fighter is predicted: it walks and turns the moment you press and swings the moment you
// attack (with the server's timings, so a refused press never swings), easing onto the server's view.
// Arrows/WASD move; SPACE/J/Z punch, K/X kick, L/C grab — or the d-pad and the three buttons.

const ITEM_ROWS: Record<BrawlItemKind, { rows: string[]; legend: Record<string, number> }> = {
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
  bat: {
    rows: ['_____WWW', '____WWWW', '___WWWW_', '__WWW___', '_HH_____', 'HH______'],
    legend: { W: 0xc89a5a, H: 0x5a3a20 },
  },
  // A red jerrycan: handle and spout on top, the embossed X on its side.
  fuel: {
    rows: ['_HHH__S', '_H_H_SS', 'RRRRRRR', 'RXRRRXR', 'RRXRXRR', 'RRRXRRR', 'RRXRXRR', 'RRRRRRR'],
    legend: { H: 0x3a3a48, S: 0x9aa3b8, R: 0xd8342c, X: 0xffcf4b },
  },
}

// Weapons as they're held: drawn along +x from the grip (`grip` = its spot across the sprite, where the
// hand closes), then turned by the swing. The fuel can is hugged to the chest instead (its street sprite).
type Swung = Exclude<BrawlWeapon, 'fuel'>
const HELD: Record<Swung, { rows: string[]; legend: Record<string, number>; grip: number }> = {
  pipe: {
    rows: ['GGGGGGGGGGGG', 'gggggggggggg'],
    legend: { G: 0xb8c0d4, g: 0x7d869c },
    grip: 0.08,
  },
  bat: {
    rows: ['_______WWWW_', 'HHHHWWWWWWWW', '_______WWWW_'],
    legend: { W: 0xc89a5a, H: 0x5a3a20 },
    grip: 0.12,
  },
  bottle: {
    rows: ['____GGGG', 'WWGGGLGG', '____GGGG'],
    legend: { G: 0x2f9e5a, L: 0x8ef0b0, W: 0xd8dce8 },
    grip: 0.25,
  },
}
// Held weapon angles in degrees, facing right (mirrored facing left): raised at rest, wound back as a
// swing starts and brought down past level by its end, SWING_MS in.
const HOLD_DEG = -65
const WIND_DEG = -125
const STRIKE_DEG = 30
const SWING_MS = 150
// A pipe or bat swung for the last time stays in the hand this long after the hit (to finish the swing).
const SPENT_MS = 200
// The word a weapon's hit pops instead of "POW!".
const HIT_WORD: Record<Swung, string> = {
  pipe: 'game.brawl.hitPipe',
  bat: 'game.brawl.hitBat',
  bottle: 'game.brawl.hitBottle',
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
  // The weapon in hand (hidden when empty-handed).
  weapon: Phaser.GameObjects.Image
  // A pipe or bat whose last swing just landed, kept in hand until the swing is over.
  spent?: { kind: Swung; until: number }
  x: number
  y: number
  // The HP bar as last drawn (redrawn only when it changes).
  hpKey: string
}

type Move = keyof typeof BRAWL.moves
// Time constant of the ease from your predicted fighter onto the server's position.
const CORRECT_TAU_MS = 200
// How far each attack reaches (mirrors the server's rules). Only used to pick your own swing's sound
// the moment you press: a smack when someone stands in range, a rush of air when it whiffs.
const REACH = { punch: 0.095, kick: 0.125, pipe: 0.135, bat: 0.15 } as const
// Your landed hit already sounded on the press: the server's echo this soon after isn't replayed.
const OWN_HIT_ECHO_MS = 450
// Everyone else's hits: softer, and at most this often (a twelve-way street fight is no drum solo).
const OTHER_HIT_MS = 140
// Rivals' moments (their hits, a KO you didn't land) play at this fraction of the volume.
const RIVAL_LEVEL = 0.5

export class BrawlScene extends MiniGameScene<BrawlSnapshot> {
  private compact = false
  private street = { x: 0, top: 0, sx: 1, sy: 1 }
  private fighterPx = 0
  private views = new Map<string, View>()
  private limbs?: Phaser.GameObjects.Graphics
  private itemImgs = new Map<number, Phaser.GameObjects.Image>()
  private itemKeys: Partial<Record<BrawlItemKind, string>> = {}
  private heldKeys: Partial<Record<Swung, string>> = {}
  // Fuel cans in flight, and the explosions already shown.
  private canImgs = new Map<number, Phaser.GameObjects.Image>()
  private seenBlasts = new Set<number>()
  // The PUNCH button's label turns into the weapon you carry ("BAT ×4", "THROW!").
  private punchBtn?: { img: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; w: number }
  private punchKey = ''
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private marker?: YouMarker
  private keysHeld = { up: false, down: false, left: false, right: false }
  private pad = new Map<number, [number, number]>()
  // Moves go out only once the player has pressed something (an untouched fighter sends nothing).
  private touched = false
  private sent = ''
  private sentAt = 0
  private lastTick = -1
  private snapAt = 0
  private lastFrameAt = 0
  private warmed = false
  private prev?: BrawlSnapshot
  // Your fighter, predicted (world units), and the attack you just threw (shown before the server's
  // echo), plus when the next one may go.
  private pred?: { x: number; y: number }
  private swing?: { kind: Move; at: number; face: 1 | -1; weapon: BrawlWeapon | null }
  private nextAttackAt = 0
  private face: 1 | -1 = 1
  private ownHitAt = Number.NEGATIVE_INFINITY
  private otherHitAt = Number.NEGATIVE_INFINITY
  constructor(...deps: SceneDeps) {
    super('brawl', ...deps)
  }

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.views = new Map()
    this.itemImgs = new Map()
    this.canImgs = new Map()
    this.seenBlasts = new Set()
    this.punchBtn = undefined
    this.punchKey = ''
    this.keysHeld = { up: false, down: false, left: false, right: false }
    this.pad = new Map()
    this.touched = false
    this.sent = ''
    this.sentAt = 0
    this.lastTick = -1
    this.snapAt = 0
    this.lastFrameAt = 0
    this.warmed = false
    this.prev = undefined
    this.pred = undefined
    this.swing = undefined
    this.nextAttackAt = 0
    this.face = 1
    this.ownHitAt = Number.NEGATIVE_INFINITY
    this.otherHitAt = Number.NEGATIVE_INFINITY

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
      img.on('pointerdown', (p: Phaser.Input.Pointer) => {
        this.pad.set(p.id, [dx, dy])
        this.touched = true
      })
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
      const text = this.add
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
      if (kind === 'punch') this.punchBtn = { img, label: text, w: actW }
    })
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.pad.delete(p.id))
    const kb = this.input.keyboard
    const hold = (names: string[], k: 'up' | 'down' | 'left' | 'right'): void => {
      for (const n of names) {
        kb?.on(`keydown-${n}`, () => {
          this.keysHeld[k] = true
          this.touched = true
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
    for (const k of ['SPACE', 'ENTER', 'J', 'Z']) this.onKey(k, () => this.attack('punch'))
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

    // The keys, named once above the controls (phones get the d-pad and the buttons alone).
    let areaBottom = padY - b * 1.5 - 12
    if (!this.compact) {
      const hint = this.t('game.brawl.hint')
      const hintText = this.add
        .text(
          width / 2,
          areaBottom,
          hint,
          headlineStyle(fitFontSize(hint, width - 32, 16), PALETTE.dim),
        )
        .setOrigin(0.5, 1)
        .setDepth(600)
      areaBottom = hintText.y - hintText.height - 8
    }

    // The street: shop fronts, then the fighting band (pavement edge → road).
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
    for (const k of Object.keys(ITEM_ROWS) as BrawlItemKind[]) {
      const icon = ITEM_ROWS[k]
      this.itemKeys[k] = ensurePixelGrid(this, {
        key: `brawl-item-${k}`,
        rows: icon.rows,
        legend: icon.legend,
        pixelSize: this.compact ? 2 : 3,
      })
    }
    // Held weapons at the avatar's own pixel scale.
    const ps = Math.max(1, Math.round(this.fighterPx / 16))
    for (const k of Object.keys(HELD) as Swung[]) {
      const held = HELD[k]
      this.heldKeys[k] = ensurePixelGrid(this, {
        key: `brawl-held-${k}-${ps}`,
        rows: held.rows,
        legend: held.legend,
        pixelSize: ps,
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

  // An attack goes out (and swings on your screen) only when the server will take it: not mid-move,
  // not during the cooldown, not while staggered or floored.
  private attack(kind: Move): void {
    const me = this.snap?.fighters.find((f) => f.id === this.selfId)
    if (!me || me.action === 'ko' || this.state.final) return
    const now = this.time.now
    if (now < this.nextAttackAt || this.serverBusy(me, now)) return
    this.sendInput({ kind })
    this.swing = { kind, at: now, face: this.face, weapon: kind === 'punch' ? me.weapon : null }
    this.nextAttackAt = now + BRAWL.moves[kind].cooldownMs
    this.swingSfx(kind, me, now)
  }

  // Your attack's sound, on the press: a grab's throw (or a grab at thin air) is a rush of air; a punch
  // or kick smacks — harder for a kick or a weapon — when someone hittable stands in its reach (as far
  // as this screen knows), and whiffs otherwise.
  private swingSfx(kind: Move, me: BrawlFighter, now: number): void {
    // A grab, or a fuel can leaving your hands (its blast sounds when it goes up).
    if (kind === 'grab' || (kind === 'punch' && me.weapon === 'fuel')) {
      this.sfx.whoosh()
      return
    }
    const at = this.pred ?? me
    const face = this.face
    const reach =
      kind === 'kick'
        ? REACH.kick
        : me.weapon === 'pipe'
          ? REACH.pipe
          : me.weapon === 'bat'
            ? REACH.bat
            : REACH.punch
    const lands = this.snap?.fighters.some((o) => {
      if (o.id === me.id || o.action === 'ko' || o.action === 'down' || o.guard) return false
      const ahead = (o.x - at.x) * face
      return ahead > 0 && ahead <= reach && Math.abs(o.y - at.y) <= BRAWL.laneTolerance
    })
    if (!lands) {
      this.sfx.whoosh()
      return
    }
    this.ownHitAt = now
    const weapon = kind === 'punch' ? me.weapon : null
    this.sfx.hit(
      kind === 'kick'
        ? 1.2
        : weapon === 'bottle' || weapon === 'bat'
          ? 1.5
          : weapon === 'pipe'
            ? 1.3
            : 0.9,
    )
    if (weapon === 'bottle') this.sfx.shatter()
  }

  // Still staggered, floored or mid-attack on the server (as of the last snapshot, run on to now).
  private serverBusy(f: BrawlFighter, now: number): boolean {
    const ms = f.actionMs + (now - this.snapAt)
    if (f.action === 'hurt') return ms < BRAWL.hurtMs
    if (f.action === 'down') return ms < BRAWL.downMs
    if (f.action === 'punch' || f.action === 'kick' || f.action === 'grab')
      return ms < BRAWL.moves[f.action].ms
    return false
  }

  // Your fighter: walks on the held keys at the server's speed (not while busy), turning at once, and
  // eases onto the server's position (dead-reckoned) so knock-backs and throws still land.
  private predict(me: BrawlFighter, time: number, dt: number): void {
    const since = Math.min(0.2, (time - this.snapAt) / 1000)
    const tx = me.action === 'walk' ? me.x + me.dx * BRAWL.speedX * since : me.x
    const ty = me.action === 'walk' ? me.y + me.dy * BRAWL.speedY * since : me.y
    if (!this.pred || me.action === 'ko') {
      this.pred = { x: tx, y: ty }
      this.face = me.face
      return
    }
    const p = this.pred
    const swinging = this.swing && time - this.swing.at < BRAWL.moves[this.swing.kind].ms
    const d = this.dir()
    if (!swinging && !this.serverBusy(me, time) && (d.dx !== 0 || d.dy !== 0)) {
      const mag = Math.hypot(d.dx, d.dy)
      p.x = Math.max(
        BRAWL.bodyR,
        Math.min(BRAWL.w - BRAWL.bodyR, p.x + (d.dx / mag) * BRAWL.speedX * (dt / 1000)),
      )
      p.y = Math.max(0, Math.min(BRAWL.depth, p.y + (d.dy / mag) * BRAWL.speedY * (dt / 1000)))
      if (d.dx !== 0) this.face = d.dx > 0 ? 1 : -1
    } else if (!swinging && d.dx === 0) this.face = me.face
    const k = 1 - Math.exp(-dt / CORRECT_TAU_MS)
    p.x += (tx - p.x) * k
    p.y += (ty - p.y) * k
    // A throw across the street: jump there rather than glide for ages.
    if (Math.hypot(tx - p.x, ty - p.y) > 0.4) this.pred = { x: tx, y: ty }
  }

  private dir(): { dx: number; dy: number } {
    const pad = [...this.pad.values()].at(-1)
    const k = this.keysHeld
    const dx = (k.right ? 1 : 0) - (k.left ? 1 : 0) || (pad?.[0] ?? 0)
    const dy = (k.down ? 1 : 0) - (k.up ? 1 : 0) || (pad?.[1] ?? 0)
    return { dx, dy }
  }

  protected frame(snap: BrawlSnapshot | null, time: number): void {
    const dt = this.lastFrameAt ? Math.min(100, time - this.lastFrameAt) : 0
    this.lastFrameAt = time
    const d = this.dir()
    const key = `${d.dx},${d.dy}`
    const fighting = this.snap?.fighters.some((f) => f.id === this.selfId) ?? false
    if (
      this.touched &&
      fighting &&
      (key !== this.sent || time - this.sentAt > 300) &&
      !this.state.final
    ) {
      this.sent = key
      this.sentAt = time
      this.sendInput({ kind: 'move', dx: d.dx, dy: d.dy })
    }
    if (!snap) return
    if (!this.warmed) {
      this.warmed = true
      this.warmAvatars(
        snap.fighters.map((f) => f.id),
        [
          ['side', 'idle', 1],
          ['side', 'hurt', 0],
          ['side', 'ko', 0],
        ],
      )
    }
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.snapAt = time
      this.onSnapshot(snap)
    }
    const me = snap.fighters.find((f) => f.id === this.selfId)
    if (me && !this.state.final) this.predict(me, time, dt)
    this.paintItems(snap)
    this.paintCans(snap, time)
    this.paintFighters(snap, time, dt)
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

  // Thrown fuel cans: flown on from the snapshot at the shared speed, spinning at chest height.
  private paintCans(snap: BrawlSnapshot, time: number): void {
    const since = Math.min(0.2, (time - this.snapAt) / 1000)
    const seen = new Set<number>()
    for (const [id, x, y, face] of snap.cans) {
      seen.add(id)
      let img = this.canImgs.get(id)
      if (!img) {
        img = this.add.image(0, 0, this.itemKeys.fuel ?? '')
        this.canImgs.set(id, img)
      }
      const fx = Math.max(
        BRAWL.bodyR,
        Math.min(BRAWL.w - BRAWL.bodyR, x + face * BRAWL.fuel.speed * since),
      )
      const p = this.toScreen(fx, y)
      img
        .setPosition(Math.round(p.x), Math.round(p.y - this.fighterPx * 0.45))
        .setAngle((time * 0.9 * face) % 360)
        .setDepth(101 + y * 500)
    }
    for (const [id, img] of this.canImgs) {
      if (seen.has(id)) continue
      img.destroy()
      this.canImgs.delete(id)
    }
  }

  // A fuel can going up: a fireball the size of the blast, sparks and smoke, the screen shakes.
  private explosion(x: number, y: number): void {
    const p = this.toScreen(x, y)
    const cy = p.y - this.fighterPx * 0.3
    const fire = this.add
      .ellipse(
        p.x,
        p.y - this.fighterPx * 0.15,
        BRAWL.fuel.blastX * this.street.sx * 2,
        BRAWL.fuel.blastY * this.street.sy * 2 + this.fighterPx * 0.6,
        PALETTE.orange,
        0.6,
      )
      .setDepth(380)
      .setScale(0.3)
    this.tweens.add({
      targets: fire,
      scale: 1,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeOut',
      onComplete: () => fire.destroy(),
    })
    burst(this, p.x, cy, PALETTE.amber, 26, 340)
    burst(this, p.x, cy, PALETTE.red, 16, 260)
    burst(this, p.x, cy, 0x4b4f63, 10, 140)
    floatText(this, p.x, cy - 12, this.t('game.brawl.boom'), PALETTE.orange, this.compact ? 16 : 24)
    shake(this, 0.014, 260)
    flash(this, PALETTE.orange, 140, 0.18)
    this.sfx.explosion()
  }

  private paintFighters(snap: BrawlSnapshot, time: number, dt: number): void {
    const since = (time - this.snapAt) / 1000
    const g = this.limbs as Phaser.GameObjects.Graphics
    g.clear()
    const px = this.fighterPx
    const ease = 1 - Math.exp(-dt / 40)
    // A fighter who left the round walks off the street.
    for (const [id, view] of this.views) {
      if (snap.fighters.some((f) => f.id === id)) continue
      view.avatar.destroy()
      view.shadow.destroy()
      view.hp.destroy()
      view.weapon.destroy()
      this.views.delete(id)
      if (id === this.selfId) this.marker?.hide()
    }
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
        const shadow = this.add.ellipse(0, 0, px * 0.9, px * 0.25, 0x000000, 0.35).setDepth(99)
        const hp = this.add.graphics().setDepth(395)
        const weapon = this.add.image(0, 0, this.heldKeys.pipe ?? '').setVisible(false)
        view = { avatar, shadow, hp, weapon, x: f.x, y: f.y, hpKey: '' }
        this.views.set(f.id, view)
      }
      const mine = f.id === this.selfId && f.action !== 'ko' && this.pred !== undefined
      // What to draw: your own swing straight away (until it's over), else the server's action.
      const swing =
        mine && this.swing && time - this.swing.at < BRAWL.moves[this.swing.kind].ms
          ? this.swing
          : undefined
      const action: BrawlAction = swing
        ? swing.kind
        : mine && f.action === 'walk' && !this.moving()
          ? 'idle'
          : mine && (f.action === 'idle' || f.action === 'walk') && this.moving()
            ? 'walk'
            : f.action
      const face: 1 | -1 = swing ? swing.face : mine ? this.face : f.face
      if (mine && this.pred) {
        view.x = this.pred.x
        view.y = this.pred.y
      } else {
        // Ease toward the snapshot, dead-reckoning a walk.
        const walking = f.action === 'walk'
        const tx = walking ? f.x + f.dx * BRAWL.speedX * Math.min(0.2, since) : f.x
        const ty = walking ? f.y + f.dy * BRAWL.speedY * Math.min(0.2, since) : f.y
        view.x += (tx - view.x) * ease
        view.y += (ty - view.y) * ease
      }
      const p = this.toScreen(view.x, view.y)
      const depth = 100 + view.y * 500
      const ms = swing
        ? time - swing.at
        : action === 'walk' || action === 'idle'
          ? 0
          : f.actionMs + since * 1000
      const bob = action === 'walk' ? Math.abs(Math.sin(time / 90)) * -3 : 0
      const lying = action === 'down' || action === 'ko'
      // Shadows all under the fighters and the HP bars all over them (one layer each): interleaving
      // shapes with sprites per fighter would break the sprite batch a dozen times a frame.
      view.shadow.setPosition(p.x, p.y)
      view.avatar
        .face(face)
        .setExpression(FACES[action] ?? 'idle')
        .walk(action === 'walk', time)
        .tick(time)
      view.avatar.image
        .setPosition(
          Math.round(p.x - (action === 'hurt' ? face * 4 : 0)),
          Math.round(p.y + bob + (lying ? -px * 0.1 : 0)),
        )
        .setDepth(depth)
        .setAngle(lying ? face * -90 : action === 'hurt' ? face * -8 : 0)
        .setAlpha(action === 'ko' ? 0.35 : f.guard ? (Math.floor(time / 90) % 2 ? 0.45 : 1) : 1)
      // A white flash on the frame a hit lands.
      if (action === 'hurt' && ms < 120)
        view.avatar.image.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL)
      else view.avatar.image.clearTint()
      // The weapon in hand: your swing's (a can you've just thrown is gone at once), else the server's.
      const thrown =
        mine && this.swing?.weapon === 'fuel' && time - this.swing.at < 500 && f.weapon === 'fuel'
      const held: BrawlWeapon | null =
        swing?.kind === 'punch'
          ? swing.weapon
          : thrown
            ? null
            : (f.weapon ?? (view.spent && time < view.spent.until ? view.spent.kind : null))
      this.paintLimbs(g, f, action, face, ms, p, lying, held)
      this.paintWeapon(view, held, action, face, ms, p, lying)
      this.paintHp(view, f, p)
      if (f.id === this.selfId) {
        if (f.action === 'ko') this.marker?.hide()
        else this.marker?.place(p.x, p.y - px - 14 + bob, time)
      }
    }
  }

  // Your held keys move you right now (and you're not mid-swing).
  private moving(): boolean {
    const d = this.dir()
    const swinging = this.swing && this.time.now - this.swing.at < BRAWL.moves[this.swing.kind].ms
    return (d.dx !== 0 || d.dy !== 0) && !swinging
  }

  // Fists and feet, in the fighter's color (a swung weapon replaces the fist: see paintWeapon).
  private paintLimbs(
    g: Phaser.GameObjects.Graphics,
    f: BrawlFighter,
    action: BrawlAction,
    face: 1 | -1,
    ms: number,
    p: { x: number; y: number },
    lying: boolean,
    held: BrawlWeapon | null,
  ): void {
    if (lying) return
    const px = this.fighterPx
    const color = this.state.colorOf(f.id)
    const hand = { x: p.x + face * px * 0.35, y: p.y - px * 0.45 }
    const swung = action === 'punch' && held !== null && held !== 'fuel'
    if ((action === 'punch' && !swung) || action === 'grab') {
      const reach =
        (action === 'grab' ? 0.55 : 0.75) * px * Math.sin(Math.min(1, ms / 160) * Math.PI)
      g.fillStyle(shade(color, -0.3), 1)
      g.fillRect(
        Math.round(Math.min(hand.x, hand.x + face * reach)),
        Math.round(hand.y - 3),
        Math.round(Math.abs(reach)),
        6,
      )
      g.fillStyle(color, 1)
      g.fillRect(Math.round(hand.x + face * reach - 5), Math.round(hand.y - 6), 10, 12)
    } else if (action === 'kick') {
      const reach = px * 0.9 * Math.sin(Math.min(1, ms / 260) * Math.PI)
      g.fillStyle(color, 1)
      g.fillRect(
        Math.round(Math.min(p.x, p.x + face * reach)),
        Math.round(p.y - px * 0.22),
        Math.round(Math.abs(reach)) + 6,
        8,
      )
    }
  }

  // The weapon in hand: a pipe, bat or bottle raised at rest and swung down through the punch (from
  // the grip, at the hand); a fuel can hugged at the chest (gone the moment it's thrown).
  private paintWeapon(
    view: View,
    held: BrawlWeapon | null,
    action: BrawlAction,
    face: 1 | -1,
    ms: number,
    p: { x: number; y: number },
    lying: boolean,
  ): void {
    const img = view.weapon
    if (!held || lying || (held === 'fuel' && action === 'punch')) {
      img.setVisible(false)
      return
    }
    const px = this.fighterPx
    img.setVisible(true).setDepth(view.avatar.image.depth + 0.5)
    if (held === 'fuel') {
      img
        .setTexture(this.itemKeys.fuel ?? '')
        .setOrigin(0.5, 0.5)
        .setFlipX(face === -1)
        .setAngle(0)
        .setPosition(Math.round(p.x + face * px * 0.28), Math.round(p.y - px * 0.4))
      return
    }
    const spec = HELD[held]
    let deg = HOLD_DEG
    if (action === 'punch') {
      const t = Math.min(1, ms / SWING_MS)
      deg = WIND_DEG + (STRIKE_DEG - WIND_DEG) * (1 - (1 - t) ** 2)
    } else if (action === 'hurt') deg = HOLD_DEG + 25
    img
      .setTexture(this.heldKeys[held] ?? '')
      .setFlipX(face === -1)
      .setOrigin(face === 1 ? spec.grip : 1 - spec.grip, 0.5)
      .setAngle(face * deg)
      .setPosition(Math.round(p.x + face * px * 0.3), Math.round(p.y - px * 0.45))
  }

  // The PUNCH button names what it does now: PUNCH, the weapon and its swings left, or THROW!
  private updatePunchButton(me: BrawlFighter | undefined): void {
    const btn = this.punchBtn
    const weapon = me && me.action !== 'ko' ? me.weapon : null
    const key = `${weapon}:${me?.uses ?? 0}`
    if (!btn || key === this.punchKey) return
    const armed = this.punchKey !== '' && weapon !== null && !this.punchKey.startsWith(`${weapon}:`)
    this.punchKey = key
    const name = weapon ? this.t(`game.brawl.weapon.${weapon}`) : ''
    const text =
      weapon === 'fuel'
        ? this.t('game.brawl.throw')
        : weapon === 'bottle'
          ? name
          : weapon
            ? this.t('game.brawl.swing', { weapon: name, n: me?.uses ?? 0 })
            : this.t('game.brawl.punch')
    btn.label
      .setText(text)
      .setFontSize(fitFontSize(text, btn.w - 10, this.compact ? 12 : 16))
      .setColor(hexToCss(weapon ? PALETTE.amber : PALETTE.text))
    if (armed) punch(this, btn.img, 0.12, 120)
  }

  // Weapon hits landed since the last snapshot, told by what the swinger lost: a swing off a pipe or
  // bat, or the bottle that smashed. A pipe or bat swung for the last time stays in hand to the end
  // of the swing.
  private weaponHits(
    snap: BrawlSnapshot,
    before: Map<string, BrawlFighter>,
  ): { id: string; kind: Swung; x: number; y: number; face: 1 | -1 }[] {
    const hits: { id: string; kind: Swung; x: number; y: number; face: 1 | -1 }[] = []
    for (const f of snap.fighters) {
      const was = before.get(f.id)
      const kind = was?.weapon
      if (!was || !kind || kind === 'fuel' || f.action !== 'punch') continue
      if (f.weapon === kind && f.uses >= was.uses) continue
      hits.push({ id: f.id, kind, x: f.x, y: f.y, face: f.face })
      const view = this.views.get(f.id)
      if (view && kind !== 'bottle' && f.weapon === null) {
        view.spent = { kind, until: this.time.now + SPENT_MS }
      }
    }
    return hits
  }

  // HP bar overhead: drawn once per change at the origin, then just moved with the fighter.
  private paintHp(view: View, f: BrawlFighter, p: { x: number; y: number }): void {
    const px = this.fighterPx
    const bw = Math.round(px * 0.9)
    const bh = this.compact ? 4 : 6
    const key = f.action === 'ko' ? 'ko' : `${f.hp}`
    if (key !== view.hpKey) {
      view.hpKey = key
      view.hp.clear()
      if (f.action !== 'ko') {
        view.hp.fillStyle(PALETTE.bg, 1).fillRect(-bw / 2 - 1, -1, bw + 2, bh + 2)
        view.hp.fillStyle(PALETTE.panelAlt, 1).fillRect(-bw / 2, 0, bw, bh)
        view.hp
          .fillStyle(f.hp > 50 ? PALETTE.lime : f.hp > 25 ? PALETTE.amber : PALETTE.red, 1)
          .fillRect(-bw / 2, 0, Math.round((bw * f.hp) / BRAWL.hp), bh)
      }
    }
    view.hp.setPosition(Math.round(p.x), Math.round(p.y - px - 12))
  }

  // Snapshot deltas: hits (POW!), knock-downs, KOs, pick-ups.
  private onSnapshot(snap: BrawlSnapshot): void {
    const prev = this.prev
    this.prev = snap
    const me = snap.fighters.find((f) => f.id === this.selfId)
    const up = snap.fighters.filter((f) => f.action !== 'ko').length
    if (me) this.hud?.setScore(this.t('game.brawl.kos', { n: me.kos }))
    this.updatePunchButton(me)
    // Explosions: each shown once (one already on the wire when this screen starts is skipped).
    for (const [id, x, y] of snap.blasts) {
      if (this.seenBlasts.has(id)) continue
      this.seenBlasts.add(id)
      if (!this.firstSnapshot) this.explosion(x, y)
    }
    for (const id of this.seenBlasts) {
      if (!snap.blasts.some((b) => b[0] === id)) this.seenBlasts.delete(id)
    }
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
      const weaponHits = this.weaponHits(snap, before)
      for (const f of snap.fighters) {
        const was = before.get(f.id)
        if (!was) continue
        const p = this.toScreen(f.x, f.y)
        const head = p.y - this.fighterPx * 0.7
        if (f.hp < was.hp) {
          // Hit by a weapon swung at them: its own word ("CLANG!"), else POW! / WHAM!
          const by = weaponHits.find((h) => {
            const ahead = (f.x - h.x) * h.face
            return h.id !== f.id && ahead > 0 && ahead <= 0.35 && Math.abs(f.y - h.y) <= 0.08
          })
          burst(this, p.x, head, by ? PALETTE.text : PALETTE.amber, by ? 14 : 10, 180)
          if (by?.kind === 'bottle') burst(this, p.x, head, 0x8ef0b0, 12, 220)
          floatText(
            this,
            p.x,
            head - 8,
            this.t(
              by
                ? HIT_WORD[by.kind]
                : f.action === 'down' || f.action === 'ko'
                  ? 'game.brawl.wham'
                  : 'game.brawl.pow',
            ),
            by ? PALETTE.text : PALETTE.amber,
            this.compact ? 12 : 16,
          )
          const now = this.time.now
          if (f.id === this.selfId) {
            this.sfx.hurt()
            flash(this, PALETTE.red, 160, 0.22)
          } else if (
            now - this.ownHitAt > OWN_HIT_ECHO_MS &&
            now - this.otherHitAt >= OTHER_HIT_MS
          ) {
            this.otherHitAt = now
            const heavy = f.action === 'down' || f.action === 'ko'
            this.sfx.quiet(() => {
              this.sfx.hit(by ? 1.4 : heavy ? 1.2 : 0.8)
              if (by?.kind === 'bottle') this.sfx.shatter()
            }, RIVAL_LEVEL * 0.7)
          }
          if (f.action === 'down') shake(this, 0.006, 140)
        }
        if (f.hp > was.hp) {
          floatText(this, p.x, head - 8, `+${f.hp - was.hp}`, PALETTE.lime, 12)
          if (f.id === this.selfId) this.sfx.powerUp()
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
          // Full volume when it's you going down or (most likely) your blow that put them there.
          const yours = f.id === this.selfId || this.time.now - this.ownHitAt <= OWN_HIT_ECHO_MS
          this.sfx.quiet(() => this.sfx.eliminated(), yours ? 1 : RIVAL_LEVEL)
        }
        if (f.id === this.selfId && f.weapon && f.weapon !== was.weapon) {
          // Picked one up: say what it is (the PUNCH button now uses it).
          this.sfx.powerUp()
          floatText(
            this,
            p.x,
            head - 24,
            this.t('game.brawl.got', { weapon: this.t(`game.brawl.weapon.${f.weapon}`) }),
            PALETTE.amber,
            this.compact ? 12 : 16,
          )
        }
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
