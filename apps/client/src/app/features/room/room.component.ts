import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  type OnInit,
  signal,
} from '@angular/core'
import { ActivatedRoute, Router } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { AVATARS, type AvatarId, PLAYER_COLORS } from '@pp/shared'
import { AudioControlsComponent } from '../../shared/audio-controls.component'
import { LanguageToggleComponent } from '../../shared/language-toggle.component'
import { FinalComponent } from './final/final.component'
import { RoundIntroComponent } from './intro/round-intro.component'
import { LiveBoardComponent } from './live-board/live-board.component'
import { LobbyComponent } from './lobby/lobby.component'
import { RoundResultComponent } from './result/round-result.component'
import { RoomStore } from './room.store'

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)] as T

// Room shell: header, the persistent round canvas + live board, and one view component per room
// phase (lobby → intro → round → round result → final). All state and server traffic live in the
// per-room RoomStore; this component only reads the route, starts the connection and lays out views.
@Component({
  selector: 'app-room',
  imports: [
    AudioControlsComponent,
    LanguageToggleComponent,
    LobbyComponent,
    RoundIntroComponent,
    RoundResultComponent,
    FinalComponent,
    LiveBoardComponent,
    TranslocoPipe,
  ],
  providers: [RoomStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './room.component.html',
  styleUrl: './room.component.scss',
})
export class RoomComponent implements OnInit {
  readonly store = inject(RoomStore)
  private readonly route = inject(ActivatedRoute)
  private readonly router = inject(Router)

  // Host-only "skip game" button (intro or mid-round): the first click arms it, a second one within
  // 3 s skips — so a stray click can't throw away a round everyone is enjoying.
  readonly canSkip = computed(
    () => this.store.isHost() && (this.store.view() === 'intro' || this.store.view() === 'round'),
  )
  readonly skipArmed = signal(false)
  private disarmTimer?: ReturnType<typeof setTimeout>

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.disarmTimer))
  }

  onSkip(button: HTMLElement): void {
    // Drop focus so the game's SPACE/ENTER keys can't press the button again.
    button.blur()
    clearTimeout(this.disarmTimer)
    if (this.skipArmed()) {
      this.skipArmed.set(false)
      this.store.skipRound()
      return
    }
    this.skipArmed.set(true)
    this.disarmTimer = setTimeout(() => this.skipArmed.set(false), 3000)
  }

  // 1-based round indices for the header's progress pips.
  pips(total: number): number[] {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  ngOnInit(): void {
    const code = (this.route.snapshot.paramMap.get('code') ?? '').toUpperCase()
    if (!code) {
      this.router.navigate(['/'])
      return
    }
    const q = this.route.snapshot.queryParamMap
    const qColor = q.get('color')
    const qAvatar = q.get('avatar')
    this.store.connect(code, {
      name: q.get('name')?.trim() || `Player-${pick(AVATARS)}`,
      color: qColor && PLAYER_COLORS.includes(qColor) ? qColor : pick(PLAYER_COLORS),
      avatar:
        qAvatar && (AVATARS as readonly string[]).includes(qAvatar)
          ? (qAvatar as AvatarId)
          : pick(AVATARS),
    })
  }
}
