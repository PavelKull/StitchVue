import assert from "node:assert/strict";
import test from "node:test";
import {
  applyStreamBatch,
  emptyStreamListing,
  finishListing,
  publishedListing,
} from "../../features/gallery/lib/listing/galleryListing.ts";
import type { GallerySort } from "../../features/gallery/lib/listing/galleryOrder.ts";

const dateGroupedSort: GallerySort = { key: "date", direction: "desc", grouped: true };
import {
  ESTIMATED_ASPECT,
  firstGeometryRange,
  firstScreenFileCount,
  GEOMETRY_FIRST_WAIT_MS,
  layoutColumnsPublished,
  layoutMosaicPublished,
  layoutSegmented,
  refineSegmentedLayout,
  rowsCovering,
  SEGMENT_SIZE,
  type SegmentedLayout,
} from "./layout.ts";

const WIDTH = 1600;
const VIEWPORT = 900;
const ROWS = 4;
const FIT = 0;

type TileBox = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

function boxesOf(layout: SegmentedLayout): TileBox[] {
  const rows = rowsCovering(layout, 0, Math.max(layout.height, 1));
  const tiles: TileBox[] = [];
  for (const row of rows) {
    for (const tile of row.tiles) {
      tiles.push({
        index: tile.index,
        x: tile.x,
        y: row.top,
        width: tile.width,
        height: row.height,
      });
    }
  }
  return tiles.sort((left, right) => left.index - right.index);
}

function boxMap(layout: SegmentedLayout): Map<number, TileBox> {
  return new Map(boxesOf(layout).map((tile) => [tile.index, tile]));
}

function firstRowIndices(layout: SegmentedLayout): number[] {
  const row = layout.segments[0]?.template[0];
  if (!row) {
    return [];
  }
  return row.tiles.map((tile) => tile.index + (layout.segments[0]?.start ?? 0));
}

function mixedAspects(count: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    if (index % 5 === 0) {
      return 0.67;
    }
    if (index % 3 === 0) {
      return 1;
    }
    return 1.5;
  });
}

/** Deterministic mix that makes mosaic DP change earlier rows when the tail is still 3:2. */
function seededAspects(count: number, seed: number): number[] {
  let state = seed + 1;
  return Array.from({ length: count }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    const pick = (state >>> 0) / 4294967296;
    if (pick < 0.25) {
      return 0.5;
    }
    if (pick < 0.4) {
      return 0.67;
    }
    if (pick < 0.55) {
      return 1;
    }
    if (pick < 0.8) {
      return 1.5;
    }
    return 2.2;
  });
}

test("control: refine is a no-op when aspects did not change", () => {
  const aspects = mixedAspects(80);
  const layout = layoutSegmented(aspects, WIDTH, VIEWPORT, ROWS, FIT, "mosaic");
  const refined = refineSegmentedLayout(
    layout,
    aspects,
    0,
    8,
    WIDTH,
    VIEWPORT,
    ROWS,
    FIT,
    "mosaic",
  );
  assert.equal(refined, null);
});

test("published mosaic tiles stay put when later metadata arrives", () => {
  const real = mixedAspects(80);
  const firstSlots: Array<number | null> = real.map((aspect, index) => (index < 40 ? aspect : null));
  const layout = layoutMosaicPublished(firstSlots, WIDTH, VIEWPORT, ROWS, FIT);
  const published = firstRowIndices(layout);
  assert.ok(published.length > 0, "trusted prefix must publish a first row");
  const before = boxMap(layout);
  const refined = layoutMosaicPublished(
    real.map((aspect) => aspect),
    WIDTH,
    VIEWPORT,
    ROWS,
    FIT,
    layout,
  );
  const after = boxMap(refined);
  for (const index of published) {
    assert.deepEqual(after.get(index), before.get(index), `published tile ${index} moved after metadata`);
  }
});

test("chooseBreaks does not move the first row when files below the fold get sizes", () => {
  const real = seededAspects(80, 1);
  const head = firstScreenFileCount(WIDTH, VIEWPORT, ROWS, real.length);
  const waiting = layoutMosaicPublished(
    real.map((aspect, index) => (index < 40 ? aspect : null)),
    WIDTH,
    VIEWPORT,
    ROWS,
    FIT,
  );
  const ready = layoutMosaicPublished(
    real.map((aspect) => aspect),
    WIDTH,
    VIEWPORT,
    ROWS,
    FIT,
    waiting,
  );
  const published = firstRowIndices(waiting);
  const before = boxMap(waiting);
  const after = boxMap(ready);
  assert.ok(published.length > 0, "trusted prefix must publish a first row");
  assert.ok(head > published.length, "first geometry window still contains files below the first row");
  for (const index of published) {
    assert.deepEqual(after.get(index), before.get(index), `first-row tile ${index} moved after tail sizes`);
  }
});

test("a later images-batch does not rebuild already published mosaic tiles", () => {
  const real = seededAspects(80, 4);
  const firstSlots: Array<number | null> = real.slice(0, 48);
  const firstBatch = layoutMosaicPublished(firstSlots, WIDTH, VIEWPORT, ROWS, FIT, null, false);
  const onScreen = boxesOf(firstBatch).filter((tile) => tile.y < VIEWPORT);
  assert.ok(onScreen.length > 0);
  const laterSlots: Array<number | null> = real.concat(Array.from({ length: 160 }, () => null));
  const afterListing = layoutMosaicPublished(laterSlots, WIDTH, VIEWPORT, ROWS, FIT, firstBatch, false);
  const after = boxMap(afterListing);
  for (const tile of onScreen) {
    assert.deepEqual(
      after.get(tile.index),
      tile,
      `published tile ${tile.index} moved when the listing grew from 48 to 240`,
    );
  }
});

test("metadata arriving out of order does not move a locked mosaic prefix", () => {
  const real = mixedAspects(64);
  let slots: Array<number | null> = Array.from({ length: 64 }, () => null);
  let layout = layoutMosaicPublished(slots, WIDTH, VIEWPORT, ROWS, FIT);
  const order = [11, 2, 7, 0, 40, 3, 1, 18, 5, 4, 6, 8, 10, 9, 12, 14, 13, 15, 17, 16, 19, 21, 20, 22, 24, 23, 25, 27, 26, 28, 30, 29, 31, 33, 32, 34, 36, 35, 37, 39, 38];
  for (const index of order) {
    const before = boxMap(layout);
    slots = slots.slice();
    slots[index] = real[index] ?? ESTIMATED_ASPECT;
    const next = layoutMosaicPublished(slots, WIDTH, VIEWPORT, ROWS, FIT, layout);
    const after = boxMap(next);
    for (const tile of before.values()) {
      assert.deepEqual(after.get(tile.index), tile, `locked tile ${tile.index} moved during shuffled metadata`);
    }
    layout = next;
  }
  assert.ok((layout.publishedEnd ?? 0) > 0);
});

test("columns do not reassign a published tile when a later aspect arrives", () => {
  const real = mixedAspects(40);
  const firstSlots: Array<number | null> = real.map((aspect, index) => (index < 6 ? aspect : null));
  const layout = layoutColumnsPublished(firstSlots, WIDTH, VIEWPORT, ROWS, null, true, FIT);
  const before = boxMap(layout);
  assert.equal(before.size, 6);
  const refined = layoutColumnsPublished(
    real.map((aspect) => aspect),
    WIDTH,
    VIEWPORT,
    ROWS,
    layout,
    true,
    FIT,
  );
  const after = boxMap(refined);
  for (const index of [0, 1, 2, 3, 4, 5]) {
    assert.deepEqual(after.get(index), before.get(index), `column tile ${index} moved after later metadata`);
  }
});

test("timeout paint with leftover 3:2 slots must not become the published first screen", () => {
  const real = mixedAspects(36);
  const waiting = layoutMosaicPublished(
    real.map((aspect, index) => (index < 2 ? aspect : null)),
    WIDTH,
    VIEWPORT,
    ROWS,
    FIT,
  );
  assert.equal(GEOMETRY_FIRST_WAIT_MS, 800);
  assert.equal(waiting.publishedEnd ?? 0, 0);
  assert.equal(boxesOf(waiting).length, 0);
  assert.ok(waiting.height > 0);
  const ready = layoutMosaicPublished(
    real.map((aspect) => aspect),
    WIDTH,
    VIEWPORT,
    ROWS,
    FIT,
    waiting,
  );
  const published = boxesOf(ready);
  assert.ok(published.length > 0);
  for (const tile of published) {
    assert.equal(ready.usedAspects[tile.index], real[tile.index]);
  }
});

test("first-screen metadata demand is not a fixed 64 and must fit the nearby header window", () => {
  const screen = firstScreenFileCount(1920, 900, 4, 5000);
  const range = firstGeometryRange(1920, 900, 4, 5000);
  const decodeDefault = 32;
  assert.notEqual(screen, SEGMENT_SIZE);
  assert.ok(Number.isInteger(screen), `firstScreenFileCount must be an integer, got ${screen}`);
  assert.equal(range.start, 0);
  assert.equal(range.end, screen);
  assert.ok(
    screen > decodeDefault,
    "first geometry range is wider than the default visible decode window and must be sent separately",
  );
});

test("zoom 1.5 does not request a fractional number of first-screen files", () => {
  const screen = firstScreenFileCount(1800, 900, 1.5, 1000);
  assert.equal(screen % 1, 0, `expected an integer file count, got ${screen}`);
});

test("date-grouped streaming stats must not invent a new visual order for already listed files", () => {
  let listing = applyStreamBatch(emptyStreamListing(), {
    session: 1,
    folder: "C:\\photos",
    phase: "names",
    files: [
      { name: "old.jpg", path: "C:\\photos\\old.jpg", size: 0, modifiedAt: 0 },
      { name: "new.jpg", path: "C:\\photos\\new.jpg", size: 0, modifiedAt: 0 },
    ],
  });
  const streamed = publishedListing(listing, dateGroupedSort).map((file) => file.path);
  listing = applyStreamBatch(listing, {
    session: 1,
    folder: "C:\\photos",
    phase: "stats",
    files: [
      { name: "old.jpg", path: "C:\\photos\\old.jpg", size: 10, modifiedAt: 1 },
      { name: "new.jpg", path: "C:\\photos\\new.jpg", size: 10, modifiedAt: 9 },
    ],
  });
  assert.deepEqual(streamed, []);
  assert.deepEqual(publishedListing(listing, dateGroupedSort).map((file) => file.path), []);
  const dated = publishedListing(finishListing(listing.discovered), dateGroupedSort).map((file) => file.path);
  assert.deepEqual(dated, ["C:\\photos\\new.jpg", "C:\\photos\\old.jpg"]);
});

test("a stale metadata session does not keep items from a previous folder open", async () => {
  const { keepCurrentSession } = await import("../../features/gallery/lib/directory/directorySession.ts");
  const kept = keepCurrentSession(
    [
      { session: 1, path: "C:\\old\\a.jpg", width: 4000, height: 3000 },
      { session: 2, path: "C:\\now\\b.jpg", width: 2000, height: 1000 },
    ],
    2,
  );
  assert.deepEqual(
    kept.map((item) => item.path),
    ["C:\\now\\b.jpg"],
  );
});
