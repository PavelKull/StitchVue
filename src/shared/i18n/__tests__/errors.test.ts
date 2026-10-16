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

describe("i18n errors (stage 4)", () => {
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

  it("maps known codes to Russian phrases", async () => {
    const { initI18n } = await import("../i18n.ts");
    const { localizeErrorCode, formatOutcomeError, formatInvokeError } = await import(
      "../errors.ts"
    );
    initI18n();
    assert.equal(localizeErrorCode("locked"), "Файл занят другой программой");
    assert.equal(
      formatOutcomeError({ errorCode: "no_space", errorMessage: "сырой русский текст" }),
      "Недостаточно места на диске",
    );
    assert.equal(formatInvokeError(new Error("state_changed")), "Содержимое папки изменилось. Подтвердите удаление ещё раз");
  });

  it("unknown code and raw Russian message stay safe (no raw RU leak as translation)", async () => {
    const { initI18n, setAppLocale, default: i18n } = await import("../i18n.ts");
    const { formatInvokeError, localizeErrorCode } = await import("../errors.ts");
    initI18n();
    i18n.addResourceBundle(
      "en",
      "translation",
      {
        errors: {
          unknown: "Something went wrong",
          locked: "File is locked by another program",
        },
      },
      true,
      true,
    );
    await setAppLocale("en");
    const unknown = localizeErrorCode("totally_new_code");
    assert.equal(unknown, "Something went wrong");
    assert.equal(unknown.includes("Файл"), false);
    const fromRussian = formatInvokeError(new Error("Файл занят другой программой: photo.jpg"));
    assert.equal(fromRussian, "Something went wrong");
    assert.equal(fromRussian.includes("Файл"), false);
    assert.equal(localizeErrorCode("locked"), "File is locked by another program");
  });

  it("language switch updates error phrases", async () => {
    const { initI18n, setAppLocale, default: i18n } = await import("../i18n.ts");
    const { localizeErrorCode } = await import("../errors.ts");
    initI18n();
    i18n.addResource("en", "translation", "errors.cancelled", "Operation cancelled");
    assert.equal(localizeErrorCode("cancelled"), "Операция отменена");
    await setAppLocale("en");
    assert.equal(localizeErrorCode("cancelled"), "Operation cancelled");
    await setAppLocale("ru");
    assert.equal(localizeErrorCode("cancelled"), "Операция отменена");
  });
});
