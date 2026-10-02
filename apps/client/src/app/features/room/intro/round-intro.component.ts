import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { AXIS_COLORS, MINIGAMES_BY_ID, type SkillAxis, TEAMS } from '@pp/shared'
import { CatalogI18nService } from '../../../core/i18n/catalog-i18n.service'
import { PixelAvatarComponent } from '../../../shared/pixel-avatar.component'
import { RoomStore } from '../room.store'

// Round intro card shown during the pre-round countdown: which game is next, how it's played (the
// catalog blurb), its format, skill axes and whether it plays well on a phone, and — for team rounds —
// who's on which side. The countdown number is re-created on every tick so its pop animation replays.
@Component({
  selector: 'app-round-intro',
  imports: [PixelAvatarComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.intro(); as intro) {
      <section class="intro arcade-window">
        <div class="arcade-titlebar">
          {{ 'room.header.round' | transloco: { n: intro.round, total: intro.total } }}
        </div>
        <div class="pad">
          <h2 class="game">{{ catalog.minigameName(intro.game) }}</h2>
          <div class="badges">
            <span class="badge format">{{ 'room.format.' + intro.format | transloco }}</span>
            @for (a of axes(); track a) {
              <span class="badge" [style.color]="axisColor(a)">{{ catalog.axisLabel(a) }}</span>
            }
            @if (mobileFriendly(); as mobile) {
              <span class="badge device" [class.mobile]="mobile === 'yes'">
                {{ (mobile === 'yes' ? 'room.intro.mobileFriendly' : 'room.intro.bestOnPc') | transloco }}
              </span>
            }
          </div>

          <div class="howto">
            <span class="label">{{ 'room.intro.howTo' | transloco }}</span>
            <p>{{ catalog.minigameBlurb(intro.game) }}</p>
          </div>

          @if (intro.format === 'team') {
            <div class="teams">
              @for (t of teams(); track t.id) {
                <div class="team" [style.borderColor]="t.color">
                  <span class="tname" [style.color]="t.color">{{ store.teamName(t.id) }}</span>
                  <span class="members">
                    @for (p of t.members; track p.id) {
                      <app-pixel-avatar [avatar]="$any(p.avatar)" [color]="p.color" [size]="22" />
                    }
                  </span>
                </div>
              }
            </div>
          }

          <div class="count-box">
            @if (store.countdown(); as n) {
              <!-- Alternating branches re-create the number element on every tick, replaying its
                   pop animation (a keyed @for would do the same but trips Angular's NG0956 warning). -->
              @if (n % 2 === 0) {
                <span class="count">{{ n }}</span>
              } @else {
                <span class="count">{{ n }}</span>
              }
              <span class="ready blink">{{ 'room.intro.getReady' | transloco }}</span>
            } @else {
              <span class="count go">{{ 'room.intro.go' | transloco }}</span>
            }
          </div>
        </div>
      </section>
    }
  `,
  styleUrl: './round-intro.component.scss',
})
export class RoundIntroComponent {
  readonly store = inject(RoomStore)
  readonly catalog = inject(CatalogI18nService)

  readonly axes = computed<readonly SkillAxis[]>(() => {
    const id = this.store.intro()?.game
    return (id && MINIGAMES_BY_ID.get(id)?.axes) || []
  })

  // PC-first: tell phone players up front whether this round plays well on their device.
  readonly mobileFriendly = computed<'yes' | 'no' | null>(() => {
    const id = this.store.intro()?.game
    const meta = id ? MINIGAMES_BY_ID.get(id) : undefined
    return meta ? (meta.mobileFriendly ? 'yes' : 'no') : null
  })

  readonly teams = computed(() =>
    TEAMS.map((t) => ({
      ...t,
      members: this.store.players().filter((p) => p.team === t.id),
    })),
  )

  axisColor(axis: SkillAxis): string {
    return AXIS_COLORS[axis]
  }
}
