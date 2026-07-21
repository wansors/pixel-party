import { Injectable, effect, signal } from '@angular/core'
import { Sfx } from '../../../game/Sfx'

const load = (key: string, fallback: number): number => {
  const n = Number(localStorage.getItem(key))
  return Number.isFinite(n) && localStorage.getItem(key) !== null
    ? Math.min(1, Math.max(0, n))
    : fallback
}

// App-wide audio: looping background music (HTMLAudioElement) plus the shared chiptune Sfx instance
// the Phaser scenes and UI play through. Volumes are 0..1 signals persisted in localStorage.
@Injectable({ providedIn: 'root' })
export class AudioService {
  readonly musicVolume = signal(load('pp:vol:music', 0.4))
  readonly sfxVolume = signal(load('pp:vol:sfx', 0.8))
  readonly sfx = new Sfx()

  private music?: HTMLAudioElement
  private retryHooked = false

  constructor() {
    effect(() => {
      const v = this.musicVolume()
      localStorage.setItem('pp:vol:music', String(v))
      if (this.music) this.music.volume = v
    })
    effect(() => {
      const v = this.sfxVolume()
      localStorage.setItem('pp:vol:sfx', String(v))
      this.sfx.volume = v
    })
  }

  // Start (or resume) the background loop. Autoplay policies block play() before any user gesture —
  // e.g. opening an invite link directly — so on rejection retry once on the first pointer press.
  ensureMusic(): void {
    if (!this.music) {
      this.music = new Audio('/audio/background-song.mp3')
      this.music.loop = true
      this.music.volume = this.musicVolume()
    }
    if (!this.music.paused) return
    this.music.play().catch(() => this.retryOnGesture())
  }

  private retryOnGesture(): void {
    if (this.retryHooked) return
    this.retryHooked = true
    window.addEventListener(
      'pointerdown',
      () => {
        this.retryHooked = false
        this.ensureMusic()
      },
      { once: true },
    )
  }
}
