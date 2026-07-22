import { Injectable } from '@angular/core'
import type { Translation, TranslocoLoader } from '@jsverse/transloco'
import { type Observable, of } from 'rxjs'
import en from '../../../assets/i18n/en.json'
import es from '../../../assets/i18n/es.json'

// Static (bundled) Transloco loader: the translation trees are imported at build time and returned
// synchronously via of(...) — no HttpClient, no network round-trip. Both langs ship in the bundle, so a
// language switch never waits on I/O. Mirrors ../utopia-offline.
const TRANSLATIONS: Record<string, Translation> = {
  en: en as Translation,
  es: es as Translation,
}

@Injectable({ providedIn: 'root' })
export class StaticTranslocoLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(TRANSLATIONS[lang] ?? (en as Translation))
  }
}
