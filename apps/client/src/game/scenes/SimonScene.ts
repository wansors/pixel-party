import type { ClientMsg, SimonSnapshot } from '@pp/shared'
import Phaser from 'phaser'
import type { RoundState } from '../RoundState'
import type { Sfx } from '../Sfx'
import type { Translate } from '../i18n'

const PAD_COLORS = [0xe63946, 0x3a7bd5, 0x2a9d3f, 0xf4c20d]
const PLAY_ON_MS = 420
const PLAY_GAP_MS = 180
// A repeated pad (e.g. seq = [1, 1, 2]) needs a longer, clearer gap than a change of pad — with the
// normal gap the second flash of the same color barely reads as a separate tap.
const PLAY_REPEAT_GAP_MS = 420

interface PlaySlot {
  pad: number
  start: number
  end: number
}

// Precomputes each pad's on-window along the playback timeline, widening the gap before a slot whose
// pad repeats the previous one.
function buildPlaySlots(seq: number[]): PlaySlot[] {
  const slots: PlaySlot[] = []
  let t = 0
  seq.forEach((pad, i) => {
    if (i > 0) t += pad === seq[i - 1] ? PLAY_REPEAT_GAP_MS : PLAY_GAP_MS
    slots.push({ pad, start: t, end: t + PLAY_ON_MS })
    t += PLAY_ON_MS
  })
  return slots
}

// Simon (sequence memory) canvas. When the player's sequence grows it plays the pads back (input
// locked), then lets the player repeat them. Scene key === mini-game id.
export class SimonScene extends Phaser.Scene {
  private info?: Phaser.GameObjects.Text
  private timer?: Phaser.GameObjects.Text
  private status?: Phaser.GameObjects.Text
  private pads: Phaser.GameObjects.Rectangle[] = []
  // Playback state.
  private shownLen = -1
  private playing = false
  private playStart = 0
  private lastTapAt = 0
  private wasAlive = true
  // Last sequence slot whose tone was played during playback, so each pad sounds once as it lights.
  private lastPlaySlot = -1
  private playSlots: PlaySlot[] = []

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    private readonly state: RoundState,
    private readonly sfx: Sfx,
    private readonly t: Translate,
  ) {
    super('simon')
  }

  create(): void {
    this.pads = []
    this.shownLen = -1
    this.playing = false
    this.wasAlive = true
    this.playSlots = []
    const { width, height } = this.scale
    const cx = width / 2
    this.info = this.add
      .text(cx, height * 0.08, '', { fontFamily: 'monospace', fontSize: '20px', color: '#9fb3c8' })
      .setOrigin(0.5)
    this.timer = this.add
      .text(cx, height * 0.14, '', { fontFamily: 'monospace', fontSize: '22px', color: '#06d6a0' })
      .setOrigin(0.5)
    this.status = this.add
      .text(cx, height * 0.2, '', { fontFamily: 'monospace', fontSize: '22px', color: '#e6edf3' })
      .setOrigin(0.5)

    // Four pads in a 2x2 block.
    const area = Math.min(width * 0.8, height * 0.55)
    const gap = area * 0.06
    const size = (area - gap) / 2
    const startX = cx - size - gap / 2 + size / 2
    const startY = height * 0.6 - size - gap / 2 + size / 2
    for (let i = 0; i < 4; i++) {
      const col = i % 2
      const row = Math.floor(i / 2)
      const x = startX + col * (size + gap)
      const y = startY + row * (size + gap)
      const pad = this.add
        .rectangle(x, y, size, size, PAD_COLORS[i])
        .setStrokeStyle(4, 0x11181f)
        .setAlpha(0.4)
        .setInteractive({ useHandCursor: true })
      pad.on('pointerdown', () => this.tap(i))
      this.pads.push(pad)
    }
  }

  private tap(pad: number): void {
    const snap = this.state.state as SimonSnapshot | null
    const me = snap?.players[this.state.selfId ?? '']
    if (!snap || !me || !me.alive || this.playing) return
    if (this.time.now - this.lastTapAt < 120) return // debounce double taps
    this.lastTapAt = this.time.now
    this.flash(pad, 200)
    this.sfx.pad(pad)
    this.send({ type: 'MINIGAME_INPUT', input: { kind: 'pad', pad } })
  }

  private flash(pad: number, ms: number): void {
    const rect = this.pads[pad]
    if (!rect) return
    rect.setAlpha(1)
    this.time.delayedCall(ms, () => rect.setAlpha(this.playing ? 0.4 : 0.4))
  }

  override update(): void {
    const snap = this.state.state as SimonSnapshot | null
    if (!snap) return
    const me = snap.players[this.state.selfId ?? '']
    this.timer?.setText(`${Math.ceil(snap.remainingMs / 1000)}s`)
    this.info?.setText(
      this.t('game.common.level', { n: snap.scores[this.state.selfId ?? ''] ?? 0 }),
    )
    if (!me) return

    // A longer sequence means the player advanced a level → play the new sequence back.
    if (me.seq.length !== this.shownLen && me.alive) {
      this.shownLen = me.seq.length
      this.playing = true
      this.playStart = this.time.now
      this.lastPlaySlot = -1
      this.playSlots = buildPlaySlots(me.seq)
    }

    if (!me.alive) {
      this.status?.setText(this.t('game.simon.out')).setColor('#e63946')
      if (this.wasAlive) {
        this.sfx.wrong()
        this.wasAlive = false
      }
      for (const p of this.pads) p.setAlpha(0.4)
      return
    }

    if (this.playing) {
      const elapsed = this.time.now - this.playStart
      const idx = this.playSlots.findIndex((s) => elapsed >= s.start && elapsed < s.end)
      const active = idx >= 0 ? this.playSlots[idx] : undefined
      this.status?.setText(this.t('game.simon.watch')).setColor('#ffd166')
      this.pads.forEach((p, i) => p.setAlpha(active?.pad === i ? 1 : 0.4))
      // Sound each pad once as it lights up during playback.
      if (active && idx !== this.lastPlaySlot) {
        this.lastPlaySlot = idx
        this.sfx.pad(active.pad)
      }
      const totalMs = this.playSlots.at(-1)?.end ?? 0
      if (elapsed >= totalMs) this.playing = false
    } else {
      this.status?.setText(this.t('game.simon.repeat')).setColor('#06d6a0')
    }
  }
}
