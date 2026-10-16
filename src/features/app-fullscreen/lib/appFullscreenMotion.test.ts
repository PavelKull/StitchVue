import assert from "node:assert/strict";
import test from "node:test";
import {
  FULLSCREEN_PANEL_MS,
  resolvePanelMotionMs,
} from "./appFullscreenMotion.ts";

test("panel motion respects animations and reduced-motion", () => {
  assert.equal(resolvePanelMotionMs(true, false), FULLSCREEN_PANEL_MS);
  assert.equal(resolvePanelMotionMs(false, false), 0);
  assert.equal(resolvePanelMotionMs(true, true), 0);
  assert.equal(resolvePanelMotionMs(false, true), 0);
});
