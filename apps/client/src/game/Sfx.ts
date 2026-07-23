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

  // Balloon burst: fast downward sweep.
  pop(): void {
    this.tone(400, 180, { slideTo: 50, gain: 0.35 })
  }

  // Simon pad tone: one distinct pitch per colour pad (played on tap and on sequence playback), for
  // the classic Simon feel. Ascending pentatonic set so any pad order still sounds musical.
  pad(index: number): void {
    const freq = Sfx.PAD_TONES[index % Sfx.PAD_TONES.length] ?? 440
    this.tone(freq, 260, { gain: 0.3 })
  }

  private static readonly PAD_TONES = [261.63, 329.63, 392.0, 523.25] // C4, E4, G4, C5
}
