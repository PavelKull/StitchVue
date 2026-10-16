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

describe("i18n init (stage 5)", () => {
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

  it("initI18n loads ru catalog and resolves nested keys", async () => {
    const { initI18n, default: i18n } = await import("../i18n.ts");
    initI18n();
    assert.equal(i18n.isInitialized, true);
    assert.equal(i18n.t("common.cancel"), "Отмена");
    assert.equal(i18n.t("gallery.emptyFolder"), "Папка пуста");
  });

  it("setAppLocale switches to shipped English and persists", async () => {
    const { initI18n, setAppLocale, default: i18n } = await import("../i18n.ts");
    initI18n();
    await setAppLocale("en");
    assert.equal(i18n.language, "en");
    assert.equal(i18n.t("common.cancel"), "Cancel");
    assert.equal(i18n.t("places.favorites"), "Favorites");
    assert.equal(i18n.t("places.trash"), "Deleted");
    const { loadPreferences } = await import(
      "../../../features/settings/settingsPreferences.ts"
    );
    assert.equal(loadPreferences().locale, "en");
  });

  it("switches EN → RU without losing catalog keys", async () => {
    const { initI18n, setAppLocale, default: i18n } = await import("../i18n.ts");
    initI18n();
    await setAppLocale("en");
    assert.equal(i18n.t("common.cancel"), "Cancel");
    await setAppLocale("ru");
    assert.equal(i18n.t("common.cancel"), "Отмена");
    assert.equal(i18n.language, "ru");
  });

  it("loads German and Simplified Chinese dictionaries", async () => {
    const { initI18n, setAppLocale, default: i18n } = await import("../i18n.ts");
    initI18n();
    await setAppLocale("de");
    assert.equal(i18n.t("common.cancel"), "Abbrechen");
    await setAppLocale("zh-Hans");
    assert.equal(i18n.t("common.cancel"), "取消");
    assert.equal(i18n.language, "zh-Hans");
  });
});
