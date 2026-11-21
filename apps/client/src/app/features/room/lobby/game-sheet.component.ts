import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { AXIS_COLORS, type MiniGameMeta, type SkillAxis } from '@pp/shared'
import { CatalogI18nService } from '../../../core/i18n/catalog-i18n.service'
import { GameThumbComponent } from '../../../shared/game-thumb.component'
import { RoomStore } from '../room.store'
import { playerRange, roundLength, unfitReason } from './game-facts'

// A game's sheet, opened from a picker card's (i): the bigger screenshot, format / skills / players /
// length, the intro joke, how to play and the PC controls — and, for the host, ADD / REMOVE. Closes
// on the backdrop, the × or Escape.
@Component({
  selector: 'app-game-sheet',
  imports: [GameThumbComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './game-sheet.component.html',
  styleUrl: './game-sheet.component.scss',
  host: { '(document:keydown.escape)': 'closed.emit()' },
})
export class GameSheetComponent {
  readonly store = inject(RoomStore)
  readonly catalog = inject(CatalogI18nService)
  readonly game = input.required<MiniGameMeta>()
  readonly closed = output<void>()

  readonly range = playerRange
  readonly duration = roundLength

  axisColor(axis: SkillAxis): string {
    return AXIS_COLORS[axis]
  }

  picked(g: MiniGameMeta): boolean {
    return this.store.isSelected(g.id) && this.store.fits(g.id)
  }

  unfitReason(g: MiniGameMeta): 'range' | 'teams' {
    return unfitReason(g.id, this.store.connectedCount())
  }
}
