import assert from "node:assert/strict";
import test from "node:test";
import {
  ESTIMATED_ASPECT,
  GEOMETRY_FIRST_WAIT_MS,
  layoutMosaicPublished,
  mosaicCommitEnd,
  ROW_PLAN_WINDOW,
  rowsCovering,
  trustedPrefixLength,
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

test("mosaicCommitEnd waits for a planning window unless every size is known", () => {
  const unknown = Array.from({ length: 40 }, () => null);
  assert.equal(trustedPrefixLength(unknown), 0);
  assert.equal(mosaicCommitEnd(unknown), 0);

  const short = mixedAspects(10).concat(Array.from({ length: 30 }, () => null));
  assert.equal(trustedPrefixLength(short), 10);
  assert.equal(mosaicCommitEnd(short), 0);

  const enough = mixedAspects(40).concat(Array.from({ length: 40 }, () => null));
  assert.equal(trustedPrefixLength(enough), 40);
  assert.equal(mosaicCommitEnd(enough), 40 - ROW_PLAN_WINDOW);

  const allKnown = mixedAspects(9);
  assert.equal(mosaicCommitEnd(allKnown), 9);
  assert.equal(mosaicCommitEnd(allKnown, false), 0);
  const closedEnough = mixedAspects(40);
  assert.equal(mosaicCommitEnd(closedEnough, true), 40);
  assert.equal(mosaicCommitEnd(closedEnough, false), 40 - ROW_PLAN_WINDOW);
});

test("unknown 3:2 slots are not published as mosaic tiles", () => {
  const real = mixedAspects(80);
  const slots: Array<number | null> = real.map((aspect, index) => (index < 40 ? aspect : null));
  const layout = layoutMosaicPublished(slots, WIDTH, VIEWPORT, ROWS, FIT);
  const published = boxesOf(layout);
  assert.ok(published.length > 0, "trusted prefix must produce at least one row");
  assert.ok((layout.publishedEnd ?? 0) > 0);
  assert.ok((layout.publishedEnd ?? 0) <= 40 - ROW_PLAN_WINDOW);
  for (const tile of published) {
    assert.notEqual(slots[tile.index], null, `tile ${tile.index} used an unknown aspect`);
    assert.equal(slots[tile.index], real[tile.index]);
  }
  assert.ok(layout.height > (layout.segments[0]?.height ?? 0), "unpublished tail still has estimated height");
});

test("a timeout wait does not commit leftover estimated slots", () => {
  const real = mixedAspects(36);
  const slots: Array<number | null> = real.map((aspect, index) => (index < 2 ? aspect : null));
  const waiting = layoutMosaicPublished(slots, WIDTH, VIEWPORT, ROWS, FIT);
  assert.equal(GEOMETRY_FIRST_WAIT_MS, 800);
  assert.equal(waiting.publishedEnd ?? 0, 0);
  assert.equal(boxesOf(waiting).length, 0);
  assert.ok(waiting.height > 0, "scrollbar height exists without published 3:2 tiles");
});

test("an incomplete row that still needs following aspects is not published", () => {
  const slots: Array<number | null> = mixedAspects(8).concat(Array.from({ length: 40 }, () => null));
  const layout = layoutMosaicPublished(slots, WIDTH, VIEWPORT, ROWS, FIT);
  assert.equal(mosaicCommitEnd(slots), 0);
  assert.equal(layout.publishedEnd ?? 0, 0);
  assert.equal(boxesOf(layout).length, 0);
});

test("a terminal fallback size may be published and does not block the prefix", () => {
  const real = mixedAspects(48);
  const slots: Array<number | null> = real.map((aspect, index) => (index === 0 ? ESTIMATED_ASPECT : aspect));
  const layout = layoutMosaicPublished(slots, WIDTH, VIEWPORT, ROWS, FIT);
  const published = boxesOf(layout);
  assert.ok(published.some((tile) => tile.index === 0), "corrupt file keeps a 3:2 slot after a confirmed failure");
  assert.equal(layout.usedAspects[0], ESTIMATED_ASPECT);
  assert.notEqual(real[0], ESTIMATED_ASPECT);
  assert.ok(published.length > 3);
});

test("a hole at the start blocks every published row", () => {
  const real = mixedAspects(48);
  const slots: Array<number | null> = real.map((aspect, index) => (index === 0 ? null : aspect));
  const layout = layoutMosaicPublished(slots, WIDTH, VIEWPORT, ROWS, FIT);
  assert.equal(trustedPrefixLength(slots), 0);
  assert.equal(boxesOf(layout).length, 0);
  assert.ok(layout.height > 0);
});

test("later trusted sizes keep already published mosaic boxes", () => {
  const real = mixedAspects(80);
  const firstSlots: Array<number | null> = real.map((aspect, index) => (index < 40 ? aspect : null));
  const first = layoutMosaicPublished(firstSlots, WIDTH, VIEWPORT, ROWS, FIT);
  const published = firstRowIndices(first);
  assert.ok(published.length > 0);
  const before = boxMap(first);
  const second = layoutMosaicPublished(
    real.map((aspect) => aspect),
    WIDTH,
    VIEWPORT,
    ROWS,
    FIT,
    first,
  );
  const after = boxMap(second);
  assert.ok((second.publishedEnd ?? 0) > (first.publishedEnd ?? 0));
  for (const index of published) {
    assert.deepEqual(after.get(index), before.get(index), `published tile ${index} moved after later sizes`);
  }
});

test("a late size after the published prefix does not rewrite published tiles", () => {
  const real = mixedAspects(80);
  const firstSlots: Array<number | null> = real.map((aspect, index) => (index < 40 ? aspect : null));
  const first = layoutMosaicPublished(firstSlots, WIDTH, VIEWPORT, ROWS, FIT);
  const published = boxesOf(first);
  assert.ok(published.length > 0);
  const late: Array<number | null> = firstSlots.slice();
  late[60] = 0.5;
  const second = layoutMosaicPublished(late, WIDTH, VIEWPORT, ROWS, FIT, first);
  const before = boxMap(first);
  const after = boxMap(second);
  assert.equal(second.publishedEnd, first.publishedEnd);
  for (const tile of published) {
    assert.deepEqual(after.get(tile.index), before.get(tile.index));
  }
});

test("the short last row stays pending until the listing is complete", () => {
  const slots = mixedAspects(9);
  const waiting = layoutMosaicPublished(slots, WIDTH, VIEWPORT, ROWS, FIT, null, false);
  assert.equal(waiting.publishedEnd ?? 0, 0);
  assert.equal(boxesOf(waiting).length, 0);
  assert.ok(waiting.height > 0, "pending known files still reserve scrollbar height");
  const ready = layoutMosaicPublished(slots, WIDTH, VIEWPORT, ROWS, FIT, waiting, true);
  assert.equal(ready.publishedEnd, 9);
  assert.ok(boxesOf(ready).length > 0);
});

test("a later batch does not retract an already published last row", () => {
  const first = layoutMosaicPublished(mixedAspects(20), WIDTH, VIEWPORT, ROWS, FIT, null, true);
  assert.equal(first.publishedEnd, 20);
  const before = boxMap(first);
  const grew = layoutMosaicPublished(
    mixedAspects(20).concat(Array.from({ length: 40 }, () => null)),
    WIDTH,
    VIEWPORT,
    ROWS,
    FIT,
    first,
    false,
  );
  assert.equal(grew.publishedEnd, 20);
  const after = boxMap(grew);
  for (const [index, tile] of before) {
    assert.deepEqual(after.get(index), tile, `published tile ${index} moved after listing growth`);
  }
});
