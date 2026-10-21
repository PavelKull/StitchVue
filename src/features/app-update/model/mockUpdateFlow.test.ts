import assert from "node:assert/strict";
import test from "node:test";
import { canStartUpdate, updateActionBlocked } from "../lib/updateLifecycle.ts";

test("legacy mock gate maps to lifecycle helpers", () => {
  assert.equal(updateActionBlocked(true, "prompt"), true);
  assert.equal(canStartUpdate("downloading"), false);
});
