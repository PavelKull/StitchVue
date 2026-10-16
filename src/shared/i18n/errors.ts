/**
 * Маппинг стабильных кодов ошибок Tauri → ключи i18n.
 * UI показывает перевод кода, не сырой `error.message`.
 */

import i18n from "./i18n.ts";

/** Коды, для которых есть отдельная пользовательская фраза. */
export const KNOWN_ERROR_CODES = [
  "locked",
  "no_space",
  "access_denied",
  "not_found",
  "not_same_volume",
  "name_conflict",
  "outside",
  "reparse",
  "cancelled",
  "io_error",
  "not_image",
  "destination",
  "favorite_link",
  "unsupported",
  "state_changed",
  "name_taken",
  "origin_missing",
] as const;

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

const ERROR_KEY_BY_CODE: Record<KnownErrorCode, string> = {
  locked: "errors.locked",
  no_space: "errors.no_space",
  access_denied: "errors.access_denied",
  not_found: "errors.not_found",
  not_same_volume: "errors.not_same_volume",
  name_conflict: "errors.name_conflict",
  outside: "errors.outside",
  reparse: "errors.reparse",
  cancelled: "errors.cancelled",
  io_error: "errors.io_error",
  not_image: "errors.not_image",
  destination: "errors.destination",
  favorite_link: "errors.favorite_link",
  unsupported: "errors.unsupported",
  state_changed: "errors.state_changed",
  name_taken: "errors.name_taken",
  origin_missing: "errors.origin_missing",
};

export function isKnownErrorCode(value: unknown): value is KnownErrorCode {
  return typeof value === "string" && (KNOWN_ERROR_CODES as readonly string[]).includes(value);
}

/** Локализованное сообщение по коду. Неизвестный код → общая фраза. */
export function localizeErrorCode(code: string | null | undefined): string {
  if (isKnownErrorCode(code)) {
    return i18n.t(ERROR_KEY_BY_CODE[code]);
  }
  return i18n.t("errors.unknown");
}

/**
 * Ошибка invoke / throw: если тело — известный код, переводим его.
 * Иначе не показываем сырой русский `message` пользователю.
 */
export function formatInvokeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.trim();
  if (isKnownErrorCode(trimmed)) {
    return localizeErrorCode(trimmed);
  }
  // Иногда Tauri оборачивает: `...: state_changed`
  for (const code of KNOWN_ERROR_CODES) {
    if (trimmed === code || trimmed.endsWith(`: ${code}`) || trimmed.endsWith(` ${code}`)) {
      return localizeErrorCode(code);
    }
  }
  if (import.meta.env?.DEV) {
    console.warn("[i18n] unlocalized invoke error:", trimmed);
  }
  return localizeErrorCode(null);
}

/** FileOutcome: приоритет errorCode над errorMessage. */
export function formatOutcomeError(outcome: {
  errorCode?: string | null;
  errorMessage?: string | null;
}): string {
  if (outcome.errorCode) {
    return localizeErrorCode(outcome.errorCode);
  }
  if (outcome.errorMessage && isKnownErrorCode(outcome.errorMessage.trim())) {
    return localizeErrorCode(outcome.errorMessage.trim());
  }
  return localizeErrorCode(null);
}
