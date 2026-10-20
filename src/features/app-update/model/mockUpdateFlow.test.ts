import assert from "node:assert/strict";
import test from "node:test";
import { initialMockUpdateSnapshot, mockUpdateBlocked } from "./mockUpdateFlow.ts";

test("mock update blocks primary action while file work is active", () => {
  assert.equal(mockUpdateBlocked(true, "prompt"), true);
  assert.equal(mockUpdateBlocked(true, "downloading"), true);
  assert.equal(mockUpdateBlocked(true, "error"), false);
  assert.equal(mockUpdateBlocked(false, "prompt"), false);
});

test("initial snapshot is prompt at zero progress", () => {
  assert.deepEqual(initialMockUpdateSnapshot(), { phase: "prompt", progress: 0 });
});
