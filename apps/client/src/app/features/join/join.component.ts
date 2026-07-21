import { HttpClient } from '@angular/common/http'
import { Component, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ActivatedRoute, Router } from '@angular/router'
import { AVATARS, type AvatarId, PLAYER_COLORS } from '@pp/shared'
import { firstValueFrom } from 'rxjs'
import { environment } from '../../../environments/environment'
import { AudioService } from '../../core/audio/audio.service'
import { AudioControlsComponent } from '../../shared/audio-controls.component'
import { PixelAvatarComponent } from '../../shared/pixel-avatar.component'

// Entry point: pick a name + pixel avatar + color, then create a fresh room or enter an existing code.
// Identity (name/color/avatar) travels to the room via query params.
@Component({
  selector: 'app-join',
  imports: [FormsModule, PixelAvatarComponent, AudioControlsComponent],
  template: `
    <main class="join">
      <div class="sound"><app-audio-controls /></div>
      <div class="arcade-window cabinet">
        <div class="arcade-titlebar">* PIXEL PARTY *</div>
        <div class="body">
          <div class="me">
            <app-pixel-avatar [avatar]="avatar()" [color]="color()" [size]="72" />
          </div>

          <input class="name" [(ngModel)]="name" placeholder="YOUR NAME" maxlength="16" />

          <div class="picker">
            <span class="label">Avatar</span>
            <div class="row">
              @for (a of avatars; track a) {
                <button
                  type="button"
                  class="swatch"
                  [class.sel]="a === avatar()"
                  (click)="avatar.set(a)"
                >
                  <app-pixel-avatar [avatar]="a" [color]="color()" [size]="28" />
                </button>
              }
            </div>
          </div>

          <div class="picker">
            <span class="label">Color</span>
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

          <button type="button" class="arcade-btn primary" (click)="createRoom()">Create room</button>
          <div class="enter">
            <input [(ngModel)]="code" placeholder="ROOM CODE" maxlength="6" />
            <button type="button" class="arcade-btn" (click)="joinRoom()">Join</button>
          </div>

          @if (message()) {
            <p class="msg">{{ message() }}</p>
          }
        </div>
      </div>
    </main>
  `,
  styles: `
    .join { display: grid; place-content: center; min-height: 100vh; padding: 1rem; }
    .sound { position: fixed; top: 0.75rem; right: 0.75rem; z-index: 10; }
    .cabinet { width: min(92vw, 380px); }
    .body { display: grid; gap: 0.9rem; padding: 1.1rem; }
    .me { display: grid; place-content: center; }
    .me app-pixel-avatar { filter: drop-shadow(0 4px 0 rgba(0,0,0,0.35)); }
    input { text-align: center; padding: 0.6rem; font-family: var(--font-pixel); font-size: 0.8rem;
      background: var(--c-bg); color: var(--c-text); border: 3px solid var(--c-frame);
      border-radius: 2px; }
    input::placeholder { color: var(--c-dim); }
    .picker { display: grid; gap: 0.4rem; }
    .label { font-size: 0.7rem; color: var(--c-dim); text-transform: uppercase; letter-spacing: 0.1em; }
    .row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .swatch { padding: 0.25rem; background: var(--c-bg); border: 3px solid var(--c-frame);
      border-radius: 2px; cursor: pointer; line-height: 0; }
    .swatch.sel { border-color: var(--c-amber); }
    .chip { width: 1.7rem; height: 1.7rem; border: 3px solid var(--c-frame); border-radius: 2px;
      cursor: pointer; }
    .chip.sel { border-color: var(--c-text); transform: scale(1.1); }
    .enter { display: flex; gap: 0.5rem; }
    .enter input { flex: 1; text-transform: uppercase; }
    .msg { margin: 0; color: var(--c-red); font-size: 0.75rem; text-align: center; }
  `,
})
export class JoinComponent {
  private readonly http = inject(HttpClient)
  private readonly router = inject(Router)

  constructor() {
    inject(AudioService).ensureMusic()
  }

  readonly avatars = AVATARS
  readonly colors = PLAYER_COLORS

  name = ''
  // Invite links (/?code=XXXX) land here with the room pre-filled; the player still picks identity.
  code = inject(ActivatedRoute).snapshot.queryParamMap.get('code')?.toUpperCase() ?? ''
  readonly avatar = signal<AvatarId>(AVATARS[0])
  readonly color = signal<string>(PLAYER_COLORS[0])
  readonly message = signal('')

  async createRoom(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ code: string }>(`${environment.apiUrl}/api/rooms`, {}),
      )
      this.enter(res.code)
    } catch {
      this.message.set('Could not reach the server')
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
        this.message.set(`Room ${code} not found`)
        return
      }
      this.enter(code)
    } catch {
      this.message.set('Could not reach the server')
    }
  }

  private enter(code: string): void {
    const name = this.name.trim()
    this.router.navigate(['/room', code], {
      queryParams: { avatar: this.avatar(), color: this.color(), ...(name ? { name } : {}) },
    })
  }
}
