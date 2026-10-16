import assert from "node:assert/strict";
import test from "node:test";
import type { ImageFile } from "../../../../entities/image/types.ts";
import { clampSidebarWidth } from "../chrome/panelMemory.ts";
import { viewerBackgroundClick } from "../viewer/viewerNav.ts";
import {
  applySortPress,
  DEFAULT_GALLERY_SORT,
  defaultSortDirection,
  groupLabels,
  naturalNameCompare,
  photoDateLabel,
  sortPhotos,
  viewerIndexAfterRemoval,
  type GallerySort,
} from "./galleryOrder.ts";
import { displayAspect, tilePhotoStyle } from "../viewer/displayRotation.ts";
import {
  ESTIMATED_ASPECT,
  layoutGallery,
  layoutNeedsAspectRefresh,
  layoutSegmented,
  refineSegmentedLayout,
} from "../../../../widgets/gallery-grid/layout.ts";

function file(name: string, modifiedAt = 0): ImageFile {
  return { name, path: `C:\\photos\\${name}`, size: 1, modifiedAt };
}

const dateDesc: GallerySort = { key: "date", direction: "desc", grouped: true };

test("natural sort places photo2 before photo10", () => {
  assert.ok(naturalNameCompare("photo2.jpg", "photo10.jpg") < 0);
  const sorted = sortPhotos([file("photo10.jpg"), file("photo2.jpg")], {
    key: "name",
    direction: "asc",
    grouped: false,
  });
  assert.deepEqual(sorted.map((item) => item.name), ["photo2.jpg", "photo10.jpg"]);
});

test("date sort falls back to name when mtime matches", () => {
  const sorted = sortPhotos([file("b.jpg", 5), file("a.jpg", 5)], {
    key: "date",
    direction: "asc",
    grouped: false,
  });
  assert.deepEqual(sorted.map((item) => item.name), ["a.jpg", "b.jpg"]);
});

test("groups follow sort direction and start a header", () => {
  const files = [file("old.jpg", Date.parse("2024-01-02T00:00:00Z")), file("new.jpg", Date.parse("2024-03-04T00:00:00Z"))];
  const sorted = sortPhotos(files, dateDesc);
  assert.equal(sorted[0].name, "new.jpg");
  const labels = groupLabels(sorted, dateDesc);
  assert.equal(labels[0], "2024-03-04");
  assert.equal(labels[1], "2024-01-02");
});

test("removal keeps the next photo, then the previous", () => {
  const paths = ["a", "b", "c"];
  assert.equal(viewerIndexAfterRemoval(paths, 0, new Set(["a"])), 0);
  assert.equal(viewerIndexAfterRemoval(paths, 2, new Set(["c"])), 1);
  assert.equal(viewerIndexAfterRemoval(paths, 1, new Set(["a", "b", "c"])), null);
});

test("sidebar width stays inside 220 and 45 percent", () => {
  assert.equal(clampSidebarWidth(100, 2000), 220);
  assert.equal(clampSidebarWidth(900, 2000), 600);
  assert.equal(clampSidebarWidth(400, 800), 360);
});

test("backdrop click uses the side gradient and closes on the photo or empty dark", () => {
  assert.equal(viewerBackgroundClick(10, 100, 400, 800, true, true), "prev");
  assert.equal(viewerBackgroundClick(10, 100, 400, 800, false, true), "none");
  assert.equal(viewerBackgroundClick(760, 100, 400, 800, true, true), "next");
  assert.equal(viewerBackgroundClick(500, 100, 400, 800, true, true), "close");
  assert.equal(viewerBackgroundClick(250, 100, 400, 800, true, true), "close");
  assert.equal(viewerBackgroundClick(200, 0, 800, 800, true, true), "close");
});

test("inactive sort keeps date groups, and a press can return to that order", () => {
  const files = [file("b.jpg", 2), file("a.jpg", 1), file("c.jpg", 2)];
  const grouped = sortPhotos(files, DEFAULT_GALLERY_SORT);
  assert.equal(DEFAULT_GALLERY_SORT.key, null);
  assert.deepEqual(
    grouped.map((item) => item.name),
    ["c.jpg", "b.jpg", "a.jpg"],
  );
  const byName = applySortPress(DEFAULT_GALLERY_SORT, "name");
  assert.equal(byName.key, "name");
  assert.equal(byName.direction, "asc");
  assert.deepEqual(
    sortPhotos(files, byName).map((item) => item.name),
    ["a.jpg", "b.jpg", "c.jpg"],
  );
  const reversed = applySortPress(byName, "name");
  assert.equal(reversed.direction, "desc");
  const cleared = applySortPress(reversed, "name");
  assert.equal(cleared.key, null);
  assert.deepEqual(
    sortPhotos(files, cleared).map((item) => item.name),
    grouped.map((item) => item.name),
  );
  const explorer = sortPhotos(files, { key: null, direction: "desc", grouped: false });
  assert.deepEqual(
    explorer.map((item) => item.name),
    ["a.jpg", "b.jpg", "c.jpg"],
  );
});

test("photo date is day month year and missing dates stay blank", async () => {
  const { initI18n } = await import("../../../../shared/i18n/i18n.ts");
  initI18n();
  const label = photoDateLabel(Date.parse("2024-03-04T12:00:00"));
  assert.ok(label);
  assert.match(label!, /04/);
  assert.match(label!, /03/);
  assert.match(label!, /2024/);
  assert.equal(photoDateLabel(0), null);
  assert.equal(defaultSortDirection("date"), "desc");
  assert.equal(defaultSortDirection("name"), "asc");
});

test("grid mode uses equal cells and keeps a short last row", () => {
  const layout = layoutGallery([1.5, 0.8, 1.2], 200, 200, 2, 0, "grid");
  assert.equal(layout.rows.length, 2);
  assert.equal(layout.rows[0].tiles.length, 2);
  assert.equal(layout.rows[1].tiles.length, 1);
  assert.equal(layout.rows[0].tiles[0].width, layout.rows[1].tiles[0].width);
  assert.ok(layout.rows[1].tiles[0].x + layout.rows[1].tiles[0].width < 200);
});

test("grid rows stay full across the segment boundary", () => {
  const aspects = Array.from({ length: 66 }, () => 1);
  const layout = layoutSegmented(aspects, 500, 100, 1, 0, "grid");
  const rows = layout.segments.flatMap((segment) =>
    segment.template.map((row) => row.tiles.map((tile) => tile.index + segment.start)),
  );
  assert.equal(layout.segments.length, 1);
  assert.equal(rows.length, 14);
  assert.ok(rows.slice(0, 13).every((row) => row.length === 5));
  assert.deepEqual(rows[13], [65]);
});

test("columns continue past a tall photo instead of starting a new block", () => {
  const aspects = Array.from({ length: 70 }, () => 1);
  aspects[10] = 0.2;
  const layout = layoutSegmented(aspects, 200, 200, 2, 0, "columns");
  const tiles = layout.segments.flatMap((segment) => segment.columns ?? []);
  const flat = tiles.flat();
  const tall = flat.find((tile) => tile.index === 10);
  assert.ok(tall);
  assert.equal(layout.segments.length, 1);
  assert.ok(flat.some((tile) => tile.index > 10 && tile.x !== tall.x && tile.y < tall.y + tall.height));
});

test("columns use one width and keep each photo's aspect", () => {
  const layout = layoutGallery([2, 0.5, 1], 200, 200, 2, 0, "columns");
  const tiles = layout.rows.flatMap((row) =>
    row.tiles.map((tile) => ({ index: tile.index, x: tile.x, width: tile.width, top: row.top, height: row.height })),
  );
  assert.equal(tiles.length, 3);
  assert.ok(tiles.every((tile) => tile.width === 100));
  const ordered = [...tiles].sort((left, right) => left.index - right.index);
  assert.deepEqual(
    ordered.map((tile) => [tile.x, tile.top, tile.height]),
    [
      [0, 0, 50],
      [100, 0, 200],
      [0, 50, 100],
    ],
  );
  assert.equal(layout.height, 200);
});

test("mosaic row width follows swapped aspect after a 90 degree display rotation", () => {
  const wide = layoutGallery([displayAspect(4000, 3000, 0), 1, 1], 900, 300, 2, 0, "mosaic");
  const tall = layoutGallery([displayAspect(4000, 3000, 1), 1, 1], 900, 300, 2, 0, "mosaic");
  const wideRatio = wide.rows[0].tiles[0].width / wide.rows[0].height;
  const tallRatio = tall.rows[0].tiles[0].width / tall.rows[0].height;
  assert.ok(wideRatio > 1);
  assert.ok(tallRatio < 1);
});

test("tile photo style swaps box size for odd quarter turns", () => {
  const style = tilePhotoStyle(120, 80, 1);
  assert.equal(style?.width, 80);
  assert.equal(style?.height, 120);
});

test("first mosaic estimated slots refresh when real aspects arrive without a mode switch", () => {
  const estimated = [ESTIMATED_ASPECT, ESTIMATED_ASPECT, ESTIMATED_ASPECT];
  const known = [1.5, 0.75, 1.2];
  assert.equal(layoutNeedsAspectRefresh(estimated, known, known.length), true);
  const first = layoutSegmented(estimated, 900, 300, 2, 0, "mosaic");
  const next = layoutSegmented(known, 900, 300, 2, 0, "mosaic");
  assert.notDeepEqual(
    first.segments[0]?.template[0]?.tiles.map((tile) => tile.width),
    next.segments[0]?.template[0]?.tiles.map((tile) => tile.width),
  );
});

test("mosaic refine relayouts the visible segment when rotation swaps aspect", () => {
  const before = layoutSegmented([1.5, 1.5, 1.5], 300, 200, 2, 0, "mosaic");
  const refined = refineSegmentedLayout(before, [1.5, 1 / 1.5, 1.5], 0, 2, 300, 200, 2, 0, "mosaic");
  assert.ok(refined);
  assert.notEqual(refined?.layout.usedAspects[1], before.usedAspects[1]);
});

test("layout height is the photo rows with no header gap", () => {
  const layout = layoutGallery([1, 1], 400, 200, 2, 0, "mosaic");
  assert.equal(layout.rows[0].top, 0);
  const content = layout.rows.reduce((max, row) => Math.max(max, row.top + row.height), 0);
  assert.equal(layout.height, content);
});
