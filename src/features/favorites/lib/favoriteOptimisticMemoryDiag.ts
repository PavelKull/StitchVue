import type { FavoriteOverlayMap } from "./favoriteOptimisticOverlay.ts";
import { countFavoriteOverlayPending } from "./favoriteOptimisticOverlay.ts";

export type FavoriteOptimisticMemorySnapshot = {
  originCacheEntries: number;
  originCacheScopeActive: boolean;
  overlayEntries: number;
  overlayPending: number;
  hiddenFolderKeys: number;
  unfavoriteGateBusy: boolean;
  massUnfavoriteSessionActive: boolean;
  originLookupPending: number;
};

export function buildFavoriteOptimisticMemorySnapshot(options: {
  originCache: ReadonlyMap<string, string>;
  originCacheScopeKey: string | null;
  overlay: FavoriteOverlayMap;
  hiddenFolderKeys: ReadonlySet<string>;
  unfavoriteGateBusy: boolean;
  massUnfavoriteSessionActive: boolean;
  originLookupPending: number;
}): FavoriteOptimisticMemorySnapshot {
  return {
    originCacheEntries: options.originCache.size,
    originCacheScopeActive: options.originCacheScopeKey !== null,
    overlayEntries: options.overlay.size,
    overlayPending: countFavoriteOverlayPending(options.overlay),
    hiddenFolderKeys: options.hiddenFolderKeys.size,
    unfavoriteGateBusy: options.unfavoriteGateBusy,
    massUnfavoriteSessionActive: options.massUnfavoriteSessionActive,
    originLookupPending: options.originLookupPending,
  };
}

export function logFavoriteOptimisticMemoryDiag(
  snapshot: FavoriteOptimisticMemorySnapshot,
): void {
  if (!import.meta.env.DEV) {
    return;
  }
  console.debug("[stitchvue:fav-optimistic-mem]", snapshot);
}

export function installFavoriteOptimisticMemoryDiag(
  readSnapshot: () => FavoriteOptimisticMemorySnapshot,
): void {
  if (!import.meta.env.DEV) {
    return;
  }
  const global = globalThis as typeof globalThis & {
    __stitchvueFavOptimisticMem?: () => FavoriteOptimisticMemorySnapshot;
  };
  global.__stitchvueFavOptimisticMem = () => {
    const snapshot = readSnapshot();
    logFavoriteOptimisticMemoryDiag(snapshot);
    return snapshot;
  };
}
