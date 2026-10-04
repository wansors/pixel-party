import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { LanguageService } from '../core/i18n/language.service'

// Compact EN|ES segmented toggle for the active UI language. Placed beside the sound control on both the
// join and room screens; switching is instant (reRenderOnLangChange) and persisted per device.
@Component({
  selector: 'app-language-toggle',
  imports: [TranslocoPipe],
  template: `
    <div class="lang">
      @for (l of lang.available; track l) {
        <button
          type="button"
          class="arcade-btn seg"
          [class.on]="lang.lang() === l"
          [attr.aria-pressed]="lang.lang() === l"
          (click)="lang.setLang(l)"
        >
          {{ 'lang.' + l | transloco }}
        </button>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .lang { display: inline-flex; gap: 0.25rem; }
    .seg { font-size: var(--fs-xs); padding: 0.3rem 0.4rem; opacity: 0.6; }
    .seg.on { opacity: 1; border-color: var(--c-amber); color: var(--c-amber); }
  `,
})
export class LanguageToggleComponent {
  readonly lang = inject(LanguageService)
}
