import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { FolderShortcut } from "../types.ts";

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

describe("folderDisplayName", () => {
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

  it("localizes places and drives without changing paths", async () => {
    const { initI18n } = await import("../../../shared/i18n/i18n.ts");
    const { folderDisplayName, directoryTitle } = await import("../folderDisplayName.ts");
    initI18n();

    const desktop: FolderShortcut = {
      name: "Desktop",
      path: "C:\\Users\\Test\\Desktop",
      kind: "place",
      placeCode: "desktop",
    };
    assert.equal(folderDisplayName(desktop), "Рабочий стол");
    assert.equal(desktop.path, "C:\\Users\\Test\\Desktop");

    const drive: FolderShortcut = {
      name: "",
      path: "D:\\",
      kind: "drive",
      placeCode: "drive",
      driveLetter: "D",
      driveKind: "fixed",
    };
    assert.equal(folderDisplayName(drive), "Локальный диск (D:)");

    const labeled: FolderShortcut = {
      name: "Data",
      path: "E:\\",
      kind: "drive",
      placeCode: "drive",
      driveLetter: "E",
      driveKind: "fixed",
    };
    assert.equal(folderDisplayName(labeled), "Data (E:)");

    assert.equal(
      directoryTitle({ title: "This PC", path: null, placeCode: "this-pc" }),
      "Этот компьютер",
    );
  });
});
