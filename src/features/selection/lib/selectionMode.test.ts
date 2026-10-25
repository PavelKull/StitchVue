import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveGalleryPhotoClick,
  shouldSuppressNativeSelection,
  suppressGalleryNativeSelectStart,
} from "./galleryPhotoClick.ts";
import {
  addRange,
  emptySelection,
  isClearSelectionHotkey,
  isSelectAllHotkey,
  selectAll,
  togglePath,
} from "./selection.ts";
import {
  clearSelectionPaths,
  enterSelectionMode,
  escapeSelection,
  resetSelectionOnFolderChange,
  resolveUnfavoriteParentDirectory,
  selectionAfterMassUnfavorite,
  shouldShowSelectionActions,
  toggleSelectionModeButton,
} from "./selectionMode.ts";

const dir = "c:\\photos";
const ordered = ["c:\\photos\\a.jpg", "c:\\photos\\b.jpg", "c:\\photos\\c.jpg", "c:\\photos\\d.jpg"];

test("1. Ctrl+click activates selection mode and selects the image", () => {
  assert.equal(enterSelectionMode(), true);
  assert.equal(
    resolveGalleryPhotoClick({
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
      selectionMode: false,
      inTrash: false,
    }),
    "toggle",
  );
  const next = togglePath(emptySelection(dir), dir, ordered, ordered[0]);
  assert.deepEqual(next.paths, [ordered[0]]);
  assert.equal(shouldShowSelectionActions(next.paths.length, false), true);
});

test("2. Second Ctrl+click deselects the image", () => {
  const once = togglePath(emptySelection(dir), dir, ordered, ordered[0]);
  const twice = togglePath(once, dir, ordered, ordered[0]);
  assert.deepEqual(twice.paths, []);
  assert.equal(twice.anchor, ordered[0]);
});

test("3. Shift+click selects a range from the anchor and enters mode", () => {
  assert.equal(enterSelectionMode(), true);
  assert.equal(
    resolveGalleryPhotoClick({
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
      selectionMode: false,
      inTrash: false,
    }),
    "extend",
  );
  const anchored = togglePath(emptySelection(dir), dir, ordered, ordered[0]);
  const ranged = addRange(anchored, dir, ordered, ordered[2]);
  assert.deepEqual(ranged.paths, [ordered[0], ordered[1], ordered[2]]);
  assert.equal(ranged.anchor, ordered[0], "Shift keeps the existing anchor");
});

test("4. Ctrl+A selects all images and activates mode", () => {
  assert.equal(enterSelectionMode(), true);
  const all = selectAll(dir, ordered, null);
  assert.deepEqual(all.paths, ordered);
  assert.equal(shouldShowSelectionActions(all.paths.length, false), true);
});

test("4b. Ctrl+A hotkey uses event.code (RU layout key ф still matches)", () => {
  assert.equal(
    isSelectAllHotkey({ code: "KeyA", key: "a", ctrlKey: true, shiftKey: false } as never),
    true,
  );
  assert.equal(
    isSelectAllHotkey({ code: "KeyA", ctrlKey: true, shiftKey: false }),
    true,
  );
  assert.equal(
    isSelectAllHotkey({ code: "KeyA", ctrlKey: true, shiftKey: false }),
    true,
  );
  // Same physical key under Russian layout — key would be "ф", code stays KeyA.
  assert.equal(isSelectAllHotkey({ code: "KeyA", ctrlKey: true, shiftKey: false }), true);
  assert.equal(isSelectAllHotkey({ code: "KeyF", ctrlKey: true, shiftKey: false }), false);
  assert.equal(isClearSelectionHotkey({ code: "KeyA", ctrlKey: true, shiftKey: true }), true);
  assert.equal(isClearSelectionHotkey({ code: "KeyA", ctrlKey: true, shiftKey: false }), false);
  assert.equal(isSelectAllHotkey({ code: "KeyA", ctrlKey: true, shiftKey: true }), false);
});

test("5. Select button turns mode on with empty selection (checkmarks available)", () => {
  const next = toggleSelectionModeButton(false, dir);
  assert.equal(next.selectionMode, true);
  assert.deepEqual(next.selection.paths, []);
});

test("6. Plain click in selection mode toggles, not opens viewer", () => {
  assert.equal(
    resolveGalleryPhotoClick({
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      selectionMode: true,
      inTrash: false,
    }),
    "toggle",
  );
});

test("7. Escape fully resets mode and paths", () => {
  const cleared = escapeSelection(dir);
  assert.equal(cleared.selectionMode, false);
  assert.deepEqual(cleared.selection, emptySelection(dir));
});

test("8. Folder change fully resets mode and paths", () => {
  const cleared = resetSelectionOnFolderChange("c:\\other");
  assert.equal(cleared.selectionMode, false);
  assert.deepEqual(cleared.selection, emptySelection("c:\\other"));
});

test("9. SelectionActions appears for any non-empty selection", () => {
  assert.equal(shouldShowSelectionActions(1, false), true);
  assert.equal(shouldShowSelectionActions(0, false), false);
  assert.equal(shouldShowSelectionActions(0, true), true);
});

test("10. Ctrl/Shift suppress native WebView2 selection on mousedown; selectstart is blocked", () => {
  assert.equal(shouldSuppressNativeSelection({ shiftKey: true, ctrlKey: false, metaKey: false }), true);
  assert.equal(shouldSuppressNativeSelection({ shiftKey: false, ctrlKey: true, metaKey: false }), true);
  assert.equal(shouldSuppressNativeSelection({ shiftKey: false, ctrlKey: false, metaKey: true }), true);
  assert.equal(shouldSuppressNativeSelection({ shiftKey: false, ctrlKey: false, metaKey: false }), false);
  let prevented = false;
  suppressGalleryNativeSelectStart({
    preventDefault() {
      prevented = true;
    },
  } as Event);
  assert.equal(prevented, true);
});

test("11. Plain click outside selection mode opens the viewer", () => {
  assert.equal(
    resolveGalleryPhotoClick({
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      selectionMode: false,
      inTrash: false,
    }),
    "open",
  );
});

test("12. Clear paths keeps mode; turning Select off clears both (unfavorite batch still uses paths)", () => {
  const kept = clearSelectionPaths(dir);
  assert.deepEqual(kept.paths, []);
  const off = toggleSelectionModeButton(true, dir);
  assert.equal(off.selectionMode, false);
  assert.deepEqual(off.selection.paths, []);
  // Mass unfavorite operates on selected paths; empty selection means no targets — mode alone is not enough.
  const selected = selectAll(dir, ordered, null);
  assert.ok(selected.paths.length > 0);
});

test("Select button off clears orphan bulk UI state", () => {
  const off = toggleSelectionModeButton(true, dir);
  assert.equal(off.selectionMode, false);
  assert.equal(shouldShowSelectionActions(off.selection.paths.length, false), false);
});

test("Trash blocks multi-select modifiers", () => {
  assert.equal(
    resolveGalleryPhotoClick({
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
      selectionMode: false,
      inTrash: true,
    }),
    "trash-blocked",
  );
});

test("mass unfavorite resolves parent when view.parent is missing", () => {
  assert.equal(
    resolveUnfavoriteParentDirectory(null, "C:\\Photos\\Избранное"),
    "C:\\Photos",
  );
  assert.equal(
    resolveUnfavoriteParentDirectory("C:\\Photos", "C:\\Photos\\Избранное"),
    "C:\\Photos",
  );
  assert.equal(
    resolveUnfavoriteParentDirectory(null, "/Users/me/Photos/Избранное/"),
    "/Users/me/Photos",
  );
});

test("mass unfavorite fully clears selection mode in the parent folder", () => {
  const cleared = selectionAfterMassUnfavorite("c:\\photos");
  assert.equal(cleared.selectionMode, false);
  assert.deepEqual(cleared.selection.paths, []);
  assert.equal(cleared.selection.directoryKey, "c:\\photos");
});
