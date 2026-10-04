// In-round chiptune music, synthesized with WebAudio — no audio files, CSP-safe (D32). Four voices like
// an 8-bit console: a square lead, a second square for harmony arpeggios, a triangle bass and a noise
// drum kit. A song is a few compact pattern strings over a chord progression, looped; a lookahead
// scheduler queues notes slightly ahead of time so timing stays tight while the page is busy.

export type ChipMood = 'action' | 'think' | 'tension' | 'results'

// A loop: chords (scale degrees, one per bar) and 16-step patterns per bar. In `lead`/`arp`, a token is
// a scale degree counted from the bar's chord root (0 = root, 2 = third, 4 = fifth, 7 = octave…), `.` a
// rest and `-` holds the previous note; `bass` is the same, an octave down; `drums` uses k (kick),
// s (snare), h (hi-hat), x (kick + hat) and `.`.
export interface ChipSong {
  bpm: number
  root: number // MIDI note of the key's tonic
  minor: boolean
  chords: number[]
  lead: string[] // cycled bar by bar
  arp: string
  bass: string
  drums: string[] // cycled bar by bar
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]

// Six loops, two per busy mood so back-to-back rounds don't repeat the same tune.
export const CHIP_SONGS: Record<ChipMood, ChipSong[]> = {
  action: [
    {
      bpm: 150,
      root: 57, // A minor: i VI III VII
      minor: true,
      chords: [0, 5, 2, 6],
      lead: ['4 . 4 . 7 . 4 . 2 - 4 . 0 - - .', '4 . 4 . 7 . 9 . 7 - 4 . 2 - 4 -'],
      arp: '0 2 4 2 0 2 4 2 0 2 4 2 0 2 4 2',
      bass: '0 . 0 0 . 0 0 . 0 . 0 0 . 0 4 .',
      drums: ['x . h . s . h . x . x . s . h h', 'x . h . s . h . x . h x s . s s'],
    },
    {
      bpm: 162,
      root: 52, // E minor: i iv VI V
      minor: true,
      chords: [0, 3, 5, 4],
      lead: ['0 . 2 . 4 . 7 . 4 . 2 . 4 - - .', '7 . 6 . 4 . 2 . 4 . 2 . 0 - - .'],
      arp: '0 4 7 4 0 4 7 4 0 4 7 4 0 4 7 4',
      bass: '0 0 . 0 0 . 0 . 0 0 . 0 4 . 4 .',
      drums: ['x . h x s . h . x . h x s . h .', 'x . h x s . h . x x h . s s s s'],
    },
  ],
  think: [
    {
      bpm: 100,
      root: 53, // F major: I vi IV V
      minor: false,
      chords: [0, 5, 3, 4],
      lead: ['4 - - . 2 . 4 . 7 - - . 4 - - .', '2 - - . 4 . 2 . 0 - - - . . . .'],
      arp: '0 . 4 . 7 . 4 . 0 . 4 . 7 . 4 .',
      bass: '0 - - . . . 4 . 0 - - . . . 4 .',
      drums: ['k . . . h . . . s . . . h . . .', 'k . . . h . . . s . . . h . h .'],
    },
    {
      bpm: 92,
      root: 48, // C major: ii V I vi
      minor: false,
      chords: [1, 4, 0, 5],
      lead: ['. . 4 . 2 . 0 . 2 - 4 - . . . .', '. . 7 . 6 . 4 . 2 - - - 0 - . .'],
      arp: '0 2 4 7 4 2 0 2 4 7 4 2 0 2 4 2',
      bass: '0 - . . 0 - . . 4 - . . 0 - . .',
      drums: ['k . h . . . h . s . h . . . h .'],
    },
  ],
  tension: [
    {
      bpm: 112,
      root: 50, // D minor: i i VI V — a heartbeat kick and a sparse, uneasy lead
      minor: true,
      chords: [0, 0, 5, 4],
      lead: ['. . . . 0 . . . . . . . 1 . . .', '. . . . 4 . . . 3 . . . 1 - - -'],
      arp: '0 . . . 4 . . . 0 . . . 4 . . .',
      bass: '0 . . 0 . . . . 0 . . 0 . . . .',
      drums: ['k . . k . . . . k . . k . . h .'],
    },
  ],
  results: [
    {
      bpm: 128,
      root: 55, // G major: I V vi IV
      minor: false,
      chords: [0, 4, 5, 3],
      lead: ['4 . 4 . 7 . 4 . 2 . 4 . 7 - - .', '9 . 7 . 4 . 7 . 4 . 2 . 0 - - .'],
      arp: '0 4 7 4 0 4 7 4 0 4 7 4 0 4 7 4',
      bass: '0 . 0 . 4 . 4 . 0 . 0 . 4 . 4 .',
      drums: ['x . h . s . h . x . h . s . h h'],
    },
  ],
}

const LOOKAHEAD_S = 0.15
const SCHEDULE_EVERY_MS = 40
const FADE_S = 0.6

interface Voice {
  wave: OscillatorType
  gain: number
}

const LEAD: Voice = { wave: 'square', gain: 0.07 }
const ARP: Voice = { wave: 'square', gain: 0.035 }
const BASS: Voice = { wave: 'triangle', gain: 0.16 }

// Plays one ChipSong at a time on its own AudioContext, through a master gain the music volume drives.
export class ChipMusic {
  private ctx?: AudioContext
  private master?: GainNode
  private noise?: AudioBuffer
  private timer?: ReturnType<typeof setInterval>
  private song?: ChipSong
  private step = 0
  private nextAt = 0
  private volume = 0.4

  setVolume(v: number): void {
    this.volume = v
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.05)
  }

  // Start `song` from its first bar (fading in), replacing whatever was playing.
  play(song: ChipSong): void {
    if (this.song === song && this.timer) return
    this.stop()
    const ctx = (this.ctx ??= new AudioContext())
    if (ctx.state === 'suspended') void ctx.resume()
    this.master = ctx.createGain()
    this.master.gain.setValueAtTime(0.0001, ctx.currentTime)
    this.master.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, this.level()),
      ctx.currentTime + FADE_S,
    )
    this.master.connect(ctx.destination)
    this.noise ??= whiteNoise(ctx)
    this.song = song
    this.step = 0
    this.nextAt = ctx.currentTime + 0.05
    this.timer = setInterval(() => this.schedule(), SCHEDULE_EVERY_MS)
  }

  // Fade out and stop scheduling.
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.song = undefined
    const { ctx, master } = this
    if (ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime)
      master.gain.setTargetAtTime(0.0001, ctx.currentTime, FADE_S / 4)
      setTimeout(() => master.disconnect(), FADE_S * 1000 + 200)
    }
    this.master = undefined
  }

  private level(): number {
    // Chip voices are dense: keep them under the mp3 theme at the same slider position.
    return this.volume * 0.55
  }

  private schedule(): void {
    const { ctx, song } = this
    if (!ctx || !song) return
    const stepS = 60 / song.bpm / 4
    while (this.nextAt < ctx.currentTime + LOOKAHEAD_S) {
      this.playStep(song, this.step, this.nextAt, stepS)
      this.step++
      this.nextAt += stepS
    }
  }

  private playStep(song: ChipSong, step: number, at: number, stepS: number): void {
    const bar = Math.floor(step / 16)
    const i = step % 16
    const chord = song.chords[bar % song.chords.length] ?? 0
    const lead = song.lead[bar % song.lead.length] ?? ''
    const drums = song.drums[bar % song.drums.length] ?? ''
    this.voiceNote(LEAD, song, chord, lead, i, at, stepS, 12)
    this.voiceNote(ARP, song, chord, song.arp, i, at, stepS, 0)
    this.voiceNote(BASS, song, chord, song.bass, i, at, stepS, -12)
    this.drum(tokens(drums)[i] ?? '.', at)
  }

  // A note starts on a degree token and lasts through the `-` tokens that follow it.
  private voiceNote(
    voice: Voice,
    song: ChipSong,
    chord: number,
    pattern: string,
    i: number,
    at: number,
    stepS: number,
    octave: number,
  ): void {
    const toks = tokens(pattern)
    const tok = toks[i]
    if (!tok || tok === '.' || tok === '-') return
    let len = 1
    while (toks[i + len] === '-') len++
    const midi = song.root + octave + degree(song, chord + Number(tok))
    this.tone(voice, 440 * 2 ** ((midi - 69) / 12), at, len * stepS * 0.92)
  }

  private tone(voice: Voice, freq: number, at: number, dur: number): void {
    const { ctx, master } = this
    if (!ctx || !master) return
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = voice.wave
    osc.frequency.setValueAtTime(freq, at)
    env.gain.setValueAtTime(voice.gain, at)
    env.gain.exponentialRampToValueAtTime(voice.gain * 0.5, at + Math.min(dur, 0.12))
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    osc.connect(env).connect(master)
    osc.start(at)
    osc.stop(at + dur + 0.02)
  }

  private drum(tok: string, at: number): void {
    if (tok === 'k' || tok === 'x') this.kick(at)
    if (tok === 's') this.hit(at, 'bandpass', 1800, 0.14, 0.12)
    if (tok === 'h' || tok === 'x') this.hit(at, 'highpass', 7000, 0.035, 0.05)
  }

  private kick(at: number): void {
    const { ctx, master } = this
    if (!ctx || !master) return
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.frequency.setValueAtTime(140, at)
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.12)
    env.gain.setValueAtTime(0.32, at)
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.14)
    osc.connect(env).connect(master)
    osc.start(at)
    osc.stop(at + 0.16)
  }

  private hit(at: number, type: BiquadFilterType, freq: number, dur: number, gain: number): void {
    const { ctx, master, noise } = this
    if (!ctx || !master || !noise) return
    const src = ctx.createBufferSource()
    src.buffer = noise
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = freq
    const env = ctx.createGain()
    env.gain.setValueAtTime(gain, at)
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    src.connect(filter).connect(env).connect(master)
    src.start(at)
    src.stop(at + dur + 0.02)
  }
}

// Semitones above the tonic for a scale degree (any integer; wraps into octaves).
function degree(song: ChipSong, d: number): number {
  const scale = song.minor ? MINOR : MAJOR
  const oct = Math.floor(d / 7)
  return (scale[((d % 7) + 7) % 7] as number) + 12 * oct
}

const tokenCache = new Map<string, string[]>()
function tokens(pattern: string): string[] {
  let t = tokenCache.get(pattern)
  if (!t) {
    t = pattern.trim().split(/\s+/)
    tokenCache.set(pattern, t)
  }
  return t
}

function whiteNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}
