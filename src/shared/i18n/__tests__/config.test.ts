import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isShippedLocale,
  mapSystemLocale,
  resolveLocale,
  SHIPPED_LOCALES,
} from "../config.ts";

describe("i18n config locale resolution", () => {
  it("maps system tags to shipped locales", () => {
    assert.equal(mapSystemLocale("ru"), "ru");
    assert.equal(mapSystemLocale("ru-RU"), "ru");
    assert.equal(mapSystemLocale("en-US"), "en");
    assert.equal(mapSystemLocale("en-GB"), "en");
    assert.equal(mapSystemLocale("de-DE"), "de");
    assert.equal(mapSystemLocale("zh-CN"), "zh-Hans");
    assert.equal(mapSystemLocale("zh-SG"), "zh-Hans");
    assert.equal(mapSystemLocale("zh-Hans"), "zh-Hans");
    assert.equal(mapSystemLocale("fr-FR"), "en");
  });

  it("prefers saved user-facing locale", () => {
    assert.equal(
      resolveLocale({
        saved: "en",
        hasExistingPreferences: true,
        systemLanguages: ["ru-RU"],
      }),
      "en",
    );
    assert.equal(
      resolveLocale({
        saved: "de",
        hasExistingPreferences: true,
        systemLanguages: ["ru-RU"],
      }),
      "de",
    );
  });

  it("keeps ru for existing preferences without locale", () => {
    assert.equal(
      resolveLocale({
        saved: undefined,
        hasExistingPreferences: true,
        systemLanguages: ["en-US"],
      }),
      "ru",
    );
  });

  it("defaults to en on fresh install regardless of OS language", () => {
    assert.equal(
      resolveLocale({
        saved: undefined,
        hasExistingPreferences: false,
        systemLanguages: ["de-DE"],
      }),
      "en",
    );
    assert.equal(
      resolveLocale({
        saved: undefined,
        hasExistingPreferences: false,
        systemLanguages: ["zh-CN"],
      }),
      "en",
    );
    assert.equal(
      resolveLocale({
        saved: undefined,
        hasExistingPreferences: false,
        systemLanguages: ["ru-RU"],
      }),
      "en",
    );
    assert.equal(
      resolveLocale({
        saved: undefined,
        hasExistingPreferences: false,
        systemLanguages: [],
      }),
      "en",
    );
  });

  it("ships ru, en, de, and zh-Hans", () => {
    assert.deepEqual([...SHIPPED_LOCALES], ["ru", "en", "de", "zh-Hans"]);
    assert.equal(isShippedLocale("ru"), true);
    assert.equal(isShippedLocale("en"), true);
    assert.equal(isShippedLocale("de"), true);
    assert.equal(isShippedLocale("zh-Hans"), true);
  });

  it("maps bad values safely", () => {
    assert.equal(
      resolveLocale({
        saved: "nope",
        hasExistingPreferences: true,
        systemLanguages: ["en-US"],
      }),
      "ru",
    );
  });
});
