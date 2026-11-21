import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import {
  AXIS_COLORS,
  idealForPlayers,
  MINIGAMES,
  type MiniGameFormat,
  type MiniGameMeta,
  SKILL_AXES,
  type SkillAxis,
} from '@pp/shared'
import { CatalogI18nService } from '../../../core/i18n/catalog-i18n.service'
import { GameThumbComponent } from '../../../shared/game-thumb.component'
import { RoomStore } from '../room.store'
import { playerRange, roundLength, unfitReason } from './game-facts'
import { GameSheetComponent } from './game-sheet.component'

// How many games "Surprise me" deals when the round count doesn't say otherwise.
const SURPRISE_SIZE = 10

// Lowercase, accents stripped: "Fútbol" matches "futbol".
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// The lobby's game picker (D40): a visual grid of game cards — an in-play screenshot, the name and the
// key facts (skills, players, length) — that the host taps to build the line-up. Picked games light
// up, the rest stay greyed; a card's (i) opens the game's sheet (bigger picture, how to play,
// controls). Search, format, skill, headcount and mobile filters narrow the grid; "Surprise me" deals
// a random line-up of the games that fit. Everyone else sees the line-up as the same cards, read-only.
@Component({
  selector: 'app-game-picker',
  imports: [GameSheetComponent, GameThumbComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './game-picker.component.html',
  styleUrl: './game-picker.component.scss',
})
export class GamePickerComponent {
  readonly store = inject(RoomStore)
  readonly catalog = inject(CatalogI18nService)
  readonly skillAxes = SKILL_AXES
  readonly formats: readonly MiniGameFormat[] = ['ffa', 'team', 'duel']
  readonly totalGames = MINIGAMES.length

  // Client-only UI state. Filters combine: null / false = no narrowing.
  readonly query = signal('')
  readonly axisFilter = signal<SkillAxis | null>(null)
  readonly formatFilter = signal<MiniGameFormat | null>(null)
  // Only games whose recommended player range holds the current headcount (D27).
  readonly idealOnly = signal(false)
  // Only phone-friendly games; the chip shows only while someone joined from a phone (D21/D34).
  readonly mobileOnly = signal(false)
  // Only the current picks — to review the line-up.
  readonly pickedOnly = signal(false)
  // The game whose sheet is open (null = closed).
  readonly detail = signal<MiniGameMeta | null>(null)

  readonly filtering = computed(
    () =>
      this.query().trim() !== '' ||
      this.axisFilter() !== null ||
      this.formatFilter() !== null ||
      this.idealOnly() ||
      (this.mobileOnly() && this.store.phoneInRoom()) ||
      this.pickedOnly(),
  )

  // Host sees the whole catalog (narrowed by the filters); everyone else just sees the line-up.
  readonly shownGames = computed<readonly MiniGameMeta[]>(() => {
    const q = fold(this.query().trim())
    const axis = this.axisFilter()
    const format = this.formatFilter()
    const mobile = this.mobileOnly() && this.store.phoneInRoom()
    const ideal = this.idealOnly()
    const picked = this.pickedOnly() || !this.store.isHost()
    const count = this.store.connectedCount()
    const selected = new Set(this.store.selectedGameIds())
    return MINIGAMES.filter(
      (g) =>
        (!picked || selected.has(g.id)) &&
        (!axis || g.axes.includes(axis)) &&
        (!format || g.format === format) &&
        (!mobile || g.mobileFriendly) &&
        (!ideal || idealForPlayers(g.id, count)) &&
        (!q ||
          fold(this.catalog.minigameName(g.id)).includes(q) ||
          fold(g.name).includes(q) ||
          fold(this.catalog.minigameBlurb(g.id)).includes(q)),
    )
  })

  // Picked games that sit this headcount out (outside their player range).
  readonly sittingOut = computed(
    () => this.store.selectedGameIds().length - this.store.playableGameIds().length,
  )

  axisColor(axis: SkillAxis): string {
    return AXIS_COLORS[axis]
  }

  toggleAxis(axis: SkillAxis): void {
    this.axisFilter.set(this.axisFilter() === axis ? null : axis)
  }

  toggleFormat(format: MiniGameFormat): void {
    this.formatFilter.set(this.formatFilter() === format ? null : format)
  }

  clearFilters(): void {
    this.query.set('')
    this.axisFilter.set(null)
    this.formatFilter.set(null)
    this.idealOnly.set(false)
    this.mobileOnly.set(false)
    this.pickedOnly.set(false)
  }

  picked(g: MiniGameMeta): boolean {
    return this.store.isSelected(g.id) && this.store.fits(g.id)
  }

  selectShown(): void {
    this.store.selectGames(this.shownGames().flatMap((g) => (this.store.fits(g.id) ? [g.id] : [])))
  }

  deselectShown(): void {
    this.store.deselectGames(this.shownGames().map((g) => g.id))
  }

  // A random line-up from the games on screen that fit the room: as many as the round count asks
  // for (AUTO → SURPRISE_SIZE). Client-side randomness is fine here — it only picks the line-up.
  surprise(): void {
    const pool = this.shownGames().filter((g) => this.store.fits(g.id))
    if (pool.length === 0) return
    const size = Math.min(
      pool.length,
      this.store.autoRounds() ? SURPRISE_SIZE : Math.max(1, this.store.effectiveRounds()),
    )
    const deck = pool
      .map((g) => ({ id: g.id, key: Math.random() }))
      .sort((a, b) => a.key - b.key)
      .map((d) => d.id)
    this.store.replaceGames(deck.slice(0, size))
  }

  openDetail(g: MiniGameMeta): void {
    this.detail.set(g)
  }

  closeDetail(): void {
    this.detail.set(null)
  }

  readonly range = playerRange
  readonly duration = roundLength

  isIdeal(g: MiniGameMeta): boolean {
    return idealForPlayers(g.id, this.store.connectedCount())
  }

  // Why a game can't be picked right now: the headcount is outside its range, or a team is empty.
  unfitReason(g: MiniGameMeta): 'range' | 'teams' {
    return unfitReason(g.id, this.store.connectedCount())
  }
}
