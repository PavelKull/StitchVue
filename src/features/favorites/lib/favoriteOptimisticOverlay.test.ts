import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFavoriteOverlayPending,
  applyFavoriteOverlayPendingBatch,
  clearFavoriteOverlayForOperation,
  favoritePathsFromServerWithOverlay,
  mapSnapshotCopyOrigins,
  clearFavoriteOverlayIfGeneration,
  favoriteDisplayOn,
  isFavoriteOverlayPending,
  nextFavoriteOverlayGeneration,
} from "./favoriteOptimisticOverlay.ts";

test("isFavoriteOverlayPending reflects pending entries only", () => {
  const overlay = applyFavoriteOverlayPending(new Map(), "a", "op1", true, 1);
  assert.equal(isFavoriteOverlayPending(overlay, "a"), true);
  assert.equal(isFavoriteOverlayPending(overlay, "b"), false);
});

test("favoriteDisplayOn uses pending desired state over confirmed set", () => {
  const confirmed = new Set(["a"]);
  const overlay = applyFavoriteOverlayPending(new Map(), "a", "op1", false, 1);
  assert.equal(favoriteDisplayOn("a", confirmed, overlay, false), false);
  assert.equal(favoriteDisplayOn("b", confirmed, overlay, false), false);
});

test("favoriteDisplayOn in favorites folder defaults on unless pending off", () => {
  const confirmed = new Set<string>();
  assert.equal(favoriteDisplayOn("x", confirmed, new Map(), true), true);
  const overlay = applyFavoriteOverlayPending(new Map(), "x", "op1", false, 1);
  assert.equal(favoriteDisplayOn("x", confirmed, overlay, true), false);
});

test("clearFavoriteOverlayIfGeneration ignores stale generation", () => {
  const overlay = applyFavoriteOverlayPending(new Map(), "a", "op1", true, 2);
  const kept = clearFavoriteOverlayIfGeneration(overlay, "a", 1);
  assert.equal(kept.size, 1);
  const cleared = clearFavoriteOverlayIfGeneration(overlay, "a", 2);
  assert.equal(cleared.size, 0);
});

test("nextFavoriteOverlayGeneration increments per path", () => {
  const gens = new Map<string, number>([["a", 3]]);
  assert.equal(nextFavoriteOverlayGeneration(gens, "a"), 4);
  assert.equal(nextFavoriteOverlayGeneration(gens, "b"), 1);
});

test("applyFavoriteOverlayPendingBatch applies many entries in one map", () => {
  const overlay = applyFavoriteOverlayPendingBatch(new Map(), [
    { key: "a", operationId: "op1", desired: true, generation: 1 },
    { key: "b", operationId: "op1", desired: true, generation: 1 },
  ]);
  assert.equal(overlay.size, 2);
  assert.equal(favoriteDisplayOn("a", new Set(), overlay, false), true);
});

test("mapSnapshotCopyOrigins only uses explicit sqlite links", () => {
  const map = mapSnapshotCopyOrigins([
    { copyPath: "C:\\Fav\\a.jpg", originPath: "C:\\Album\\a.jpg" },
    { copyPath: "C:\\Fav\\b.jpg", originPath: null },
  ]);
  assert.equal(map.size, 1);
  assert.equal(map.get("c:\\fav\\a.jpg"), "c:\\album\\a.jpg");
});

test("favoritePathsFromServerWithOverlay keeps pending off over stale server stars", () => {
  const overlay = applyFavoriteOverlayPending(new Map(), "c:\\a.jpg", "op", false, 1);
  const merged = favoritePathsFromServerWithOverlay(["C:\\a.jpg"], overlay);
  assert.equal(merged.has("c:\\a.jpg"), false);
});

test("favoritePathsFromServerWithOverlay adds pending on before server confirms", () => {
  const overlay = applyFavoriteOverlayPending(new Map(), "c:\\b.jpg", "op", true, 1);
  const merged = favoritePathsFromServerWithOverlay([], overlay);
  assert.equal(merged.has("c:\\b.jpg"), true);
});

test("clearFavoriteOverlayForOperation removes only matching pending ops", () => {
  let overlay = applyFavoriteOverlayPending(new Map(), "a", "op1", true, 1);
  overlay = applyFavoriteOverlayPending(overlay, "b", "op2", true, 1);
  const next = clearFavoriteOverlayForOperation(overlay, "op1");
  assert.equal(next.has("a"), false);
  assert.equal(next.has("b"), true);
});
