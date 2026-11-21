import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core'
import { AXIS_COLORS, MINIGAMES_BY_ID, type MiniGameId } from '@pp/shared'

// A mini-game's thumbnail: a real in-play screenshot from `public/thumbs/<id>.webp` (regenerated with
// the playtest-screenshots skill's `thumbs.ts`, D40). A game without one — a brand-new game, or a
// failed load — gets a pixel-art placeholder instead: its initials over stripes in its skill-axis
// colors, so the grid never shows a broken image. The URL is relative, so it resolves below the
// page's <base href> (BASE_PATH deployments included).
@Component({
  selector: 'app-game-thumb',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!failed()) {
      <img
        [src]="src()"
        [alt]="alt()"
        loading="lazy"
        decoding="async"
        draggable="false"
        (error)="failed.set(true)"
      />
    } @else {
      <span class="placeholder" [style.background]="stripes()" role="img" [attr.aria-label]="alt()">
        <span class="initials">{{ initials() }}</span>
      </span>
    }
  `,
  styles: `
    :host { display: block; position: relative; aspect-ratio: 16 / 10; overflow: hidden;
      background: var(--c-bg); }
    img { display: block; width: 100%; height: 100%; object-fit: cover;
      image-rendering: pixelated; }
    .placeholder { position: absolute; inset: 0; display: grid; place-items: center; }
    .initials { font-family: var(--font-pixel); font-size: var(--fs-lg); color: var(--c-text);
      padding: 0.3rem 0.5rem; background: rgba(16, 18, 28, 0.82); border: 3px solid var(--c-frame);
      text-shadow: 0 3px 0 rgba(0, 0, 0, 0.5); letter-spacing: 0.1em; }
  `,
})
export class GameThumbComponent {
  readonly id = input.required<MiniGameId>()
  // Accessible name (the localized game name); empty = decorative.
  readonly alt = input('')

  readonly failed = signal(false)
  readonly src = computed(() => `thumbs/${this.id()}.webp`)
  readonly initials = computed(() =>
    (MINIGAMES_BY_ID.get(this.id())?.name ?? this.id())
      .split(/[\s-]+/)
      .map((w) => w.charAt(0))
      .join('')
      .slice(0, 3)
      .toUpperCase(),
  )
  // Diagonal pixel stripes in the game's axis colors (dark-tinted so the initials stay readable).
  readonly stripes = computed(() => {
    const axes = MINIGAMES_BY_ID.get(this.id())?.axes ?? []
    const colors = axes.length ? axes.map((a) => AXIS_COLORS[a]) : ['#3a3f66']
    const stops = colors.flatMap((c, i) => [`${c} ${i * 16}px`, `${c} ${i * 16 + 16}px`])
    return `linear-gradient(rgba(16,18,28,0.55), rgba(16,18,28,0.55)), repeating-linear-gradient(45deg, ${stops.join(', ')})`
  })
}
