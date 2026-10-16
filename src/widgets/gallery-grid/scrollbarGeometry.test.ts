import assert from "node:assert/strict";
import test from "node:test";
import {
  inScrollbarRevealLane,
  laneOverlaps,
  scrollbarMetrics,
  scrollTopFromDrag,
  trackLimits,
} from "./scrollbarGeometry.ts";

const viewport = { left: 0, right: 1000, top: 0, bottom: 900 };

test("thumb uses the viewport ratio and the visual track", () => {
  const metrics = scrollbarMetrics({
    scrollHeight: 9000,
    clientHeight: 900,
    scrollTop: 0,
    trackTop: 70,
    trackBottom: 900,
  });
  assert.equal(metrics.visible, true);
  assert.equal(metrics.overflow, 8100);
  assert.equal(Math.round(metrics.thumbHeight), 81);
  assert.equal(metrics.thumbTop, 78);
});

test("a short folder keeps the minimum thumb and an equal gap at both ends", () => {
  const metrics = scrollbarMetrics({
    scrollHeight: 80_000,
    clientHeight: 800,
    scrollTop: 80_000 - 800,
    trackTop: 0,
    trackBottom: 800,
  });
  assert.equal(metrics.thumbHeight, 37.8);
  assert.equal(metrics.thumbTop, 800 - 8 - 37.8);
});

test("overflow of one pixel hides the thumb", () => {
  const metrics = scrollbarMetrics({
    scrollHeight: 901,
    clientHeight: 900,
    scrollTop: 0,
    trackTop: 0,
    trackBottom: 900,
  });
  assert.equal(metrics.visible, false);
});

test("top bar insets only the track and a centered bottom bar does not", () => {
  const limits = trackLimits(viewport, [
    { edge: "top", rect: { left: 0, right: 1000, top: 16, bottom: 70 } },
    { edge: "bottom", rect: { left: 300, right: 700, top: 800, bottom: 880 } },
  ]);
  assert.deepEqual(limits, { trackTop: 70, trackBottom: 900 });
  assert.equal(laneOverlaps(viewport, { left: 300, right: 700, top: 800, bottom: 880 }), false);
});

test("a bottom bar that reaches the scrollbar lane raises the track", () => {
  const limits = trackLimits(viewport, [
    { edge: "bottom", rect: { left: 900, right: 1000, top: 820, bottom: 890 } },
  ]);
  assert.equal(limits.trackBottom, 820);
});

test("reveal lane is the full viewport height so a bottom toolbar does not shrink it", () => {
  const lane = { top: 0, bottom: 900, right: 1000 };
  assert.equal(inScrollbarRevealLane(940, 80, lane), true);
  assert.equal(inScrollbarRevealLane(940, 880, lane), true);
  assert.equal(inScrollbarRevealLane(920, 880, lane), false);
});

test("drag maps the thumb travel onto the scroll range and clamps", () => {
  assert.equal(scrollTopFromDrag(0, 100, 200, 1000), 500);
  assert.equal(scrollTopFromDrag(100, -500, 200, 1000), 0);
  assert.equal(scrollTopFromDrag(900, 500, 200, 1000), 1000);
  assert.equal(scrollTopFromDrag(40, 10, 0, 1000), 40);
});
