// Chiptune sound effects synthesized with WebAudio — square/triangle/sawtooth oscillators plus a
// filtered noise channel (the NES-style "noise" voice for hits, crashes, splashes and crowds). No audio
// binaries, CSP-safe, and one shared instance for Angular chrome and every Phaser scene. All effects
// fire from user gestures (taps/clicks), so the lazily created AudioContext is never blocked.
export class Sfx {
  // 0..1 master volume, applied at trigger time (owned by the audio settings UI).
  volume = 0.8
  private ctx?: AudioContext
  private noiseBuffer?: AudioBuffer

  private context(): AudioContext {
    this.ctx ??= new AudioContext()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  // A burst of white noise through a filter whose cutoff can sweep — the percussive voice.
  private noise(
    durMs: number,
    opts: {
      filter?: BiquadFilterType
      freq?: number
      freqTo?: number
      q?: number
      gain?: number
      delayMs?: number
      attackMs?: number
    } = {},
  ): void {
    if (this.volume <= 0) return
    const ctx = this.context()
    this.noiseBuffer ??= Sfx.whiteNoise(ctx)
    const t0 = ctx.currentTime + (opts.delayMs ?? 0) / 1000
    const dur = durMs / 1000
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    const filter = ctx.createBiquadFilter()
    filter.type = opts.filter ?? 'lowpass'
    filter.frequency.setValueAtTime(opts.freq ?? 2000, t0)
    if (opts.freqTo) filter.frequency.exponentialRampToValueAtTime(opts.freqTo, t0 + dur)
    filter.Q.value = opts.q ?? 0.8
    const gain = ctx.createGain()
    const peak = (opts.gain ?? 0.3) * this.volume
    const attack = (opts.attackMs ?? 2) / 1000
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + Math.max(attack + 0.01, dur))
    src.connect(filter).connect(gain).connect(ctx.destination)
    src.start(t0)
    src.stop(t0 + dur + 0.02)
  }

  private static whiteNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    return buffer
  }

  private tone(
    freq: number,
    durMs: number,
    opts: { type?: OscillatorType; slideTo?: number; delayMs?: number; gain?: number } = {},
  ): void {
    if (this.volume <= 0) return
    const ctx = this.context()
    const t0 = ctx.currentTime + (opts.delayMs ?? 0) / 1000
    const dur = durMs / 1000
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = opts.type ?? 'square'
    osc.frequency.setValueAtTime(freq, t0)
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur)
    const peak = (opts.gain ?? 0.25) * this.volume
    gain.gain.setValueAtTime(peak, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + dur)
  }

  // Plays `sound` at a fraction of the volume — for other players' moments, so a 12-player room
  // stays readable: `sfx.quiet(() => sfx.pop())`.
  quiet(sound: () => void, level = 0.4): void {
    const full = this.volume
    this.volume = full * level
    try {
      sound()
    } finally {
      this.volume = full
    }
  }

  // UI/game tap.
  click(): void {
    this.tone(900, 35)
  }

  // Countdown tick and the final GO.
  tick(): void {
    this.tone(600, 50)
  }

  go(): void {
    this.tone(880, 90)
    this.tone(1320, 140, { delayMs: 90 })
  }

  correct(): void {
    this.tone(660, 80)
    this.tone(990, 140, { delayMs: 80 })
  }

  wrong(): void {
    this.tone(220, 250, { type: 'sawtooth', slideTo: 110 })
  }

  // Classic coin blip (cash-out, points banked).
  coin(): void {
    this.tone(988, 70)
    this.tone(1319, 200, { delayMs: 70 })
  }

  // Short rising arpeggio for winning a round.
  win(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5] // C5 E5 G5 C6
    notes.forEach((f, i) => this.tone(f, i === notes.length - 1 ? 260 : 90, { delayMs: i * 90 }))
  }

  // Session-end fanfare: a triumphant two-voice phrase for the final podium.
  fanfare(): void {
    const lead: [number, number, number][] = [
      [392.0, 0, 120],
      [392.0, 130, 120],
      [392.0, 260, 120],
      [523.25, 390, 420],
      [466.16, 830, 160],
      [523.25, 1000, 520],
    ]
    for (const [f, at, dur] of lead) this.tone(f, dur, { delayMs: at, gain: 0.22 })
    for (const [f, at, dur] of lead) {
      this.tone(f / 2, dur, { delayMs: at, type: 'triangle', gain: 0.18 })
    }
  }

  // Balloon burst: fast downward sweep.
  pop(): void {
    this.tone(400, 180, { slideTo: 50, gain: 0.35 })
  }

  // Elimination sting (a player is out): a harsh zap, then a sad three-note fall — loud enough to
  // read as the round's big dramatic beat, short enough to repeat when several drop at once.
  eliminated(): void {
    this.tone(1400, 120, { type: 'sawtooth', slideTo: 180, gain: 0.22 })
    const fall = [392.0, 349.23, 293.66] // G4 F4 D4
    fall.forEach((f, i) =>
      this.tone(f, i === fall.length - 1 ? 320 : 110, { type: 'triangle', delayMs: 140 + i * 120 }),
    )
  }

  // Distant thunder for a lightning flash: a low, rumbling downward sweep.
  thunder(): void {
    this.tone(140, 520, { type: 'sawtooth', slideTo: 38, gain: 0.16 })
    this.tone(90, 640, { type: 'triangle', slideTo: 30, delayMs: 60, gain: 0.2 })
  }

  // Freeze Doll: one note of the doll's chant (a nursery-rhyme phrase; its spacing is the tempo tell),
  // the whirr of her head turning, and the laser's sweep.
  chant(step: number): void {
    const freq = Sfx.CHANT[step % Sfx.CHANT.length] ?? 392
    this.tone(freq, 140, { type: 'triangle', gain: 0.3 })
  }

  turn(): void {
    this.tone(260, 160, { slideTo: 820, gain: 0.18 })
  }

  laser(): void {
    this.tone(1600, 380, { type: 'sawtooth', slideTo: 700, gain: 0.12 })
  }

  private static readonly CHANT = [392.0, 329.63, 392.0, 329.63, 440.0, 392.0, 329.63, 261.63] // G E G E A G E C

  // A bomb going off: a noise blast that darkens as it fades, over a low, crunchy downward rumble.
  boom(): void {
    this.noise(520, { freq: 3000, freqTo: 120, gain: 0.4 })
    this.tone(160, 320, { type: 'sawtooth', slideTo: 35, gain: 0.22 })
    this.tone(90, 420, { type: 'square', slideTo: 30, delayMs: 30, gain: 0.14 })
  }

  // --- Impacts & motion (noise voice) --------------------------------------------------------------

  // A punch, kick, shove or bump landing: a short noise smack on a low thump. `strength` 0.5..1.5.
  hit(strength = 1): void {
    this.noise(70 + 40 * strength, { freq: 2600, freqTo: 400, gain: 0.25 * strength })
    this.tone(150, 90, { type: 'square', slideTo: 60, gain: 0.16 * strength })
  }

  // Something big colliding (cars, a falling block): a longer, rougher crunch.
  crash(): void {
    this.noise(300, { freq: 1800, freqTo: 200, q: 1.5, gain: 0.32 })
    this.tone(120, 220, { type: 'sawtooth', slideTo: 45, gain: 0.14 })
  }

  // A ship or rock blown apart: a crackling burst that rolls off.
  explosion(): void {
    this.noise(420, { filter: 'bandpass', freq: 1400, freqTo: 90, q: 0.6, gain: 0.38 })
    this.tone(220, 260, { type: 'square', slideTo: 40, gain: 0.12 })
  }

  // A shot fired — laser, harpoon, bubble, javelin release: the classic falling "pew".
  shoot(): void {
    this.tone(1250, 110, { slideTo: 280, gain: 0.14 })
  }

  // Taking off (a jump, a hop): a quick upward chirp.
  jump(): void {
    this.tone(330, 120, { slideTo: 880, gain: 0.16 })
  }

  // Landing on your feet / a piece settling: a short soft thud.
  land(): void {
    this.noise(70, { freq: 600, freqTo: 120, gain: 0.25 })
    this.tone(110, 70, { type: 'triangle', slideTo: 60, gain: 0.2 })
  }

  // A rush of air — a dash, a throw, a rope swing.
  whoosh(): void {
    this.noise(260, {
      filter: 'bandpass',
      freq: 600,
      freqTo: 2400,
      q: 1.2,
      gain: 0.18,
      attackMs: 60,
    })
  }

  // Into the water (off the ice, through the glass, off the edge).
  splash(): void {
    this.noise(480, { filter: 'bandpass', freq: 2200, freqTo: 300, q: 0.9, gain: 0.3 })
    this.tone(520, 160, { type: 'triangle', slideTo: 180, delayMs: 30, gain: 0.12 })
  }

  // A footstep / stride; alternate `side` for left and right so a run reads as a rhythm.
  step(side = 0): void {
    this.noise(40, { freq: side % 2 ? 900 : 700, freqTo: 200, gain: 0.16 })
  }

  // Something clicking into place (a Tetris piece locking, a cell filled): a tight low tick.
  lock(): void {
    this.tone(196, 55, { type: 'square', gain: 0.16 })
    this.noise(35, { freq: 1500, gain: 0.1 })
  }

  // Lines cleared / a combo paid out: a bright arpeggio, longer for more (n = 1..4).
  lineClear(n = 1): void {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]
    for (let i = 0; i <= Math.min(4, Math.max(1, n)); i++) {
      this.tone(notes[i] as number, 70, { delayMs: i * 55, gain: 0.18 })
    }
  }

  // A boost or power-up kicking in: a fast rising sweep with a sparkle.
  powerUp(): void {
    this.tone(330, 220, { slideTo: 1320, gain: 0.14 })
    this.tone(1760, 90, { type: 'triangle', delayMs: 180, gain: 0.12 })
  }

  // Losing a life / taking damage that doesn't knock you out: a short buzzy drop.
  hurt(): void {
    this.tone(520, 160, { type: 'sawtooth', slideTo: 160, gain: 0.16 })
    this.noise(90, { freq: 1200, gain: 0.12 })
  }

  // A crowd roaring (a finish line, a podium): swelling filtered noise with a cheer on top.
  cheer(): void {
    this.noise(1200, {
      filter: 'bandpass',
      freq: 900,
      freqTo: 1400,
      q: 0.5,
      gain: 0.2,
      attackMs: 250,
    })
    this.noise(900, {
      filter: 'bandpass',
      freq: 2400,
      q: 2,
      gain: 0.08,
      delayMs: 150,
      attackMs: 200,
    })
  }

  // A lit fuse fizzing (a bomb being dropped or passed).
  fuse(): void {
    this.noise(200, { filter: 'highpass', freq: 5000, gain: 0.1 })
  }

  // A card or tile flipping over.
  flip(): void {
    this.noise(45, { filter: 'highpass', freq: 3000, gain: 0.14 })
    this.tone(1200, 30, { type: 'triangle', delayMs: 20, gain: 0.08 })
  }

  // A ball or body bouncing off a paddle, wall or rope; `pitch` 0..1 shifts it up.
  bounce(pitch = 0.5): void {
    this.tone(330 + pitch * 440, 70, { type: 'square', gain: 0.16 })
  }

  // Glass giving way: a bright crack and a tinkle of shards.
  shatter(): void {
    this.noise(260, { filter: 'highpass', freq: 3500, freqTo: 1800, gain: 0.26 })
    const shards = [2637, 3136, 2349, 3520]
    shards.forEach((f, i) =>
      this.tone(f, 60, { type: 'triangle', delayMs: 40 + i * 45, gain: 0.07 }),
    )
  }

  // A gunshot — the starting pistol, a six-shooter: a sharp crack with a short boom under it.
  gunshot(): void {
    this.noise(120, { freq: 6000, freqTo: 500, gain: 0.42 })
    this.tone(180, 90, { type: 'square', slideTo: 60, gain: 0.16 })
  }

  // An alarm wail (a boss incoming): two rising sweeps.
  siren(): void {
    this.tone(500, 320, { type: 'sawtooth', slideTo: 900, gain: 0.1 })
    this.tone(500, 320, { type: 'sawtooth', slideTo: 900, delayMs: 360, gain: 0.1 })
  }

  // Ice or a surface starting to give: a dry little crackle.
  crack(): void {
    this.noise(30, { filter: 'highpass', freq: 2500, gain: 0.16 })
    this.noise(25, { filter: 'highpass', freq: 3200, delayMs: 45, gain: 0.12 })
  }

  // The last seconds of a round running out: a higher, more urgent tick than `tick`.
  urgent(): void {
    this.tone(1046.5, 60, { gain: 0.18 })
  }

  // Simon pad tone: one distinct pitch per colour pad (played on tap and on sequence playback), for
  // the classic Simon feel. Ascending pentatonic set so any pad order still sounds musical.
  pad(index: number): void {
    const freq = Sfx.PAD_TONES[index % Sfx.PAD_TONES.length] ?? 440
    this.tone(freq, 260, { gain: 0.3 })
  }

  private static readonly PAD_TONES = [261.63, 329.63, 392.0, 523.25] // C4, E4, G4, C5
}
