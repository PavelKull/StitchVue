/**
 * Единый экземпляр i18next. Инициализировать до первого рендера React.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import {
  loadPreferences,
  savePreferences,
} from "../../features/settings/lib/settingsPreferences.ts";
import {
  applyDocumentLang,
  isUserFacingLocale,
  type UserFacingLocale,
} from "./config.ts";
import de from "./locales/de.json" with { type: "json" };
import en from "./locales/en.json" with { type: "json" };
import ru from "./locales/ru.json" with { type: "json" };
import zhHans from "./locales/zh-Hans.json" with { type: "json" };

let initialized = false;

function missingKeyMessage(key: string): string {
  try {
    if (import.meta.env?.DEV) {
      console.warn(`[i18n] missing key: ${key}`);
      return key;
    }
  } catch {
    /* non-Vite host */
  }
  return "";
}

/**
 * Синхронная инициализация i18n + `document.documentElement.lang`.
 * Повторный вызов безопасен (no-op для init, lang пересинхронизируется).
 */
export function initI18n(): typeof i18n {
  if (!initialized) {
    const prefs = loadPreferences();
    const lng: UserFacingLocale = isUserFacingLocale(prefs.locale) ? prefs.locale : "ru";

    i18n.use(initReactI18next);
    void i18n.init({
      resources: {
        ru: { translation: ru },
        en: { translation: en },
        de: { translation: de },
        "zh-Hans": { translation: zhHans },
      },
      lng,
      fallbackLng: "ru",
      supportedLngs: ["ru", "en", "de", "zh-Hans"],
      // false: `zh-Hans` breaks under nonExplicitSupportedLngs (falls back to ru).
      nonExplicitSupportedLngs: false,
      defaultNS: "translation",
      interpolation: {
        escapeValue: false,
      },
      returnNull: false,
      returnEmptyString: false,
      parseMissingKeyHandler: missingKeyMessage,
      react: {
        useSuspense: false,
      },
    });

    initialized = true;
  }

  applyDocumentLang(i18n.resolvedLanguage ?? i18n.language ?? "ru");
  return i18n;
}

/** Смена языка runtime (prefs + i18n + lang). */
export async function setAppLocale(locale: UserFacingLocale): Promise<void> {
  savePreferences({ locale });
  initI18n();
  await i18n.changeLanguage(locale);
  applyDocumentLang(locale);
}

export default i18n;
