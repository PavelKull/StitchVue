import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFavoriteOverlayPending,
  clearFavoriteOverlayForOperation,
  clearFavoriteOverlayIfGeneration,
  countFavoriteOverlayPending,
  type FavoriteOverlayEntry,
} from "./favoriteOptimisticOverlay.ts";
import {
  buildFavoriteOptimisticMemorySnapshot,
} from "./favoriteOptimisticMemoryDiag.ts";
import {
  ensureFavoriteCopyOriginCacheScope,
  mergeFavoriteCopyOriginCache,
} from "./favoriteMassUnfavoriteOptimistic.ts";

/** Mirrors GalleryPage rollback + generation map prune. */
function rollbackOverlayWithGenerationTrack(
  overlay: Map<string, FavoriteOverlayEntry>,
  generations: Map<string, number>,
  key: string,
  generation: number,
): void {
  const entry = overlay.get(key);
  if (!entry || entry.generation !== generation) {
    return;
  }
  overlay.delete(key);
  generations.delete(key);
}

test("100 alternations favorites scope → cache empty outside favorites", () => {
  const cache = new Map<string, string>();
  const scope = { current: null as string | null };
  for (let i = 0; i < 100; i += 1) {
    ensureFavoriteCopyOriginCacheScope(
      cache,
      `C:\\Album${i}\\Избранное`,
      scope,
    );
    mergeFavoriteCopyOriginCache(cache, [
      {
        copyPath: `C:\\Album${i}\\Избранное\\photo.jpg`,
        originPath: `C:\\Album${i}\\photo.jpg`,
      },
    ]);
    ensureFavoriteCopyOriginCacheScope(cache, null, scope);
  }
  const snapshot = buildFavoriteOptimisticMemorySnapshot({
    originCache: cache,
    originCacheScopeKey: scope.current,
    overlay: new Map(),
    hiddenFolderKeys: new Set(),
    unfavoriteGateBusy: false,
    massUnfavoriteSessionActive: false,
    originLookupPending: 0,
  });
  assert.equal(cache.size, 0);
  assert.equal(snapshot.originCacheEntries, 0);
  assert.equal(snapshot.originCacheScopeActive, false);
});

test("20 mass-style overlay cycles leave no pending entries", () => {
  let overlay = new Map<
    string,
    {
      operationId: string;
      status: "pending";
      desired: boolean;
      generation: number;
    }
  >();
  for (let i = 0; i < 20; i += 1) {
    const op = `mass-op-${i}`;
    overlay = applyFavoriteOverlayPending(overlay, "copy-key", op, false, i + 1);
    overlay = applyFavoriteOverlayPending(overlay, "origin-key", op, false, i + 1);
    overlay = clearFavoriteOverlayForOperation(overlay, op);
  }
  assert.equal(overlay.size, 0);
  assert.equal(countFavoriteOverlayPending(overlay), 0);
});

test("ABA: stale generation rollback does not clear newer pending overlay", () => {
  let overlay = applyFavoriteOverlayPending(new Map(), "k", "op-old", false, 1);
  overlay = applyFavoriteOverlayPending(overlay, "k", "op-new", true, 2);
  overlay = clearFavoriteOverlayIfGeneration(overlay, "k", 1);
  assert.equal(overlay.get("k")?.desired, true);
  assert.equal(overlay.get("k")?.operationId, "op-new");
  assert.equal(overlay.get("k")?.generation, 2);
  overlay = clearFavoriteOverlayIfGeneration(overlay, "k", 2);
  assert.equal(overlay.size, 0);
});

test("single vs batch operationId isolation on same pathKey", () => {
  let overlay = applyFavoriteOverlayPending(new Map(), "k", "batch-op", false, 1);
  overlay = applyFavoriteOverlayPending(overlay, "other", "single-op", true, 1);
  overlay = clearFavoriteOverlayForOperation(overlay, "batch-op");
  assert.equal(overlay.has("k"), false);
  assert.equal(overlay.get("other")?.desired, true);
});

test("teardown simulation clears copy and origin generation tracks", () => {
  const overlay = new Map<string, FavoriteOverlayEntry>();
  const generations = new Map<string, number>();
  const copyKey = "copy";
  const originKey = "origin";
  overlay.set(copyKey, {
    operationId: "s1",
    status: "pending",
    desired: false,
    generation: 3,
  });
  overlay.set(originKey, {
    operationId: "s1",
    status: "pending",
    desired: false,
    generation: 4,
  });
  generations.set(copyKey, 3);
  generations.set(originKey, 4);
  rollbackOverlayWithGenerationTrack(overlay, generations, copyKey, 3);
  rollbackOverlayWithGenerationTrack(overlay, generations, originKey, 4);
  assert.equal(overlay.size, 0);
  assert.equal(generations.size, 0);
  assert.equal(countFavoriteOverlayPending(overlay), 0);
});

test("stale origin merge after scope clear does not resurrect cache without scope", () => {
  const cache = new Map<string, string>();
  const scope = { current: null as string | null };
  ensureFavoriteCopyOriginCacheScope(cache, "C:\\A\\Избранное", scope);
  mergeFavoriteCopyOriginCache(cache, [
    { copyPath: "C:\\A\\Избранное\\x.jpg", originPath: "C:\\A\\x.jpg" },
  ]);
  assert.equal(cache.size, 1);
  ensureFavoriteCopyOriginCacheScope(cache, null, scope);
  assert.equal(cache.size, 0);
  // Late lookup would need explicit scope before merge — without it, merge repopulates:
  mergeFavoriteCopyOriginCache(cache, [
    { copyPath: "C:\\A\\Избранное\\y.jpg", originPath: "C:\\A\\y.jpg" },
  ]);
  assert.equal(cache.size, 1);
  const snapshot = buildFavoriteOptimisticMemorySnapshot({
    originCache: cache,
    originCacheScopeKey: scope.current,
    overlay: new Map(),
    hiddenFolderKeys: new Set(),
    unfavoriteGateBusy: false,
    massUnfavoriteSessionActive: false,
    originLookupPending: 1,
  });
  assert.equal(snapshot.originCacheScopeActive, false);
  assert.equal(snapshot.originCacheEntries, 1);
});
