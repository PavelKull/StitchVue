import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  common,
  folder,
  gallery,
  places,
  properties,
  ru,
  selection,
  settings,
  sidebar,
  supportReminder,
  appUpdate,
  toolbar,
  topNav,
  trash,
  viewer,
} from "../texts.ts";
import { t } from "../t.ts";

const ROOT_NAMESPACES = [
  "common",
  "places",
  "errors",
  "gallery",
  "toolbar",
  "topNav",
  "sidebar",
  "settings",
  "properties",
  "viewer",
  "selection",
  "folder",
  "trash",
  "supportReminder",
  "appUpdate",
] as const;

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

function collectStrings(
  value: unknown,
  path: string,
  out: Array<{ path: string; text: string }>,
): void {
  if (typeof value === "string") {
    out.push({ path, text: value });
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectStrings(child, path ? `${path}.${key}` : key, out);
    }
  }
}

function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((match) => match[1]!).sort();
}

describe("i18n catalog (stage 1)", () => {
  it("exports every root namespace from ru.json", () => {
    assert.deepEqual(Object.keys(ru).sort(), [...ROOT_NAMESPACES].sort());
    assert.equal(ru.common, common);
    assert.equal(ru.places, places);
    assert.equal(ru.gallery, gallery);
    assert.equal(ru.toolbar, toolbar);
    assert.equal(ru.topNav, topNav);
    assert.equal(ru.sidebar, sidebar);
    assert.equal(ru.settings, settings);
    assert.equal(ru.properties, properties);
    assert.equal(ru.viewer, viewer);
    assert.equal(ru.selection, selection);
    assert.equal(ru.folder, folder);
    assert.equal(ru.trash, trash);
    assert.equal(ru.supportReminder, supportReminder);
    assert.equal(ru.appUpdate, appUpdate);
  });

  it("has no empty leaf strings", () => {
    const leaves: Array<{ path: string; text: string }> = [];
    collectStrings(ru, "", leaves);
    assert.ok(leaves.length > 200, `expected a full catalog, got ${leaves.length}`);
    for (const leaf of leaves) {
      assert.notEqual(leaf.text.trim(), "", leaf.path);
    }
  });

  it("keeps well-formed {{placeholders}}", () => {
    const leaves: Array<{ path: string; text: string }> = [];
    collectStrings(ru, "", leaves);
    const withVars = leaves.filter((leaf) => leaf.text.includes("{{"));
    assert.ok(withVars.length > 10);
    for (const leaf of withVars) {
      assert.match(leaf.text, /\{\{\w+\}\}/, leaf.path);
      assert.equal(leaf.text.includes("{ {"), false, leaf.path);
      assert.ok(placeholders(leaf.text).length > 0, leaf.path);
    }
  });

  it("interpolates via t() without changing static catalog values", () => {
    assert.equal(common.errorToast, "Ошибка: {{message}}");
    assert.equal(t(common.errorToast, { message: "access_denied" }), "Ошибка: access_denied");
    assert.equal(t(selection.selectedCount, { count: 3 }), "Выделено: 3");
    assert.equal(gallery.emptyFolder.title, "Папка пуста");
  });

  it("ru.json parses and matches the texts facade", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(dir, "../locales/ru.json"), "utf8");
    const parsed = JSON.parse(raw) as typeof ru;
    assert.deepEqual(parsed, ru);
  });
});
