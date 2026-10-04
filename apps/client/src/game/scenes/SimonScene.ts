import { PALETTE, type SimonPlayerView, type SimonSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import { ensureAvatarTexture } from '../avatars'
import { addBanner, burst, flash, floatText, punch, ring, shake, showBanner } from '../fx'
import { bodyStyle, headlineStyle, hexToCss, shade } from '../pixelStyle'
import { MiniGameScene, type SceneDeps } from './MiniGameScene'

const PAD_COLORS = [PALETTE.red, 0x3a7bd5, 0x2a9d3f, PALETTE.amber]
const PLAY_ON_MS = 420
const PLAY_GAP_MS = 180
// A repeated pad (e.g. seq = [1, 1, 2]) needs a longer, clearer gap than a change of pad — with the
// normal gap the second flash of the same color barely reads as a separate tap.
const PLAY_REPEAT_GAP_MS = 420
// Beat between "level up!" (or the round start) and the first pad of the playback.
const PLAY_LEAD_IN_MS = 600
const TAP_LIT_MS = 200
// The device is drawn on a DEVICE_CELLS-wide pixel grid (each cell = one chunky art pixel).
const DEVICE_CELLS = 48
const HALO_CELLS = 3
// The bottom strip's slots: everyone in a full room on a wide screen, the leaders (+ you) otherwise.
const MAX_RIVALS = 12
// Keys per pad (top-left, top-right, bottom-left, bottom-right): the Q W / A S block mirrors the
// device, and 1-4 (top row or numpad) read in the same order. The letter is printed on the pad.
const PAD_KEYS: readonly (readonly string[])[] = [
  ['Q', 'ONE', 'NUMPAD_ONE'],
  ['W', 'TWO', 'NUMPAD_TWO'],
  ['A', 'THREE', 'NUMPAD_THREE'],
  ['S', 'FOUR', 'NUMPAD_FOUR'],
]
// A create() within this long of the scene's own shutdown is a relayout restart mid-round (a new round
// only starts seconds after the previous one stopped) — the one case where a memo may carry over.
const RELAYOUT_GAP_MS = 1000
// A rival going out (or clearing the lot) sounds at most this often — and never over your playback.
const RIVAL_SOUND_EVERY_MS = 500

interface PlaySlot {
  pad: number
  start: number
  end: number
}

// Precomputes each pad's on-window along the playback timeline, widening the gap before a slot whose
// pad repeats the previous one.
function buildPlaySlots(seq: number[]): PlaySlot[] {
  const slots: PlaySlot[] = []
  let t = PLAY_LEAD_IN_MS
  seq.forEach((pad, i) => {
    if (i > 0) t += pad === seq[i - 1] ? PLAY_REPEAT_GAP_MS : PLAY_GAP_MS
    slots.push({ pad, start: t, end: t + PLAY_ON_MS })
    t += PLAY_ON_MS
  })
  return slots
}

type PadLook = 'off' | 'on' | 'halo'

// Paints an n x n grid of `cellPx` cells into a texture: `at` gives each cell's color + alpha (null =
// transparent). Runs of identical cells along a row become one rectangle, so a device texture is a few
// hundred canvas fills instead of a few thousand.
function paintCells(
  scene: Phaser.Scene,
  key: string,
  n: number,
  cellPx: number,
  at: (x: number, y: number) => readonly [number, number] | null,
): string {
  const g = scene.make.graphics({ x: 0, y: 0 })
  for (let y = 0; y < n; y++) {
    let x = 0
    while (x < n) {
      const cell = at(x, y)
      let end = x + 1
      while (end < n) {
        const next = at(end, y)
        if (cell === null ? next !== null : next?.[0] !== cell[0] || next[1] !== cell[1]) break
        end++
      }
      if (cell)
        g.fillStyle(cell[0], cell[1]).fillRect(x * cellPx, y * cellPx, (end - x) * cellPx, cellPx)
      x = end
    }
  }
  g.generateTexture(key, n * cellPx, n * cellPx)
  g.destroy()
  return key
}

// Simon (sequence memory) canvas: a round pixel-art Simon device with four quarter-ring pads around a
// count display. WATCH: the player's growing sequence plays back (input locked, device rim amber);
// YOUR TURN: repeat it (rim lime, pips below track the replay). Pads have clearly distinct unlit/lit
// states plus a glow halo; a level-up celebrates before the next playback; a wrong pad blinks the pad
// that was expected. Pads answer to clicks/taps and to Q W / A S (or 1-4), printed on the pads on
// keyboard-sized screens. The server owns the sequence and the verdicts. Scene key === mini-game id.
export class SimonScene extends MiniGameScene<SimonSnapshot> {
  private prompt?: Phaser.GameObjects.Text
  private shell?: Phaser.GameObjects.Image
  private hubText?: Phaser.GameObjects.Text
  private pads: Phaser.GameObjects.Image[] = []
  private halos: Phaser.GameObjects.Image[] = []
  private pips?: Phaser.GameObjects.Graphics
  private rivals: Phaser.GameObjects.Text[] = []
  // Each rival's avatar, just left of their text (KO face once out).
  private rivalIcons: Phaser.GameObjects.Image[] = []
  private waitText?: Phaser.GameObjects.Text
  private banner?: Phaser.GameObjects.Text
  private rivalsSnap?: SimonSnapshot
  private cellPx = 4
  private cx = 0
  private cy = 0
  private pipsY = 0
  // Playback state.
  private shownLen = -1
  private playing = false
  private playStart = 0
  private lastTapAt = 0
  private lastTapPad = -1
  private wasAlive = true
  // Last sequence slot whose tone was played during playback, so each pad sounds once as it lights.
  private lastPlaySlot = -1
  private playSlots: PlaySlot[] = []
  // pad -> time until which a tap keeps it lit.
  private litUntil: number[] = []
  // After a wrong pad: the pad that was expected blinks until this time.
  private hintPad = -1
  private hintUntil = 0
  private pipsKey = ''
  // The playback on screen, kept across a relayout restart (create() clears it only for a fresh
  // round): an orientation flip or window resize resumes it where it was — or skips it if it already
  // ended — instead of replaying the whole sequence, a second look for a player stuck mid-replay.
  private playMemo = { round: -1, len: -1, start: 0 }
  private stoppedAt = Number.NEGATIVE_INFINITY
  // Players already seen out of the run (sounded once), and when a rival's sting last played.
  private readonly ended = new Set<string>()
  private rivalSoundAt = Number.NEGATIVE_INFINITY

  constructor(...deps: SceneDeps) {
    super('simon', ...deps)
  }

  override create(): void {
    super.create()
    if (this.game.getTime() - this.stoppedAt > RELAYOUT_GAP_MS) {
      this.playMemo = { round: -1, len: -1, start: 0 }
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stoppedAt = this.game.getTime()
    })
    this.pads = []
    this.halos = []
    this.rivals = []
    this.rivalIcons = []
    this.shownLen = -1
    this.playing = false
    this.wasAlive = true
    this.playSlots = []
    this.lastPlaySlot = -1
    this.litUntil = [0, 0, 0, 0]
    this.hintPad = -1
    this.hintUntil = 0
    this.pipsKey = ''
    this.rivalsSnap = undefined
    this.ended.clear()
    this.rivalSoundAt = Number.NEGATIVE_INFINITY

    const { width, height } = this.scale
    const compact = Math.min(width, height) < 520
    const top = this.top
    this.cx = width / 2
    const promptSize = compact ? 16 : 24
    const promptY = top + (compact ? 24 : 34)
    this.prompt = this.add
      .text(this.cx, promptY, '', headlineStyle(promptSize, PALETTE.amber, { align: 'center' }))
      .setOrigin(0.5)

    // Bottom strip: the leaders' levels (yours always among them), the replay pips above it, then the
    // device.
    const rivalY = height - (compact ? 20 : 28)
    this.pipsY = rivalY - (compact ? 36 : 46)
    // Keyboard screens: name the keys under the prompt (the pads carry their letters too).
    if (!compact) {
      this.add
        .text(this.cx, promptY + promptSize / 2 + 14, this.t('game.simon.keys'), bodyStyle(16))
        .setOrigin(0.5, 0)
    }
    const areaTop = promptY + promptSize / 2 + (compact ? 20 : 52)
    const areaBottom = this.pipsY - (compact ? 22 : 30)
    // A big canvas (1080p) gets a bigger device; laptops and phones keep the old cap.
    const cap = width >= 1400 && height >= 860 ? 600 : 440
    const size = Math.max(160, Math.min(width - 48, areaBottom - areaTop, cap))
    this.cellPx = Math.max(2, Math.floor(size / DEVICE_CELLS))
    this.cy = (areaTop + areaBottom) / 2

    // Every look of the device is drawn up front (cached per size, so only the first round at a size
    // pays): drawn lazily, the first lit pad, the YOUR TURN rim or the OUT rim each cost a visible hitch
    // mid-play — several thousand pixel cells per texture.
    for (const rim of [PALETTE.frame, PALETTE.amber, PALETTE.lime, PALETTE.red]) this.bodyKey(rim)
    for (let i = 0; i < 4; i++)
      for (const look of ['off', 'on', 'halo'] as const) this.padKey(i, look)
    this.shell = this.add.image(this.cx, this.cy, this.bodyKey(PALETTE.frame))
    for (let i = 0; i < 4; i++) {
      const origin = { x: i % 2 === 0 ? 1 : 0, y: i < 2 ? 1 : 0 }
      const halo = this.add
        .image(this.cx, this.cy, this.padKey(i, 'halo'))
        .setOrigin(origin.x, origin.y)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false)
      const pad = this.add
        .image(this.cx, this.cy, this.padKey(i, 'off'))
        .setOrigin(origin.x, origin.y)
        .setInteractive({ useHandCursor: true })
      pad.on('pointerdown', () => this.tap(i, true))
      this.halos.push(halo)
      this.pads.push(pad)
      for (const k of PAD_KEYS[i] ?? []) this.onKey(k, () => this.tap(i, false))
      if (!compact) {
        const at = this.padCenter(i)
        this.add
          .text(
            at.x,
            at.y,
            PAD_KEYS[i]?.[0] ?? '',
            headlineStyle(cap > 440 ? 24 : 16, PALETTE.text, {
              stroke: '#10121c',
              strokeThickness: 4,
            }),
          )
          .setOrigin(0.5)
          .setAlpha(0.75)
          .setDepth(1)
      }
    }
    this.add.image(this.cx, this.cy, this.hubKey()).setDepth(2)
    this.hubText = this.add
      .text(this.cx, this.cy, '', headlineStyle(compact ? 24 : 32, PALETTE.amber))
      .setOrigin(0.5)
      .setDepth(3)

    this.pips = this.add.graphics()
    for (let i = 0; i < MAX_RIVALS; i++) {
      this.rivals.push(
        this.add
          .text(0, rivalY, '', bodyStyle(compact ? 12 : 14, PALETTE.text))
          .setOrigin(0.5)
          .setVisible(false),
      )
      this.rivalIcons.push(
        this.add
          .image(0, rivalY, ensureAvatarTexture(this, 'cat', PALETTE.dim, 1))
          .setOrigin(1, 0.5)
          .setVisible(false),
      )
    }
    this.waitText = this.add
      .text(
        this.cx,
        height / 2 + (compact ? 44 : 56),
        '',
        bodyStyle(compact ? 14 : 18, PALETTE.text, { stroke: '#10121c', strokeThickness: 4 }),
      )
      .setOrigin(0.5)
      .setDepth(951)
    this.banner = addBanner(this)
    // The kit's 34px banner overflows a phone on longer words ("¡TERMINADO!").
    if (compact) this.banner.setFontSize(24)
  }

  // --- Procedural pixel art -------------------------------------------------------------------------

  // One quarter-ring pad (or its glow halo) as a texture whose inner corner is the device centre.
  private padKey(pad: number, look: PadLook): string {
    const key = `pp-simon-pad-${pad}-${look}-${this.cellPx}`
    if (this.textures.exists(key)) return key
    const c = PAD_COLORS[pad] ?? PALETTE.dim
    const q = DEVICE_CELLS / 2
    const margin = look === 'halo' ? HALO_CELLS : 0
    const n = q + margin
    const left = pad % 2 === 0
    const upper = pad < 2
    const rOut = q - 0.5
    const rIn = q * 0.38
    const gap = 1.2
    const tones =
      look === 'on'
        ? { base: shade(c, 0.12), hi: shade(c, 0.62), lo: c, rim: shade(c, -0.3) }
        : { base: shade(c, -0.5), hi: shade(c, -0.28), lo: shade(c, -0.64), rim: shade(c, -0.78) }
    return paintCells(this, key, n, this.cellPx, (tx, ty) => {
      // Distance from the device centre (the texture's inner corner), in cells.
      const ax = left ? n - tx - 0.5 : tx + 0.5
      const ay = upper ? n - ty - 0.5 : ty + 0.5
      const dist = Math.sqrt(ax * ax + ay * ay)
      if (ax < gap || ay < gap || dist < rIn) return null
      if (look === 'halo') {
        if (dist > rOut + margin) return null
        return [c, dist <= rOut ? 0.28 : dist <= rOut + margin / 2 ? 0.4 : 0.18]
      }
      if (dist > rOut) return null
      const edge = dist > rOut - 1 || dist < rIn + 1 || ax < gap + 1 || ay < gap + 1
      // Light from the top-left: the rim band facing it is highlighted, the far one shaded.
      const facing = ((left ? 1 : -1) * ax + (upper ? 1 : -1) * ay) / dist
      const band = dist > rOut - 3
      let color = tones.base
      if (edge) color = tones.rim
      else if (band && facing > 0.35) color = tones.hi
      else if (band && facing < -0.35) color = tones.lo
      // A lit pad gets a bright glint near its outer rim.
      if (look === 'on' && !edge && dist > rOut - 5 && dist < rOut - 3 && Math.abs(facing) < 0.3)
        color = 0xffffff
      return [color, 1]
    })
  }

  // The dark round shell behind the pads, rimmed in the state colour (amber WATCH / lime YOUR TURN).
  private bodyKey(rim: number): string {
    const key = `pp-simon-body-${rim.toString(16)}-${this.cellPx}`
    if (this.textures.exists(key)) return key
    const n = DEVICE_CELLS + 4
    const r = n / 2
    const [dark, inner] = [shade(rim, -0.5), shade(PALETTE.bg, -0.3)]
    return paintCells(this, key, n, this.cellPx, (x, y) => {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r)
      if (d > r) return null
      return [d > r - 1.2 ? rim : d > r - 2.2 ? dark : inner, 1]
    })
  }

  // Centre hub: the classic count display.
  private hubKey(): string {
    const key = `pp-simon-hub-${this.cellPx}`
    if (this.textures.exists(key)) return key
    const r = DEVICE_CELLS * 0.19 - 1.5
    const n = Math.ceil(r * 2)
    return paintCells(this, key, n, this.cellPx, (x, y) => {
      const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2)
      if (d > r) return null
      return [d > r - 1.1 ? PALETTE.frameLit : PALETTE.panel, 1]
    })
  }

  // Screen point in the middle of a pad's ring (for rings/bursts/labels).
  private padCenter(pad: number): { x: number; y: number } {
    const d = DEVICE_CELLS * this.cellPx * 0.24
    return {
      x: this.cx + (pad % 2 === 0 ? -d : d),
      y: this.cy + (pad < 2 ? -d : d),
    }
  }

  // --- Input ----------------------------------------------------------------------------------------

  private tap(pad: number, byPointer: boolean): void {
    const me = this.snap?.players[this.selfId]
    if (!me || !me.alive || this.playing) return
    // Debounce double-fired taps on the same pad; keys need none (auto-repeat is already filtered),
    // and a fast typist may hit two pads well inside 120 ms.
    if (byPointer && this.time.now - this.lastTapAt < 120 && this.lastTapPad === pad) return
    this.lastTapAt = this.time.now
    this.lastTapPad = pad
    this.litUntil[pad] = this.time.now + TAP_LIT_MS
    this.sfx.pad(pad)
    const at = this.padCenter(pad)
    ring(this, at.x, at.y, shade(PAD_COLORS[pad] ?? PALETTE.text, 0.4), 70)
    this.sendInput({ kind: 'pad', pad })
  }

  // --- Frame ----------------------------------------------------------------------------------------

  protected frame(snap: SimonSnapshot | null): void {
    if (!snap) return
    const me = snap.players[this.selfId]
    const score = snap.scores[this.selfId] ?? 0
    if (snap !== this.rivalsSnap) this.hud?.setScore(this.t('game.common.level', { n: score }))
    if (snap !== this.rivalsSnap) this.trackRivalsEnded(snap)
    this.renderRivals(snap)
    if (!me) {
      // A spectator (not in this round): the device stays dark.
      this.waitText?.setText(this.t('game.common.waiting'))
      return
    }
    const now = this.time.now

    // A longer sequence means the player advanced a level → celebrate, then play the new sequence.
    if (me.seq.length !== this.shownLen && me.alive) {
      const memo = this.playMemo
      const resumed = memo.round === this.state.round && memo.len === me.seq.length
      if (this.shownLen > 0 && me.seq.length > this.shownLen) this.levelUp(me.seq.length - 1)
      this.shownLen = me.seq.length
      this.playSlots = buildPlaySlots(me.seq)
      this.playStart = resumed ? memo.start : now
      if (!resumed) this.playMemo = { round: this.state.round, len: me.seq.length, start: now }
      const elapsed = now - this.playStart
      this.playing = elapsed < (this.playSlots.at(-1)?.end ?? 0)
      // Resuming mid-playback: pads already shown stay shown (and silent).
      this.lastPlaySlot = -1
      this.playSlots.forEach((slot, i) => {
        if (resumed && elapsed >= slot.start) this.lastPlaySlot = i
      })
      if (this.hubText) {
        this.hubText.setText(String(me.seq.length))
        if (!resumed) punch(this, this.hubText, 0.3, 110)
      }
    }
    if (!me.alive) {
      this.renderEnded(me, score, now)
      return
    }

    let active: PlaySlot | undefined
    if (this.playing) {
      const elapsed = now - this.playStart
      const idx = this.playSlots.findIndex((s) => elapsed >= s.start && elapsed < s.end)
      active = idx >= 0 ? this.playSlots[idx] : undefined
      // Sound each pad once as it lights up during playback.
      if (active && idx !== this.lastPlaySlot) {
        this.lastPlaySlot = idx
        this.sfx.pad(active.pad)
      }
      const totalMs = this.playSlots.at(-1)?.end ?? 0
      if (elapsed >= totalMs) {
        this.playing = false
        this.sfx.go()
      }
      this.renderPips(me.seq.length, this.lastPlaySlot + 1, -1, PALETTE.amber)
    } else {
      this.renderPips(me.seq.length, me.pos, me.pos, PALETTE.lime)
    }
    this.setState(
      this.playing ? this.t('game.simon.watch') : this.t('game.simon.yourTurn'),
      this.playing ? PALETTE.amber : PALETTE.lime,
      // "YOUR TURN!" blinks arcade-style (stepped, not faded).
      this.playing || Math.floor(now / 450) % 2 === 0,
    )
    this.pads.forEach((_, i) => this.setPad(i, active?.pad === i || now < (this.litUntil[i] ?? 0)))
  }

  private setPad(i: number, lit: boolean): void {
    const pad = this.pads[i]
    const key = this.padKey(i, lit ? 'on' : 'off')
    if (pad && pad.texture.key !== key) pad.setTexture(key)
    this.halos[i]?.setVisible(lit)
  }

  private setState(text: string, color: number, visible: boolean): void {
    if (!this.prompt) return
    if (this.prompt.text !== text) {
      this.prompt.setText(text)
      punch(this, this.prompt, 0.2, 90)
    }
    this.prompt.setColor(hexToCss(color)).setVisible(visible)
    const key = this.bodyKey(color)
    if (this.shell && this.shell.texture.key !== key) this.shell.setTexture(key)
  }

  private levelUp(completed: number): void {
    // Level up: a rising power-up sweep, done before the next playback's first pad.
    this.sfx.powerUp()
    ring(this, this.cx, this.cy, PALETTE.lime, DEVICE_CELLS * this.cellPx * 0.5)
    burst(this, this.cx, this.cy, PALETTE.lime, 16, 240)
    floatText(
      this,
      this.cx,
      this.cy - DEVICE_CELLS * this.cellPx * 0.12,
      completed % 5 === 0 ? this.t('game.common.great') : this.t('game.common.nice'),
      PALETTE.lime,
      24,
    )
  }

  // Out (wrong pad) or cleared the whole sequence: say so, and on a miss blink the pad that was due.
  private renderEnded(me: SimonPlayerView, score: number, now: number): void {
    const clearedAll = me.seq.length <= score
    if (this.wasAlive) {
      this.wasAlive = false
      this.playing = false
      // The banner sits over the hub; keep the count from peeking out behind it.
      this.hubText?.setVisible(false)
      // A relayout restart after the run ended only restores the end state (no buzz/shake replay).
      const quiet = this.firstSnapshot
      if (clearedAll && !quiet) {
        this.sfx.cheer()
        this.sfx.coin()
        burst(this, this.cx, this.cy, PALETTE.amber, 30, 320)
      } else if (!quiet) {
        // A wrong pad ends the run: the elimination sting.
        this.sfx.eliminated()
        shake(this, 0.012, 240)
        flash(this, PALETTE.red, 160)
        this.hintPad = me.seq[me.pos] ?? -1
        this.hintUntil = now + 1500
      }
      if (this.banner) {
        showBanner(
          this,
          this.banner,
          clearedAll ? this.t('game.common.finished') : this.t('game.common.out'),
          clearedAll ? PALETTE.lime : PALETTE.red,
        )
      }
      this.waitText?.setText(this.t('game.common.waiting'))
    }
    this.setState(this.prompt?.text ?? '', clearedAll ? PALETTE.lime : PALETTE.red, false)
    const blink = now < this.hintUntil && Math.floor(now / 180) % 2 === 0
    this.pads.forEach((_, i) => this.setPad(i, blink && i === this.hintPad))
    this.renderPips(
      me.seq.length,
      me.pos,
      clearedAll ? -1 : me.pos,
      clearedAll ? PALETTE.lime : PALETTE.red,
    )
  }

  // A rival's run ending: a short hurt for a wrong pad, a cheer for clearing the whole sequence —
  // throttled, and silent while this player's own sequence is playing back (it must stay audible).
  // The first snapshot only learns who is already out.
  private trackRivalsEnded(snap: SimonSnapshot): void {
    for (const [id, p] of Object.entries(snap.players)) {
      if (p.alive || this.ended.has(id)) continue
      this.ended.add(id)
      if (this.firstSnapshot || id === this.selfId || this.playing) continue
      if (this.time.now - this.rivalSoundAt < RIVAL_SOUND_EVERY_MS) continue
      this.rivalSoundAt = this.time.now
      if (p.seq.length <= (snap.scores[id] ?? 0)) this.sfx.cheer()
      else this.sfx.hurt()
    }
  }

  // One pip per pad in the current sequence: done (filled), next (outlined), still to go (dim).
  private renderPips(len: number, done: number, next: number, color: number): void {
    const key = `${len}:${done}:${next}:${color}`
    if (!this.pips || key === this.pipsKey) return
    this.pipsKey = key
    const { width } = this.scale
    const gap = 4
    const s = Math.max(6, Math.min(16, Math.floor((width - 32 + gap) / Math.max(1, len) - gap)))
    const total = len * s + (len - 1) * gap
    const x0 = this.cx - total / 2
    this.pips.clear()
    for (let i = 0; i < len; i++) {
      const x = Math.round(x0 + i * (s + gap))
      const y = Math.round(this.pipsY - s / 2)
      if (i < done) {
        this.pips.fillStyle(color, 1).fillRect(x, y, s, s)
        this.pips.fillStyle(shade(color, 0.5), 1).fillRect(x, y, s, 2)
      } else {
        this.pips.fillStyle(PALETTE.panelAlt, 1).fillRect(x, y, s, s)
        if (i === next) this.pips.lineStyle(2, color, 1).strokeRect(x - 1, y - 1, s + 2, s + 2)
      }
    }
  }

  // The leaders' levels along the bottom, in their colours (✕ = out) — always including yours: when you
  // aren't among the top N, you take the last slot.
  private renderRivals(snap: SimonSnapshot): void {
    // Levels only change with a snapshot.
    if (snap === this.rivalsSnap) return
    this.rivalsSnap = snap
    const ranked = Object.keys(snap.players).sort(
      (a, b) =>
        (snap.scores[b] ?? 0) - (snap.scores[a] ?? 0) ||
        (snap.players[b]?.pos ?? 0) - (snap.players[a]?.pos ?? 0),
    )
    const { width } = this.scale
    const shown = ranked.slice(0, width < 520 ? 4 : width < 1400 ? 8 : MAX_RIVALS)
    if (this.selfId in snap.players && !shown.includes(this.selfId))
      shown[shown.length - 1] = this.selfId
    const slot = (this.scale.width - 32) / Math.max(1, shown.length)
    this.rivals.forEach((text, i) => {
      const id = shown[i]
      const icon = this.rivalIcons[i]
      text.setVisible(id !== undefined)
      icon?.setVisible(id !== undefined)
      if (id === undefined) return
      const alive = snap.players[id]?.alive ?? false
      const name = this.label(id).slice(0, 8)
      const color = this.state.colorOf(id, PALETTE.text)
      text
        .setText(`${name} ${snap.scores[id] ?? 0}${alive ? '' : ' ✕'}`)
        .setColor(hexToCss(color))
        .setAlpha(alive ? 1 : 0.5)
        .setX(16 + slot * (i + 0.5) + 9)
      icon
        ?.setTexture(
          ensureAvatarTexture(
            this,
            this.state.avatarOf(id),
            color,
            1,
            'front',
            alive ? 'idle' : 'ko',
          ),
        )
        .setPosition(Math.round(text.x - text.width / 2 - 2), text.y)
        .setAlpha(alive ? 1 : 0.5)
    })
  }
}
