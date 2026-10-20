import assert from "node:assert/strict";
import test from "node:test";
import { aspectFromMeta, computeViewerFrame } from "./viewerFrame.ts";

test("aspectFromMeta swaps dimensions for odd quarter turns", () => {
  const meta = { width: 4000, height: 3000, rotationQuarters: 1 };
  assert.equal(aspectFromMeta(meta), 3000 / 4000);
  assert.equal(aspectFromMeta({ width: 4000, height: 3000 }), 4000 / 3000);
});

test("fillScreen frame uses display aspect not 1:1 placeholder", () => {
  const portrait = aspectFromMeta({ width: 3000, height: 4000, rotationQuarters: 0 });
  const frame = computeViewerFrame(portrait, 1200, 900, true, 1);
  assert.ok(frame.height > frame.width);
});
