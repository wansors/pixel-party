import { Injectable, inject, signal } from '@angular/core'
import { TranslocoService } from '@jsverse/transloco'
import { AVAILABLE_LANGS, DEFAULT_LANG, LANG_STORAGE_KEY, type Lang, isLang } from './i18n.tokens'

// The single seam for the active UI language. Holds the active `lang` signal, hydrates it from
// localStorage on construction (falling back to DEFAULT_LANG on a missing/corrupt/invalid value), and
// drives TranslocoService.setActiveLang on every change. Persistence is best-effort; the language is a
// pure client preference (never read from / written to the server). Mirrors ../utopia-offline.
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService)
  readonly lang = signal<Lang>(DEFAULT_LANG)
  readonly available: readonly Lang[] = AVAILABLE_LANGS

  constructor() {
    this.setLang(this.hydrate())
  }

  setLang(l: Lang): void {
    this.lang.set(l)
    this.transloco.setActiveLang(l)
    this.persist(l)
  }

  private hydrate(): Lang {
    if (typeof localStorage === 'undefined') return DEFAULT_LANG
    try {
      const raw = localStorage.getItem(LANG_STORAGE_KEY)
      return isLang(raw) ? raw : DEFAULT_LANG
    } catch {
      return DEFAULT_LANG
    }
  }

  private persist(l: Lang): void {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(LANG_STORAGE_KEY, l)
    } catch {
      // Storage full / disabled — the lang still applies this session; persistence is best-effort.
    }
  }
}
