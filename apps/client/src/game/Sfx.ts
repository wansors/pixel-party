// Chiptune sound effects synthesized with WebAudio (square/triangle/sawtooth oscillators) — no audio
// binaries, CSP-safe, and one shared instance for Angular chrome and every Phaser scene. All effects
// fire from user gestures (taps/clicks), so the lazily created AudioContext is never blocked.
export class Sfx {
  // 0..1 master volume, applied at trigger time (owned by the audio settings UI).
  volume = 0.8
  private ctx?: AudioContext

  private tone(
    freq: number,
    durMs: number,
    opts: { type?: OscillatorType; slideTo?: number; delayMs?: number; gain?: number } = {},
  ): void {
    if (this.volume <= 0) return
    this.ctx ??= new AudioContext()
    const ctx = this.ctx
    if (ctx.state === 'suspended') void ctx.resume()
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

  // Simon pad tone: one distinct pitch per colour pad (played on tap and on sequence playback), for
  // the classic Simon feel. Ascending pentatonic set so any pad order still sounds musical.
  pad(index: number): void {
    const freq = Sfx.PAD_TONES[index % Sfx.PAD_TONES.length] ?? 440
    this.tone(freq, 260, { gain: 0.3 })
  }

  private static readonly PAD_TONES = [261.63, 329.63, 392.0, 523.25] // C4, E4, G4, C5
}
