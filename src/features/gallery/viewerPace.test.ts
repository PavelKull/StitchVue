import assert from "node:assert/strict";
import test from "node:test";
import { aheadForInterval, isFastPace, smoothInterval, VIEWER_AHEAD_FAST, VIEWER_AHEAD_NORMAL, VIEWER_AHEAD_SLOW } from "./viewerPace.ts";

test("one fast step does not jump the preload depth", () => {
  const smoothed = smoothInterval([700, 700, 700, 90]);
  assert.ok(smoothed != null && smoothed > 180);
  assert.equal(aheadForInterval(smoothed), VIEWER_AHEAD_NORMAL);
  assert.equal(isFastPace(smoothed), false);
});

test("a run of fast steps deepens light preload", () => {
  const smoothed = smoothInterval([120, 100, 140, 90]);
  assert.equal(aheadForInterval(smoothed), VIEWER_AHEAD_FAST);
  assert.equal(isFastPace(smoothed), true);
});

test("slow steps shorten preload", () => {
  assert.equal(aheadForInterval(smoothInterval([800, 900, 700])), VIEWER_AHEAD_SLOW);
});
