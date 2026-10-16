import assert from "node:assert/strict";
import test from "node:test";
import type { ImageFile } from "../../../../entities/image/types.ts";
import { eventSessionIsCurrent } from "../directory/directorySession.ts";
import { recallHotFolder, rememberHotFolder, resetHotCache } from "../cache/folderHotCache.ts";
import {
  applyStreamBatch,
  emptyStreamListing,
  finishListing,
  listingStamp,
  publishedListing,
  type StreamListing,
} from "./galleryListing.ts";
import { DEFAULT_GALLERY_SORT, type GallerySort } from "./galleryOrder.ts";
import type { ImagesBatchEvent } from "./imagesBatch.ts";
import { layoutMosaicPublished } from "../../../../widgets/gallery-grid/layout.ts";

const dateSort: GallerySort = DEFAULT_GALLERY_SORT;
const nameSort: GallerySort = { key: "name", direction: "asc", grouped: false };

function file(name: string, modifiedAt = 0, folder = "C:\\photos"): ImageFile {
  return { name, path: `${folder}\\${name}`, size: modifiedAt > 0 ? 10 : 0, modifiedAt };
}

function namesBatch(files: ImageFile[], folder = "C:\\photos"): ImagesBatchEvent {
  return {
    session: 1,
    folder,
    phase: "names",
    files: files.map((item) => ({ ...item, size: 0, modifiedAt: 0 })),
  };
}

function statsBatch(files: ImageFile[], folder = "C:\\photos"): ImagesBatchEvent {
  return { session: 1, folder, phase: "stats", files };
}

function grow(listing: StreamListing, files: ImageFile[]): StreamListing {
  return applyStreamBatch(listing, namesBatch(files));
}

function pathsOf(files: ImageFile[]): string[] {
  return files.map((item) => item.path);
}

test("images-batch 48 → 240 → 1000 stays unpublished until the listing is complete", () => {
  let listing = emptyStreamListing();
  const all = Array.from({ length: 1000 }, (_, index) => file(`p${String(index).padStart(4, "0")}.jpg`, 1000 - index));
  listing = grow(listing, all.slice(0, 48));
  assert.equal(listing.discovered.length, 48);
  assert.deepEqual(publishedListing(listing, dateSort), []);
  listing = grow(listing, all.slice(48, 240));
  assert.equal(listing.discovered.length, 240);
  assert.deepEqual(publishedListing(listing, nameSort), []);
  listing = grow(listing, all.slice(240));
  listing = applyStreamBatch(listing, statsBatch(all));
  assert.equal(listing.discovered.length, 1000);
  assert.deepEqual(publishedListing(listing, dateSort), []);
  listing = finishListing(listing.discovered);
  const published = publishedListing(listing, dateSort);
  assert.equal(published.length, 1000);
  assert.equal(published[0]?.name, "p0000.jpg");
  assert.equal(new Set(pathsOf(published)).size, 1000);
});

test("name sort publishes only after the full name list is complete", () => {
  const files = [file("b.jpg", 1), file("a.jpg", 2), file("c.jpg", 3)];
  let listing = grow(emptyStreamListing(), files.slice(0, 2));
  assert.deepEqual(publishedListing(listing, nameSort), []);
  listing = finishListing(applyStreamBatch(listing, namesBatch([files[2]])).discovered);
  assert.deepEqual(
    publishedListing(listing, nameSort).map((item) => item.name),
    ["a.jpg", "b.jpg", "c.jpg"],
  );
});

test("date-grouped streaming stats must not invent a new visual order for already listed files", () => {
  let listing = grow(emptyStreamListing(), [file("old.jpg"), file("new.jpg")]);
  const streamed = pathsOf(publishedListing(listing, dateSort));
  listing = applyStreamBatch(
    listing,
    statsBatch([file("old.jpg", 1), file("new.jpg", 9)]),
  );
  const beforeComplete = pathsOf(publishedListing(listing, dateSort));
  assert.deepEqual(streamed, []);
  assert.deepEqual(beforeComplete, []);
  listing = finishListing(listing.discovered);
  const dated = pathsOf(publishedListing(listing, dateSort));
  assert.deepEqual(dated, ["C:\\photos\\new.jpg", "C:\\photos\\old.jpg"]);
  const replay = applyStreamBatch(listing, statsBatch([file("new.jpg", 9), file("old.jpg", 1)]));
  assert.deepEqual(pathsOf(publishedListing(replay, dateSort)), dated);
});

test("stats arriving out of order still yield one date order after complete", () => {
  let listing = grow(emptyStreamListing(), [file("a.jpg"), file("b.jpg"), file("c.jpg")]);
  listing = applyStreamBatch(listing, statsBatch([file("c.jpg", 30)]));
  listing = applyStreamBatch(listing, statsBatch([file("a.jpg", 10)]));
  listing = applyStreamBatch(listing, statsBatch([file("b.jpg", 20)]));
  listing = finishListing(listing.discovered);
  assert.deepEqual(
    publishedListing(listing, dateSort).map((item) => item.name),
    ["c.jpg", "b.jpg", "a.jpg"],
  );
});

test("finishing the listing publishes the short last row of a complete folder", () => {
  const files = [file("a.jpg", 3), file("b.jpg", 2), file("c.jpg", 1)];
  const listing = finishListing(files);
  const published = publishedListing(listing, nameSort);
  assert.equal(published.length, 3);
  assert.deepEqual(
    published.map((item) => item.name),
    ["a.jpg", "b.jpg", "c.jpg"],
  );
});

test("a watcher add creates a new complete order without duplicating paths", () => {
  const first = finishListing([file("a.jpg", 1), file("b.jpg", 2)]);
  const added = finishListing([file("a.jpg", 1), file("b.jpg", 2), file("c.jpg", 3)]);
  const published = publishedListing(added, nameSort);
  assert.deepEqual(
    published.map((item) => item.name),
    ["a.jpg", "b.jpg", "c.jpg"],
  );
  assert.notEqual(listingStamp(publishedListing(first, nameSort), nameSort), listingStamp(published, nameSort));
  assert.equal(new Set(pathsOf(published)).size, published.length);
});

test("deleting a published file drops it from the next complete listing", () => {
  const before = publishedListing(finishListing([file("a.jpg", 1), file("b.jpg", 2), file("c.jpg", 3)]), nameSort);
  const after = publishedListing(finishListing([file("a.jpg", 1), file("c.jpg", 3)]), nameSort);
  assert.deepEqual(
    after.map((item) => item.name),
    ["a.jpg", "c.jpg"],
  );
  assert.ok(!after.some((item) => item.name === "b.jpg"));
  assert.notEqual(listingStamp(before, nameSort), listingStamp(after, nameSort));
});

test("renaming a photo is a new listing identity", () => {
  const before = publishedListing(finishListing([file("old.jpg", 4), file("keep.jpg", 1)]), nameSort);
  const after = publishedListing(finishListing([file("new.jpg", 4), file("keep.jpg", 1)]), nameSort);
  assert.ok(after.some((item) => item.name === "new.jpg"));
  assert.ok(!after.some((item) => item.name === "old.jpg"));
  assert.notEqual(listingStamp(before, nameSort), listingStamp(after, nameSort));
  const renamedFolder = publishedListing(
    finishListing([file("old.jpg", 4, "C:\\renamed"), file("keep.jpg", 1, "C:\\renamed")]),
    nameSort,
  );
  assert.notEqual(listingStamp(before, nameSort), listingStamp(renamedFolder, nameSort));
});

test("switching folders does not keep the previous published list", () => {
  const first = publishedListing(finishListing([file("a.jpg", 1, "C:\\one")]), dateSort);
  const second = publishedListing(finishListing([file("b.jpg", 2, "C:\\two")]), dateSort);
  assert.equal(first[0]?.path.includes("one"), true);
  assert.equal(second[0]?.path.includes("two"), true);
  assert.notEqual(first[0]?.path, second[0]?.path);
});

test("a stale images-batch from a previous session is dropped", () => {
  assert.equal(eventSessionIsCurrent(1, 2), false);
  assert.equal(eventSessionIsCurrent(2, 2), true);
  let listing = finishListing([file("live.jpg", 8)]);
  listing = applyStreamBatch(listing, {
    session: 1,
    folder: "C:\\photos",
    phase: "names",
    files: [file("stale.jpg")],
  });
  assert.deepEqual(
    publishedListing(listing, nameSort).map((item) => item.name),
    ["live.jpg"],
  );
});

test("changing sort during indexing reorders only a complete listing", () => {
  let listing = grow(emptyStreamListing(), [file("b.jpg", 2), file("a.jpg", 1)]);
  listing = applyStreamBatch(listing, statsBatch([file("b.jpg", 2), file("a.jpg", 1)]));
  assert.deepEqual(publishedListing(listing, nameSort), []);
  listing = finishListing(listing.discovered);
  assert.deepEqual(
    publishedListing(listing, nameSort).map((item) => item.name),
    ["a.jpg", "b.jpg"],
  );
  assert.deepEqual(
    publishedListing(listing, dateSort).map((item) => item.name),
    ["b.jpg", "a.jpg"],
  );
});

test("reopening a folder from the hot cache keeps the complete listing", () => {
  resetHotCache();
  const images = [file("new.jpg", 9), file("old.jpg", 1)];
  rememberHotFolder({
    path: "C:\\photos",
    title: "photos",
    parent: "C:\\",
    folders: [],
    images,
    sort: dateSort,
    layoutMode: "mosaic",
    rowsPerScreen: 4,
    scrollTop: 0,
    meta: [],
    thumbs: [],
  });
  const hot = recallHotFolder("C:\\photos");
  assert.ok(hot);
  const published = publishedListing(finishListing(hot.images), hot.sort);
  assert.deepEqual(
    published.map((item) => item.name),
    ["new.jpg", "old.jpg"],
  );
  resetHotCache();
});

test("published listing has no duplicates or gaps after a full scan", () => {
  const files = Array.from({ length: 240 }, (_, index) => file(`img-${index}.jpg`, index + 1));
  const listing = finishListing(applyStreamBatch(grow(emptyStreamListing(), files), statsBatch(files)).discovered);
  const published = publishedListing(listing, dateSort);
  assert.equal(published.length, 240);
  assert.equal(new Set(pathsOf(published)).size, 240);
  const names = grow(emptyStreamListing(), files);
  assert.equal(names.discovered.length, 240);
  assert.equal(new Set(pathsOf(names.discovered)).size, 240);
});

test("sort of 1k / 10k / 20k files stays on the listing path, not metadata-batch", () => {
  const samples = [1000, 10_000, 20_000];
  const measured: Record<number, number> = {};
  for (const count of samples) {
    const files = Array.from({ length: count }, (_, index) =>
      file(`f${index}.jpg`, (count - index) * 10),
    );
    const listing = finishListing(files);
    const started = performance.now();
    const published = publishedListing(listing, dateSort);
    measured[count] = performance.now() - started;
    assert.equal(published.length, count);
    assert.equal(published[0]?.name, "f0.jpg");
  }
  const firstScreenSlots = Array.from({ length: 48 }, (_, index) => (index % 3 === 0 ? 0.67 : 1.5));
  const layoutStarted = performance.now();
  const firstScreen = layoutMosaicPublished(firstScreenSlots, 1600, 900, 4, 0, null, true);
  const firstScreenMs = performance.now() - layoutStarted;
  assert.ok((firstScreen.publishedEnd ?? 0) > 0);
  assert.ok(measured[1000]! < 200, `1k sort ${measured[1000]}ms`);
  assert.ok(measured[10_000]! < 800, `10k sort ${measured[10_000]}ms`);
  assert.ok(measured[20_000]! < 2000, `20k sort ${measured[20_000]}ms`);
  console.log(
    `listing sort ms: 1k=${measured[1000]?.toFixed(2)} 10k=${measured[10_000]?.toFixed(2)} 20k=${measured[20_000]?.toFixed(2)}; first mosaic screen=${firstScreenMs.toFixed(2)}ms`,
  );
});
