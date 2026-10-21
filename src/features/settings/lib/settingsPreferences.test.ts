import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

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
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  resetPreferencesToDefaults,
  savePreferences,
} from "./settingsPreferences.ts";
import {
  clearGallerySessionMemory,
  loadGallerySessionMemory,
  resolveInitialLayoutMode,
  resolveInitialRowsPerScreen,
  saveGallerySessionMemory,
  validateRowsPerScreen,
} from "./gallerySessionMemory.ts";

const V2 = "stitchvue.preferences.v2";
const V1 = "stitchvue.preferences.v1";

describe("settingsPreferences", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
    (globalThis as { sessionStorage?: Storage }).sessionStorage = memoryStorage();
    clearGallerySessionMemory();
  });

  afterEach(() => {
    clearGallerySessionMemory();
  });

  it("loads defaults for empty storage", () => {
    const prefs = loadPreferences();
    assert.equal(prefs.confirmMove, "mass");
    assert.equal(prefs.defaultLayoutMode, "mosaic");
    assert.equal(prefs.panelsPeekOnEdge, true);
    assert.equal(prefs.showPhotoDates, false);
    assert.equal(prefs.rememberLastFolder, false);
    assert.ok(["ru", "en", "de", "zh-Hans"].includes(prefs.locale));
  });

  it("defaults confirmMove to mass on empty storage", () => {
    assert.equal(loadPreferences().confirmMove, "mass");
    assert.notEqual(loadPreferences().confirmMove, "always");
  });

  it("defaults locale to en on fresh install", () => {
    const previous = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { language: "ru-RU", languages: ["ru-RU"] },
    });
    try {
      assert.equal(loadPreferences().locale, "en");
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: previous,
      });
    }
  });

  it("keeps ru for existing v2 prefs without locale and persists it", () => {
    const previous = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { language: "en-US", languages: ["en-US"] },
    });
    try {
      localStorage.setItem(
        V2,
        JSON.stringify({
          confirmMove: "never",
          panelsPeekOnEdge: false,
        }),
      );
      const prefs = loadPreferences();
      assert.equal(prefs.locale, "ru");
      assert.equal(prefs.confirmMove, "never");
      const stored = JSON.parse(localStorage.getItem(V2) ?? "{}") as { locale?: string };
      assert.equal(stored.locale, "ru");
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: previous,
      });
    }
  });

  it("persists explicit locale across load", () => {
    savePreferences({ locale: "en" });
    assert.equal(loadPreferences().locale, "en");
    savePreferences({ locale: "ru" });
    assert.equal(loadPreferences().locale, "ru");
  });

  it("defaults rememberLastFolder false when v2 omits the field", () => {
    localStorage.setItem(
      V2,
      JSON.stringify({
        confirmMove: "never",
        panelsPeekOnEdge: false,
      }),
    );
    const prefs = loadPreferences();
    assert.equal(prefs.rememberLastFolder, false);
  });

  it("defaults showPhotoDates false when v2 omits the field", () => {
    localStorage.setItem(
      V2,
      JSON.stringify({
        confirmMove: "never",
        panelsPeekOnEdge: false,
        animationsEnabled: false,
      }),
    );
    const prefs = loadPreferences();
    assert.equal(prefs.showPhotoDates, false);
    assert.equal(prefs.confirmMove, "never");
    assert.equal(prefs.panelsPeekOnEdge, false);
    assert.equal(prefs.animationsEnabled, false);
  });

  it("persists showPhotoDates toggle across load", () => {
    savePreferences({ showPhotoDates: true });
    assert.equal(loadPreferences().showPhotoDates, true);
    savePreferences({ showPhotoDates: false });
    assert.equal(loadPreferences().showPhotoDates, false);
  });

  it("migrates showPhotoDates from v1", () => {
    localStorage.setItem(
      V1,
      JSON.stringify({
        showPhotoDates: true,
        confirmMove: "mass",
      }),
    );
    const prefs = loadPreferences();
    assert.equal(prefs.showPhotoDates, true);
    assert.equal(prefs.confirmMove, "mass");
    const stored = JSON.parse(localStorage.getItem(V2) ?? "{}") as { showPhotoDates?: boolean };
    assert.equal(stored.showPhotoDates, true);
  });

  it("migrates missing showPhotoDates from v1 as false", () => {
    localStorage.setItem(V1, JSON.stringify({ confirmMove: "always" }));
    assert.equal(loadPreferences().showPhotoDates, false);
  });

  it("migrates v1 peek flags with AND rule", () => {
    localStorage.setItem(
      V1,
      JSON.stringify({
        sidebarPeekOnEdge: true,
        topNavPeekOnEdge: false,
        toolbarPeekOnEdge: true,
        confirmMove: "mass",
      }),
    );
    const prefs = loadPreferences();
    assert.equal(prefs.panelsPeekOnEdge, false);
    assert.equal(prefs.confirmMove, "mass");
    assert.ok(localStorage.getItem(V2));
  });

  it("migrates v1 remember pinned with AND rule", () => {
    localStorage.setItem(
      V1,
      JSON.stringify({
        rememberSidebarPinned: true,
        rememberTopNavPinned: false,
        rememberToolbarPinned: true,
      }),
    );
    const prefs = loadPreferences();
    assert.equal(prefs.rememberPanelsPinned, false);
  });

  it("handles corrupted json", () => {
    localStorage.setItem(V2, "{not-json");
    const prefs = loadPreferences();
    assert.deepEqual(prefs.confirmMove, DEFAULT_PREFERENCES.confirmMove);
  });

  it("reset restores defaults", () => {
    savePreferences({ confirmMove: "never", panelsPeekOnEdge: false, showPhotoDates: true, locale: "en" });
    resetPreferencesToDefaults();
    const prefs = loadPreferences();
    assert.equal(prefs.confirmMove, "mass");
    assert.equal(prefs.panelsPeekOnEdge, true);
    assert.equal(prefs.showPhotoDates, false);
    assert.equal(prefs.locale, "en");
  });

  it("migrates v1 without locale to ru", () => {
    const previous = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { language: "en-US", languages: ["en-US"] },
    });
    try {
      localStorage.setItem(V1, JSON.stringify({ confirmMove: "mass" }));
      const prefs = loadPreferences();
      assert.equal(prefs.locale, "ru");
      assert.equal(prefs.confirmMove, "mass");
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: previous,
      });
    }
  });
});

describe("gallerySessionMemory", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
    clearGallerySessionMemory();
  });

  it("resolves layout from memory when remember enabled", () => {
    saveGallerySessionMemory({ lastLayoutMode: "columns" });
    const mode = resolveInitialLayoutMode(
      { defaultLayoutMode: "grid", rememberLayoutMode: true },
      loadGallerySessionMemory(),
    );
    assert.equal(mode, "columns");
  });

  it("uses default when remember layout disabled", () => {
    saveGallerySessionMemory({ lastLayoutMode: "columns" });
    const mode = resolveInitialLayoutMode(
      { defaultLayoutMode: "grid", rememberLayoutMode: false },
      loadGallerySessionMemory(),
    );
    assert.equal(mode, "grid");
  });

  it("validates zoom steps", () => {
    assert.equal(validateRowsPerScreen(99), 8);
    assert.equal(validateRowsPerScreen(4), 4);
    assert.equal(resolveInitialRowsPerScreen({ rememberZoom: false }, { lastRowsPerScreen: 2 }), 4);
  });
});
