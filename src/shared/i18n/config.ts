/**
 * Реестр языков и политика выбора locale (без React / i18next).
 */

/** Языки, заложенные в архитектуру. */
export type AppLocale = "ru" | "en" | "de" | "zh-Hans";

/** Языки с готовым словарём, доступные пользователю. */
export type UserFacingLocale = AppLocale;

export const ARCHITECTURE_LOCALES: readonly AppLocale[] = [
  "ru",
  "en",
  "de",
  "zh-Hans",
] as const;

export const USER_FACING_LOCALES: readonly UserFacingLocale[] = [
  "ru",
  "en",
  "de",
  "zh-Hans",
] as const;

/** Языки с готовым словарём, выбираемые в Settings. */
export const SHIPPED_LOCALES: readonly UserFacingLocale[] = [
  "ru",
  "en",
  "de",
  "zh-Hans",
] as const;

/** Подписи языков сами на себе (для переключателя). */
export const LOCALE_NATIVE_LABELS: Record<AppLocale, string> = {
  ru: "Русский",
  en: "English",
  de: "Deutsch",
  "zh-Hans": "简体中文",
};

export function isShippedLocale(value: unknown): value is UserFacingLocale {
  return (
    typeof value === "string" &&
    (SHIPPED_LOCALES as readonly string[]).includes(value)
  );
}

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "ru" || value === "en" || value === "de" || value === "zh-Hans";
}

export function isUserFacingLocale(value: unknown): value is UserFacingLocale {
  return isAppLocale(value);
}

/**
 * Системная локаль → пользовательский язык UI.
 * Неизвестные языки → en.
 */
export function mapSystemLocale(tag: string): UserFacingLocale {
  const normalized = tag.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "ru" || normalized.startsWith("ru-")) {
    return "ru";
  }
  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en";
  }
  if (normalized === "de" || normalized.startsWith("de-")) {
    return "de";
  }
  if (normalized === "zh-hans" || normalized.startsWith("zh")) {
    return "zh-Hans";
  }
  return "en";
}

export type ResolveLocaleInput = {
  /** Значение из preferences (может отсутствовать / быть битым). */
  saved: unknown;
  /**
   * true — в storage уже были настройки без поля locale (или после v1→v2).
   * Тогда сохраняем русский (миграция), а не продуктовый en.
   */
  hasExistingPreferences: boolean;
  /**
   * Ранее — `navigator.languages` для автовыбора ОС.
   * Оставлено в API для совместимости вызовов; на выбор locale больше не влияет.
   */
  systemLanguages: readonly string[];
};

/**
 * Приоритет: сохранённый user-facing → (существующие prefs без locale → ru)
 * → en (продуктовый дефолт для новой установки и битого значения у нового пользователя).
 */
export function resolveLocale(input: ResolveLocaleInput): UserFacingLocale {
  if (isUserFacingLocale(input.saved)) {
    return input.saved;
  }
  if (input.saved === undefined || input.saved === null) {
    if (input.hasExistingPreferences) {
      return "ru";
    }
    return "en";
  }
  if (input.hasExistingPreferences) {
    // Повреждённое значение у существующего пользователя — не уводить с RU
    return "ru";
  }
  return "en";
}

export function readSystemLanguages(
  languageList: readonly string[] | undefined = typeof navigator !== "undefined"
    ? navigator.languages
    : undefined,
  language: string | undefined = typeof navigator !== "undefined" ? navigator.language : undefined,
): string[] {
  if (languageList && languageList.length > 0) {
    return [...languageList];
  }
  if (language) {
    return [language];
  }
  return [];
}

export function applyDocumentLang(locale: string): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.lang = locale;
}
