import assert from "node:assert/strict";
import test from "node:test";
import { layoutGallery } from "./layout.ts";

test("one mosaic photo follows zoom when its full-width height already fits the viewport", () => {
  const aspect = 1.5;
  const width = 1600;
  const viewport = 1080;
  const steps = [8, 6, 4, 2, 1];
  const heights = steps.map(
    (rows) => layoutGallery([aspect], width, viewport, rows, 0, "mosaic").rows[0].height,
  );
  for (let index = 1; index < heights.length; index += 1) {
    assert.ok(heights[index] > heights[index - 1], `${steps[index]} should be taller than ${steps[index - 1]}`);
  }
  const natural = width / aspect;
  for (const height of heights) {
    assert.ok(height <= viewport);
    assert.ok(height <= natural + 1);
  }
});

test("a multi-photo mosaic row stays full width", () => {
  const laid = layoutGallery([1.5, 1.2, 0.8, 1.6], 1600, 1080, 4, 0, "mosaic");
  assert.equal(laid.rows.length, 1);
  assert.equal(laid.rows[0].height, 314);
  const width = laid.rows[0].tiles.reduce((sum, tile) => sum + tile.width, 0);
  assert.equal(width, 1600);
});
