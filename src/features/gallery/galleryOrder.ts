import type { ImageFile } from "../../entities/image/types";
import { formatDate } from "../../shared/i18n/formatters.ts";
import i18n from "../../shared/i18n/i18n.ts";

export type SortKey = "date" | "name";
export type SortDirection = "asc" | "desc";

export type GallerySort = {
  /** Null means no sort button is pressed. */
  key: SortKey | null;
  direction: SortDirection;
  grouped: boolean;
};

export const DEFAULT_GALLERY_SORT: GallerySort = {
  key: null,
  direction: "desc",
  grouped: true,
};

/** Date starts newest-first. Name starts A-to-Z. */
export function defaultSortDirection(key: SortKey): SortDirection {
  return key === "name" ? "asc" : "desc";
}

export function photoDateLabel(modifiedAt: number): string | null {
  if (modifiedAt <= 0) {
    return null;
  }
  const date = new Date(modifiedAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return formatDate(date);
}

export function naturalNameCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

export function pathTieBreak(left: string, right: string): number {
  return left.replace(/\//g, "\\").toLowerCase().localeCompare(right.replace(/\//g, "\\").toLowerCase());
}

/** Date sort uses file mtime. EXIF DateTimeOriginal is not on the folder listing. */
export function sortInstant(file: ImageFile): number {
  return file.modifiedAt > 0 ? file.modifiedAt : 0;
}

/**
 * Off → default direction → opposite direction → off.
 * Date starts newest-first. Name starts A-to-Z.
 */
export function applySortPress(current: GallerySort, key: SortKey): GallerySort {
  if (current.key !== key) {
    return { ...current, key, direction: defaultSortDirection(key) };
  }
  if (current.direction === defaultSortDirection(key)) {
    return { ...current, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { ...current, key: null };
}

export function sortOrderName(sort: GallerySort): string {
  const active = activeSort(sort);
  return `${active.key}-${active.direction}`;
}

function activeSort(sort: GallerySort): { key: SortKey; direction: SortDirection } {
  if (sort.key === null) {
    return sort.grouped ? { key: "date", direction: "desc" } : { key: "name", direction: "asc" };
  }
  return { key: sort.key, direction: sort.direction };
}

export function sortPhotos(files: readonly ImageFile[], sort: GallerySort): ImageFile[] {
  const next = files.slice();
  const active = activeSort(sort);
  const direction = active.direction === "asc" ? 1 : -1;
  next.sort((left, right) => {
    const primary =
      active.key === "name"
        ? naturalNameCompare(left.name, right.name)
        : sortInstant(left) - sortInstant(right) || naturalNameCompare(left.name, right.name);
    if (primary !== 0) {
      return primary * direction;
    }
    return pathTieBreak(left.path, right.path);
  });
  return next;
}

export function groupLabel(file: ImageFile, sort: GallerySort): string {
  if (activeSort(sort).key === "name") {
    const first = Array.from(file.name)[0];
    return first ? first.toLocaleUpperCase() : "#";
  }
  if (file.modifiedAt <= 0) {
    return i18n.t("gallery.noDate");
  }
  return new Date(file.modifiedAt).toISOString().slice(0, 10);
}

/** True when this index starts a sort group. The gallery does not draw these titles. */
export function groupBreaks(files: readonly ImageFile[], sort: GallerySort): boolean[] {
  if (!sort.grouped || files.length === 0) {
    return files.map(() => false);
  }
  let previous = "";
  return files.map((file) => {
    const label = groupLabel(file, sort);
    const starts = label !== previous;
    previous = label;
    return starts;
  });
}

export function groupLabels(files: readonly ImageFile[], sort: GallerySort): (string | null)[] {
  const breaks = groupBreaks(files, sort);
  return files.map((file, index) => (breaks[index] ? groupLabel(file, sort) : null));
}

/**
 * After removals, stay on the next remaining photo, otherwise the previous one.
 * Indexes refer to the list before removal.
 */
export function viewerIndexAfterRemoval(
  orderedPaths: readonly string[],
  openIndex: number | null,
  removed: ReadonlySet<string>,
): number | null {
  if (openIndex === null || orderedPaths.length === 0) {
    return null;
  }
  const open = orderedPaths[openIndex];
  if (!open) {
    return null;
  }
  if (!removed.has(open)) {
    const kept = orderedPaths.filter((path) => !removed.has(path));
    const next = kept.indexOf(open);
    return next === -1 ? null : next;
  }
  for (let index = openIndex + 1; index < orderedPaths.length; index += 1) {
    if (!removed.has(orderedPaths[index])) {
      return orderedPaths.slice(0, index).filter((path) => !removed.has(path)).length;
    }
  }
  for (let index = openIndex - 1; index >= 0; index -= 1) {
    if (!removed.has(orderedPaths[index])) {
      return orderedPaths.slice(0, index).filter((path) => !removed.has(path)).length;
    }
  }
  return null;
}
