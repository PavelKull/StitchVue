import assert from "node:assert/strict";
import test from "node:test";
import { placeTooltipInViewport } from "./tooltipPosition.ts";

test("tooltip flips below when there is no room above", () => {
  const anchor = { left: 100, top: 4, right: 140, bottom: 36, width: 40, height: 32, x: 100, y: 4, toJSON: () => ({}) };
  const placed = placeTooltipInViewport(anchor, 120, 32, "above", { width: 800, height: 600 });
  assert.equal(placed.placement, "below");
  assert.equal(placed.top, 36 + 8);
});

test("tooltip stays inside horizontal viewport", () => {
  const anchor = { left: 2, top: 200, right: 30, bottom: 232, width: 28, height: 32, x: 2, y: 200, toJSON: () => ({}) };
  const placed = placeTooltipInViewport(anchor, 200, 24, "below", { width: 800, height: 600 });
  assert.ok(placed.left - 100 >= 8);
});
