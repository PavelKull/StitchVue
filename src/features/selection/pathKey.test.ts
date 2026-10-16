import test from "node:test";
import assert from "node:assert/strict";
import { pathKey } from "./selection.ts";

test("pathKey treats canonical Windows paths as the same folder", () => {
  const plain = "C:\\Users\\Pavel\\Photos\\Избранное";
  const verbatim = "\\\\?\\C:\\Users\\Pavel\\Photos\\Избранное";
  assert.equal(pathKey(plain), pathKey(verbatim));
});
