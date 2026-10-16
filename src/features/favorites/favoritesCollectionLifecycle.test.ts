import test from "node:test";
import assert from "node:assert/strict";
import {
  browseErrorLooksLikeMissingFolder,
  favoritesActivityAfterRename,
} from "./favoritesCollectionLifecycle.ts";
import { isFavoritesFolderName } from "../../entities/folder/serviceFolder.ts";

test("isFavoritesFolderName accepts both canonical names", () => {
  assert.equal(isFavoritesFolderName("Избранное"), true);
  assert.equal(isFavoritesFolderName("Избранная"), true);
  assert.equal(isFavoritesFolderName("Лучшие фото"), false);
});

test("renaming active favorites to a regular name deactivates the collection", () => {
  assert.equal(
    favoritesActivityAfterRename("favorites", "Лучшие фото"),
    "deactivated",
  );
  assert.equal(
    favoritesActivityAfterRename("favorites", "Избранная"),
    "stays-active",
  );
  assert.equal(favoritesActivityAfterRename(null, "Лучшие фото"), "unchanged");
});

test("browseErrorLooksLikeMissingFolder detects a vanished open folder", () => {
  assert.equal(
    browseErrorLooksLikeMissingFolder("not a directory: C:\\Photos\\Избранное"),
    true,
  );
  assert.equal(browseErrorLooksLikeMissingFolder("access denied"), false);
});
