import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { PixelAvatarComponent } from '../../../shared/pixel-avatar.component'
import { PointsPipe } from '../../../shared/points.pipe'
import { RoomStore } from '../room.store'

// Live standings beside the round canvas (a slim strip above it on phones). Ordered by the SESSION
// total — the question players glance over to answer is "who's winning overall" — with this round's
// raw tally as an extra column (and tiebreak) so the board still moves in real time; the round leader
// is starred. Arrows show session rank movement since the previous round.
@Component({
  selector: 'app-live-board',
  imports: [PixelAvatarComponent, TranslocoPipe, PointsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="live-board" [attr.aria-label]="'room.scoreboard.live' | transloco">
      <h4>
        <span>{{ 'room.scoreboard.live' | transloco }}</span>
        @if (hasRound()) {
          <span class="col">{{ 'room.live.round' | transloco }}</span>
        }
        <span class="col">{{ 'room.live.total' | transloco }}</span>
      </h4>
      <ol>
        @for (r of store.liveRows(); track r.playerId) {
          <li [class.me]="r.playerId === store.selfId()" [class.lead]="r.rank === 1">
            <span class="rank">{{ r.rank }}</span>
            <app-pixel-avatar
              [avatar]="store.playerAvatar(r.playerId)"
              [color]="store.playerColor(r.playerId)"
              [size]="16"
            />
            <span class="name" [style.color]="store.playerColor(r.playerId)">
              {{ store.playerName(r.playerId) }}
            </span>
            @if (r.roundValue !== null) {
              <span class="round" [class.leader]="r.roundLeader">
                {{ r.roundLeader ? '★' : '' }}{{ r.roundValue }}
              </span>
            }
            <span class="pts">{{ r.points | pts }}</span>
            @switch (sign(store.rankDelta(r.playerId))) {
              @case (1) {
                <span class="delta up">▲</span>
              }
              @case (-1) {
                <span class="delta down">▼</span>
              }
              @default {
                <span class="delta"></span>
              }
            }
          </li>
        }
      </ol>
    </aside>
  `,
  styleUrl: './live-board.component.scss',
})
export class LiveBoardComponent {
  readonly store = inject(RoomStore)

  hasRound(): boolean {
    return this.store.liveRows().some((r) => r.roundValue !== null)
  }

  sign(n: number): number {
    return Math.sign(n)
  }
}
