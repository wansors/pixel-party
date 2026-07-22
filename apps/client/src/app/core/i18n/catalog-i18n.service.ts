import { Injectable, inject } from '@angular/core'
import { TranslocoService } from '@jsverse/transloco'
import { MINIGAMES_BY_ID, type MiniGameId } from '@pp/shared'

// Central id→display-text resolver for the mini-game catalog: names + blurbs the lobby/host UI and the
// round intro/result titlebar show, resolved by the stable mini-game id with an ENGLISH FALLBACK to the
// @pp/shared MINIGAMES meta (whose English name/blurb stay as the dev/server fallback). Mirrors
// ../utopia-offline's CatalogI18nService. Uses synchronous translate() (reads the active lang);
// reRenderOnLangChange + Angular CD re-evaluate template-bound calls on a language switch.
@Injectable({ providedIn: 'root' })
export class CatalogI18nService {
  private readonly transloco = inject(TranslocoService)

  minigameName(id: MiniGameId): string {
    return this.resolveOrFallback(
      `catalog.minigame.${id}.name`,
      MINIGAMES_BY_ID.get(id)?.name ?? id,
    )
  }

  minigameBlurb(id: MiniGameId): string {
    return this.resolveOrFallback(
      `catalog.minigame.${id}.blurb`,
      MINIGAMES_BY_ID.get(id)?.blurb ?? '',
    )
  }

  // Transloco's default missing handler echoes the key on a miss; treat key-echo or empty as a miss and
  // return the English fallback so a rendered string is always guaranteed.
  private resolveOrFallback(key: string, fallback: string): string {
    const result = this.transloco.translate<string>(key)
    return !result || result === key ? fallback : result
  }
}
