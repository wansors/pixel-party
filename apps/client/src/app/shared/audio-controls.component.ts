import { Component, inject, signal } from '@angular/core'
import { AudioService } from '../core/audio/audio.service'

// Compact sound settings: a SND button toggling a popover with music / SFX volume sliders.
@Component({
  selector: 'app-audio-controls',
  template: `
    <div class="audio">
      <button type="button" class="arcade-btn snd" (click)="open.set(!open())">SND</button>
      @if (open()) {
        <div class="panel arcade-window">
          <label>
            <span>Music</span>
            <input
              type="range"
              min="0"
              max="100"
              [value]="audio.musicVolume() * 100"
              (input)="audio.musicVolume.set(+$any($event.target).value / 100)"
            />
          </label>
          <label>
            <span>SFX</span>
            <input
              type="range"
              min="0"
              max="100"
              [value]="audio.sfxVolume() * 100"
              (input)="audio.sfxVolume.set(+$any($event.target).value / 100)"
              (change)="audio.sfx.click()"
            />
          </label>
        </div>
      }
    </div>
  `,
  styles: `
    .audio { position: relative; }
    .snd { font-size: 0.65rem; padding: 0.35rem 0.5rem; }
    .panel {
      position: absolute;
      right: 0;
      top: calc(100% + 0.4rem);
      z-index: 20;
      display: grid;
      gap: 0.6rem;
      padding: 0.75rem;
      min-width: 200px;
    }
    label {
      display: grid;
      grid-template-columns: 3.5rem 1fr;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.65rem;
      color: var(--c-dim);
      text-transform: uppercase;
    }
    input[type='range'] {
      width: 100%;
      accent-color: var(--c-amber);
    }
  `,
})
export class AudioControlsComponent {
  readonly audio = inject(AudioService)
  readonly open = signal(false)
}
