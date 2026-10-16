/**
 * Каталог UI-строк и runtime i18n StitchVue.
 * Источник RU: `locales/ru.json`. Фасад неймспейсов — `texts.ts` (этап 1, static).
 * Runtime lookup — `i18n` / `useTranslation` (этап 2+). Плейсхолдеры в static — `t()`.
 */

export {
  common,
  places,
  gallery,
  toolbar,
  topNav,
  sidebar,
  settings,
  properties,
  viewer,
  selection,
  folder,
  trash,
  ru,
} from "./texts.ts";
export type { RuMessages } from "./texts.ts";
export { t } from "./t.ts";

export {
  ARCHITECTURE_LOCALES,
  USER_FACING_LOCALES,
  SHIPPED_LOCALES,
  LOCALE_NATIVE_LABELS,
  applyDocumentLang,
  isAppLocale,
  isUserFacingLocale,
  isShippedLocale,
  mapSystemLocale,
  readSystemLanguages,
  resolveLocale,
} from "./config.ts";
export type { AppLocale, UserFacingLocale, ResolveLocaleInput } from "./config.ts";

export { default as i18n, initI18n, setAppLocale } from "./i18n.ts";
export {
  KNOWN_ERROR_CODES,
  formatInvokeError,
  formatOutcomeError,
  isKnownErrorCode,
  localizeErrorCode,
} from "./errors.ts";
export type { KnownErrorCode } from "./errors.ts";
export {
  clearFormatterCaches,
  formatDate,
  formatDateTime,
  formatFileSize,
  formatNumber,
  uiIntlLocale,
} from "./formatters.ts";
