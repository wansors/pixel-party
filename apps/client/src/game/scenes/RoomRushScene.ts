import {
  PALETTE,
  ROOM_RUSH,
  type RoomRushPlayer,
  type RoomRushSnapshot,
  roomRushSlotAngle,
} from '@pp/shared'
import type Phaser from 'phaser'
import { AvatarSprite, avatarPx, ensureAvatarTexture } from '../avatars'
import { addBanner, eliminate, flash, floatText, ring, shake, showBanner } from '../fx'
import { SnapshotInterpolator, lerp } from '../netcode/SnapshotInterpolator'
import {
  ensureBevelPanel,
  ensurePixelGrid,
  fitFontSize,
  headlineStyle,
  hexToCss,
  shade,
} from '../pixelStyle'
import { type Shadow, YouMarker, addShadow } from '../playerMarks'
import { PlayerStrip } from '../playerStrip'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

// Room Rush ("Mingle"): a top-down arena — a spinning carousel in the middle and ten little rooms around
// the edge, doors facing the centre. During the music everyone rides the carousel; then a number is
// called, some doors open and each open room shows a live "count/N" counter. The moment a room holds
// exactly N its door slams shut (safe!); at the buzzer everyone else is ELIMINATED — unless nobody made
// it, then the call is replayed. Steer with the arrows/WASD or by holding the pointer where you want to
// go; SPACE / SHIFT / the DASH button shoves. Bodies are interpolated a full snapshot interval behind
// (no pause-and-hop); your own push shows at once as an arrow at your feet, a dash as a ring.

const SPIN = 0.45 // carousel rad/s (mirrors the server, to extrapolate the wedges between snapshots)
// Snapshots arrive every ~150 ms: interpolating a full interval behind keeps bodies gliding.
const RENDER_DELAY_MS = 150
const ARROW_ROWS = ['__W___', '__WW__', 'WWWWW_', 'WWWWWW', 'WWWWW_', '__WW__', '__W___']
const WEDGES = 8
const WEDGE_COLORS = [PALETTE.magenta, PALETTE.amber, PALETTE.cyan, PALETTE.lime]
// Rivals' moments play at this fraction of the volume (yours stay full), so a full room stays readable.
const RIVAL_LEVEL = 0.5

interface View {
  avatar: AvatarSprite
  shadow: Shadow
  gone: boolean
  x: number
  y: number
}

export class RoomRushScene extends MiniGameScene<RoomRushSnapshot> {
  private readonly interp = new SnapshotInterpolator<RoomRushSnapshot>(RENDER_DELAY_MS)
  private compact = false
  private arena = { cx: 0, cy: 0, size: 0 }
  private floor?: Phaser.GameObjects.Graphics
  // The carousel is baked once and just rotated; its rim and the rooms redraw only when they change
  // (the open doors' glow pulses by alpha, not by redrawing).
  private carousel?: Phaser.GameObjects.Image
  private rim?: Phaser.GameObjects.Graphics
  private rooms?: Phaser.GameObjects.Graphics
  private doors?: Phaser.GameObjects.Graphics
  private roomsKey = ''
  private rimKey = ''
  private chromeRef: unknown = null
  private warmed = false
  private counters: Phaser.GameObjects.Text[] = []
  private callBar?: Phaser.GameObjects.Graphics
  private callBox = { x: 0, y: 0, w: 0, h: 0 }
  private prompt?: Phaser.GameObjects.Text
  private promptText = ''
  private strip?: PlayerStrip
  private banner?: Phaser.GameObjects.Text
  private marker?: YouMarker
  private dashBtn?: Phaser.GameObjects.Image
  private dashText?: Phaser.GameObjects.Text
  private dashKeys = { up: '', down: '' }
  private arrow?: Phaser.GameObjects.Image
  private views = new Map<string, View>()
  private avatarPx = 0
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>
  private aim?: { x: number; y: number }
  private aimPointer = -1
  private dir = { dx: 0, dy: 0 }
  // Nothing is sent until you steer for the first time (an untouched seat must stay idle).
  private steered = false
  private sentDir = ''
  private sentAt = 0
  private lastTick = -1
  private snapAt = 0
  // Event trackers.
  private lastPhase = ''
  private lastCall = 0
  private lockedSeen = new Set<number>()
  // You were already safe inside a locked room as of the last snapshot.
  private wasSafe = false
  private bannerUntil = 0

  constructor(...deps: SceneDeps) {
    super('room-rush', ...deps)
  }

  override create(): void {
    super.create()
    const { width, height } = this.scale
    this.compact = Math.min(width, height) < 520
    this.interp.reset()
    this.views = new Map()
    this.counters = []
    this.aim = undefined
    this.aimPointer = -1
    this.dir = { dx: 0, dy: 0 }
    this.steered = false
    this.sentDir = ''
    this.sentAt = 0
    this.lastTick = -1
    this.snapAt = 0
    this.lastPhase = ''
    this.roomsKey = ''
    this.rimKey = ''
    this.chromeRef = null
    this.warmed = false
    this.lastCall = 0
    this.lockedSeen = new Set()
    this.wasSafe = false
    this.bannerUntil = 0
    this.promptText = ''

    const stripSize = this.compact ? 11 : 13
    this.strip = new PlayerStrip(this, width / 2, this.top + 8, width - 24, stripSize, 2)
    const promptSize = this.compact ? 12 : 16
    const promptY = this.top + 8 + PlayerStrip.rowH(stripSize) * 2 + promptSize / 2
    this.prompt = this.add
      .text(width / 2, promptY, '', headlineStyle(promptSize, PALETTE.amber))
      .setOrigin(0.5)
      .setDepth(600)
    const barW = Math.min(width - 32, 420)
    this.callBox = { x: width / 2 - barW / 2, y: promptY + promptSize / 2 + 8, w: barW, h: 6 }
    this.callBar = this.add.graphics().setDepth(600)

    // Dash button: under the arena, or — on a wide screen, where the square arena is height-bound —
    // beside it, so the arena gets the full height.
    const btnH = this.compact ? 72 : 56
    const areaTop = this.callBox.y + this.callBox.h + 10
    const hintH = this.compact ? 0 : 28
    const sideSize = Math.floor(Math.min(width - 16, height - 16 - hintH - areaTop))
    const margin = (width - sideSize) / 2
    const side = !this.compact && margin - 40 >= 180
    const btnW = side
      ? Math.min(300, Math.floor(margin - 40))
      : Math.min(width - 32, this.compact ? 260 : 300)
    const btnX = side ? width - margin / 2 : width / 2
    const btnY = side
      ? areaTop + (height - 16 - hintH - areaTop) / 2
      : height - (this.compact ? 14 : 16) - btnH / 2
    this.dashKeys = {
      up: ensureBevelPanel(this, btnW, btnH, PALETTE.orange, 5, true),
      down: ensureBevelPanel(this, btnW, btnH, shade(PALETTE.orange, -0.45), 5, true),
    }
    this.dashBtn = this.add.image(btnX, btnY, this.dashKeys.up).setDepth(700).setInteractive()
    const dashLabel = this.t('game.roomRush.dash')
    this.dashText = this.add
      .text(
        btnX,
        btnY,
        dashLabel,
        headlineStyle(fitFontSize(dashLabel, btnW - 20, this.compact ? 16 : 24), PALETTE.text, {
          stroke: '#10121c',
          strokeThickness: 4,
        }),
      )
      .setOrigin(0.5)
      .setDepth(701)
    this.dashBtn.on('pointerdown', () => this.dash())

    let areaBottom = side ? height - 10 : btnY - btnH / 2 - 10
    // The keys, named once above the DASH button (phones steer by touch).
    if (!this.compact) {
      const hint = this.t('game.roomRush.hint')
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
    const size = Math.floor(Math.min(width - 16, areaBottom - areaTop))
    this.arena = { cx: width / 2, cy: areaTop + (areaBottom - areaTop) / 2, size }
    this.avatarPx = avatarPx(Math.round(ROOM_RUSH.playerR * 2 * size * 1.25))
    this.floor = this.add.graphics().setDepth(1)
    const hub = this.toScreen(0.5, 0.5)
    this.carousel = this.add.image(hub.x, hub.y, this.ensureWheel()).setDepth(2)
    this.rim = this.add.graphics().setDepth(2)
    this.rooms = this.add.graphics().setDepth(3)
    this.doors = this.add.graphics().setDepth(3)
    this.paintFloor()
    for (let slot = 0; slot < ROOM_RUSH.slots; slot++) {
      const a = roomRushSlotAngle(slot)
      const r = ROOM_RUSH.roomR - ROOM_RUSH.half - 0.045
      const p = this.toScreen(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r)
      this.counters.push(
        this.add
          .text(
            p.x,
            p.y,
            '',
            headlineStyle(this.compact ? 8 : 12, PALETTE.text, {
              stroke: '#10121c',
              strokeThickness: 3,
            }),
          )
          .setOrigin(0.5)
          .setDepth(70),
      )
    }
    this.marker = new YouMarker(this, this.compact ? 8 : 12, 75)
    this.banner = addBanner(this)
    const arrowKey = ensurePixelGrid(this, {
      key: 'rr-steer',
      rows: ARROW_ROWS,
      legend: { W: PALETTE.amber },
      pixelSize: this.compact ? 2 : 3,
    })
    this.arrow = this.add.image(0, 0, arrowKey).setDepth(58).setAlpha(0.85).setVisible(false)

    // Controls: arrows / WASD, or hold the pointer where you want to go; SPACE / SHIFT dash.
    this.cursors = this.input.keyboard?.createCursorKeys()
    const kb = this.input.keyboard
    if (kb) {
      this.wasd = {
        W: kb.addKey('W'),
        A: kb.addKey('A'),
        S: kb.addKey('S'),
        D: kb.addKey('D'),
      }
    }
    for (const k of ['SPACE', 'SHIFT', 'ENTER']) this.onKey(k, () => this.dash())
    this.input.on(
      'pointerdown',
      (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (over.includes(this.dashBtn as Phaser.GameObjects.GameObject)) return
        this.aimPointer = p.id
        this.aim = { x: p.x, y: p.y }
      },
    )
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.id === this.aimPointer && p.isDown) this.aim = { x: p.x, y: p.y }
    })
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.id !== this.aimPointer) return
      this.aimPointer = -1
      this.aim = undefined
    })
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    const { cx, cy, size } = this.arena
    return { x: cx + (x - 0.5) * size, y: cy + (y - 0.5) * size }
  }

  // Corner of a room slot in screen space: su/sv in room half-sides along its outward / sideways axes.
  private roomPoint(slot: number, su: number, sv: number): { x: number; y: number } {
    const a = roomRushSlotAngle(slot)
    const h = ROOM_RUSH.half
    const c = { x: 0.5 + Math.cos(a) * ROOM_RUSH.roomR, y: 0.5 + Math.sin(a) * ROOM_RUSH.roomR }
    return this.toScreen(
      c.x + su * h * Math.cos(a) - sv * h * Math.sin(a),
      c.y + su * h * Math.sin(a) + sv * h * Math.cos(a),
    )
  }

  // Checkerboard dance floor.
  private paintFloor(): void {
    const g = this.floor as Phaser.GameObjects.Graphics
    const { cx, cy, size } = this.arena
    const x0 = cx - size / 2
    const y0 = cy - size / 2
    const n = 12
    const cell = size / n
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        g.fillStyle((i + j) % 2 === 0 ? 0x2a1f3d : 0x33264a, 1)
        g.fillRect(
          Math.floor(x0 + i * cell),
          Math.floor(y0 + j * cell),
          Math.ceil(cell),
          Math.ceil(cell),
        )
      }
    }
    g.lineStyle(4, PALETTE.frameLit, 1)
    g.strokeRect(x0, y0, size, size)
  }

  private dash(): void {
    const snap = this.snap
    const me = snap?.players.find((p) => p.id === this.selfId)
    if (!snap || !me?.alive || me.dashMs > 0 || snap.phase === 'reveal' || this.state.final) return
    this.sendInput({ kind: 'dash' })
    this.sfx.whoosh()
    // The burst shows at once (your body follows the server a beat later).
    const v = this.views.get(this.selfId)
    if (v && !Number.isNaN(v.x)) ring(this, v.x, v.y, PALETTE.orange, this.avatarPx * 1.1)
    if (this.dashBtn) {
      this.dashBtn.setTexture(this.dashKeys.down)
      this.time.delayedCall(120, () => this.dashBtn?.setTexture(this.dashKeys.up))
    }
  }

  protected frame(snap: RoomRushSnapshot | null, time: number): void {
    if (!snap) return
    if (!this.warmed) {
      this.warmed = true
      this.warmAvatars(
        snap.players.map((p) => p.id),
        [
          ['front', 'happy', 0],
          ['front', 'ko', 0],
          ['back', 'idle', 0],
          ['side', 'idle', 0],
        ],
      )
    }
    if (this.state.tick !== this.lastTick) {
      this.lastTick = this.state.tick
      this.snapAt = time
      this.interp.push(snap, time)
      this.onSnapshot(snap)
    }
    this.steer(snap, time)
    this.carousel?.setRotation(snap.carouselAngle + (SPIN * (time - this.snapAt)) / 1000)
    this.paintRooms(snap)
    this.doors?.setAlpha(0.5 + 0.5 * Math.sin(time / 120))
    this.paintPlayers(time)
    if (snap !== this.chromeRef) {
      this.chromeRef = snap
      this.paintChrome(snap)
    }
    this.paintCallBar(snap, time - this.snapAt)
    if (this.banner?.visible && time > this.bannerUntil && !this.state.final)
      this.banner.setVisible(false)
  }

  // The carousel's wedges and hub, drawn once into a texture (the image rotates).
  private ensureWheel(): string {
    const r = Math.round(ROOM_RUSH.carouselR * this.arena.size)
    const key = `rr-wheel-${r}`
    if (this.textures.exists(key)) return key
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    for (let i = 0; i < WEDGES; i++) {
      const a0 = (i * Math.PI * 2) / WEDGES
      const a1 = a0 + (Math.PI * 2) / WEDGES
      g.fillStyle(shade(WEDGE_COLORS[i % WEDGE_COLORS.length] ?? PALETTE.magenta, -0.45), 1)
      g.slice(r, r, r, a0, a1, false)
      g.fillPath()
    }
    g.fillStyle(PALETTE.amber, 1)
    g.fillCircle(r, r, Math.max(4, r * 0.12))
    g.generateTexture(key, r * 2, r * 2)
    g.destroy()
    return key
  }

  private steer(snap: RoomRushSnapshot, time: number): void {
    if (!snap.players.some((p) => p.id === this.selfId && p.alive) || this.state.final) {
      this.dir = { dx: 0, dy: 0 }
      return
    }
    const keys = this.cursors
    const w = this.wasd
    const kx =
      (keys?.right.isDown || w?.D.isDown ? 1 : 0) - (keys?.left.isDown || w?.A.isDown ? 1 : 0)
    const ky = (keys?.down.isDown || w?.S.isDown ? 1 : 0) - (keys?.up.isDown || w?.W.isDown ? 1 : 0)
    if (kx !== 0 || ky !== 0) this.dir = { dx: kx, dy: ky }
    else if (this.aim) {
      const me = this.views.get(this.selfId)
      const ox = me && !Number.isNaN(me.x) ? me.x : this.arena.cx
      const oy = me && !Number.isNaN(me.x) ? me.y : this.arena.cy
      const dx = this.aim.x - ox
      const dy = this.aim.y - oy
      // A dead zone around your own avatar, so holding still on yourself really stops.
      this.dir = Math.hypot(dx, dy) < this.avatarPx * 0.4 ? { dx: 0, dy: 0 } : { dx, dy }
    } else this.dir = { dx: 0, dy: 0 }
    if (kx !== 0 || ky !== 0 || this.aim) this.steered = true
    if (!this.steered) return
    const mag = Math.hypot(this.dir.dx, this.dir.dy)
    const key =
      mag < 0.001
        ? '0'
        : `${Math.round((this.dir.dx / mag) * 20)},${Math.round((this.dir.dy / mag) * 20)}`
    if ((key !== this.sentDir || time - this.sentAt > 250) && !this.state.final) {
      this.sentDir = key
      this.sentAt = time
      this.sendInput({ kind: 'move', dx: this.dir.dx, dy: this.dir.dy })
    }
  }

  // Phase/room/elimination events, once per fresh snapshot.
  private onSnapshot(snap: RoomRushSnapshot): void {
    const first = this.lastPhase === ''
    const me = snap.players.find((p) => p.id === this.selfId)
    if (snap.phase !== this.lastPhase || snap.call !== this.lastCall) {
      if (!first) {
        if (snap.phase === 'call') {
          this.sfx.go()
          showBanner(
            this,
            this.banner as Phaser.GameObjects.Text,
            this.t('game.roomRush.number', { n: snap.n }),
            PALETTE.amber,
          )
          this.bannerUntil = this.time.now + 900
          shake(this, 0.004, 120)
        } else if (snap.phase === 'reveal') this.onBuzzer(snap, me)
        else if (snap.phase === 'music') this.sfx.tick()
      } else {
        for (const p of snap.players) if (!p.alive) this.fadeOut(p.id, false)
      }
      if (snap.phase === 'music') this.lockedSeen.clear()
      this.lastPhase = snap.phase
      this.lastCall = snap.call
    }
    // The eliminated stay on the floor through the reveal (for their stamp); anyone out otherwise (a
    // player who left mid-call) just fades.
    if (snap.phase !== 'reveal') for (const p of snap.players) if (!p.alive) this.fadeOut(p.id)
    let slammed = false
    for (const room of snap.rooms) {
      if (!room.locked || this.lockedSeen.has(room.slot)) continue
      this.lockedSeen.add(room.slot)
      if (first) continue
      const c = this.roomPoint(room.slot, 0, 0)
      ring(this, c.x, c.y, PALETTE.lime, this.arena.size * ROOM_RUSH.half * 1.4)
      shake(this, 0.003, 90)
      slammed = true
    }
    // A door slams shut (one slam per snapshot): the one that shuts you in safe slams loud and chimes,
    // the others' doors softer.
    const mine = slammed && !!me?.safe && !this.wasSafe
    if (mine) {
      this.sfx.lock()
      this.sfx.correct()
    } else if (slammed) this.sfx.quiet(() => this.sfx.lock(), RIVAL_LEVEL)
    this.wasSafe = !!me?.safe
  }

  private onBuzzer(snap: RoomRushSnapshot, me: RoomRushPlayer | undefined): void {
    const size = this.compact ? 12 : 16
    if (snap.outThisCall.length === 0 && !snap.players.some((p) => p.safe)) {
      // Nobody made it: the call is replayed.
      this.sfx.wrong()
      showBanner(
        this,
        this.banner as Phaser.GameObjects.Text,
        this.t('game.roomRush.wipeout'),
        PALETTE.orange,
      )
      this.bannerUntil = this.time.now + 1200
      return
    }
    // One sting for the whole batch: full if it took you, softer if it only took rivals.
    const tookMe = !!me && snap.outThisCall.includes(me.id)
    if (snap.outThisCall.length > 0)
      this.sfx.quiet(() => this.sfx.eliminated(), tookMe ? 1 : RIVAL_LEVEL)
    for (const id of snap.outThisCall) {
      const p = snap.players.find((q) => q.id === id)
      if (!p) continue
      const s = this.toScreen(p.x, p.y)
      eliminate(this, s.x, s.y, this.state.colorOf(id), this.quip('game.common.stamps', id), size)
    }
    if (me && snap.outThisCall.includes(me.id)) flash(this, PALETTE.red, 220, 0.3)
    else if (me?.alive) {
      const s = this.toScreen(me.x, me.y)
      floatText(this, s.x, s.y - this.avatarPx, this.t('game.roomRush.safe'), PALETTE.lime, size)
      this.sfx.win()
    }
  }

  // The eliminated leave the floor (they stay listed, dimmed, in the strip above).
  private fadeOut(id: string, animate = true): void {
    const v = this.views.get(id)
    if (!v || v.gone) return
    v.gone = true
    v.avatar.setExpression('ko')
    v.shadow.setVisible(false)
    const img = v.avatar.image
    if (!animate) img.setVisible(false)
    else
      this.tweens.add({ targets: img, alpha: 0, scale: img.scale * 0.5, delay: 350, duration: 500 })
  }

  // Rooms (walls, fills, shut doors, counters) and the carousel's rim: redrawn only when they change.
  private paintRooms(snap: RoomRushSnapshot): void {
    const rimKey = snap.phase
    if (rimKey !== this.rimKey && this.rim) {
      this.rimKey = rimKey
      const c = this.toScreen(0.5, 0.5)
      this.rim
        .clear()
        .lineStyle(4, PALETTE.amber, snap.phase === 'music' ? 1 : 0.6)
        .strokeCircle(c.x, c.y, ROOM_RUSH.carouselR * this.arena.size)
    }
    const key = `${snap.phase}:${snap.n}:${snap.rooms.map((r) => `${r.slot},${r.count},${r.locked}`).join(';')}`
    if (key === this.roomsKey) return
    this.roomsKey = key
    const g = this.rooms as Phaser.GameObjects.Graphics
    const doors = this.doors as Phaser.GameObjects.Graphics
    g.clear()
    doors.clear()
    const wallW = Math.max(3, Math.round(this.arena.size / 140))
    const d = ROOM_RUSH.door / ROOM_RUSH.half
    for (let slot = 0; slot < ROOM_RUSH.slots; slot++) {
      const room = snap.rooms.find((r) => r.slot === slot)
      const pts = [
        this.roomPoint(slot, -1, -1),
        this.roomPoint(slot, 1, -1),
        this.roomPoint(slot, 1, 1),
        this.roomPoint(slot, -1, 1),
      ]
      const fill = !room
        ? 0x16121f
        : room.locked
          ? shade(PALETTE.lime, -0.6)
          : shade(PALETTE.amber, -0.62)
      g.fillStyle(fill, 1)
      g.fillPoints(pts, true)
      const wall = room ? (room.locked ? PALETTE.lime : PALETTE.amber) : PALETTE.frame
      g.lineStyle(wallW, wall, 1)
      const line = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
        g.lineBetween(a.x, a.y, b.x, b.y)
      }
      line(pts[1] as { x: number; y: number }, pts[2] as { x: number; y: number })
      line(pts[0] as { x: number; y: number }, pts[1] as { x: number; y: number })
      line(pts[3] as { x: number; y: number }, pts[2] as { x: number; y: number })
      line(this.roomPoint(slot, -1, -1), this.roomPoint(slot, -1, -d))
      line(this.roomPoint(slot, -1, d), this.roomPoint(slot, -1, 1))
      // The door: shut (inactive rooms, the music, a locked room) or open (a glowing threshold, its
      // pulse is the doors layer's alpha).
      const open = room && !room.locked && snap.phase === 'call'
      const a = this.roomPoint(slot, -1, -d)
      const b = this.roomPoint(slot, -1, d)
      if (open) doors.lineStyle(wallW, PALETTE.amber, 0.7).lineBetween(a.x, a.y, b.x, b.y)
      else {
        g.lineStyle(wallW + 1, room?.locked ? PALETTE.lime : shade(PALETTE.orange, -0.35), 1)
        line(a, b)
      }
      // Live counter.
      const label = this.counters[slot]
      if (!label) continue
      const text = room ? `${room.count}/${snap.n}` : ''
      if (label.text !== text) label.setText(text)
      if (!room) continue
      // Lime once locked, amber with one spot left (the next one in slams the door).
      const color = room.locked
        ? PALETTE.lime
        : room.count === snap.n - 1
          ? PALETTE.amber
          : PALETTE.text
      label.setColor(hexToCss(color))
    }
  }

  private paintPlayers(time: number): void {
    const sample = this.interp.sample(time)
    if (!sample) return
    for (const p of sample.to.players) {
      let view = this.views.get(p.id)
      if (!view) {
        const avatar = new AvatarSprite(
          this,
          this.state.avatarOf(p.id),
          this.state.colorOf(p.id),
          this.avatarPx,
        )
        avatar.image.setDepth(60)
        const shadow = addShadow(this, this.avatarPx, 59)
        view = { avatar, shadow, gone: false, x: Number.NaN, y: 0 }
        this.views.set(p.id, view)
        if (!p.alive) this.fadeOut(p.id, false)
      }
      const from = sample.from.players.find((q) => q.id === p.id) ?? p
      // A respawn onto the carousel snaps instead of sliding across the floor.
      const jump = Math.hypot(p.x - from.x, p.y - from.y) > 0.15
      const x = jump ? p.x : lerp(from.x, p.x, sample.t)
      const y = jump ? p.y : lerp(from.y, p.y, sample.t)
      const s = this.toScreen(x, y)
      // Faces where it walks (top-down: back going up, front going down, side going across) — you:
      // where you push, at once.
      const self = p.id === this.selfId
      const pushing = self && (this.dir.dx !== 0 || this.dir.dy !== 0)
      if (pushing) view.avatar.faceMotion(this.dir.dx, this.dir.dy, 0.1)
      else if (!Number.isNaN(view.x) && !jump) view.avatar.faceMotion(s.x - view.x, s.y - view.y)
      view.x = s.x
      view.y = s.y
      if (!view.gone) view.avatar.setExpression(p.safe ? 'happy' : 'idle')
      view.avatar.tick(time)
      view.avatar.image.setPosition(Math.round(s.x), Math.round(s.y))
      view.shadow.setPosition(Math.round(s.x), Math.round(s.y + this.avatarPx * 0.42))
      if (self) {
        if (view.gone) this.marker?.hide()
        else this.marker?.place(s.x, s.y - this.avatarPx * 0.45, time)
        // Your push, at your feet, the moment you press.
        const mag = Math.hypot(this.dir.dx, this.dir.dy)
        this.arrow?.setVisible(pushing && !view.gone && mag > 0)
        if (pushing && mag > 0)
          this.arrow
            ?.setPosition(
              Math.round(s.x + (this.dir.dx / mag) * this.avatarPx * 0.75),
              Math.round(s.y + (this.dir.dy / mag) * this.avatarPx * 0.75),
            )
            .setRotation(Math.atan2(this.dir.dy, this.dir.dx))
      }
    }
  }

  // Call timer: how long the doors stay open (run on between snapshots).
  private paintCallBar(snap: RoomRushSnapshot, since: number): void {
    const g = this.callBar as Phaser.GameObjects.Graphics
    g.clear()
    if (snap.phase !== 'call' || snap.phaseTotalMs <= 0 || this.state.final) return
    const { x, y, w, h } = this.callBox
    const frac = Math.max(0, Math.min(1, (snap.phaseMs - since) / snap.phaseTotalMs))
    g.fillStyle(PALETTE.panelAlt, 1)
    g.fillRect(x, y, w, h)
    g.fillStyle(frac < 0.3 ? PALETTE.red : PALETTE.amber, 1)
    g.fillRect(x, y, Math.round(w * frac), h)
  }

  // Strip, HUD, prompt and the DASH button: once per snapshot.
  private paintChrome(snap: RoomRushSnapshot): void {
    const me = snap.players.find((p) => p.id === this.selfId)
    const alive = snap.players.filter((p) => p.alive).length
    this.hud?.setCenter(
      this.t('game.common.left', { n: alive, total: snap.players.length }),
      alive <= 1 ? PALETTE.red : PALETTE.text,
    )
    this.hud?.setScore(this.t('game.roomRush.call', { n: snap.call }))
    this.strip?.set(
      snap.players.map((p) => ({
        text: `${this.label(p.id)}${p.alive ? (p.safe ? ' ✓' : '') : ' ✗'}`,
        avatar: this.state.avatarOf(p.id),
        color: this.state.colorOf(p.id),
        dim: !p.alive,
      })),
    )
    // Dash readiness.
    const ready = !!me?.alive && me.dashMs <= 0 && snap.phase !== 'reveal'
    this.dashBtn?.setAlpha(ready ? 1 : 0.45)
    this.dashText?.setAlpha(ready ? 1 : 0.45)
    const prompt = this.promptFor(snap, me)
    if (this.prompt && prompt.text !== this.promptText) {
      this.promptText = prompt.text
      this.prompt.setText(prompt.text).setColor(hexToCss(prompt.color))
      this.prompt.setFontSize(
        fitFontSize(prompt.text, this.scale.width - 24, this.compact ? 12 : 16),
      )
    }
    if (this.state.final && me && this.banner && !this.banner.visible) {
      showBanner(
        this,
        this.banner,
        me?.alive ? this.t('game.roomRush.survived') : this.t('game.common.out'),
        me?.alive ? PALETTE.lime : PALETTE.red,
      )
    }
  }

  private promptFor(
    snap: RoomRushSnapshot,
    me: RoomRushPlayer | undefined,
  ): { text: string; color: number } {
    if (!me || this.state.final) return { text: '', color: PALETTE.amber }
    if (!me.alive)
      return { text: this.quip('game.common.spectating', this.selfId), color: PALETTE.dim }
    if (snap.phase === 'music')
      return { text: this.t('game.roomRush.musicHint'), color: PALETTE.cyan }
    if (snap.phase === 'reveal') return { text: this.t('game.roomRush.safe'), color: PALETTE.lime }
    if (me.safe) return { text: this.t('game.roomRush.lockedHint'), color: PALETTE.lime }
    return { text: this.t('game.roomRush.callHint', { n: snap.n }), color: PALETTE.amber }
  }
}
