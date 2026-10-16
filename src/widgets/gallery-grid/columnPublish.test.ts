import assert from "node:assert/strict";
import test from "node:test";
import { eventSessionIsCurrent } from "../../features/gallery/lib/directory/directorySession.ts";
import { listingStamp } from "../../features/gallery/lib/listing/galleryListing.ts";
import { DEFAULT_GALLERY_SORT } from "../../features/gallery/lib/listing/galleryOrder.ts";
import {
  ESTIMATED_ASPECT,
  layoutColumnsPublished,
  layoutGallery,
  layoutMosaicPublished,
  mosaicLayoutKey,
  rowsCovering,
  type MasonryTile,
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

function slotsFrom(real: number[], known: number): Array<number | null> {
  return real.map((aspect, index) => (index < known ? aspect : null));
}

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

function allColumnTiles(layout: SegmentedLayout): MasonryTile[] {
  return (layout.segments[0]?.columns ?? []).flat();
}

function assertBoxesStay(before: Map<number, TileBox>, after: SegmentedLayout, label: string): void {
  const next = boxMap(after);
  for (const [index, tile] of before) {
    assert.deepEqual(next.get(index), tile, `${label}: tile ${index} moved`);
  }
}

function assertPackedColumns(layout: SegmentedLayout): void {
  const seen = new Set<number>();
  for (const column of layout.segments[0]?.columns ?? []) {
    let y = 0;
    for (const tile of column) {
      assert.equal(tile.y, y, `column gap or overlap at index ${tile.index}`);
      assert.ok(!seen.has(tile.index), `duplicate index ${tile.index}`);
      seen.add(tile.index);
      y += tile.height;
    }
  }
  assert.equal(seen.size, layout.publishedEnd ?? 0);
}

test("late metadata of the first photo publishes it without inventing 3:2 tiles", () => {
  const real = mixedAspects(24);
  const waiting = layoutColumnsPublished(slotsFrom(real, 0), WIDTH, VIEWPORT, ROWS, null, true, FIT);
  assert.equal(waiting.publishedEnd ?? 0, 0);
  assert.equal(boxesOf(waiting).length, 0);
  assert.ok(waiting.height > 0);
  const ready = layoutColumnsPublished(slotsFrom(real, 1), WIDTH, VIEWPORT, ROWS, waiting, true, FIT);
  assert.equal(ready.publishedEnd, 1);
  assert.equal(ready.usedAspects[0], real[0]);
  assert.notEqual(real[0], ESTIMATED_ASPECT);
});

test("late metadata in the middle of the list does not move the published prefix", () => {
  const real = mixedAspects(40);
  const first = layoutColumnsPublished(slotsFrom(real, 12), WIDTH, VIEWPORT, ROWS, null, true, FIT);
  const before = boxMap(first);
  assert.equal(before.size, 12);
  const second = layoutColumnsPublished(slotsFrom(real, 24), WIDTH, VIEWPORT, ROWS, first, true, FIT);
  assertBoxesStay(before, second, "middle metadata");
  assert.equal(second.publishedEnd, 24);
});

test("late metadata at the end of the list only appends new column tiles", () => {
  const real = mixedAspects(40);
  const first = layoutColumnsPublished(slotsFrom(real, 36), WIDTH, VIEWPORT, ROWS, null, true, FIT);
  const before = boxMap(first);
  const second = layoutColumnsPublished(slotsFrom(real, 40), WIDTH, VIEWPORT, ROWS, first, true, FIT);
  assertBoxesStay(before, second, "end metadata");
  assert.equal(second.publishedEnd, 40);
});

test("random arrival order only extends a consecutive trusted prefix", () => {
  const real = mixedAspects(32);
  let slots: Array<number | null> = Array.from({ length: 32 }, () => null);
  let layout = layoutColumnsPublished(slots, WIDTH, VIEWPORT, ROWS, null, true, FIT);
  const order = [7, 0, 14, 1, 3, 2, 9, 4, 6, 5, 8, 11, 10, 12];
  for (const index of order) {
    const before = boxMap(layout);
    slots = slots.slice();
    slots[index] = real[index];
    layout = layoutColumnsPublished(slots, WIDTH, VIEWPORT, ROWS, layout, true, FIT);
    assertBoxesStay(before, layout, `shuffle at ${index}`);
    assert.equal(layout.publishedEnd, slots.findIndex((slot) => slot == null));
  }
});

test("repeating the same metadata batch returns the same published column boxes", () => {
  const slots = slotsFrom(mixedAspects(40), 18);
  const first = layoutColumnsPublished(slots, WIDTH, VIEWPORT, ROWS, null, true, FIT);
  const second = layoutColumnsPublished(slots, WIDTH, VIEWPORT, ROWS, first, true, FIT);
  assert.equal(second, first);
  const third = layoutColumnsPublished(slots.slice(), WIDTH, VIEWPORT, ROWS, second, true, FIT);
  assert.equal(third, second);
});

test("a thumbnail arriving before metadata does not publish a 3:2 column tile", () => {
  const real = mixedAspects(16);
  const waiting = layoutColumnsPublished(slotsFrom(real, 0), WIDTH, VIEWPORT, ROWS, null, true, FIT);
  const stillWaiting = layoutColumnsPublished(slotsFrom(real, 0), WIDTH, VIEWPORT, ROWS, waiting, true, FIT);
  assert.equal(stillWaiting.publishedEnd ?? 0, 0);
  assert.equal(boxesOf(stillWaiting).length, 0);
});

test("a terminal fallback size may be published in columns and does not block the prefix", () => {
  const real = mixedAspects(24);
  const slots: Array<number | null> = real.map((aspect, index) => (index === 0 ? ESTIMATED_ASPECT : aspect));
  const layout = layoutColumnsPublished(slots, WIDTH, VIEWPORT, ROWS, null, true, FIT);
  const published = boxesOf(layout);
  assert.ok(published.some((tile) => tile.index === 0));
  assert.equal(layout.usedAspects[0], ESTIMATED_ASPECT);
  assert.ok((layout.publishedEnd ?? 0) > 1);
});

test("gradual publication of 1000 column tiles keeps earlier boxes", () => {
  const real = mixedAspects(1000);
  let layout = layoutColumnsPublished(slotsFrom(real, 0), WIDTH, VIEWPORT, ROWS, null, true, FIT);
  for (let known = 25; known <= 1000; known += 25) {
    const before = boxMap(layout);
    layout = layoutColumnsPublished(slotsFrom(real, known), WIDTH, VIEWPORT, ROWS, layout, true, FIT);
    assertBoxesStay(before, layout, `known=${known}`);
    assert.equal(layout.publishedEnd, known);
  }
  assertPackedColumns(layout);
});

test("publishing 20 000 column tiles stays incremental and packed", () => {
  const real = mixedAspects(20_000);
  let layout = layoutColumnsPublished(slotsFrom(real, 0), WIDTH, VIEWPORT, ROWS, null, true, FIT);
  const started = performance.now();
  layout = layoutColumnsPublished(slotsFrom(real, 20_000), WIDTH, VIEWPORT, ROWS, layout, true, FIT);
  const elapsed = performance.now() - started;
  assert.equal(layout.publishedEnd, 20_000);
  assertPackedColumns(layout);
  assert.ok(elapsed < 400, `20k column publish took ${elapsed}ms`);
  console.log(`20k column publish ${elapsed.toFixed(2)}ms`);
});

test("scrolling down and back up returns the same published column boxes", () => {
  const layout = layoutColumnsPublished(slotsFrom(mixedAspects(120), 120), WIDTH, VIEWPORT, ROWS, null, true, FIT);
  const top = rowsCovering(layout, 0, VIEWPORT);
  const lower = rowsCovering(layout, VIEWPORT * 3, VIEWPORT * 4);
  assert.ok(top.length > 0);
  assert.ok(lower.length > 0);
  const topAgain = rowsCovering(layout, 0, VIEWPORT);
  assert.deepEqual(
    topAgain.map((row) => row.tiles.map((tile) => [tile.index, tile.x, tile.width, row.top, row.height])),
    top.map((row) => row.tiles.map((tile) => [tile.index, tile.x, tile.width, row.top, row.height])),
  );
});

test("zoom is a new column layout version and may change boxes", () => {
  const slots = slotsFrom(mixedAspects(48), 48);
  const atFour = layoutColumnsPublished(slots, WIDTH, VIEWPORT, 4, null, true, FIT);
  const atTwo = layoutColumnsPublished(slots, WIDTH, VIEWPORT, 2, atFour, true, FIT);
  assert.notEqual(atTwo.layoutKey, atFour.layoutKey);
  assert.equal(atTwo.layoutKey, mosaicLayoutKey(WIDTH, VIEWPORT, 2, FIT));
  const afterMeta = layoutColumnsPublished(slots, WIDTH, VIEWPORT, 2, atTwo, true, FIT);
  assert.equal(afterMeta, atTwo);
});

test("container width is a new column layout version", () => {
  const slots = slotsFrom(mixedAspects(48), 48);
  const wide = layoutColumnsPublished(slots, 1600, VIEWPORT, ROWS, null, true, FIT);
  const narrow = layoutColumnsPublished(slots, 1100, VIEWPORT, ROWS, wide, true, FIT);
  assert.notEqual(narrow.layoutKey, wide.layoutKey);
});

test("Fit is a new column layout version", () => {
  const slots = slotsFrom(mixedAspects(48), 48);
  const none = layoutColumnsPublished(slots, WIDTH, VIEWPORT, ROWS, null, true, 0);
  const cropped = layoutColumnsPublished(slots, WIDTH, VIEWPORT, ROWS, none, true, 0.15);
  assert.notEqual(cropped.layoutKey, none.layoutKey);
});

test("switching mosaic and columns does not mix coordinates", () => {
  const real = mixedAspects(48);
  const mosaic = layoutMosaicPublished(real, WIDTH, VIEWPORT, ROWS, FIT);
  const columns = layoutColumnsPublished(real, WIDTH, VIEWPORT, ROWS, mosaic, true, FIT);
  assert.ok(columns.columnHeights);
  assert.ok(columns.segments[0]?.columns);
  assert.equal(mosaic.segments[0]?.columns, undefined);
  assert.notDeepEqual(boxesOf(columns)[0], boxesOf(mosaic)[0]);
});

test("a sort change is a new listing identity for column publication", () => {
  const files = [
    { name: "b.jpg", path: "C:\\photos\\b.jpg", size: 1, modifiedAt: 2 },
    { name: "a.jpg", path: "C:\\photos\\a.jpg", size: 1, modifiedAt: 1 },
  ];
  const byDate = listingStamp(files, DEFAULT_GALLERY_SORT);
  const byName = listingStamp(files, { key: "name", direction: "asc", grouped: false });
  assert.notEqual(byDate, byName);
});

test("fast folder switch starts a new column layout without previous tiles", () => {
  const first = layoutColumnsPublished(slotsFrom(mixedAspects(24), 24), WIDTH, VIEWPORT, ROWS, null, true, FIT);
  const second = layoutColumnsPublished(slotsFrom(mixedAspects(24).reverse(), 24), WIDTH, VIEWPORT, ROWS, null, true, FIT);
  assert.notDeepEqual(boxesOf(first)[0], boxesOf(second)[0]);
});

test("a stale metadata session does not keep items from a previous folder open", () => {
  assert.equal(eventSessionIsCurrent(1, 2), false);
  assert.equal(eventSessionIsCurrent(2, 2), true);
});

test("published column tiles never overlap, skip, or duplicate", () => {
  let layout = layoutColumnsPublished(slotsFrom(mixedAspects(80), 16), WIDTH, VIEWPORT, ROWS, null, true, FIT);
  layout = layoutColumnsPublished(slotsFrom(mixedAspects(80), 40), WIDTH, VIEWPORT, ROWS, layout, true, FIT);
  layout = layoutColumnsPublished(slotsFrom(mixedAspects(80), 80), WIDTH, VIEWPORT, ROWS, layout, true, FIT);
  assertPackedColumns(layout);
  const indices = allColumnTiles(layout).map((tile) => tile.index).sort((left, right) => left - right);
  assert.deepEqual(indices, Array.from({ length: 80 }, (_, index) => index));
});

test("a published photo keeps its assigned column after later sizes arrive", () => {
  const real = mixedAspects(40);
  const first = layoutColumnsPublished(slotsFrom(real, 8), WIDTH, VIEWPORT, ROWS, null, true, FIT);
  const assigned = new Map(allColumnTiles(first).map((tile) => [tile.index, tile.x]));
  const second = layoutColumnsPublished(slotsFrom(real, 40), WIDTH, VIEWPORT, ROWS, first, true, FIT);
  for (const [index, x] of assigned) {
    const tile = allColumnTiles(second).find((item) => item.index === index);
    assert.equal(tile?.x, x, `tile ${index} changed column`);
  }
});

test("new sizes do not rerun placeColumns on the published prefix", () => {
  const real = mixedAspects(20_000);
  const first = layoutColumnsPublished(slotsFrom(real, 20_000), WIDTH, VIEWPORT, ROWS, null, true, FIT);
  const frozen = first.segments[0]?.columns?.[0]?.[0];
  assert.ok(frozen);
  const started = performance.now();
  const second = layoutColumnsPublished(slotsFrom(real, 20_000), WIDTH, VIEWPORT, ROWS, first, true, FIT);
  const elapsed = performance.now() - started;
  assert.equal(second, first);
  assert.equal(second.segments[0]?.columns?.[0]?.[0], frozen);
  assert.ok(elapsed < 20, `repeat 20k batch took ${elapsed}ms`);
  console.log(`repeat 20k column batch ${elapsed.toFixed(2)}ms`);
});

test("incremental columns match a full placeColumns of the trusted prefix", () => {
  const aspects = mixedAspects(36);
  const published = layoutColumnsPublished(aspects, WIDTH, VIEWPORT, ROWS, null, true, FIT);
  const full = layoutGallery(aspects, WIDTH, VIEWPORT, ROWS, FIT, "columns");
  const fromPublished = boxesOf(published);
  const fromFull = full.rows
    .map((row) => ({
      index: row.tiles[0].index,
      x: row.tiles[0].x,
      y: row.top,
      width: row.tiles[0].width,
      height: row.height,
    }))
    .sort((left, right) => left.index - right.index);
  assert.deepEqual(fromPublished, fromFull);
});

test("a hole at the start blocks every published column tile", () => {
  const real = mixedAspects(24);
  const slots: Array<number | null> = real.map((aspect, index) => (index === 0 ? null : aspect));
  const layout = layoutColumnsPublished(slots, WIDTH, VIEWPORT, ROWS, null, true, FIT);
  assert.equal(layout.publishedEnd ?? 0, 0);
  assert.equal(boxesOf(layout).length, 0);
  assert.ok(layout.height > 0);
});
