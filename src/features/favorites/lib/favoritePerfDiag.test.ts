import assert from "node:assert/strict";
import test from "node:test";

import { sumFileBytes } from "./favoritePerfDiag.ts";

test("sumFileBytes ignores non-positive sizes", () => {
  assert.equal(sumFileBytes([{ size: 100 }, { size: 0 }, { size: 50 }]), 150);
});
