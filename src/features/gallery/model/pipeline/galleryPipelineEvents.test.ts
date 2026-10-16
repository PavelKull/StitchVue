import assert from "node:assert/strict";
import test from "node:test";
import type { DirectoryView } from "../../../../entities/folder/types.ts";
import { applyImagesBatch } from "../../lib/listing/imagesBatch.ts";
import { mergeMetaFromScanner } from "../../lib/pipeline/metaBatch.ts";

const baseView: DirectoryView = {
  title: "Photos",
  path: "C:\\photos",
  parent: "C:\\",
  folders: [],
  images: [
    { name: "a.jpg", path: "C:\\photos\\a.jpg", size: 1, modifiedAt: 1 },
    { name: "b.jpg", path: "C:\\photos\\b.jpg", size: 2, modifiedAt: 2 },
  ],
  serviceRole: null,
};

test("metadata-batch merge keeps display rotation when width and height update", () => {
  const merged = mergeMetaFromScanner({ width: 4000, height: 3000, rotationQuarters: 1 }, 4000, 3000);
  assert.equal(merged.rotationQuarters, 1);
  assert.equal(merged.width, 4000);
  assert.equal(merged.height, 3000);
});

test("images-batch stats merges size and mtime into the listing", () => {
  const next = applyImagesBatch(baseView, {
    session: 1,
    folder: "C:\\photos",
    phase: "stats",
    files: [{ name: "a.jpg", path: "C:\\photos\\a.jpg", size: 99, modifiedAt: 9 }],
  });
  assert.equal(next.images[0]?.size, 99);
  assert.equal(next.images[1]?.size, 2);
});

test("images-batch append adds only new paths", () => {
  const next = applyImagesBatch(baseView, {
    session: 1,
    folder: "C:\\photos",
    phase: "chunk",
    files: [
      { name: "b.jpg", path: "C:\\photos\\b.jpg", size: 2, modifiedAt: 2 },
      { name: "c.jpg", path: "C:\\photos\\c.jpg", size: 3, modifiedAt: 3 },
    ],
  });
  assert.equal(next.images.length, 3);
  assert.equal(next.images[2]?.path, "C:\\photos\\c.jpg");
});

test("images-batch append is a no-op when everything is already listed", () => {
  const next = applyImagesBatch(baseView, {
    session: 1,
    folder: "C:\\photos",
    phase: "chunk",
    files: [{ name: "a.jpg", path: "C:\\photos\\a.jpg", size: 1, modifiedAt: 1 }],
  });
  assert.equal(next, baseView);
});
