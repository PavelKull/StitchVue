import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FAST_ENTER_PX_S,
  FAST_EXIT_PX_S,
  advanceScrollMode,
  initialScrollModeState,
} from "./scrollLoadMode.ts";

test("idle sample becomes scrolling with direction", () => {
  const next = advanceScrollMode(initialScrollModeState(), 120, 0, 100);
  assert.equal(next.mode, "scrolling");
  assert.equal(next.ahead, 1);
});

test("fast enter and hysteresis exit", () => {
  let state = initialScrollModeState();
  state = advanceScrollMode(state, 40, 0, 16);
  assert.equal(state.mode, "scrolling");
  // Second sample: large jump in a short window → FastScrolling
  state = advanceScrollMode(state, 40 + FAST_ENTER_PX_S, 40, 32);
  assert.equal(state.mode, "fastScrolling");
  // Drive velocity below exit with several slow samples
  for (let i = 0; i < 16; i += 1) {
    const top = 40 + i;
    state = advanceScrollMode(state, top + 1, top, 200 + i * 40);
  }
  assert.ok(state.velocity < FAST_EXIT_PX_S || state.mode === "scrolling");
  assert.equal(state.mode, "scrolling");
});
