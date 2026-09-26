import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { PixelAvatarComponent } from '../../../shared/pixel-avatar.component'
import { PointsPipe } from '../../../shared/points.pipe'
import { SkillRadarComponent } from '../../../shared/skill-radar.component'
import { RoomStore } from '../room.store'

// Post-round screen: the round winner (or winning team) up top, then this round's placements (stat,
// points earned, catch-up bonus, a cosmetic callout) beside the updated session standings with rank
// movement — one screen, both published by the server together — plus the skill profile so far.
@Component({
  selector: 'app-round-result',
  imports: [PixelAvatarComponent, SkillRadarComponent, TranslocoPipe, PointsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './round-result.component.html',
  styleUrl: './round-result.component.scss',
})
export class RoundResultComponent {
  readonly store = inject(RoomStore)

  sign(n: number): number {
    return Math.sign(n)
  }
}
