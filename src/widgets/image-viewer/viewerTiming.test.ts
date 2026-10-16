import assert from "node:assert/strict";
import test from "node:test";
import { markFirstFrame, markQualityFrame, markViewerOpened, markWebviewDecode, viewerTimings } from "./viewerTiming.ts";

test("the first frame is recorded once and a later quality time stays separate", () => {
  markViewerOpened();
  markFirstFrame();
  const first = viewerTimings().firstFrameMs;
  assert.ok(first !== null);
  markFirstFrame();
  assert.equal(viewerTimings().firstFrameMs, first);
  markQualityFrame();
  assert.ok(viewerTimings().qualityFrameMs !== null);
  markWebviewDecode(12);
  assert.equal(viewerTimings().webviewDecodeMs, 12);
});
