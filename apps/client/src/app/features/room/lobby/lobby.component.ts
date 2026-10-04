import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import {
  AXIS_COLORS,
  fitsPlayers,
  hexToCss,
  idealForPlayers,
  MINIGAMES,
  type MiniGameMeta,
  PALETTE,
  SKILL_AXES,
  type SkillAxis,
} from '@pp/shared'
import { CatalogI18nService } from '../../../core/i18n/catalog-i18n.service'
import { PixelAvatarComponent } from '../../../shared/pixel-avatar.component'
import { SkillRadarComponent } from '../../../shared/skill-radar.component'
import { RoomStore } from '../room.store'

// Lobby: who's here (and ready), the big shareable room code, and the host's session setup (game
// line-up with skill-axis filters, round count, catch-up toggle). The primary actions sit in a footer
// that never scrolls away, so READY / START are always one tap from wherever the list is scrolled.
@Component({
  selector: 'app-lobby',
  imports: [PixelAvatarComponent, SkillRadarComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lobby.component.html',
  styleUrl: './lobby.component.scss',
})
export class LobbyComponent {
  readonly store = inject(RoomStore)
  readonly catalog = inject(CatalogI18nService)
  readonly skillAxes = SKILL_AXES
  readonly totalGames = MINIGAMES.length
  readonly coverageColor = hexToCss(PALETTE.cyan)

  readonly copied = signal(false)
  // Game-picker axis filter (client-only UI state): null = every game; an axis narrows the grid so a
  // host can build a themed line-up.
  readonly axisFilter = signal<SkillAxis | null>(null)
  // Mobile filter (client-only, combines with the axis filter): Pixel Party is PC-first, so when some
  // players joined from their phones the host can narrow the grid to the games that play well there.
  // The chip (and the cards' phone tags) only show while a phone is in the room.
  readonly mobileOnly = signal(false)
  // "Ideal for N" filter (client-only, combines with the others): only games whose recommended player
  // range holds the current headcount (D27).
  readonly idealOnly = signal(false)

  // Host sees the whole catalog (narrowed by the filters); everyone else just sees the line-up.
  readonly shownGames = computed<readonly MiniGameMeta[]>(() => {
    const axis = this.axisFilter()
    const mobile = this.mobileOnly() && this.store.phoneInRoom()
    const ideal = this.idealOnly()
    const count = this.store.connectedCount()
    const pool = this.store.isHost()
      ? MINIGAMES
      : MINIGAMES.filter((g) => this.store.selectedGameIds().includes(g.id))
    return pool.filter(
      (g) =>
        (!axis || g.axes.includes(axis)) &&
        (!mobile || g.mobileFriendly) &&
        (!ideal || idealForPlayers(g.id, count)),
    )
  })

  // Picked games that sit this headcount out (outside their player range).
  readonly sittingOut = computed(
    () => this.store.selectedGameIds().length - this.store.playableGameIds().length,
  )

  // Aggregate skill coverage of the current line-up, as a 0..1 radar per axis (relative to whichever
  // axis the selection leans on most) — a "what will this session train" preview.
  readonly coverage = computed(() => {
    const ids = new Set(this.store.playableGameIds())
    const counts = new Map<SkillAxis, number>()
    for (const g of MINIGAMES) {
      if (!ids.has(g.id)) continue
      for (const axis of g.axes) counts.set(axis, (counts.get(axis) ?? 0) + 1)
    }
    const max = Math.max(1, ...counts.values())
    return SKILL_AXES.map((axis) => ({
      label: this.catalog.axisLabel(axis),
      value: (counts.get(axis) ?? 0) / max,
    }))
  })

  // Segments of the "N/M READY" meter, one per connected player.
  readonly readySegments = computed(() => {
    const total = this.store.connectedCount()
    const ready = this.store.readyCount()
    return Array.from({ length: total }, (_, i) => i < ready)
  })

  axisColor(axis: SkillAxis): string {
    return AXIS_COLORS[axis]
  }

  toggleAxis(axis: SkillAxis): void {
    this.axisFilter.set(this.axisFilter() === axis ? null : axis)
  }

  selectShown(): void {
    this.store.selectGames(this.shownGames().flatMap((g) => (this.store.fits(g.id) ? [g.id] : [])))
  }

  // "3-8" — a player range as the card shows it (one number when both ends match).
  range(lo: number, hi: number): string {
    return lo === hi ? `${lo}` : `${lo}-${hi}`
  }

  isIdeal(g: MiniGameMeta): boolean {
    return idealForPlayers(g.id, this.store.connectedCount())
  }

  // Why a game can't be picked right now: the headcount is outside its range, or a team is empty.
  unfitReason(g: MiniGameMeta): 'range' | 'teams' {
    return fitsPlayers(g.id, this.store.connectedCount()) ? 'teams' : 'range'
  }

  // "3 v 1": teams more than one player apart get a warning next to the shuffle button.
  readonly unevenTeams = computed(() => {
    const [red = 0, blue = 0] = this.store.teamSizes()
    return this.store.usesTeams() && Math.abs(red - blue) > 1 ? `${red} v ${blue}` : null
  })

  deselectShown(): void {
    this.store.deselectGames(this.shownGames().map((g) => g.id))
  }

  stepRounds(delta: number): void {
    this.store.setRounds(this.store.effectiveRounds() + delta)
  }

  // Clipboard API needs a secure context (localhost qualifies, plain LAN IPs don't) — fall back to
  // the legacy execCommand path so copying also works when the host opened the app via its LAN IP.
  async copyInvite(): Promise<void> {
    const url = this.store.inviteUrl
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = url
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    this.copied.set(true)
    setTimeout(() => this.copied.set(false), 2000)
  }
}
