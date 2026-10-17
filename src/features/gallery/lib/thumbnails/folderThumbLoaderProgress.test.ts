import assert from "node:assert/strict";
import test from "node:test";
import {
  cometFinishMode,
  cometProgressRatio,
  emptyFolderThumbLoaderSnapshot,
  type FolderThumbLoaderSnapshot,
} from "./folderThumbLoaderProgress.ts";

function snap(
  patch: Partial<FolderThumbLoaderSnapshot>,
): FolderThumbLoaderSnapshot {
  return { ...emptyFolderThumbLoaderSnapshot(), ...patch };
}

test("listing keeps progress indeterminate", () => {
  assert.equal(
    cometProgressRatio(
      snap({ listingBusy: true, imageCount: 0, settledCount: 0 }),
    ),
    null,
  );
  assert.equal(
    cometProgressRatio(
      snap({ listingBusy: true, imageCount: 40, settledCount: 12 }),
    ),
    null,
  );
});

test("settled over total after listing", () => {
  assert.equal(
    cometProgressRatio(
      snap({ listingBusy: false, imageCount: 8, settledCount: 2 }),
    ),
    0.25,
  );
  assert.equal(
    cometProgressRatio(
      snap({ listingBusy: false, imageCount: 10, settledCount: 10 }),
    ),
    1,
  );
});

test("failed items in settled count still raise progress", () => {
  assert.equal(
    cometProgressRatio(
      snap({ listingBusy: false, imageCount: 4, settledCount: 4 }),
    ),
    1,
  );
});

test("finish close only when every listed image settled", () => {
  assert.equal(
    cometFinishMode(
      snap({ imageCount: 10, settledCount: 10, pipelinePass: "running" }),
    ),
    "close",
  );
});

test("cancelled never closes the ring", () => {
  assert.equal(
    cometFinishMode(
      snap({
        imageCount: 10,
        settledCount: 3,
        pipelinePass: "cancelled",
      }),
    ),
    "abort",
  );
});

test("all settled still closes when cache is capped", () => {
  assert.equal(
    cometFinishMode(
      snap({
        imageCount: 10,
        settledCount: 10,
        cacheCapped: true,
        pipelinePass: "running",
      }),
    ),
    "close",
  );
});

test("cache cap and incomplete completed pass fade without 100%", () => {
  assert.equal(
    cometFinishMode(
      snap({
        imageCount: 100,
        settledCount: 40,
        cacheCapped: true,
        pipelinePass: "running",
      }),
    ),
    "fade",
  );
  assert.equal(
    cometFinishMode(
      snap({
        imageCount: 100,
        settledCount: 40,
        pipelinePass: "completed",
      }),
    ),
    "fade",
  );
});
