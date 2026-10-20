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
  isTerminalFavoriteAddOutcomeStatus,
  isFavoriteOverlayPending,
  isFavoriteOverlayBlockingAdd,
  nextFavoriteOverlayGeneration,
  rollbackIndeterminateFavoriteOverlay,
  filterListingImagesForFavoriteOverlay,
  shouldHideFromFavoritesListing,
} from "./favoriteOptimisticOverlay.ts";

test("isFavoriteOverlayBlockingAdd only when pending desired true", () => {
  const overlay = new Map([
    ["a", { operationId: "1", status: "pending", desired: false, generation: 1 }],
    ["b", { operationId: "2", status: "pending", desired: true, generation: 1 }],
  ]);
  assert.equal(isFavoriteOverlayBlockingAdd(overlay, "a"), false);
  assert.equal(isFavoriteOverlayBlockingAdd(overlay, "b"), true);
});

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

test("shouldHideFromFavoritesListing only for pending desired false", () => {
  const overlay = applyFavoriteOverlayPending(new Map(), "a", "op1", false, 1);
  assert.equal(shouldHideFromFavoritesListing(overlay, "a"), true);
  assert.equal(shouldHideFromFavoritesListing(overlay, "b"), false);
  const on = applyFavoriteOverlayPending(new Map(), "c", "op1", true, 1);
  assert.equal(shouldHideFromFavoritesListing(on, "c"), false);
});

test("filterListingImagesForFavoriteOverlay drops pending-off copies", () => {
  const files = [{ path: "C:\\Fav\\a.jpg" }, { path: "C:\\Fav\\b.jpg" }];
  const overlay = applyFavoriteOverlayPendingBatch(new Map(), [
    { key: "c:\\fav\\a.jpg", operationId: "op", desired: false, generation: 1 },
  ]);
  const next = filterListingImagesForFavoriteOverlay(files, overlay);
  assert.equal(next.length, 1);
  assert.equal(next[0].path, files[1].path);
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

test("cancelled add outcome clears pending overlay so star matches disk", () => {
  assert.equal(isTerminalFavoriteAddOutcomeStatus("cancelled"), true);
  let overlay = applyFavoriteOverlayPending(new Map(), "c:\\x.jpg", "op", true, 3);
  overlay = clearFavoriteOverlayIfGeneration(overlay, "c:\\x.jpg", 3);
  assert.equal(
    favoriteDisplayOn("c:\\x.jpg", new Set(), overlay, false),
    false,
  );
});

test("clearFavoriteOverlayForOperation removes only matching pending ops", () => {
  let overlay = applyFavoriteOverlayPending(new Map(), "a", "op1", true, 1);
  overlay = applyFavoriteOverlayPending(overlay, "b", "op2", true, 1);
  const next = clearFavoriteOverlayForOperation(overlay, "op1");
  assert.equal(next.has("a"), false);
  assert.equal(next.has("b"), true);
});

test("T027 rollbackIndeterminateFavoriteOverlay drops only listed pending keys", () => {
  let overlay = applyFavoriteOverlayPending(new Map(), "c:\\a.jpg", "op1", true, 1);
  overlay = applyFavoriteOverlayPending(overlay, "c:\\b.jpg", "op2", true, 1);
  const next = rollbackIndeterminateFavoriteOverlay(overlay, ["C:\\a.jpg"]);
  assert.equal(next.has("c:\\a.jpg"), false);
  assert.equal(next.has("c:\\b.jpg"), true);
});
