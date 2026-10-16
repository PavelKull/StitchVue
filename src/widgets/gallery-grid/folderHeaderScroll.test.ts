import assert from "node:assert/strict";
import test from "node:test";
import { compensateHeaderScrollTop, FOLDER_HEADER_TOP_PX } from "./folderHeaderScroll.ts";

test("at the top, header growth keeps scroll at 0", () => {
  assert.equal(compensateHeaderScrollTop(0, 0, 180), 0);
  assert.equal(compensateHeaderScrollTop(FOLDER_HEADER_TOP_PX, 120, 240), 0);
});

test("when scrolled, header growth is added to scrollTop", () => {
  assert.equal(compensateHeaderScrollTop(800, 0, 180), 980);
  assert.equal(compensateHeaderScrollTop(800, 180, 360), 980);
});

test("when scrolled, header shrink is subtracted from scrollTop", () => {
  assert.equal(compensateHeaderScrollTop(980, 360, 180), 800);
});

test("photoScrollTop stays the same after a scrolled header change", () => {
  const scroll = 900;
  const header = 0;
  const nextHeader = 176;
  const nextScroll = compensateHeaderScrollTop(scroll, header, nextHeader);
  assert.equal(nextScroll - nextHeader, scroll - header);
});

test("clamps to the scrollable range", () => {
  assert.equal(compensateHeaderScrollTop(50, 400, 0), 0);
  assert.equal(compensateHeaderScrollTop(2000, 0, 200, 1500), 1500);
});
