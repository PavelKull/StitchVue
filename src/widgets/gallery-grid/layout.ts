import type { LayoutMode } from "../../entities/gallery/layoutMode";

export type { LayoutMode };

export type TileBox = {
  index: number;
  x: number;
  width: number;
};

export type GalleryRow = {
  top: number;
  height: number;
  tiles: TileBox[];
};

export type GalleryLayout = {
  height: number;
  rows: GalleryRow[];
};

export const TILE_GAP = 0;

/**
 * Mosaic DP lookahead (`k_max`). A row starting at `s` only sees `s .. s+k_max-1` in `chooseBreaks`.
 * Incremental publish never re-runs that DP on committed files; the last row of a prefix DP
 * (at most `k_max` photos) stays pending unless the current listing is fully known.
 * Raising this constant is not required for immutability.
 */
export const ROW_PLAN_WINDOW = 16;
const K_MAX = ROW_PLAN_WINDOW;

/** Mosaic rows sit just above the zoom target, matching the previous mixed layout. */
const MOSAIC_SCALE = 1.02;

/** Unknown files keep this slot so the scrollbar exists before headers arrive. */
export const ESTIMATED_ASPECT = 1.5;

/**
 * Geometry is read before the first mosaic paint, and later metadata does not rebuild the whole gallery.
 * Set to false to restore estimated-aspect layout on every metadata batch.
 */
export const GEOMETRY_FIRST_LAYOUT = true;

/**
 * First-screen wait budget for UX only.
 * Mosaic must not commit estimated 3:2 rows when this elapses.
 */
export const GEOMETRY_FIRST_WAIT_MS = 800;

/** One metadata update lays out at most this many files, and never a locked segment. */
export const SEGMENT_SIZE = 64;

export type SegmentSpan = {
  start: number;
  end: number;
  top: number;
  height: number;
  /** Row tops are relative to the segment. Indices are relative to `start`. Shared by identical estimated segments. */
  template: GalleryRow[];
  /** Rows do not overlap vertically, so the first visible row can be found by binary search. */
  stacked: boolean;
  /** Continuous masonry columns, each already sorted by y. Absent for row layouts. */
  columns?: MasonryTile[][];
};

export type MasonryTile = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SegmentedLayout = {
  height: number;
  segments: SegmentSpan[];
  usedAspects: number[];
  /** Exclusive end of published mosaic or column tiles. Missing means the whole listing is published. */
  publishedEnd?: number;
  /** Zoom, width, Fit, and mode. A different key is a new layout version. */
  layoutKey?: string;
  /** Column stack heights after the published prefix. Columns only. */
  columnHeights?: number[];
};

export function layoutGallery(
  aspects: number[],
  width: number,
  viewportHeight: number,
  rowsPerScreen: number,
  fit: number,
  layoutMode: LayoutMode = "grid",
  indexOffset = 0,
  galleryTail = true,
): GalleryLayout {
  if (aspects.length === 0 || width < 1 || viewportHeight < 1) {
    return { height: 0, rows: [] };
  }

  if (layoutMode === "grid") {
    const rows = placeUniform(aspects, width, viewportHeight, rowsPerScreen, indexOffset);
    const height = rows.reduce((total, row) => Math.max(total, row.top + row.height), 0);
    return { height, rows };
  }

  if (layoutMode === "columns") {
    const placed = placeColumns(aspects, width, viewportHeight, rowsPerScreen, indexOffset);
    return { height: placed.height, rows: placed.rows };
  }

  const hTarget = (viewportHeight / rowsPerScreen) * MOSAIC_SCALE;
  const breaks = chooseBreaks(aspects, width, viewportHeight, hTarget, fit, galleryTail);
  const rows: GalleryRow[] = [];
  let top = 0;
  let cursor = 0;
  breaks.forEach((count, rowIndex) => {
    const last = galleryTail && rowIndex === breaks.length - 1;
    const slice = aspects.slice(cursor, cursor + count);
    // Единственный кадр папки: высота идёт за зумом, не шире ряда и не выше экрана.
    const followZoom = aspects.length === 1;
    const row = placeRow(
      slice,
      cursor + indexOffset,
      width,
      top,
      hTarget,
      viewportHeight,
      fit,
      last,
      followZoom,
    );
    rows.push(row);
    top += row.height + (rowIndex < breaks.length - 1 ? TILE_GAP : 0);
    cursor += count;
  });
  return { height: top, rows };
}

export function emptySegmentedLayout(): SegmentedLayout {
  return { height: 0, segments: [], usedAspects: [], publishedEnd: 0, layoutKey: "" };
}

export type GeometryRange = {
  start: number;
  end: number;
};

export function clampIndexRange(start: number, end: number, fileCount: number): GeometryRange {
  const count = Number.isFinite(fileCount) ? Math.max(0, Math.floor(fileCount)) : 0;
  const from = Number.isFinite(start) ? Math.min(count, Math.max(0, Math.floor(start))) : 0;
  const to = Number.isFinite(end) ? Math.min(count, Math.max(from, Math.floor(end))) : count;
  return { start: from, end: to };
}

/** Files that fill the viewport if every photo is a narrow portrait, plus two extra rows. */
export function firstScreenFileCount(
  width: number,
  viewportHeight: number,
  rowsPerScreen: number,
  fileCount: number,
): number {
  const count = Number.isFinite(fileCount) ? Math.max(0, Math.floor(fileCount)) : 0;
  if (
    count === 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(viewportHeight) ||
    width < 1 ||
    viewportHeight < 1
  ) {
    return 0;
  }
  const rows = Number.isFinite(rowsPerScreen) && rowsPerScreen > 0 ? rowsPerScreen : 1;
  const rowH = (viewportHeight / rows) * MOSAIC_SCALE;
  const tileW = Math.max(1, rowH * (2 / 3));
  const cols = Math.max(1, Math.ceil(width / tileW));
  const rowBudget = Math.max(1, Math.ceil(rows + 2));
  return Math.min(count, cols * rowBudget);
}

/** First metadata window. Independent of a published layout or decode range. */
export function firstGeometryRange(
  width: number,
  viewportHeight: number,
  rowsPerScreen: number,
  fileCount: number,
): GeometryRange {
  return clampIndexRange(0, firstScreenFileCount(width, viewportHeight, rowsPerScreen, fileCount), fileCount);
}

export function isTrustedAspect(slot: number | null | undefined): slot is number {
  return slot != null && Number.isFinite(slot) && slot > 0;
}

/** Consecutive trusted sizes from the start of the listing. */
export function trustedPrefixLength(slots: Array<number | null>): number {
  let known = 0;
  while (known < slots.length && isTrustedAspect(slots[known])) {
    known += 1;
  }
  return known;
}

/**
 * Exclusive file index a mosaic row may be published up to.
 * Rows that still need unknown following aspects stay pending.
 * The short last row is committed only when the listing is complete.
 */
export function mosaicCommitEnd(slots: Array<number | null>, listingComplete = true): number {
  const known = trustedPrefixLength(slots);
  if (known === 0) {
    return 0;
  }
  if (known === slots.length && listingComplete) {
    return known;
  }
  if (known <= K_MAX) {
    return 0;
  }
  return known - K_MAX;
}

function sameAspects(left: number[], right: number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function lastTileIndex(row: GalleryRow): number {
  return row.tiles[row.tiles.length - 1]?.index ?? -1;
}

function takeRowsBefore(rows: GalleryRow[], commitEnd: number): GalleryRow[] {
  const taken: GalleryRow[] = [];
  for (const row of rows) {
    if (lastTileIndex(row) >= commitEnd) {
      break;
    }
    taken.push(row);
  }
  return taken;
}

function publishedEndOf(rows: GalleryRow[]): number {
  if (rows.length === 0) {
    return 0;
  }
  return lastTileIndex(rows[rows.length - 1]) + 1;
}

export function mosaicLayoutKey(
  width: number,
  viewportHeight: number,
  rowsPerScreen: number,
  fit: number,
): string {
  return `${width}|${viewportHeight}|${rowsPerScreen}|${fit}`;
}

function meanTrustedAspect(slots: Array<number | null>, known: number): number {
  if (known <= 0) {
    return ESTIMATED_ASPECT;
  }
  let sum = 0;
  for (let index = 0; index < known; index += 1) {
    sum += slots[index] as number;
  }
  return sum / known;
}

function estimateUniformTail(
  count: number,
  width: number,
  viewportHeight: number,
  rowsPerScreen: number,
  fit: number,
  sampleAspect = ESTIMATED_ASPECT,
): number {
  if (count <= 0) {
    return 0;
  }
  const aspect =
    Number.isFinite(sampleAspect) && sampleAspect > 0 ? sampleAspect : ESTIMATED_ASPECT;
  const span = Math.min(SEGMENT_SIZE, count);
  const sample = Array.from({ length: span }, () => aspect);
  const full = layoutGallery(sample, width, viewportHeight, rowsPerScreen, fit, "mosaic", 0, span === count);
  if (span === count) {
    return full.height;
  }
  const times = Math.floor(count / span);
  const rest = count % span;
  let height = full.height * times;
  if (rest > 0) {
    height += layoutGallery(
      sample.slice(0, rest),
      width,
      viewportHeight,
      rowsPerScreen,
      fit,
      "mosaic",
      0,
      true,
    ).height;
  }
  return height;
}

function committedKeepEnd(previous: SegmentedLayout | null | undefined, slotCount: number): number {
  if (!previous) {
    return 0;
  }
  const published = previous.publishedEnd ?? 0;
  if (published <= 0 || published > slotCount) {
    return 0;
  }
  return published;
}

/** True when display rotation swapped width/height (w/h ↔ h/w), not late metadata drift. */
export function isDisplayRotationAspectSwap(frozen: number, slot: number): boolean {
  if (!isTrustedAspect(frozen) || !isTrustedAspect(slot) || frozen === slot) {
    return false;
  }
  const product = frozen * slot;
  return product > 0.985 && product < 1.015;
}

/** Shrink the frozen published prefix when display rotation changes aspect (B-003). */
export function thawPublishedKeepEnd(
  slots: Array<number | null>,
  previous: SegmentedLayout | null | undefined,
  keepEnd: number,
): number {
  if (!previous || keepEnd <= 0) {
    return keepEnd;
  }
  let thawAt = keepEnd;
  for (let index = 0; index < keepEnd && index < slots.length; index += 1) {
    const slot = slots[index];
    const frozen = previous.usedAspects[index];
    if (frozen === undefined) {
      continue;
    }
    if (isTrustedAspect(slot) && isDisplayRotationAspectSwap(frozen, slot)) {
      thawAt = Math.min(thawAt, index);
    }
  }
  return thawAt;
}

function keepPublishedRows(previous: SegmentedLayout, keepEnd: number): GalleryRow[] {
  const rows: GalleryRow[] = [];
  for (const segment of previous.segments) {
    for (const row of segment.template) {
      const last = (row.tiles[row.tiles.length - 1]?.index ?? -1) + segment.start;
      if (last >= keepEnd) {
        return rows;
      }
      if (segment.start === 0 && segment.top === 0) {
        rows.push(row);
        continue;
      }
      rows.push({
        top: segment.top + row.top,
        height: row.height,
        tiles: row.tiles.map((tile) => ({
          ...tile,
          index: tile.index + segment.start,
        })),
      });
    }
  }
  return rows;
}

function freezeUsedAspects(
  slots: Array<number | null>,
  previous: SegmentedLayout | null | undefined,
  keepEnd: number,
): number[] {
  const used: number[] = [];
  for (let index = 0; index < slots.length; index += 1) {
    if (index < keepEnd && previous && index < previous.usedAspects.length) {
      used.push(previous.usedAspects[index]);
      continue;
    }
    const slot = slots[index];
    used.push(isTrustedAspect(slot) ? slot : ESTIMATED_ASPECT);
  }
  return used;
}

/**
 * Mosaic rows from trusted sizes only. Unknown files contribute estimated
 * scrollbar height and are not turned into tiles.
 * Published rows are never passed back through `chooseBreaks` in the same layout version.
 * `listingComplete` must be false while names/stats can still grow the list, so the last
 * row stays pending instead of being published and later retracted.
 */
export function layoutMosaicPublished(
  slots: Array<number | null>,
  width: number,
  viewportHeight: number,
  rowsPerScreen: number,
  fit: number,
  previous?: SegmentedLayout | null,
  listingComplete = true,
): SegmentedLayout {
  const layoutKey = mosaicLayoutKey(width, viewportHeight, rowsPerScreen, fit);
  if (slots.length === 0 || width < 1 || viewportHeight < 1) {
    return { height: 0, segments: [], usedAspects: [], publishedEnd: 0, layoutKey };
  }
  const version =
    previous && previous.layoutKey === layoutKey && (previous.publishedEnd ?? 0) <= slots.length
      ? previous
      : null;
  const committedEnd = committedKeepEnd(version, slots.length);
  const keepEnd = thawPublishedKeepEnd(slots, version, committedEnd);
  const used = freezeUsedAspects(slots, version, keepEnd);
  const known = trustedPrefixLength(slots);
  const closed = listingComplete;
  const commitUntil = mosaicCommitEnd(slots, closed);
  if (
    version &&
    version.publishedEnd === committedEnd &&
    keepEnd === committedEnd &&
    keepEnd === known &&
    version.usedAspects.length === used.length &&
    sameAspects(version.usedAspects, used) &&
    !(closed && known === slots.length && commitUntil > keepEnd)
  ) {
    return version;
  }

  const rows = keepEnd > 0 && version ? keepPublishedRows(version, keepEnd) : [];
  const from = publishedEndOf(rows);
  let leftoverHeight = 0;
  if (known > from) {
    const slice: number[] = [];
    for (let index = from; index < known; index += 1) {
      slice.push(slots[index] as number);
    }
    const laid = layoutGallery(
      slice,
      width,
      viewportHeight,
      rowsPerScreen,
      fit,
      "mosaic",
      from,
      closed && known === slots.length,
    );
    const origin =
      rows.length > 0 ? rows[rows.length - 1].top + rows[rows.length - 1].height + TILE_GAP : 0;
    const extra = commitUntil > from ? takeRowsBefore(laid.rows, commitUntil) : [];
    for (const row of extra) {
      rows.push({
        top: origin + row.top,
        height: row.height,
        tiles: row.tiles,
      });
    }
    const takenHeight = extra.length > 0 ? extra[extra.length - 1].top + extra[extra.length - 1].height : 0;
    leftoverHeight = Math.max(0, laid.height - takenHeight);
  }

  const publishedEnd = publishedEndOf(rows);
  const unknownHeight = estimateUniformTail(
    Math.max(0, slots.length - known),
    width,
    viewportHeight,
    rowsPerScreen,
    fit,
    meanTrustedAspect(slots, known),
  );
  const publishedHeight =
    rows.length > 0 ? rows[rows.length - 1].top + rows[rows.length - 1].height : 0;
  const height = publishedHeight + leftoverHeight + unknownHeight;
  if (rows.length === 0) {
    return { height, segments: [], usedAspects: used, publishedEnd: 0, layoutKey };
  }
  return {
    height,
    segments: [
      {
        start: 0,
        end: publishedEnd,
        top: 0,
        height: publishedHeight,
        template: rows,
        stacked: true,
      },
    ],
    usedAspects: used,
    publishedEnd,
    layoutKey,
  };
}

/**
 * Masonry columns from trusted sizes only. Each new file is assigned to the
 * current shortest column and then frozen. Published tiles are never passed
 * back through `placeColumns`.
 */
export function layoutColumnsPublished(
  slots: Array<number | null>,
  width: number,
  viewportHeight: number,
  rowsPerScreen: number,
  previous?: SegmentedLayout | null,
  listingComplete = true,
  fit = 0,
): SegmentedLayout {
  void listingComplete;
  const layoutKey = mosaicLayoutKey(width, viewportHeight, rowsPerScreen, fit);
  if (slots.length === 0 || width < 1 || viewportHeight < 1) {
    return { height: 0, segments: [], usedAspects: [], publishedEnd: 0, layoutKey, columnHeights: [] };
  }
  const { columnCount, tileWidth } = columnMetrics(width, viewportHeight, rowsPerScreen);
  const version =
    previous &&
    previous.layoutKey === layoutKey &&
    previous.columnHeights &&
    previous.columnHeights.length === columnCount &&
    (previous.publishedEnd ?? 0) <= slots.length &&
    ((previous.publishedEnd ?? 0) === 0 || previous.segments[0]?.columns)
      ? previous
      : null;
  const committedEnd = committedKeepEnd(version, slots.length);
  const keepEnd = thawPublishedKeepEnd(slots, version, committedEnd);
  const used = freezeUsedAspects(slots, version, keepEnd);
  const known = trustedPrefixLength(slots);
  if (
    version &&
    version.publishedEnd === committedEnd &&
    keepEnd === committedEnd &&
    keepEnd === known &&
    version.usedAspects.length === used.length &&
    sameAspects(version.usedAspects, used)
  ) {
    return version;
  }

  let columns: MasonryTile[][];
  let heights: number[];
  let rows: GalleryRow[];
  const columnSegment = version?.segments[0];
  const reuseColumns =
    keepEnd > 0 &&
    keepEnd === committedEnd &&
    columnSegment?.columns &&
    version?.columnHeights;
  if (reuseColumns && columnSegment.columns && version.columnHeights) {
    columns = columnSegment.columns.map((column) => column.slice());
    heights = version.columnHeights.slice();
    rows = columnSegment.template.slice();
  } else {
    columns = Array.from({ length: columnCount }, () => []);
    heights = Array.from({ length: columnCount }, () => 0);
    rows = [];
    for (let index = 0; index < keepEnd; index += 1) {
      appendColumnTile(columns, heights, rows, slots[index] as number, index, tileWidth);
    }
  }
  for (let index = keepEnd; index < known; index += 1) {
    appendColumnTile(columns, heights, rows, slots[index] as number, index, tileWidth);
  }

  const publishedEnd = known;
  const publishedHeight = maxHeight(heights);
  const height = estimateColumnCanvasHeight(
    heights,
    slots.length - known,
    tileWidth,
    meanTrustedAspect(slots, known),
  );
  const segment = {
    start: 0,
    end: publishedEnd,
    top: 0,
    height: publishedHeight,
    template: rows,
    stacked: false as const,
    columns,
  };
  if (publishedEnd === 0) {
    return { height, segments: [], usedAspects: used, publishedEnd: 0, layoutKey, columnHeights: heights };
  }
  return {
    height,
    segments: [segment],
    usedAspects: used,
    publishedEnd,
    layoutKey,
    columnHeights: heights,
  };
}

export function layoutSegmented(
  aspects: number[],
  width: number,
  viewportHeight: number,
  rowsPerScreen: number,
  fit: number,
  layoutMode: LayoutMode = "grid",
): SegmentedLayout {
  if (aspects.length === 0 || width < 1 || viewportHeight < 1) {
    return emptySegmentedLayout();
  }
  if (layoutMode === "grid") {
    const laid = layoutGallery(aspects, width, viewportHeight, rowsPerScreen, fit, layoutMode, 0, true);
    return {
      height: laid.height,
      segments: [
        {
          start: 0,
          end: aspects.length,
          top: 0,
          height: laid.height,
          template: laid.rows,
          stacked: true,
        },
      ],
      usedAspects: aspects.slice(),
    };
  }
  if (layoutMode === "columns") {
    return continuousColumns(aspects, width, viewportHeight, rowsPerScreen);
  }
  const shared = new Map<string, { rows: GalleryRow[]; height: number }>();
  const segments: SegmentSpan[] = [];
  let top = 0;
  const head = GEOMETRY_FIRST_LAYOUT
    ? firstScreenFileCount(width, viewportHeight, rowsPerScreen, aspects.length)
    : 0;
  let start = 0;
  while (start < aspects.length) {
    const span = start === 0 && head > 0 ? head : SEGMENT_SIZE;
    const end = Math.min(aspects.length, start + span);
    const tail = end === aspects.length;
    const aspect = tail ? null : sharedAspect(aspects, start, end);
    const key = aspect === null ? "" : `${layoutMode}:${aspect}:${end - start}`;
    let cached = key === "" ? undefined : shared.get(key);
    if (!cached) {
      const laid = layoutGallery(
        aspects.slice(start, end),
        width,
        viewportHeight,
        rowsPerScreen,
        fit,
        layoutMode,
        0,
        tail,
      );
      cached = { rows: laid.rows, height: laid.height };
      if (key !== "") {
        shared.set(key, cached);
      }
    }
    segments.push({
      start,
      end,
      top,
      height: cached.height,
      template: cached.rows,
      stacked: true,
    });
    top += cached.height;
    start = end;
  }
  return { height: top, segments, usedAspects: aspects.slice() };
}

/** True when laid-out aspects no longer match live metadata for the first mosaic segment. */
export function layoutNeedsAspectRefresh(usedAspects: number[], livePrefix: number[], fileCount: number): boolean {
  if (usedAspects.length !== fileCount) {
    return fileCount > 0;
  }
  const n = Math.min(usedAspects.length, livePrefix.length);
  for (let index = 0; index < n; index += 1) {
    if (usedAspects[index] !== livePrefix[index]) {
      return true;
    }
  }
  return false;
}

function sharedAspect(aspects: number[], start: number, end: number): number | null {
  const aspect = aspects[start];
  for (let index = start + 1; index < end; index += 1) {
    if (aspects[index] !== aspect) {
      return null;
    }
  }
  return aspect ?? null;
}

function rowTopForLocalIndex(rows: GalleryRow[], localIndex: number): number | null {
  for (const row of rows) {
    if (row.tiles.some((tile) => tile.index === localIndex)) {
      return row.top;
    }
  }
  return null;
}

/**
 * Recompute segments that do not intersect [lockStart, lockEnd).
 * Segments entirely above the lock contribute their height delta to scrollDelta
 * so pixels on screen stay put.
 */
export function refineSegmentedLayout(
  current: SegmentedLayout,
  aspects: number[],
  lockStart: number,
  lockEnd: number,
  width: number,
  viewportHeight: number,
  rowsPerScreen: number,
  fit: number,
  layoutMode: LayoutMode = "grid",
): { layout: SegmentedLayout; scrollDelta: number } | null {
  if (current.usedAspects.length !== aspects.length || width < 1 || viewportHeight < 1) {
    return null;
  }
  if (layoutMode === "grid") {
    return null;
  }
  if (layoutMode === "columns") {
    return null;
  }
  if (current.publishedEnd != null) {
    return null;
  }
  const nextAspects = current.usedAspects.slice();
  const segments = current.segments.map((segment) => ({ ...segment }));
  let changed = false;
  let scrollDelta = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const locked = segment.start < lockEnd && segment.end > lockStart;
    let dirty = false;
    for (let file = segment.start; file < segment.end; file += 1) {
      if (nextAspects[file] !== aspects[file]) {
        dirty = true;
        break;
      }
    }
    if (!dirty) {
      continue;
    }
    const local = layoutGallery(
      aspects.slice(segment.start, segment.end),
      width,
      viewportHeight,
      rowsPerScreen,
      fit,
      layoutMode,
      0,
      segment.end === aspects.length,
    );
    if (!locked && segment.end <= lockStart) {
      scrollDelta += local.height - segment.height;
    } else if (locked) {
      const localIndex = Math.min(segment.end - 1, Math.max(segment.start, lockStart)) - segment.start;
      const oldTop = rowTopForLocalIndex(segment.template, localIndex);
      const newTop = rowTopForLocalIndex(local.rows, localIndex);
      if (oldTop !== null && newTop !== null) {
        scrollDelta += newTop - oldTop;
      }
    }
    for (let file = segment.start; file < segment.end; file += 1) {
      nextAspects[file] = aspects[file];
    }
    segments[index] = { ...segment, height: local.height, template: local.rows };
    changed = true;
  }

  if (!changed) {
    return null;
  }

  let top = 0;
  for (const segment of segments) {
    segment.top = top;
    top += segment.height;
  }
  return {
    layout: { height: top, segments, usedAspects: nextAspects },
    scrollDelta,
  };
}

export function rowsCovering(layout: SegmentedLayout, y0: number, y1: number): GalleryRow[] {
  if (layout.segments.length === 0 || y1 <= y0) {
    return [];
  }
  const rows: GalleryRow[] = [];
  let index = segmentAt(layout.segments, y0);
  for (; index < layout.segments.length; index += 1) {
    const segment = layout.segments[index];
    if (segment.top >= y1) {
      break;
    }
    if (segment.columns) {
      rows.push(...columnRowsCovering(segment.columns, segment.top, y0, y1));
      continue;
    }
    const first = segment.stacked ? firstStackedRow(segment.template, segment.top, y0) : 0;
    for (let rowIndex = first; rowIndex < segment.template.length; rowIndex += 1) {
      const row = segment.template[rowIndex];
      const top = segment.top + row.top;
      if (top + row.height <= y0) {
        continue;
      }
      if (top >= y1) {
        break;
      }
      rows.push({
        top,
        height: row.height,
        tiles: row.tiles.map((tile) => ({
          index: tile.index + segment.start,
          x: tile.x,
          width: tile.width,
        })),
      });
    }
  }
  return rows;
}

export function rowAtY(layout: SegmentedLayout, y: number): GalleryRow | undefined {
  return rowsCovering(layout, y, y + 1)[0];
}

export function rowForIndex(layout: SegmentedLayout, index: number): GalleryRow | undefined {
  const segment = layout.segments.find((item) => index >= item.start && index < item.end);
  if (!segment) {
    return undefined;
  }
  const local = index - segment.start;
  if (segment.columns) {
    for (const column of segment.columns) {
      const columnTile = column.find((tile) => tile.index === index);
      if (!columnTile) {
        continue;
      }
      return {
        top: segment.top + columnTile.y,
        height: columnTile.height,
        tiles: [{ index, x: columnTile.x, width: columnTile.width }],
      };
    }
  }
  const row = segment.template.find((item) => item.tiles.some((tile) => tile.index === local));
  if (!row) {
    return undefined;
  }
  return {
    top: segment.top + row.top,
    height: row.height,
    tiles: row.tiles.map((tile) => ({
      index: tile.index + segment.start,
      x: tile.x,
      width: tile.width,
    })),
  };
}

function continuousColumns(
  aspects: number[],
  width: number,
  viewportHeight: number,
  rowsPerScreen: number,
): SegmentedLayout {
  const placed = placeColumns(aspects, width, viewportHeight, rowsPerScreen, 0);
  return {
    height: placed.height,
    segments: [
      {
        start: 0,
        end: aspects.length,
        top: 0,
        height: placed.height,
        template: placed.rows,
        stacked: false,
        columns: placed.columns,
      },
    ],
    usedAspects: aspects.slice(),
    publishedEnd: aspects.length,
    layoutKey: mosaicLayoutKey(width, viewportHeight, rowsPerScreen, 0),
    columnHeights: placed.heights,
  };
}

function columnRowsCovering(columns: MasonryTile[][], origin: number, y0: number, y1: number): GalleryRow[] {
  const rows: GalleryRow[] = [];
  const localTop = y0 - origin;
  const localBottom = y1 - origin;
  for (const column of columns) {
    for (let index = firstMasonryTile(column, localTop); index < column.length; index += 1) {
      const tile = column[index];
      if (tile.y >= localBottom) {
        break;
      }
      if (tile.y + tile.height <= localTop) {
        continue;
      }
      rows.push({
        top: origin + tile.y,
        height: tile.height,
        tiles: [{ index: tile.index, x: tile.x, width: tile.width }],
      });
    }
  }
  return rows;
}

function firstMasonryTile(tiles: MasonryTile[], y0: number): number {
  let low = 0;
  let high = tiles.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (tiles[mid].y + tiles[mid].height <= y0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function firstStackedRow(rows: GalleryRow[], origin: number, y0: number): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (origin + rows[mid].top + rows[mid].height <= y0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function segmentAt(segments: SegmentSpan[], y: number): number {
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (segments[mid].top + segments[mid].height <= y) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return Math.min(low, Math.max(0, segments.length - 1));
}

export function rowAt(rows: GalleryRow[], y: number): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].top + rows[mid].height <= y) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return Math.min(low, Math.max(0, rows.length - 1));
}

export type DecodeWindow = {
  start: number;
  end: number;
  focusStart: number;
  focusEnd: number;
};

export function decodeWindow(
  rows: GalleryRow[],
  scrollTop: number,
  viewportHeight: number,
): DecodeWindow {
  if (rows.length === 0 || viewportHeight < 1) {
    return { start: 0, end: 0, focusStart: 0, focusEnd: 0 };
  }
  const viewTop = Math.max(0, scrollTop);
  const viewBottom = viewTop + viewportHeight;
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  let focusStart = 0;
  let focusEnd = 0;
  let focused = false;
  for (const row of rows) {
    if (row.top + row.height <= viewTop || row.top >= viewBottom) {
      continue;
    }
    const rowStart = rowStartIndex(row);
    const rowEnd = rowEndIndex(row, rowStart);
    start = Math.min(start, rowStart);
    end = Math.max(end, rowEnd);
    if (!focused && row.top >= viewTop - 0.5 && row.top + row.height <= viewBottom + 0.5) {
      focusStart = rowStart;
      focusEnd = rowEnd;
      focused = true;
    }
  }
  if (!Number.isFinite(start)) {
    return { start: 0, end: 0, focusStart: 0, focusEnd: 0 };
  }
  if (!focused) {
    focusStart = start;
    focusEnd = end;
  }
  return { start, end, focusStart, focusEnd };
}

function rowStartIndex(row: GalleryRow | undefined): number {
  return row?.tiles[0]?.index ?? 0;
}

function rowEndIndex(row: GalleryRow | undefined, fallback: number): number {
  const tiles = row?.tiles;
  if (!tiles || tiles.length === 0) {
    return fallback;
  }
  return tiles[tiles.length - 1].index + 1;
}

function chooseBreaks(
  aspects: number[],
  width: number,
  viewportHeight: number,
  hTarget: number,
  fit: number,
  galleryTail: boolean,
): number[] {
  const count = aspects.length;
  const best = Array.from({ length: count + 1 }, () => Number.POSITIVE_INFINITY);
  const choice = Array.from({ length: count + 1 }, () => 1);
  best[0] = 0;

  for (let start = 0; start < count; start += 1) {
    if (!Number.isFinite(best[start])) {
      continue;
    }
    let sum = 0;
    let maxAspect = 0;
    const limit = Math.min(K_MAX, count - start);
    for (let take = 1; take <= limit; take += 1) {
      const aspect = aspects[start + take - 1];
      sum += aspect;
      maxAspect = Math.max(maxAspect, aspect);
      const last = galleryTail && start + take === count;
      const cost = rowCost(sum, maxAspect, take, width, viewportHeight, hTarget, fit, last);
      const total = best[start] + cost;
      if (total < best[start + take]) {
        best[start + take] = total;
        choice[start + take] = take;
      }
    }
  }

  if (!Number.isFinite(best[count])) {
    return aspects.map(() => 1);
  }

  const reversed: number[] = [];
  let index = count;
  while (index > 0) {
    const take = choice[index];
    reversed.push(take);
    index -= take;
  }
  return reversed.reverse();
}

function rowCost(
  sum: number,
  maxAspect: number,
  take: number,
  width: number,
  viewportHeight: number,
  hTarget: number,
  fit: number,
  last: boolean,
): number {
  if (sum <= 0 || hTarget <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (take > 1 && maxAspect / sum > 0.6) {
    return Number.POSITIVE_INFINITY;
  }
  const natural = width / sum;
  const height = chosenHeight(natural, hTarget, viewportHeight, fit);
  if (take > 1 && (height > viewportHeight || height < hTarget * 0.5)) {
    return Number.POSITIVE_INFINITY;
  }
  if (last && (natural > viewportHeight || natural < hTarget * 0.5)) {
    return 0.25;
  }
  const ratio = Math.log(height / hTarget);
  return ratio * ratio;
}

function chosenHeight(natural: number, hTarget: number, viewportHeight: number, fit: number): number {
  if (fit <= 0) {
    return natural;
  }
  const factor = 1 - Math.min(fit, 0.1);
  const minSumScale = factor;
  const maxSumScale = factor > 0 ? 1 / factor : 1;
  const want = widthSafe(natural, hTarget);
  const minHeight = natural / maxSumScale;
  const maxHeight = natural / minSumScale;
  const pulled = Math.min(maxHeight, Math.max(minHeight, Math.min(want, viewportHeight)));
  const before = Math.log(natural / hTarget) ** 2;
  const after = Math.log(pulled / hTarget) ** 2;
  return after + 1e-9 < before ? pulled : natural;
}

function widthSafe(natural: number, hTarget: number): number {
  return hTarget > 0 ? hTarget : natural;
}

function placeRow(
  aspects: number[],
  indexOffset: number,
  width: number,
  top: number,
  hTarget: number,
  viewportHeight: number,
  fit: number,
  last: boolean,
  followZoom = false,
): GalleryRow {
  const sum = aspects.reduce((total, aspect) => total + aspect, 0);
  const gapTotal = TILE_GAP * Math.max(0, aspects.length - 1);
  const rowWidth = Math.max(1, width - gapTotal);
  const natural = rowWidth / sum;
  let height = chosenHeight(natural, hTarget, viewportHeight, fit);
  let stretch = true;
  if (followZoom) {
    height = Math.min(hTarget, viewportHeight, natural);
    stretch = false;
  } else if (last && (natural > viewportHeight || natural < hTarget * 0.5)) {
    height = Math.min(hTarget, viewportHeight);
    stretch = false;
  }
  if (height > viewportHeight) {
    height = viewportHeight;
    stretch = false;
  }

  const tiles: TileBox[] = [];
  let x = 0;
  aspects.forEach((aspect, index) => {
    const tileWidth =
      stretch && index === aspects.length - 1
        ? Math.max(1, width - x)
        : Math.max(1, Math.round((height * aspect)));
    tiles.push({
      index: indexOffset + index,
      x,
      width: tileWidth,
    });
    x += tileWidth + (index < aspects.length - 1 ? TILE_GAP : 0);
  });
  return { top, height: Math.round(height), tiles };
}

function columnMetrics(width: number, viewportHeight: number, rowsPerScreen: number): {
  columnCount: number;
  tileWidth: number;
} {
  const cell = Math.max(48, viewportHeight / Math.max(1, rowsPerScreen));
  const columnCount = Math.max(1, Math.floor(width / cell));
  return { columnCount, tileWidth: width / columnCount };
}

function shortestColumn(heights: ArrayLike<number>): number {
  let column = 0;
  for (let next = 1; next < heights.length; next += 1) {
    if (heights[next] < heights[column]) {
      column = next;
    }
  }
  return column;
}

function maxHeight(heights: ArrayLike<number>): number {
  let height = 0;
  for (let index = 0; index < heights.length; index += 1) {
    height = Math.max(height, heights[index]);
  }
  return height;
}

function estimateColumnCanvasHeight(
  heights: ArrayLike<number>,
  remaining: number,
  tileWidth: number,
  sampleAspect = ESTIMATED_ASPECT,
): number {
  const published = maxHeight(heights);
  if (remaining <= 0) {
    return published;
  }
  const aspect =
    Number.isFinite(sampleAspect) && sampleAspect > 0 ? sampleAspect : ESTIMATED_ASPECT;
  const tileHeight = Math.max(1, Math.round(tileWidth / aspect));
  let sum = 0;
  for (let index = 0; index < heights.length; index += 1) {
    sum += heights[index];
  }
  const even = Math.ceil((sum + remaining * tileHeight) / Math.max(1, heights.length));
  return Math.max(published, even);
}

function appendColumnTile(
  columns: MasonryTile[][],
  heights: number[],
  rows: GalleryRow[],
  aspect: number,
  index: number,
  tileWidth: number,
): void {
  const column = shortestColumn(heights);
  const tileHeight = Math.max(1, Math.round(tileWidth / (aspect > 0 ? aspect : ESTIMATED_ASPECT)));
  const y = heights[column];
  const x = column * tileWidth;
  const tile: MasonryTile = { index, x, y, width: tileWidth, height: tileHeight };
  columns[column].push(tile);
  rows.push({
    top: y,
    height: tileHeight,
    tiles: [{ index, x, width: tileWidth }],
  });
  heights[column] += tileHeight;
}

function placeColumns(
  aspects: number[],
  width: number,
  viewportHeight: number,
  rowsPerScreen: number,
  indexOffset: number,
): { rows: GalleryRow[]; columns: MasonryTile[][]; height: number; heights: number[] } {
  const { columnCount, tileWidth } = columnMetrics(width, viewportHeight, rowsPerScreen);
  const heights = Array.from({ length: columnCount }, () => 0);
  const columns: MasonryTile[][] = Array.from({ length: columnCount }, () => []);
  const rows: GalleryRow[] = [];
  for (let index = 0; index < aspects.length; index += 1) {
    appendColumnTile(columns, heights, rows, aspects[index], indexOffset + index, tileWidth);
  }
  return { rows, columns, height: maxHeight(heights), heights };
}

function placeUniform(
  aspects: number[],
  width: number,
  viewportHeight: number,
  rowsPerScreen: number,
  indexOffset: number,
): GalleryRow[] {
  if (aspects.length === 1) {
    const height = Math.max(48, viewportHeight / Math.max(1, rowsPerScreen));
    const aspect = aspects[0] ?? ESTIMATED_ASPECT;
    const tileWidth = Math.min(width, Math.max(1, Math.round(height * aspect)));
    return [
      {
        top: 0,
        height,
        tiles: [{ index: indexOffset, x: 0, width: tileWidth }],
      },
    ];
  }
  const cell = Math.max(48, viewportHeight / Math.max(1, rowsPerScreen));
  const columns = Math.max(1, Math.floor(width / cell));
  const tile = Math.max(1, Math.floor(width / columns));
  const rows: GalleryRow[] = [];
  let top = 0;
  for (let start = 0; start < aspects.length; start += columns) {
    const count = Math.min(columns, aspects.length - start);
    const tiles: TileBox[] = [];
    for (let column = 0; column < count; column += 1) {
      tiles.push({
        index: indexOffset + start + column,
        x: column * tile,
        width: tile,
      });
    }
    rows.push({ top, height: tile, tiles });
    top += tile;
  }
  return rows;
}
