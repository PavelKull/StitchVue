import assert from "node:assert/strict";
import test from "node:test";
import {
  FOLDER_DELAY_MS,
  LEAVE_GRACE_MS,
  PHOTO_DELAY_MS,
  hoverWindow,
  initialHoverState,
  reduceHover,
  type HoverState,
} from "./hoverPrefetch.ts";

function at(state: HoverState, event: Parameters<typeof reduceHover>[1], now: number) {
  return reduceHover(state, event, now);
}

test("a quick pass over several folders sends only the one that stays", () => {
  let state = initialHoverState();
  state = at(state, { type: "enter-folder", path: "C:\\a" }, 0).state;
  state = at(state, { type: "enter-folder", path: "C:\\b" }, 40).state;
  state = at(state, { type: "enter-folder", path: "C:\\c" }, 80).state;
  const early = at(state, { type: "tick" }, FOLDER_DELAY_MS);
  assert.equal(early.effects.length, 0);
  const fired = at(state, { type: "tick" }, 80 + FOLDER_DELAY_MS);
  assert.equal(fired.effects.length, 1);
  assert.equal(fired.effects[0].type, "prefetch-folder");
  if (fired.effects[0].type === "prefetch-folder") {
    assert.equal(fired.effects[0].path, "C:\\c");
  }
});

test("leaving before the delay sends nothing", () => {
  let state = initialHoverState();
  state = at(state, { type: "enter-folder", path: "C:\\a" }, 0).state;
  state = at(state, { type: "leave-folder", path: "C:\\a" }, 50).state;
  const fired = at(state, { type: "tick" }, FOLDER_DELAY_MS);
  assert.deepEqual(fired.effects, []);
});

test("leaving a started folder cancels after the grace period", () => {
  let state = initialHoverState();
  state = at(state, { type: "enter-folder", path: "C:\\a" }, 0).state;
  state = at(state, { type: "tick" }, FOLDER_DELAY_MS).state;
  state = at(state, { type: "leave-folder", path: "C:\\a" }, FOLDER_DELAY_MS + 10).state;
  const tooSoon = at(state, { type: "tick" }, FOLDER_DELAY_MS + 10 + LEAVE_GRACE_MS - 1);
  assert.equal(tooSoon.effects.length, 0);
  const cancelled = at(state, { type: "tick" }, FOLDER_DELAY_MS + 10 + LEAVE_GRACE_MS);
  assert.deepEqual(cancelled.effects, [{ type: "cancel-folder" }]);
});

test("moving back during the grace period keeps the folder prefetch", () => {
  let state = initialHoverState();
  state = at(state, { type: "enter-folder", path: "C:\\a" }, 0).state;
  state = at(state, { type: "tick" }, FOLDER_DELAY_MS).state;
  state = at(state, { type: "leave-folder", path: "C:\\a" }, 200).state;
  state = at(state, { type: "enter-folder", path: "C:\\a" }, 250).state;
  const fired = at(state, { type: "tick" }, 400);
  assert.deepEqual(fired.effects, []);
  assert.equal(state.folderSent, "C:\\a");
  assert.equal(state.folderCancelDue, null);
});

test("a photo hover waits, and a second pass does not send a duplicate", () => {
  let state = initialHoverState();
  state = at(state, { type: "enter-photo", path: "C:\\a.jpg", size: 4, modifiedAt: 9 }, 0).state;
  assert.equal(at(state, { type: "tick" }, PHOTO_DELAY_MS - 1).effects.length, 0);
  const fired = at(state, { type: "tick" }, PHOTO_DELAY_MS);
  assert.equal(fired.effects.length, 1);
  assert.equal(fired.effects[0].type, "prefetch-photo");
  state = fired.state;
  state = at(state, { type: "enter-photo", path: "C:\\a.jpg", size: 4, modifiedAt: 9 }, 300).state;
  assert.deepEqual(at(state, { type: "tick" }, 500).effects, []);
});

test("sweeping across photos sends only the photo that remains", () => {
  let state = initialHoverState();
  for (let index = 0; index < 100; index += 1) {
    state = at(state, { type: "enter-photo", path: `C:\\p${index}.jpg`, size: 1, modifiedAt: 1 }, index).state;
  }
  const fired = at(state, { type: "tick" }, 99 + PHOTO_DELAY_MS);
  assert.equal(fired.effects.length, 1);
  if (fired.effects[0].type === "prefetch-photo") {
    assert.equal(fired.effects[0].path, "C:\\p99.jpg");
  }
});

test("the open folder is not prefetched again", () => {
  let state = initialHoverState({ order: "date-desc", first: 8, extra: 16, longEdge: 800, openPath: "C:\\open" });
  state = at(state, { type: "enter-folder", path: "C:\\open" }, 0).state;
  assert.equal(state.folderDue, null);
  assert.deepEqual(at(state, { type: "tick" }, FOLDER_DELAY_MS).effects, []);
});

test("one screen of rows stays inside the hover window", () => {
  assert.deepEqual(hoverWindow(4), { first: 24, extra: 48 });
  assert.equal(hoverWindow(1).first, 8);
  assert.ok(hoverWindow(20).first <= 48);
  assert.ok(hoverWindow(20).first + hoverWindow(20).extra <= 96);
});
