import assert from "node:assert/strict";
import test from "node:test";
import { coalesceFolderRefresh } from "./folderRefresh.ts";

test("folder refresh runs a queued path after the active run finishes", async () => {
  const log: string[] = [];
  const schedule = coalesceFolderRefresh(async (path) => {
    log.push(path);
    await new Promise((resolve) => setTimeout(resolve, 5));
  });

  schedule("C:\\first");
  schedule("C:\\second");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(log, ["C:\\first", "C:\\second"]);
});
