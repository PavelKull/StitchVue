import test from "node:test";
import assert from "node:assert/strict";
import { applyFavoriteOverlayPending } from "./favoriteOptimisticOverlay.ts";
import { buildFavoriteOptimisticMemorySnapshot } from "./favoriteOptimisticMemoryDiag.ts";
import { ensureFavoriteCopyOriginCacheScope } from "./favoriteMassUnfavoriteOptimistic.ts";

test("ensureFavoriteCopyOriginCacheScope clears cache on folder change", () => {
  const cache = new Map<string, string>([["a", "b"]]);
  const scope = { current: "old" as string | null };
  ensureFavoriteCopyOriginCacheScope(cache, "C:\\New\\Избранное", scope);
  assert.equal(cache.size, 0);
  assert.notEqual(scope.current, "old");
});

test("memory snapshot exposes counts without paths", () => {
  const overlay = applyFavoriteOverlayPending(new Map(), "k", "op", false, 1);
  const snapshot = buildFavoriteOptimisticMemorySnapshot({
    originCache: new Map([["a", "b"]]),
    originCacheScopeKey: "scope",
    overlay,
    hiddenFolderKeys: new Set(["x"]),
    unfavoriteGateBusy: true,
    massUnfavoriteSessionActive: false,
    originLookupPending: 2,
  });
  assert.equal(snapshot.originCacheEntries, 1);
  assert.equal(snapshot.overlayPending, 1);
  assert.equal(snapshot.hiddenFolderKeys, 1);
  assert.equal(snapshot.originLookupPending, 2);
  assert.equal(JSON.stringify(snapshot).includes("C:\\"), false);
});
