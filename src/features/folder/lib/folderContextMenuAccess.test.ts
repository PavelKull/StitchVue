import assert from "node:assert/strict";
import test from "node:test";
import {
  canLoadFolderMenuOptions,
  folderShortcutFromPath,
} from "./folderContextMenuAccess.ts";

test("drive roots skip rename/delete IPC", () => {
  assert.equal(canLoadFolderMenuOptions({ kind: "drive" }, "C:"), false);
  assert.equal(canLoadFolderMenuOptions({ kind: "folder" }, "C:\\Photos"), true);
  assert.equal(canLoadFolderMenuOptions({ kind: "place" }, ""), false);
});

test("folderShortcutFromPath marks drive roots", () => {
  assert.deepEqual(folderShortcutFromPath("C:\\"), {
    name: "C:",
    path: "C:\\",
    kind: "drive",
  });
  assert.deepEqual(folderShortcutFromPath("C:\\Photos\\Album"), {
    name: "Album",
    path: "C:\\Photos\\Album",
    kind: "folder",
  });
});
