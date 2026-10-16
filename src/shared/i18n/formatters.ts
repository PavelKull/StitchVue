/**
 * Локализованные форматтеры дат/чисел/размеров.
 * Экземпляры кэшируются по UI-locale; сортировка файлов сюда не привязана.
 */

import i18n from "./i18n.ts";

type CacheKey = string;

const dateCache = new Map<CacheKey, Intl.DateTimeFormat>();
const dateTimeCache = new Map<CacheKey, Intl.DateTimeFormat>();
const numberCache = new Map<CacheKey, Intl.NumberFormat>();

/** BCP 47 tag for Intl from active UI language. */
export function uiIntlLocale(): string {
  const lng = (i18n.resolvedLanguage ?? i18n.language ?? "ru").toLowerCase();
  if (lng === "en" || lng.startsWith("en-")) {
    return "en-US";
  }
  if (lng === "ru" || lng.startsWith("ru-")) {
    return "ru-RU";
  }
  if (lng === "de" || lng.startsWith("de-")) {
    return "de-DE";
  }
  if (lng === "zh-hans" || lng.startsWith("zh")) {
    return "zh-CN";
  }
  return lng;
}

function cacheKey(locale: string, options: Intl.DateTimeFormatOptions | Intl.NumberFormatOptions): CacheKey {
  return `${locale}|${JSON.stringify(options)}`;
}

function getDateFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = uiIntlLocale();
  const key = cacheKey(locale, options);
  let formatter = dateCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateCache.set(key, formatter);
  }
  return formatter;
}

function getDateTimeFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = uiIntlLocale();
  const key = cacheKey(locale, options);
  let formatter = dateTimeCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateTimeCache.set(key, formatter);
  }
  return formatter;
}

function getNumberFormatter(options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const locale = uiIntlLocale();
  const key = cacheKey(locale, options);
  let formatter = numberCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberCache.set(key, formatter);
  }
  return formatter;
}

/** Short calendar date for gallery tiles (locale-aware). */
export function formatDate(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return getDateFormatter({ day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

/** Date + time for properties and diagnostics. */
export function formatDateTime(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return getDateTimeFormatter({
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return getNumberFormatter(options).format(value);
}

/**
 * Product file-size tiers (B / KB / MB / GB) with localized unit labels.
 * Thresholds unchanged from formatCacheSize.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  const gb = 1024 * 1024 * 1024;
  if (bytes >= gb) {
    const value = bytes / gb;
    const formatted =
      value % 1 === 0
        ? formatNumber(value, { maximumFractionDigits: 0 })
        : formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return i18n.t("common.gigabytes", { value: formatted });
  }
  if (bytes >= 1024 * 1024) {
    const mb = Math.max(0, Math.round(bytes / (1024 * 1024)));
    return i18n.t("common.megabytes", { value: formatNumber(mb, { maximumFractionDigits: 0 }) });
  }
  if (bytes >= 1024) {
    const kb = Math.max(1, Math.round(bytes / 1024));
    return i18n.t("common.kilobytes", { value: formatNumber(kb, { maximumFractionDigits: 0 }) });
  }
  return i18n.t("common.bytes", { value: formatNumber(bytes, { maximumFractionDigits: 0 }) });
}

/** Clear caches after language change (optional; formatters rebuild lazily). */
export function clearFormatterCaches(): void {
  dateCache.clear();
  dateTimeCache.clear();
  numberCache.clear();
}

i18n.on("languageChanged", () => {
  clearFormatterCaches();
});
