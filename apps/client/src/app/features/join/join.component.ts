import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ActivatedRoute, Router } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { AVATARS, type AvatarId, MINIGAMES, PLAYER_COLORS } from '@pp/shared'
import { firstValueFrom } from 'rxjs'
import { environment } from '../../../environments/environment'
import { AudioService } from '../../core/audio/audio.service'
import { AudioControlsComponent } from '../../shared/audio-controls.component'
import { LanguageToggleComponent } from '../../shared/language-toggle.component'
import { PixelAvatarComponent } from '../../shared/pixel-avatar.component'

// Entry point: pick a name + pixel avatar + color, then create a fresh room or enter an existing code.
// Identity (name/color/avatar) travels to the room via query params.
@Component({
  selector: 'app-join',
  imports: [
    FormsModule,
    PixelAvatarComponent,
    AudioControlsComponent,
    LanguageToggleComponent,
    TranslocoPipe,
  ],
  template: `
    <main class="join">
      <div class="sound"><app-audio-controls /></div>
      <h1 class="logo" aria-label="Pixel Party">
        @for (ch of logo; track $index) {
          <span [style.color]="ch.color" [style.animationDelay.ms]="$index * 90">{{ ch.char }}</span>
        }
      </h1>
      <p class="tagline">{{ 'join.tagline' | transloco: { n: gameCount } }}</p>
      <div class="arcade-window cabinet">
        <div class="arcade-titlebar">{{ 'join.title' | transloco }}</div>
        <div class="body">
          <div class="me">
            <app-pixel-avatar [avatar]="avatar()" [color]="color()" [size]="64" [blinks]="true" />
          </div>

          <input
            class="name"
            [(ngModel)]="name"
            [placeholder]="'join.yourName' | transloco"
            maxlength="16"
            (focus)="onNameFocus()"
          />

          <div class="picker">
            <span class="label">{{ 'join.avatar' | transloco }}</span>
            <div class="row">
              @for (a of avatars; track a) {
                <button
                  type="button"
                  class="swatch"
                  [class.sel]="a === avatar()"
                  (click)="avatar.set(a)"
                >
                  <app-pixel-avatar [avatar]="a" [color]="color()" [size]="32" />
                </button>
              }
            </div>
          </div>

          <div class="picker">
            <span class="label">{{ 'join.color' | transloco }}</span>
            <div class="row">
              @for (c of colors; track c) {
                <button
                  type="button"
                  class="chip"
                  [class.sel]="c === color()"
                  [style.background]="c"
                  (click)="color.set(c)"
                  [attr.aria-label]="c"
                ></button>
              }
            </div>
          </div>

          <button type="button" class="arcade-btn primary" (click)="createRoom()">
            ▶ {{ 'join.createRoom' | transloco }}
          </button>
          <span class="or">{{ 'join.or' | transloco }}</span>
          <div class="enter">
            <input [(ngModel)]="code" [placeholder]="'join.roomCode' | transloco" maxlength="6" />
            <button type="button" class="arcade-btn" (click)="joinRoom()">
              {{ 'join.join' | transloco }}
            </button>
          </div>

          @if (message()) {
            <p class="msg">{{ message() }}</p>
          }
        </div>
      </div>
      <footer><app-language-toggle /></footer>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .join { display: grid; justify-content: center; align-content: safe center; height: 100dvh;
      overflow-y: auto; padding: 3.5rem 1rem; gap: 0.75rem; }
    .logo { margin: 0; text-align: center; font-size: var(--fs-xl); font-weight: normal;
      letter-spacing: 0.08em; line-height: 1.2; text-shadow: 0 5px 0 rgba(0,0,0,0.45); }
    .logo span { display: inline-block; animation: hop 2.4s steps(2, end) infinite; }
    @keyframes hop { 0%, 90%, 100% { transform: none; } 95% { transform: translateY(-6px); } }
    .tagline { margin: 0 0 0.5rem; text-align: center; color: var(--c-dim); font-size: var(--fs-xs);
      letter-spacing: 0.08em; line-height: 1.6; text-transform: uppercase; text-wrap: balance; }
    .or { text-align: center; color: var(--c-dim); font-size: var(--fs-xs); text-transform: uppercase; }
    @media (prefers-reduced-motion: reduce) { .logo span { animation: none; } }
    @media (max-width: 420px) { .logo { font-size: var(--fs-lg); } }
    .sound { position: fixed; top: 0.75rem; right: 0.75rem; z-index: 10; }
    footer { position: fixed; bottom: 0.75rem; left: 0; right: 0; display: flex;
      justify-content: center; z-index: 10; }
    .cabinet { width: min(calc(100vw - 2rem), 380px); }
    .body > * { min-width: 0; }
    .body { display: grid; gap: 0.9rem; padding: 1.1rem; }
    .me { display: grid; place-content: center; }
    .me app-pixel-avatar { filter: drop-shadow(0 4px 0 rgba(0,0,0,0.35)); }
    input { text-align: center; padding: 0.6rem; font-family: var(--font-pixel); font-size: var(--fs-sm);
      background: var(--c-bg); color: var(--c-text); border: 3px solid var(--c-frame);
      border-radius: 2px; }
    input::placeholder { color: var(--c-dim); }
    .picker { display: grid; gap: 0.4rem; }
    .label { font-size: var(--fs-xs); color: var(--c-dim); text-transform: uppercase; letter-spacing: 0.1em; }
    .row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .swatch { padding: 0.25rem; background: var(--c-bg); border: 3px solid var(--c-frame);
      border-radius: 2px; cursor: pointer; line-height: 0; }
    .swatch.sel { border-color: var(--c-amber); }
    .chip { width: 1.7rem; height: 1.7rem; border: 3px solid var(--c-frame); border-radius: 2px;
      cursor: pointer; }
    .chip.sel { border-color: var(--c-text); transform: scale(1.1); }
    .enter { display: flex; gap: 0.5rem; }
    .enter input { flex: 1; min-width: 0; text-transform: uppercase; }
    .msg { margin: 0; color: var(--c-red); font-size: var(--fs-sm); text-align: center; }
  `,
})
export class JoinComponent {
  private readonly http = inject(HttpClient)
  private readonly router = inject(Router)
  private readonly transloco = inject(TranslocoService)

  private readonly route = inject(ActivatedRoute)

  constructor() {
    inject(AudioService).ensureMusic()
    // Bounced back here by the host removing our seat: explain why we landed on the entry screen.
    if (this.route.snapshot.queryParamMap.get('kicked'))
      this.message.set(this.transloco.translate('join.kicked'))
  }

  readonly avatars = AVATARS
  readonly colors = PLAYER_COLORS
  readonly gameCount = MINIGAMES.length
  // "PIXEL PARTY" with each letter in a player color (spaces stay uncolored).
  readonly logo = [...'PIXEL PARTY'].map((char, i) => ({
    // A plain space inside an inline-block span collapses to nothing — keep the gap with an nbsp.
    char: char === ' ' ? '\u00a0' : char,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length] ?? '#ffcf4b',
  }))
  private readonly nicknameAdjectives = [
    'Pixel',
    'Turbo',
    'Retro',
    'Neon',
    'Rapid',
    'Mega',
    'Super',
    'Cosmic',
  ]

  // Prefilled with a fun random name so a player can jump straight to "Crear sala"/"Entrar"; the first
  // click into the field clears it to make room for typing a real one (see onNameFocus()).
  name = this.randomName()
  private nameIsDefault = true
  // Invite links (/?code=XXXX) land here with the room pre-filled; the player still picks identity.
  code = this.route.snapshot.queryParamMap.get('code')?.toUpperCase() ?? ''
  readonly avatar = signal<AvatarId>(AVATARS[0])
  readonly color = signal<string>(PLAYER_COLORS[0])
  readonly message = signal('')

  private randomName(): string {
    const adjective =
      this.nicknameAdjectives[Math.floor(Math.random() * this.nicknameAdjectives.length)]
    const noun = AVATARS[Math.floor(Math.random() * AVATARS.length)] as string
    const suffix = Math.floor(Math.random() * 90 + 10)
    return `${adjective}${noun.charAt(0).toUpperCase()}${noun.slice(1)}${suffix}`
  }

  onNameFocus(): void {
    if (!this.nameIsDefault) return
    this.name = ''
    this.nameIsDefault = false
  }

  async createRoom(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ code: string }>(`${environment.apiUrl}/api/rooms`, {}),
      )
      this.enter(res.code)
    } catch {
      this.message.set(this.transloco.translate('join.cantReach'))
    }
  }

  async joinRoom(): Promise<void> {
    const code = this.code.trim().toUpperCase()
    if (!code) return
    try {
      const res = await firstValueFrom(
        this.http.get<{ exists: boolean }>(`${environment.apiUrl}/api/rooms/${code}`),
      )
      if (!res.exists) {
        this.message.set(this.transloco.translate('join.roomNotFound', { code }))
        return
      }
      this.enter(code)
    } catch {
      this.message.set(this.transloco.translate('join.cantReach'))
    }
  }

  private enter(code: string): void {
    const name = this.name.trim()
    this.router.navigate(['/room', code], {
      queryParams: { avatar: this.avatar(), color: this.color(), ...(name ? { name } : {}) },
    })
  }
}
