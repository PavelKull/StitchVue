import assert from "node:assert/strict";
import test from "node:test";
import {
  NATIVE_KEPT_CAP,
  cancelNativeWarm,
  emptyNativeWarm,
  finishNativeWarm,
  promoteNativeWarm,
  requestNativeWarm,
} from "./nativeWarm.ts";

test("a fast run of hover warms keeps one decode and only the latest pending photo", () => {
  let state = emptyNativeWarm();
  const started: string[] = [];
  for (let index = 0; index < 100; index += 1) {
    const next = requestNativeWarm(state, `photo-${index}`);
    state = next.state;
    if (next.start) {
      started.push(next.start);
    }
  }
  assert.deepEqual(started, ["photo-0"]);
  assert.equal(state.active, 1);
  assert.equal(state.pending, "photo-99");
  assert.equal(state.kept.length, 1);

  const done = finishNativeWarm(state);
  assert.equal(done.start, "photo-99");
  assert.equal(done.state.pending, null);
  assert.equal(done.state.active, 1);
  assert.deepEqual(done.state.kept, ["photo-0", "photo-99"]);
});

test("a cancelled hover does not start the photo that never began", () => {
  let state = requestNativeWarm(emptyNativeWarm(), "first").state;
  state = requestNativeWarm(state, "second").state;
  assert.equal(state.pending, "second");
  state = cancelNativeWarm(state);
  const done = finishNativeWarm(state);
  assert.equal(done.start, null);
  assert.equal(done.state.active, 0);
  assert.equal(done.state.pending, null);
});

test("opening the photo under the cursor keeps its pending decode and drops the other", () => {
  let state = requestNativeWarm(emptyNativeWarm(), "first").state;
  state = requestNativeWarm(state, "second").state;
  const opened = promoteNativeWarm(state, "second");
  assert.equal(opened.pending, "second");
  const other = promoteNativeWarm(state, "first");
  assert.equal(other.pending, null);
  assert.equal(finishNativeWarm(other).start, null);
});

test("repeated hovers keep at most eight prepared photos", () => {
  let state = emptyNativeWarm();
  for (let index = 0; index < 20; index += 1) {
    const started = requestNativeWarm(state, `photo-${index}`);
    state = started.state;
    if (started.start) {
      state = finishNativeWarm(state).state;
    }
  }
  assert.ok(state.kept.length <= NATIVE_KEPT_CAP);
  assert.equal(state.kept.length, NATIVE_KEPT_CAP);
  assert.equal(state.kept[0], "photo-12");
  assert.equal(state.kept[NATIVE_KEPT_CAP - 1], "photo-19");
  const again = requestNativeWarm(state, "photo-19");
  assert.equal(again.start, null);
});
