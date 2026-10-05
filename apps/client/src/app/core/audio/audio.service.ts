import { effect, Injectable, signal } from '@angular/core'
import type { MiniGameId } from '@pp/shared'
import { CHIP_SONGS, ChipMusic } from '../../../game/chipMusic'
import { roundMusic } from '../../../game/musicMoods'
import { Sfx } from '../../../game/Sfx'
import { appUrl } from '../net/app-url'

const THEME_FADE_MS = 600

const load = (key: string, fallback: number): number => {
  const n = Number(localStorage.getItem(key))
  return Number.isFinite(n) && localStorage.getItem(key) !== null
    ? Math.min(1, Math.max(0, n))
    : fallback
}

// App-wide audio and the party's music director (D32). The theme song (an mp3, HTMLAudioElement) plays
// on the join screen, in the lobby and on the final podium, resuming where it left off; rounds and
// round results play synthesized chiptune loops picked by the game's mood (action / think / tension,
// rotating between songs so back-to-back rounds differ), and games whose own sound is the game play
// none. Plus the shared chiptune Sfx instance the Phaser scenes and UI play through. Volumes are 0..1
// signals persisted in localStorage.
@Injectable({ providedIn: 'root' })
export class AudioService {
  readonly musicVolume = signal(load('pp:vol:music', 0.4))
  readonly sfxVolume = signal(load('pp:vol:sfx', 0.8))
  readonly sfx = new Sfx()

  readonly chip = new ChipMusic()

  private music?: HTMLAudioElement
  private retryHooked = false
  // Whether the theme should be audible (false while a round or results own the music).
  private themeOn = true
  private themeFade?: ReturnType<typeof setInterval>

  constructor() {
    effect(() => {
      const v = this.musicVolume()
      localStorage.setItem('pp:vol:music', String(v))
      if (this.music && this.themeOn && !this.themeFade) this.music.volume = v
      this.chip.setVolume(v)
    })
    effect(() => {
      const v = this.sfxVolume()
      localStorage.setItem('pp:vol:sfx', String(v))
      this.sfx.volume = v
    })
  }

  // Start (or resume) the theme loop. Autoplay policies block play() before any user gesture — e.g.
  // opening an invite link directly — so on rejection retry once on the first pointer press.
  ensureMusic(): void {
    if (!this.music) {
      this.music = new Audio(appUrl('audio/background-song.mp3'))
      this.music.loop = true
      this.music.volume = this.musicVolume()
    }
    if (!this.themeOn || !this.music.paused) return
    this.music.play().catch(() => this.retryOnGesture())
  }

  // Lobby, join screen, final podium: the theme song, faded back in where it paused.
  playTheme(): void {
    this.chip.stop()
    if (this.themeOn) return
    this.themeOn = true
    this.ensureMusic()
    this.fadeTheme(this.musicVolume())
  }

  // A round: the game's chiptune mood (a different song of that mood each round), or silence.
  playRound(id: MiniGameId, round: number): void {
    this.muteTheme()
    const mood = roundMusic(id)
    if (mood === 'none') {
      this.chip.stop()
      return
    }
    const songs = CHIP_SONGS[mood]
    this.chip.play(songs[round % songs.length] ?? (songs[0] as (typeof songs)[number]))
  }

  // Round results and standings.
  playResults(): void {
    this.muteTheme()
    this.chip.play(CHIP_SONGS.results[0] as (typeof CHIP_SONGS.results)[number])
  }

  private muteTheme(): void {
    if (!this.themeOn) return
    this.themeOn = false
    this.fadeTheme(0)
  }

  // Ramp the theme's volume; pausing at 0 keeps its position for the next playTheme().
  private fadeTheme(to: number): void {
    const audio = this.music
    if (!audio) return
    if (this.themeFade) clearInterval(this.themeFade)
    const from = audio.volume
    const started = performance.now()
    this.themeFade = setInterval(() => {
      const k = Math.min(1, (performance.now() - started) / THEME_FADE_MS)
      audio.volume = from + (to - from) * k
      if (k < 1) return
      clearInterval(this.themeFade)
      this.themeFade = undefined
      if (to === 0) audio.pause()
    }, 30)
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
