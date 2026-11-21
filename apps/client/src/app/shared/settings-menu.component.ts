import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { APP_VERSION } from '@pp/shared'
import { AudioService } from '../core/audio/audio.service'
import { LanguageToggleComponent } from './language-toggle.component'

// A pixel cog, 16×16 (`X` = ink): a ring round a hole, eight teeth — drawn as one crisp SVG path and
// shown at 2 px a cell.
const COG = [
  '......XXXX......',
  '......XXXX......',
  '..XX..XXXX..XX..',
  '..XXXXXXXXXXXX..',
  '...XXXXXXXXXX...',
  '...XXXX..XXXX...',
  'XXXXXX....XXXXXX',
  'XXXXX......XXXXX',
  'XXXXX......XXXXX',
  'XXXXXX....XXXXXX',
  '...XXXX..XXXX...',
  '...XXXXXXXXXX...',
  '..XXXXXXXXXXXX..',
  '..XX..XXXX..XX..',
  '......XXXX......',
  '......XXXX......',
]
const COG_PATH = COG.flatMap((row, y) =>
  [...row].flatMap((c, x) => (c === 'X' ? [`M${x} ${y}h1v1h-1z`] : [])),
).join('')

// The settings menu (D56): a pixel cog button opening a popover with the music / SFX volume sliders,
// the EN|ES language toggle and the app version (handy when someone's tab runs an old build). The
// language can only change outside a session (D44): in a room past the lobby the toggle is locked and
// says so (`langLocked`).
@Component({
  selector: 'app-settings-menu',
  imports: [TranslocoPipe, LanguageToggleComponent],
  template: `
    <div class="settings">
      <button
        type="button"
        class="arcade-btn cog"
        [class.on]="open()"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="'settings.open' | transloco"
        [title]="'settings.open' | transloco"
        (click)="open.set(!open())"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path [attr.d]="cog" /></svg>
      </button>
      @if (open()) {
        <div class="panel arcade-window">
          <label>
            <span>{{ 'audio.music' | transloco }}</span>
            <input
              type="range"
              min="0"
              max="100"
              [value]="audio.musicVolume() * 100"
              (input)="audio.musicVolume.set(+$any($event.target).value / 100)"
            />
          </label>
          <label>
            <span>{{ 'audio.sfx' | transloco }}</span>
            <input
              type="range"
              min="0"
              max="100"
              [value]="audio.sfxVolume() * 100"
              (input)="audio.sfxVolume.set(+$any($event.target).value / 100)"
              (change)="audio.sfx.click()"
            />
          </label>
          <div class="row">
            <span>{{ 'settings.language' | transloco }}</span>
            <app-language-toggle [disabled]="langLocked()" />
          </div>
          @if (langLocked()) {
            <p class="note">{{ 'settings.langLocked' | transloco }}</p>
          }
          <span class="version">Pixel Party v{{ version }}</span>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .settings { position: relative; }
    .cog { display: grid; place-items: center; padding: 0.2rem; line-height: 0; }
    .cog svg { width: 32px; height: 32px; fill: currentColor; shape-rendering: crispEdges; }
    .cog.on { color: var(--c-amber); border-color: var(--c-amber); }
    .panel {
      position: absolute;
      right: 0;
      top: calc(100% + 0.4rem);
      z-index: 20;
      display: grid;
      gap: 0.6rem;
      padding: 0.75rem;
      min-width: 250px;
    }
    label, .row {
      display: grid;
      grid-template-columns: 5.5rem 1fr;
      align-items: center;
      gap: 0.5rem;
      font-size: var(--fs-sm);
      color: var(--c-dim);
      text-transform: uppercase;
    }
    input[type='range'] {
      width: 100%;
      accent-color: var(--c-amber);
    }
    .note {
      margin: -0.2rem 0 0;
      color: var(--c-dim);
      font-size: var(--fs-xs);
      line-height: 1.5;
    }
    .version {
      padding-top: 0.4rem;
      border-top: 2px solid var(--c-panel-alt);
      color: var(--c-dim);
      font-size: var(--fs-xs);
      text-align: right;
    }
  `,
})
export class SettingsMenuComponent {
  readonly audio = inject(AudioService)
  // In a session past the lobby: the language can't change (D44).
  readonly langLocked = input(false)
  readonly open = signal(false)
  readonly version = APP_VERSION
  readonly cog = COG_PATH
}
