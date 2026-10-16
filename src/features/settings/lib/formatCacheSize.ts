import { formatNumber } from "../../shared/i18n/formatters.ts";
import i18n from "../../shared/i18n/i18n.ts";

/**
 * Cache used/limit label — MB/GB tiers only (same thresholds as before i18n).
 * Smaller values round to 0 MB, matching the previous product rule.
 */
export function formatCacheSize(bytes: number): string {
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
  const mb = Math.max(0, Math.round(bytes / (1024 * 1024)));
  return i18n.t("common.megabytes", { value: formatNumber(mb, { maximumFractionDigits: 0 }) });
}
