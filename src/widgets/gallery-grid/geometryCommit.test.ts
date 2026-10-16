import assert from "node:assert/strict";
import test from "node:test";
import {
  ESTIMATED_ASPECT,
  layoutGallery,
  layoutMosaicPublished,
  mosaicLayoutKey,
  refineSegmentedLayout,
  ROW_PLAN_WINDOW,
  rowsCovering,
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

function assertPacked(layout: SegmentedLayout): void {
  const tiles = boxesOf(layout);
  const seen = new Set<number>();
  for (const tile of tiles) {
    assert.equal(seen.has(tile.index), false, `duplicate tile ${tile.index}`);
    seen.add(tile.index);
    assert.ok(tile.width > 0);
    assert.ok(tile.height > 0);
  }
  if (tiles.length === 0) {
    assert.equal(layout.publishedEnd ?? 0, 0);
    return;
  }
  const indices = tiles.map((tile) => tile.index);
  assert.equal(indices[0], 0);
  for (let index = 1; index < indices.length; index += 1) {
    assert.equal(indices[index], indices[index - 1] + 1, `gap between ${indices[index - 1]} and ${indices[index]}`);
  }
  assert.equal(indices[indices.length - 1], (layout.publishedEnd ?? 0) - 1);
}

function assertBoxesStay(before: Map<number, TileBox>, after: SegmentedLayout, label: string): void {
  const next = boxMap(after);
  for (const [index, tile] of before) {
    assert.deepEqual(next.get(index), tile, `${label}: tile ${index} moved`);
  }
}

function slotsFrom(real: number[], known: number): Array<number | null> {
  return real.map((aspect, index) => (index < known ? aspect : null));
}

test("late metadata below the viewport does not move published mosaic rows", () => {
  const real = seededAspects(120, 3);
  const first = layoutMosaicPublished(slotsFrom(real, 40), WIDTH, VIEWPORT, ROWS, FIT);
  assertPacked(first);
  const visible = boxesOf(first).filter((tile) => tile.y < VIEWPORT);
  assert.ok(visible.length > 0);
  const before = boxMap(first);
  const second = layoutMosaicPublished(slotsFrom(real, 120), WIDTH, VIEWPORT, ROWS, FIT, first);
  assertPacked(second);
  assertBoxesStay(before, second, "below viewport");
});

test("late metadata above the viewport does not rewrite a published prefix", () => {
  const real = mixedAspects(80);
  const first = layoutMosaicPublished(slotsFrom(real, 48), WIDTH, VIEWPORT, ROWS, FIT);
  const before = boxMap(first);
  const late = slotsFrom(real, 48);
  if (first.publishedEnd && first.publishedEnd > 0) {
    late[0] = 2.4;
  }
  const second = layoutMosaicPublished(late, WIDTH, VIEWPORT, ROWS, FIT, first);
  assertPacked(second);
  assertBoxesStay(before, second, "late size above viewport");
});

test("random arrival order only extends the consecutive published prefix", () => {
  const real = mixedAspects(80);
  const order = [17, 3, 0, 41, 1, 8, 2, 25, 4, 6, 5, 9, 7, 12, 11, 10, 13, 15, 14, 16, 19, 18, 21, 20, 22, 24, 23, 26, 28, 27, 29, 31, 30, 32, 34, 33, 35, 37, 36, 39, 38];
  let slots: Array<number | null> = Array.from({ length: 80 }, () => null);
  let layout = layoutMosaicPublished(slots, WIDTH, VIEWPORT, ROWS, FIT);
  for (const index of order) {
    const before = boxMap(layout);
    slots = slots.slice();
    slots[index] = real[index];
    layout = layoutMosaicPublished(slots, WIDTH, VIEWPORT, ROWS, FIT, layout);
    assertPacked(layout);
    assertBoxesStay(before, layout, `shuffle at ${index}`);
  }
  assert.ok((layout.publishedEnd ?? 0) > 0);
});

test("repeating the same metadata batch returns the same published boxes", () => {
  const real = mixedAspects(64);
  const slots = slotsFrom(real, 40);
  const first = layoutMosaicPublished(slots, WIDTH, VIEWPORT, ROWS, FIT);
  const second = layoutMosaicPublished(slots, WIDTH, VIEWPORT, ROWS, FIT, first);
  assert.equal(second, first);
  const third = layoutMosaicPublished(slots.slice(), WIDTH, VIEWPORT, ROWS, FIT, second);
  assert.equal(third, second);
});

test("a long sequence of row publishes keeps earlier boxes and stays packed", () => {
  const real = mixedAspects(160);
  let layout = layoutMosaicPublished(slotsFrom(real, 0), WIDTH, VIEWPORT, ROWS, FIT);
  let lastEnd = 0;
  for (let known = 20; known <= 160; known += 12) {
    const before = boxMap(layout);
    layout = layoutMosaicPublished(slotsFrom(real, known), WIDTH, VIEWPORT, ROWS, FIT, layout);
    assertPacked(layout);
    assertBoxesStay(before, layout, `known=${known}`);
    assert.ok((layout.publishedEnd ?? 0) >= lastEnd);
    lastEnd = layout.publishedEnd ?? 0;
  }
  assert.ok(lastEnd > 40);
});

test("rows covering the first screen stay put after scrolling the virtual range", () => {
  const real = mixedAspects(120);
  const first = layoutMosaicPublished(slotsFrom(real, 48), WIDTH, VIEWPORT, ROWS, FIT);
  const top = rowsCovering(first, 0, VIEWPORT);
  assert.ok(top.length > 0);
  const second = layoutMosaicPublished(slotsFrom(real, 120), WIDTH, VIEWPORT, ROWS, FIT, first);
  const topAgain = rowsCovering(second, 0, VIEWPORT);
  assert.deepEqual(
    topAgain.map((row) => row.tiles.map((tile) => [tile.index, tile.x, tile.width, row.top, row.height])),
    top.map((row) => row.tiles.map((tile) => [tile.index, tile.x, tile.width, row.top, row.height])),
  );
  const lower = rowsCovering(second, VIEWPORT * 2, VIEWPORT * 3);
  for (const row of lower) {
    for (const tile of row.tiles) {
      assert.ok(tile.index >= 0);
    }
  }
});

test("zoom is a new layout version and may change boxes", () => {
  const real = mixedAspects(64);
  const slots = slotsFrom(real, 64);
  const atFour = layoutMosaicPublished(slots, WIDTH, VIEWPORT, 4, FIT);
  const atTwo = layoutMosaicPublished(slots, WIDTH, VIEWPORT, 2, FIT, atFour);
  assert.notEqual(atTwo.layoutKey, atFour.layoutKey);
  assertPacked(atFour);
  assertPacked(atTwo);
  const afterMeta = layoutMosaicPublished(slots, WIDTH, VIEWPORT, 2, FIT, atTwo);
  assert.equal(afterMeta, atTwo);
});

test("container width is a new layout version", () => {
  const real = mixedAspects(48);
  const slots = slotsFrom(real, 48);
  const wide = layoutMosaicPublished(slots, 1600, VIEWPORT, ROWS, FIT);
  const narrow = layoutMosaicPublished(slots, 1100, VIEWPORT, ROWS, FIT, wide);
  assert.notEqual(narrow.layoutKey, wide.layoutKey);
  assertPacked(wide);
  assertPacked(narrow);
});

test("Fit is a new layout version", () => {
  const real = mixedAspects(48);
  const slots = slotsFrom(real, 48);
  const none = layoutMosaicPublished(slots, WIDTH, VIEWPORT, ROWS, 0);
  const cropped = layoutMosaicPublished(slots, WIDTH, VIEWPORT, ROWS, 0.15, none);
  assert.notEqual(cropped.layoutKey, none.layoutKey);
  assert.equal(mosaicLayoutKey(WIDTH, VIEWPORT, ROWS, 0.15), cropped.layoutKey);
  assertPacked(cropped);
});

test("a new folder version does not mix previous coordinates", () => {
  const firstFolder = layoutMosaicPublished(slotsFrom(mixedAspects(48), 48), WIDTH, VIEWPORT, ROWS, FIT);
  const secondFolder = layoutMosaicPublished(slotsFrom(seededAspects(48, 9), 48), WIDTH, VIEWPORT, ROWS, FIT, null);
  assertPacked(firstFolder);
  assertPacked(secondFolder);
  assert.notDeepEqual(boxesOf(firstFolder)[0], boxesOf(secondFolder)[0]);
});

test("listing growth during indexing keeps published rows of the same version", () => {
  const real = seededAspects(80, 4);
  const first = layoutMosaicPublished(real, WIDTH, VIEWPORT, ROWS, FIT, null, false);
  assert.ok((first.publishedEnd ?? 0) < real.length, "open listing must not publish the last row");
  const growing = layoutMosaicPublished(
    real.concat(Array.from({ length: 160 }, () => null)),
    WIDTH,
    VIEWPORT,
    ROWS,
    FIT,
    first,
    false,
  );
  assertPacked(growing);
  const onScreen = boxesOf(first).filter((tile) => tile.y < VIEWPORT);
  assert.ok(onScreen.length > 0);
  const after = boxMap(growing);
  for (const tile of onScreen) {
    assert.deepEqual(after.get(tile.index), tile);
  }
});

test("published mosaic tiles never overlap, skip, or duplicate", () => {
  const real = seededAspects(96, 2);
  let layout = layoutMosaicPublished(slotsFrom(real, 16), WIDTH, VIEWPORT, ROWS, FIT);
  layout = layoutMosaicPublished(slotsFrom(real, 40), WIDTH, VIEWPORT, ROWS, FIT, layout);
  layout = layoutMosaicPublished(slotsFrom(real, 96), WIDTH, VIEWPORT, ROWS, FIT, layout);
  assertPacked(layout);
  let top = 0;
  for (const row of layout.segments[0]?.template ?? []) {
    assert.equal(row.top, top);
    top += row.height;
    let x = 0;
    for (const tile of row.tiles) {
      assert.equal(tile.x, x);
      x += tile.width;
    }
  }
});

test("refine cannot rewrite a committed mosaic prefix through the viewport lock", () => {
  const real = mixedAspects(64);
  const layout = layoutMosaicPublished(slotsFrom(real, 48), WIDTH, VIEWPORT, ROWS, FIT);
  const refined = refineSegmentedLayout(
    layout,
    layout.usedAspects.map((aspect, index) => (index === 0 ? 2.2 : aspect)),
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

test("a global chooseBreaks relayout may move the first row, but a frozen prefix does not", () => {
  const real = seededAspects(80, 1);
  const partial = real.map((aspect, index) => (index < 6 ? aspect : ESTIMATED_ASPECT));
  const globalWaiting = layoutGallery(partial, WIDTH, VIEWPORT, ROWS, FIT, "mosaic");
  const globalReady = layoutGallery(real, WIDTH, VIEWPORT, ROWS, FIT, "mosaic");
  const firstWaiting = globalWaiting.rows[0]?.tiles.map((tile) => tile.width);
  const firstReady = globalReady.rows[0]?.tiles.map((tile) => tile.width);
  assert.notDeepEqual(firstWaiting, firstReady);
  const frozen = layoutMosaicPublished(slotsFrom(real, 40), WIDTH, VIEWPORT, ROWS, FIT);
  const continued = layoutMosaicPublished(
    real.map((aspect) => aspect),
    WIDTH,
    VIEWPORT,
    ROWS,
    FIT,
    frozen,
  );
  assertBoxesStay(boxMap(frozen), continued, "frozen prefix vs global DP");
  assert.ok((frozen.publishedEnd ?? 0) + ROW_PLAN_WINDOW <= 40 + ROW_PLAN_WINDOW);
});

test("a 20k estimated tail updates height without rebuilding published rows", () => {
  const real = mixedAspects(48);
  const first = layoutMosaicPublished(slotsFrom(real, 48).concat(Array.from({ length: 16 }, () => null)), WIDTH, VIEWPORT, ROWS, FIT);
  const before = boxMap(first);
  const huge: Array<number | null> = slotsFrom(real, 48).concat(Array.from({ length: 20_000 - 48 }, () => null));
  const started = Date.now();
  const second = layoutMosaicPublished(huge, WIDTH, VIEWPORT, ROWS, FIT, first);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 250, `tail estimate took ${elapsed}ms`);
  assert.ok(second.height > first.height);
  assertPacked(second);
  assertBoxesStay(before, second, "20k tail");
});
