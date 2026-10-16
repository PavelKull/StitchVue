import test from "node:test";
import assert from "node:assert/strict";
import {
  BOTTOM_SCROLL_PAD_GAP_PX,
  bottomScrollPadNeeded,
  resolveBottomScrollPad,
} from "./bottomScrollPad.ts";

test("bottomScrollPadNeeded sums dock, edge, and gap", () => {
  assert.equal(bottomScrollPadNeeded(80, 16, 12), 108);
  assert.equal(bottomScrollPadNeeded(0, 16), 0);
  assert.equal(bottomScrollPadNeeded(80, 16), 80 + 16 + BOTTOM_SCROLL_PAD_GAP_PX);
});

test("resolveBottomScrollPad keeps full reserve when content overflows viewport", () => {
  assert.equal(resolveBottomScrollPad(100, 2000, 800), 100);
  assert.equal(resolveBottomScrollPad(100, 800, 800), 100);
});

test("resolveBottomScrollPad shrinks when short content already clears the panel", () => {
  assert.equal(resolveBottomScrollPad(100, 500, 800), 0);
  assert.equal(resolveBottomScrollPad(100, 750, 800), 50);
  assert.equal(resolveBottomScrollPad(100, 700, 800), 0);
});

test("resolveBottomScrollPad ignores invalid sizes", () => {
  assert.equal(resolveBottomScrollPad(0, 2000, 800), 0);
  assert.equal(resolveBottomScrollPad(100, 2000, 0), 0);
});
