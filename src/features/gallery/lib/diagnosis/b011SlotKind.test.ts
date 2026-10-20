import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyB011ReactSlot,
  mosaicIndexPublished,
} from "./b011SlotKind.ts";

test("classifyB011ReactSlot: layout hole when tile not rendered", () => {
  assert.equal(
    classifyB011ReactSlot({
      file: { path: "C:\\a.jpg" },
      thumb: { tier: 512, thumbnailPath: "C:\\cache\\a.jpg" },
      failed: undefined,
      layoutTileRendered: false,
    }),
    "layout-hole",
  );
});

test("classifyB011ReactSlot: waiting placeholder without thumb", () => {
  assert.equal(
    classifyB011ReactSlot({
      file: { path: "C:\\a.jpg" },
      thumb: undefined,
      failed: undefined,
      layoutTileRendered: true,
    }),
    "placeholder-waiting",
  );
});

test("classifyB011ReactSlot: thumb in map when display tier ready", () => {
  assert.equal(
    classifyB011ReactSlot({
      file: { path: "C:\\a.jpg" },
      thumb: { tier: 256, thumbnailPath: "C:\\cache\\a.jpg" },
      failed: undefined,
      layoutTileRendered: true,
    }),
    "thumb-in-map",
  );
});

test("mosaicIndexPublished respects publishedEnd", () => {
  assert.equal(mosaicIndexPublished(0, 10), true);
  assert.equal(mosaicIndexPublished(9, 10), true);
  assert.equal(mosaicIndexPublished(10, 10), false);
});
