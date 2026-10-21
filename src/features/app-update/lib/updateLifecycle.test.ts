import assert from "node:assert/strict";
import test from "node:test";
import {
  canStartUpdate,
  classifyUpdateError,
  initialUpdateSnapshot,
  updateActionBlocked,
} from "./updateLifecycle.ts";

test("initial snapshot is idle", () => {
  assert.deepEqual(initialUpdateSnapshot(), {
    phase: "idle",
    progress: 0,
    errorKey: null,
  });
});

test("update action blocked only on prompt/error while ops busy", () => {
  assert.equal(updateActionBlocked(true, "prompt"), true);
  assert.equal(updateActionBlocked(true, "error"), true);
  assert.equal(updateActionBlocked(true, "downloading"), false);
  assert.equal(updateActionBlocked(false, "prompt"), false);
});

test("cannot start download without confirm / while in flight", () => {
  assert.equal(canStartUpdate("prompt"), true);
  assert.equal(canStartUpdate("error"), true);
  assert.equal(canStartUpdate("idle"), false);
  assert.equal(canStartUpdate("arming"), false);
  assert.equal(canStartUpdate("downloading"), false);
  assert.equal(canStartUpdate("installing"), false);
});

test("classifyUpdateError maps signature, install, and network", () => {
  assert.equal(classifyUpdateError(new Error("signature verification failed")), "signature");
  assert.equal(classifyUpdateError("minisign pubkey mismatch"), "signature");
  assert.equal(classifyUpdateError(new Error("could not verify update")), "signature");
  assert.equal(classifyUpdateError(new Error("NSIS install failed")), "install");
  assert.equal(classifyUpdateError("failed to install update"), "install");
  assert.equal(classifyUpdateError(new Error("fetch failed")), "network");
  assert.equal(classifyUpdateError("timeout"), "network");
});
