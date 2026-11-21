import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  effect,
  inject,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { AVATARS, type AvatarId, MAX_NAME_LEN, PLAYER_COLORS } from '@pp/shared'
import { toAvatarId } from '../../../../game/avatarSprites'
import { PixelAvatarComponent } from '../../../shared/pixel-avatar.component'
import { RoomStore } from '../room.store'

// Lobby dialog to change your own name, avatar and color after joining (D40). Opens on your current
// look; SAVE sends SET_PROFILE and the dialog closes once the server accepts it (a refusal — a name
// someone else already uses — shows inline and keeps it open).
@Component({
  selector: 'app-profile-editor',
  imports: [PixelAvatarComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="backdrop" (click)="closed.emit()" aria-hidden="true"></div>
    <form
      class="editor arcade-window"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="'room.profile.title' | transloco"
      (submit)="$event.preventDefault(); save()"
    >
      <div class="arcade-titlebar">{{ 'room.profile.title' | transloco }}</div>
      <div class="body">
        <div class="me">
          <app-pixel-avatar [avatar]="avatar()" [color]="color()" [size]="64" [blinks]="true" />
        </div>
        <input
          #nameInput
          class="name"
          [value]="name()"
          (input)="name.set($any($event.target).value)"
          [attr.maxlength]="maxLen"
          [placeholder]="'join.yourName' | transloco"
          [attr.aria-label]="'join.yourName' | transloco"
        />
        <div class="picker">
          <span class="label">{{ 'join.avatar' | transloco }}</span>
          <div class="row">
            @for (a of avatars; track a) {
              <button
                type="button"
                class="swatch"
                [class.sel]="a === avatar()"
                [attr.aria-pressed]="a === avatar()"
                [attr.aria-label]="a"
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
                [attr.aria-pressed]="c === color()"
                [style.background]="c"
                [attr.aria-label]="c"
                (click)="color.set(c)"
              ></button>
            }
          </div>
        </div>
        @if (store.profileError()) {
          <p class="err" role="alert">{{ store.profileError() }}</p>
        }
        <div class="actions">
          <button type="button" class="arcade-btn" (click)="closed.emit()">
            {{ 'room.profile.cancel' | transloco }}
          </button>
          <button type="submit" class="arcade-btn primary" [disabled]="!name().trim()">
            {{ 'room.profile.save' | transloco }}
          </button>
        </div>
      </div>
    </form>
  `,
  styles: `
    .backdrop { position: fixed; inset: 0; z-index: 40; background: rgba(8, 9, 14, 0.72); }
    .editor { position: fixed; z-index: 41; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: min(calc(100vw - 2rem), 360px); max-height: calc(100dvh - 2rem); overflow-y: auto; }
    .body { display: grid; gap: 0.9rem; padding: 1.1rem; }
    .body > * { min-width: 0; }
    .me { display: grid; place-content: center; }
    .me app-pixel-avatar { filter: drop-shadow(0 4px 0 rgba(0,0,0,0.35)); }
    .name { text-align: center; padding: 0.6rem; font-family: var(--font-pixel); font-size: var(--fs-sm);
      background: var(--c-bg); color: var(--c-text); border: 3px solid var(--c-frame); border-radius: 2px; }
    .name:focus { outline: none; border-color: var(--c-frame-lit); }
    .name::placeholder { color: var(--c-dim); }
    .picker { display: grid; gap: 0.4rem; }
    .label { font-size: var(--fs-xs); color: var(--c-dim); text-transform: uppercase; letter-spacing: 0.1em; }
    .row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .swatch { padding: 0.25rem; background: var(--c-bg); border: 3px solid var(--c-frame);
      border-radius: 2px; cursor: pointer; line-height: 0; }
    .swatch.sel { border-color: var(--c-amber); }
    .chip { width: 1.7rem; height: 1.7rem; border: 3px solid var(--c-frame); border-radius: 2px; cursor: pointer; }
    .chip.sel { border-color: var(--c-text); transform: scale(1.1); }
    .err { margin: 0; color: var(--c-red); font-size: var(--fs-xs); text-align: center; line-height: 1.5; }
    .actions { display: flex; gap: 0.6rem; }
    .actions .arcade-btn { flex: 1; }
  `,
})
export class ProfileEditorComponent {
  readonly store = inject(RoomStore)
  readonly closed = output<void>()

  readonly avatars = AVATARS
  readonly colors = PLAYER_COLORS
  readonly maxLen = MAX_NAME_LEN

  private readonly start = this.store.me()
  readonly name = signal(this.start?.name ?? '')
  readonly avatar = signal<AvatarId>(toAvatarId(this.start?.avatar ?? AVATARS[0]))
  readonly color = signal(this.start?.color ?? PLAYER_COLORS[0] ?? '#29d3f2')

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput')
  private readonly savedAtOpen = this.store.profileSaved()

  constructor() {
    this.store.profileError.set('')
    // Focus + select the name, so typing replaces it straight away.
    effect(() => {
      const el = this.nameInput()?.nativeElement
      if (el) untracked(() => queueMicrotask(() => el.select()))
    })
    // The server accepted the change: done.
    effect(() => {
      if (this.store.profileSaved() !== this.savedAtOpen) untracked(() => this.closed.emit())
    })
  }

  save(): void {
    const name = this.name().trim()
    if (!name) return
    const me = this.store.me()
    // Nothing changed: just close.
    if (me && me.name === name && me.avatar === this.avatar() && me.color === this.color()) {
      this.closed.emit()
      return
    }
    this.store.setProfile(name, this.avatar(), this.color())
  }
}
