import assert from "node:assert/strict";
import test from "node:test";
import type { FolderShortcut } from "../../entities/folder/types";
import {
  applyDrivesSnapshot,
  beginDrivesRequest,
  finishDrivesRequest,
  initialDrivesState,
  shouldRefreshDrives,
} from "./drivesState.ts";

const drive = (letter: string): FolderShortcut => ({
  name: `Disk (${letter}:)`,
  path: `${letter}:\\`,
  kind: "drive",
  media: "ssd",
  serviceRole: null,
});

test("initial state is idle with an empty list", () => {
  assert.deepEqual(initialDrivesState(), {
    status: "idle",
    drives: [],
    error: null,
    requestId: 0,
  });
});

test("begin marks loading and keeps the previous successful list", () => {
  let state = initialDrivesState();
  state = finishDrivesRequest(beginDrivesRequest(state), 1, { ok: true, drives: [drive("C")] });
  state = beginDrivesRequest(state);
  assert.equal(state.status, "loading");
  assert.equal(state.requestId, 2);
  assert.deepEqual(state.drives, [drive("C")]);
  assert.equal(state.error, null);
});

test("success with an empty list is distinct from error", () => {
  let state = beginDrivesRequest(initialDrivesState());
  state = finishDrivesRequest(state, 1, { ok: true, drives: [] });
  assert.equal(state.status, "success");
  assert.deepEqual(state.drives, []);
  assert.equal(state.error, null);
});

test("error keeps the previous list and stores the message", () => {
  let state = initialDrivesState();
  state = finishDrivesRequest(beginDrivesRequest(state), 1, { ok: true, drives: [drive("C")] });
  state = beginDrivesRequest(state);
  state = finishDrivesRequest(state, 2, { ok: false, error: "boom" });
  assert.equal(state.status, "error");
  assert.equal(state.error, "boom");
  assert.deepEqual(state.drives, [drive("C")]);
});

test("a late reply from an older request is ignored", () => {
  let state = beginDrivesRequest(initialDrivesState());
  const firstId = state.requestId;
  state = beginDrivesRequest(state);
  const secondId = state.requestId;
  state = finishDrivesRequest(state, firstId, { ok: true, drives: [drive("D")] });
  assert.equal(state.status, "loading");
  assert.deepEqual(state.drives, []);
  state = finishDrivesRequest(state, secondId, { ok: true, drives: [drive("C")] });
  assert.equal(state.status, "success");
  assert.deepEqual(state.drives, [drive("C")]);
});

test("out-of-order success then error does not apply the stale error", () => {
  let state = beginDrivesRequest(initialDrivesState());
  const firstId = state.requestId;
  state = beginDrivesRequest(state);
  const secondId = state.requestId;
  state = finishDrivesRequest(state, secondId, { ok: true, drives: [drive("C")] });
  state = finishDrivesRequest(state, firstId, { ok: false, error: "stale" });
  assert.equal(state.status, "success");
  assert.deepEqual(state.drives, [drive("C")]);
  assert.equal(state.error, null);
});

test("shouldRefreshDrives blocks only while a request is in flight", () => {
  assert.equal(shouldRefreshDrives(initialDrivesState()), true);
  assert.equal(shouldRefreshDrives(beginDrivesRequest(initialDrivesState())), false);
  const success = finishDrivesRequest(beginDrivesRequest(initialDrivesState()), 1, {
    ok: true,
    drives: [drive("C")],
  });
  assert.equal(shouldRefreshDrives(success), true);
});

test("applyDrivesSnapshot marks success even while a load was pending", () => {
  const loading = beginDrivesRequest(initialDrivesState());
  const applied = applyDrivesSnapshot(loading, [drive("C"), drive("D")]);
  assert.equal(applied.status, "success");
  assert.deepEqual(applied.drives, [drive("C"), drive("D")]);
  assert.equal(applied.error, null);
});
