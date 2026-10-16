import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
  };
}

describe("i18n formatters", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
    localStorage.setItem(
      "stitchvue.preferences.v2",
      JSON.stringify({
        defaultLayoutMode: "mosaic",
        rememberLayoutMode: true,
        rememberZoom: true,
        rememberLastFolder: false,
        confirmMove: "always",
        panelsPeekOnEdge: true,
        rememberPanelsPinned: true,
        animationsEnabled: true,
        showPhotoDates: false,
        locale: "ru",
      }),
    );
  });

  afterEach(async () => {
    const { default: i18n } = await import("../i18n.ts");
    await i18n.changeLanguage("ru");
  });

  it("formats dates for ru and en", async () => {
    const { initI18n, setAppLocale } = await import("../i18n.ts");
    const { formatDate, formatDateTime } = await import("../formatters.ts");
    initI18n();
    const stamp = Date.UTC(2024, 2, 4, 12, 30, 0);
    assert.match(formatDate(stamp), /04/);
    assert.match(formatDate(stamp), /03/);
    assert.match(formatDate(stamp), /2024/);
    assert.match(formatDateTime(stamp), /2024/);

    await setAppLocale("en");
    const enDate = formatDate(stamp);
    assert.match(enDate, /2024/);
    assert.match(enDate, /03|3/);
    assert.match(enDate, /04|4/);
  });

  it("formats numbers and file sizes with unit labels", async () => {
    const { initI18n, setAppLocale } = await import("../i18n.ts");
    const { formatFileSize, formatNumber } = await import("../formatters.ts");
    initI18n();
    assert.match(formatNumber(1234).replace(/\s/g, " "), /1 234|1,234/);
    assert.match(formatFileSize(512), /512/);
    assert.match(formatFileSize(512), /Б/);
    assert.match(formatFileSize(2 * 1024 * 1024), /2/);
    assert.match(formatFileSize(2 * 1024 * 1024), /МБ/);

    await setAppLocale("en");
    assert.match(formatNumber(1234), /1,234/);
    assert.match(formatFileSize(2 * 1024 * 1024), /MB/);
    assert.match(formatFileSize(1024 * 1024 * 1024), /GB/);
  });
});
