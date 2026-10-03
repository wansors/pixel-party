import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { PLAYER_COLORS, type ScoreEntryDto } from '@pp/shared'
import { linesOf, pickLine } from '../../../../game/quips'
import { PixelAvatarComponent } from '../../../shared/pixel-avatar.component'
import { PointsPipe } from '../../../shared/points.pipe'
import { SkillRadarComponent } from '../../../shared/skill-radar.component'
import { RoomStore } from '../room.store'

interface Confetto {
  left: number
  delay: number
  duration: number
  color: string
  size: number
}

// Session finale: a three-step podium (2nd · 1st · 3rd) under a shower of pixel confetti, the full
// ranking (last place gets the wooden spoon and a jab), the viewer's skill profile and the session highlights (MVP, comeback, per-round winners).
// The host can send the room back to the lobby for another session.
@Component({
  selector: 'app-final',
  imports: [PixelAvatarComponent, SkillRadarComponent, TranslocoPipe, PointsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './final.component.html',
  styleUrl: './final.component.scss',
})
export class FinalComponent {
  readonly store = inject(RoomStore)
  private readonly transloco = inject(TranslocoService)

  // Podium order left→right: 2nd, 1st, 3rd (only the places that exist).
  readonly podium = computed(() => {
    const top = this.store.final().slice(0, 3)
    const [first, second, third] = top
    return [second, first, third].filter((s): s is ScoreEntryDto => !!s)
  })

  // Deterministic confetti layout (index-derived), so it doesn't reshuffle on change detection.
  readonly confetti: Confetto[] = Array.from({ length: 36 }, (_, i) => ({
    left: (i * 37) % 100,
    delay: (i * 173) % 2400,
    duration: 2200 + ((i * 97) % 1600),
    color: PLAYER_COLORS[i % PLAYER_COLORS.length] ?? '#ffcf4b',
    size: 4 + (i % 3) * 2,
  }))

  // Last place, once there are enough players for it to sting (and not when everybody tied).
  readonly spoon = computed(() => {
    const ranking = this.store.final()
    const last = ranking.at(-1)
    return ranking.length >= 3 && last && last.rank !== ranking[0]?.rank ? last : null
  })

  // The wooden-spoon jab, the same on every screen (seeded by the player). A template call, so a
  // language switch re-renders it.
  spoonLine(playerId: string): string {
    const lines = linesOf(this.transloco.translate<unknown>('room.final.spoonLines'))
    return pickLine(lines, `spoon:${playerId}`)
  }

  place(entry: ScoreEntryDto): number {
    return this.store.final().indexOf(entry) + 1
  }
}
