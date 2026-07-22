import { provideHttpClient, withFetch } from '@angular/common/http'
import {
  type ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core'
import { provideRouter } from '@angular/router'
import { provideTransloco } from '@jsverse/transloco'
import { routes } from './app.routes'
import { AVAILABLE_LANGS, DEFAULT_LANG } from './core/i18n/i18n.tokens'
import { LanguageService } from './core/i18n/language.service'
import { StaticTranslocoLoader } from './core/i18n/transloco-loader'

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withFetch()),
    provideRouter(routes),
    provideTransloco({
      config: {
        availableLangs: [...AVAILABLE_LANGS],
        defaultLang: DEFAULT_LANG,
        fallbackLang: DEFAULT_LANG,
        reRenderOnLangChange: true,
        prodMode: false,
      },
      loader: StaticTranslocoLoader,
    }),
    // Construct LanguageService at bootstrap so the stored lang is hydrated + applied to Transloco BEFORE
    // first render (its constructor reads localStorage and calls setActiveLang).
    provideAppInitializer(() => {
      inject(LanguageService)
    }),
  ],
}
