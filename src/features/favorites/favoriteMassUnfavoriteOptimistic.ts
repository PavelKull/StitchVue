import type { ImageFile } from "../../entities/image/types.ts";
import { pathKey } from "../selection/selection.ts";
import type { FavoriteCopyOrigin } from "../selection/fileOperation.ts";

export type FavoritesServiceFolderHideOverlay = {
  operationId: string;
  generation: number;
  folderPath: string;
  parentDirectory: string;
};

/** Keep origin cache scoped to one favorites folder; clear when scope changes or closes. */
export function ensureFavoriteCopyOriginCacheScope(
  cache: Map<string, string>,
  scopePath: string | null,
  activeScopeKey: { current: string | null },
): void {
  if (scopePath === null) {
    cache.clear();
    activeScopeKey.current = null;
    return;
  }
  const scopeKey = pathKey(scopePath);
  if (activeScopeKey.current !== scopeKey) {
    cache.clear();
    activeScopeKey.current = scopeKey;
  }
}

/** Merge SQLite-registered copy → origin links into the confirmed cache. */
export function mergeFavoriteCopyOriginCache(
  cache: Map<string, string>,
  rows: ReadonlyArray<FavoriteCopyOrigin>,
): void {
  for (const row of rows) {
    if (!row.originPath) {
      continue;
    }
    cache.set(pathKey(row.copyPath), pathKey(row.originPath));
  }
}

export function originKeyFromCopyCache(
  cache: ReadonlyMap<string, string>,
  copyPath: string,
): string | null {
  return cache.get(pathKey(copyPath)) ?? null;
}

/** Rows for overlay apply from cache only (no invented origins). */
export function copyOriginRowsFromCache(
  cache: ReadonlyMap<string, string>,
  copyPaths: readonly string[],
): FavoriteCopyOrigin[] {
  return copyPaths.map((copyPath) => ({
    copyPath,
    originPath: cache.get(pathKey(copyPath)) ?? null,
  }));
}

/**
 * Hide the service «Избранное» folder only when the listing is complete and every
 * listed image in that folder is included in the removal batch (no subfolders).
 */
export function shouldOptimisticallyHideFavoritesServiceFolder(options: {
  sessionPath: string;
  targets: readonly ImageFile[];
  listingImages: readonly ImageFile[];
  childFolderCount: number;
  listingReady: boolean;
}): boolean {
  if (!options.listingReady) {
    return false;
  }
  if (options.childFolderCount > 0) {
    return false;
  }
  if (options.listingImages.length === 0) {
    return false;
  }
  const targetKeys = new Set(
    options.targets.map((file) => pathKey(file.path)),
  );
  if (targetKeys.size !== options.listingImages.length) {
    return false;
  }
  return options.listingImages.every((file) =>
    targetKeys.has(pathKey(file.path)),
  );
}

export function nextFavoritesFolderHideGeneration(
  generations: ReadonlyMap<string, number>,
  folderPath: string,
): number {
  return (generations.get(pathKey(folderPath)) ?? 0) + 1;
}

export function shouldApplyFavoritesFolderHideOverlay(
  overlay: FavoritesServiceFolderHideOverlay | null,
  operationId: string,
  generation: number,
): boolean {
  return (
    overlay !== null &&
    overlay.operationId === operationId &&
    overlay.generation === generation
  );
}
