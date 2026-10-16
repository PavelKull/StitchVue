import test from "node:test";
import assert from "node:assert/strict";
import { orderFoldersForDisplay } from "./folderOrder.ts";
import type { FolderShortcut } from "../../entities/folder/types";

const folder = (name: string, serviceRole?: FolderShortcut["serviceRole"]): FolderShortcut => ({
  name,
  path: `C:\\x\\${name}`,
  kind: "folder",
  serviceRole: serviceRole ?? null,
});

test("orderFoldersForDisplay pins service folders without reshuffling the rest", () => {
  const input = [folder("Photos"), folder("Альбом"), folder("Избранное", "favorites"), folder("Удаленное", "trash")];
  const ordered = orderFoldersForDisplay(input);
  assert.deepEqual(
    ordered.map((item) => item.name),
    ["Избранное", "Удаленное", "Photos", "Альбом"],
  );
});
