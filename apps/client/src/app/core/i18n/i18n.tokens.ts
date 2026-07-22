// i18n tokens: the closed set of UI languages + the localStorage key the LanguageService persists the
// active choice under. English is the default and the fallback (the repo is English; es.json layers
// translations on top). Mirrors the ../utopia-offline convention.
export const AVAILABLE_LANGS = ['en', 'es'] as const
export type Lang = (typeof AVAILABLE_LANGS)[number]
export const DEFAULT_LANG: Lang = 'en'
export const LANG_STORAGE_KEY = 'pp_lang'

// Runtime guard for an untrusted (localStorage-sourced) value: only a known lang passes.
export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (AVAILABLE_LANGS as readonly string[]).includes(value)
}
