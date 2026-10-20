import assert from "node:assert/strict";
import test from "node:test";

import { initI18n } from "../../../shared/i18n/i18n.ts";
import {
  fileOperationIsActiveInDirectory,
  fileOperationIsCopyToFavoritesInDirectory,
  fileOperationProgressWidthSample,
} from "./fileOperation.ts";

await initI18n();

test("file operation progress belongs only to its album directory", () => {
  const operation = {
    id: "op-1",
    action: "copy_to_local_favorites" as const,
    directory: "F:\\Album A",
  };
  assert.equal(fileOperationIsActiveInDirectory(operation, "F:\\Album A"), true);
  assert.equal(fileOperationIsActiveInDirectory(operation, "F:\\Album B"), false);
  assert.equal(
    fileOperationIsCopyToFavoritesInDirectory(operation, "F:\\Album B"),
    false,
  );
  assert.equal(
    fileOperationIsCopyToFavoritesInDirectory(operation, "F:\\Album A"),
    true,
  );
});

test("progress width sample reserves space for large counts and byte totals", () => {
  const withBytes = fileOperationProgressWidthSample(true);
  const countOnly = fileOperationProgressWidthSample(false);
  assert.ok(withBytes.length > countOnly.length);
  assert.match(withBytes, /9999/);
});
