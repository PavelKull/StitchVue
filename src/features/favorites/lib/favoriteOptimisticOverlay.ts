import { pathKey } from "../../selection/lib/selection.ts";

/** Per-path optimistic star overlay on top of `favoritePaths` (confirmed listing). */

export type FavoriteOverlayEntry = {
  operationId: string;
  status: "pending" | "success" | "error";
  /** Intended star state while pending. */
  desired: boolean;
  generation: number;
};

export type FavoriteOverlayMap = ReadonlyMap<string, FavoriteOverlayEntry>;

export function isFavoriteOverlayPending(
  overlay: FavoriteOverlayMap,
  key: string,
): boolean {
  return overlay.get(key)?.status === "pending";
}

/** Pending unfavorite — hide copy from Favorites grid/viewer before IPC completes. */
export function shouldHideFromFavoritesListing(
  overlay: FavoriteOverlayMap,
  key: string,
): boolean {
  const entry = overlay.get(key);
  return entry?.status === "pending" && entry.desired === false;
}

export function filterListingImagesForFavoriteOverlay<T extends { path: string }>(
  images: readonly T[],
  overlay: FavoriteOverlayMap,
): T[] {
  if (overlay.size === 0) {
    return images.slice();
  }
  let pendingOff = false;
  for (const entry of overlay.values()) {
    if (entry.status === "pending" && !entry.desired) {
      pendingOff = true;
      break;
    }
  }
  if (!pendingOff) {
    return images.slice();
  }
  return images.filter(
    (file) => !shouldHideFromFavoritesListing(overlay, pathKey(file.path)),
  );
}

export function favoriteDisplayOn(
  key: string,
  confirmedPaths: ReadonlySet<string>,
  overlay: FavoriteOverlayMap,
  inFavoritesFolder: boolean,
): boolean {
  const entry = overlay.get(key);
  if (entry?.status === "pending") {
    return entry.desired;
  }
  if (inFavoritesFolder) {
    return true;
  }
  return confirmedPaths.has(key);
}

export function nextFavoriteOverlayGeneration(
  generations: ReadonlyMap<string, number>,
  key: string,
): number {
  return (generations.get(key) ?? 0) + 1;
}

export function applyFavoriteOverlayPending(
  overlay: FavoriteOverlayMap,
  key: string,
  operationId: string,
  desired: boolean,
  generation: number,
): FavoriteOverlayMap {
  const next = new Map(overlay);
  next.set(key, {
    operationId,
    status: "pending",
    desired,
    generation,
  });
  return next;
}

export function applyFavoriteOverlayPendingBatch(
  overlay: FavoriteOverlayMap,
  entries: ReadonlyArray<{
    key: string;
    operationId: string;
    desired: boolean;
    generation: number;
  }>,
): FavoriteOverlayMap {
  if (entries.length === 0) {
    return overlay;
  }
  const next = new Map(overlay);
  for (const entry of entries) {
    next.set(entry.key, {
      operationId: entry.operationId,
      status: "pending",
      desired: entry.desired,
      generation: entry.generation,
    });
  }
  return next;
}

/** SQLite-registered copy → origin links only (no guessed byte-match origins). */
export function mapSnapshotCopyOrigins(
  rows: ReadonlyArray<{ copyPath: string; originPath: string | null }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    if (!row.originPath) {
      continue;
    }
    out.set(pathKey(row.copyPath), pathKey(row.originPath));
  }
  return out;
}

export function clearFavoriteOverlayIfGeneration(
  overlay: FavoriteOverlayMap,
  key: string,
  generation: number,
): FavoriteOverlayMap {
  const entry = overlay.get(key);
  if (!entry || entry.generation !== generation) {
    return overlay;
  }
  const next = new Map(overlay);
  next.delete(key);
  return next;
}

export function clearFavoriteOverlayKey(
  overlay: FavoriteOverlayMap,
  key: string,
): FavoriteOverlayMap {
  if (!overlay.has(key)) {
    return overlay;
  }
  const next = new Map(overlay);
  next.delete(key);
  return next;
}

/** Drop stale pending entries for a batch when the operation ends or the folder session changed. */
/** Apply server favorite listing without overriding in-flight optimistic stars. */
export function favoritePathsFromServerWithOverlay(
  serverPaths: readonly string[],
  overlay: FavoriteOverlayMap,
): Set<string> {
  const next = new Set(serverPaths.map((item) => pathKey(item)));
  for (const [key, entry] of overlay) {
    if (entry.status !== "pending") {
      continue;
    }
    if (entry.desired) {
      next.add(key);
    } else {
      next.delete(key);
    }
  }
  return next;
}

export function countFavoriteOverlayPending(overlay: FavoriteOverlayMap): number {
  let count = 0;
  for (const entry of overlay.values()) {
    if (entry.status === "pending") {
      count += 1;
    }
  }
  return count;
}

export function clearFavoriteOverlayForOperation(
  overlay: FavoriteOverlayMap,
  operationId: string,
): FavoriteOverlayMap {
  let changed = false;
  const next = new Map(overlay);
  for (const [key, entry] of overlay) {
    if (entry.operationId === operationId && entry.status === "pending") {
      next.delete(key);
      changed = true;
    }
  }
  return changed ? next : overlay;
}

/**
 * CL-P05 / T027: при неопределённой связи (лаг журнала / needs review)
 * сбрасывает только перечисленные pending-ключи, чужие пути не трогает.
 */
export function rollbackIndeterminateFavoriteOverlay(
  overlay: FavoriteOverlayMap,
  keys: readonly string[],
): FavoriteOverlayMap {
  if (keys.length === 0) {
    return overlay;
  }
  let changed = false;
  const next = new Map(overlay);
  for (const raw of keys) {
    const key = pathKey(raw);
    const entry = next.get(key);
    if (!entry || entry.status !== "pending") {
      continue;
    }
    next.delete(key);
    changed = true;
  }
  return changed ? next : overlay;
}
