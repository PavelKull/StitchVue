import test from "node:test";
import assert from "node:assert/strict";
import type { ImageFile } from "../../../entities/image/types.ts";
import {
  copyOriginRowsFromCache,
  ensureFavoriteCopyOriginCacheScope,
  mergeFavoriteCopyOriginCache,
  shouldOptimisticallyHideFavoritesServiceFolder,
} from "./favoriteMassUnfavoriteOptimistic.ts";

function img(path: string): ImageFile {
  return { path, size: 1, modifiedAt: 0, name: path.split("\\").pop() ?? path };
}

test("ensureFavoriteCopyOriginCacheScope clears when scope is null", () => {
  const cache = new Map([["a", "b"]]);
  const scope = { current: "x" as string | null };
  ensureFavoriteCopyOriginCacheScope(cache, null, scope);
  assert.equal(cache.size, 0);
  assert.equal(scope.current, null);
});

test("mergeFavoriteCopyOriginCache ignores rows without origin", () => {
  const cache = new Map<string, string>();
  mergeFavoriteCopyOriginCache(cache, [
    { copyPath: "C:\\Fav\\a.jpg", originPath: "C:\\Album\\a.jpg" },
    { copyPath: "C:\\Fav\\b.jpg", originPath: null },
  ]);
  assert.equal(cache.size, 1);
  assert.equal(cache.get("c:\\fav\\a.jpg"), "c:\\album\\a.jpg");
});

test("copyOriginRowsFromCache does not invent origins", () => {
  const cache = new Map([["c:\\fav\\a.jpg", "c:\\album\\a.jpg"]]);
  const rows = copyOriginRowsFromCache(cache, ["C:\\Fav\\a.jpg", "C:\\Fav\\x.jpg"]);
  assert.equal(rows[0].originPath, "c:\\album\\a.jpg");
  assert.equal(rows[1].originPath, null);
});

test("full favorites emptying allows optimistic folder hide", () => {
  const fav = "C:\\Photos\\Избранное";
  const files = [img(`${fav}\\a.jpg`), img(`${fav}\\b.jpg`)];
  assert.equal(
    shouldOptimisticallyHideFavoritesServiceFolder({
      sessionPath: fav,
      targets: files,
      listingImages: files,
      childFolderCount: 0,
      listingReady: true,
    }),
    true,
  );
});

test("partial removal does not hide favorites folder", () => {
  const fav = "C:\\Photos\\Избранное";
  const all = [img(`${fav}\\a.jpg`), img(`${fav}\\b.jpg`)];
  assert.equal(
    shouldOptimisticallyHideFavoritesServiceFolder({
      sessionPath: fav,
      targets: [all[0]],
      listingImages: all,
      childFolderCount: 0,
      listingReady: true,
    }),
    false,
  );
});

test("incomplete listing blocks optimistic folder hide", () => {
  const fav = "C:\\Photos\\Избранное";
  const files = [img(`${fav}\\a.jpg`)];
  assert.equal(
    shouldOptimisticallyHideFavoritesServiceFolder({
      sessionPath: fav,
      targets: files,
      listingImages: files,
      childFolderCount: 0,
      listingReady: false,
    }),
    false,
  );
});

test("child folders block optimistic hide", () => {
  const fav = "C:\\Photos\\Избранное";
  const files = [img(`${fav}\\a.jpg`)];
  assert.equal(
    shouldOptimisticallyHideFavoritesServiceFolder({
      sessionPath: fav,
      targets: files,
      listingImages: files,
      childFolderCount: 1,
      listingReady: true,
    }),
    false,
  );
});
