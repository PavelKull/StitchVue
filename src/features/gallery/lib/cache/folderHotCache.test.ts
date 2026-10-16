import assert from "node:assert/strict";
import test from "node:test";
import type { ImageFile } from "../../../../entities/image/types.ts";
import {
  forgetHotFolder,
  HOT_FOLDER_LIMIT,
  recallHotFolder,
  rememberHotFolder,
  resetHotCache,
  retainUnchanged,
} from "./folderHotCache.ts";

function image(name: string, size = 10, modifiedAt = 5): ImageFile {
  return { name, path: `D:\\photos\\${name}`, size, modifiedAt };
}

function folder(path: string, count: number) {
  return {
    path,
    title: path,
    parent: null,
    folders: [],
    images: Array.from({ length: count }, (_, index) => image(`${path}-${index}.jpg`)),
    sort: { key: "date" as const, direction: "desc" as const, grouped: true },
    layoutMode: "grid" as const,
    rowsPerScreen: 4,
    scrollTop: 120,
    meta: [] as [string, { width: number; height: number }][],
    thumbs: [] as [string, { tier: number; thumbnailPath: string }][],
  };
}

test("forgetHotFolder drops one path without clearing the rest", () => {
  resetHotCache();
  rememberHotFolder(folder("D:\\trash", 3));
  rememberHotFolder(folder("D:\\other", 2));
  forgetHotFolder("D:\\trash");
  assert.equal(recallHotFolder("D:\\trash"), null);
  assert.ok(recallHotFolder("D:\\other"));
  resetHotCache();
});

test("the sixth folder drops the least recently used one", () => {
  resetHotCache();
  for (let index = 0; index < HOT_FOLDER_LIMIT; index += 1) {
    rememberHotFolder(folder(`D:\\set\\${index}`, 2));
  }
  recallHotFolder("D:\\set\\0");
  rememberHotFolder(folder("D:\\set\\next", 2));
  assert.equal(recallHotFolder("D:\\set\\1"), null);
  assert.ok(recallHotFolder("D:\\set\\0"));
  assert.ok(recallHotFolder("D:\\set\\next"));
  resetHotCache();
});

test("a changed file drops its cached geometry and thumbnail", () => {
  const previous = [image("a.jpg", 10, 1), image("b.jpg", 10, 1)];
  const next = [image("a.jpg", 10, 1), image("b.jpg", 99, 2), image("c.jpg", 10, 1)];
  const meta = new Map([
    ["D:\\photos\\a.jpg", { width: 3, height: 2 }],
    ["D:\\photos\\b.jpg", { width: 1, height: 1 }],
  ]);
  const thumbs = new Map([
    ["D:\\photos\\a.jpg", { tier: 256, thumbnailPath: "a.jpg" }],
    ["D:\\photos\\b.jpg", { tier: 256, thumbnailPath: "b.jpg" }],
  ]);
  const failed = new Map<string, string>();
  retainUnchanged(previous, next, meta, thumbs, failed);
  assert.equal(meta.has("D:\\photos\\a.jpg"), true);
  assert.equal(meta.has("D:\\photos\\b.jpg"), false);
  assert.equal(thumbs.has("D:\\photos\\b.jpg"), false);
});
