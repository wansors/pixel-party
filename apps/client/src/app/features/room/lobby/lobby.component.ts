import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import {
  AUTO_ROUNDS_CAP,
  hexToCss,
  MAX_ROUNDS,
  MINIGAMES,
  PALETTE,
  SKILL_AXES,
  type SkillAxis,
} from '@pp/shared'
import { CatalogI18nService } from '../../../core/i18n/catalog-i18n.service'
import { PixelAvatarComponent } from '../../../shared/pixel-avatar.component'
import { SkillRadarComponent } from '../../../shared/skill-radar.component'
import { RoomStore } from '../room.store'
import { GamePickerComponent } from './game-picker.component'
import { ProfileEditorComponent } from './profile-editor.component'

// Lobby: who's here (and ready), the big shareable room code, and the host's session setup (the
// visual game picker, round count, catch-up toggle). The EN|ES toggle lives in its title bar: the
// lobby is the only place in a room where the language can change (never mid-game). Your own row has an edit button to change your
// name/avatar/color (D40). The primary actions sit in a footer that never scrolls away, so READY /
// START are always one tap from wherever the list is scrolled.
@Component({
  selector: 'app-lobby',
  imports: [
    GamePickerComponent,
    PixelAvatarComponent,
    ProfileEditorComponent,
    SkillRadarComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lobby.component.html',
  styleUrl: './lobby.component.scss',
})
export class LobbyComponent {
  readonly store = inject(RoomStore)
  readonly catalog = inject(CatalogI18nService)
  readonly coverageColor = hexToCss(PALETTE.cyan)
  readonly maxRounds = MAX_ROUNDS
  readonly autoCap = AUTO_ROUNDS_CAP
  // One-tap session lengths for the round count (the stepper covers everything in between).
  readonly roundPresets = [10, 20, 30, 50] as const

  readonly copied = signal(false)
  // The "edit my profile" dialog is open.
  readonly editing = signal(false)

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

  // "3 v 1": teams more than one player apart get a warning next to the shuffle button.
  readonly unevenTeams = computed(() => {
    const [red = 0, blue = 0] = this.store.teamSizes()
    return this.store.usesTeams() && Math.abs(red - blue) > 1 ? `${red} v ${blue}` : null
  })

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
