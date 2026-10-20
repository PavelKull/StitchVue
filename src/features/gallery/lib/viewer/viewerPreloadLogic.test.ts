import assert from "node:assert/strict";
import test from "node:test";
import type { ImageFile } from "../../../../entities/image/types.ts";
import {
  buildNeighborContext,
  buildNeighborJobs,
  neighborContextEquals,
  pickHoverWarmSource,
  resolveNeighborSource,
  shouldAcceptHoverFrame,
  shouldSkipReadyDecode,
} from "./viewerPreloadLogic.ts";

function file(path: string, index: number): ImageFile {
  return { name: path, path, size: index + 1, modifiedAt: index };
}

const files = Array.from({ length: 12 }, (_, index) => file(`C:\\p${index}.jpg`, index));

test("opening a photo plans five ahead and two back", () => {
  const planned = buildNeighborJobs(files, 5, 5, 1, false);
  assert.deepEqual(
    planned.jobs.map((job) => job.file.path),
    ["C:\\p6.jpg", "C:\\p7.jpg", "C:\\p8.jpg", "C:\\p9.jpg", "C:\\p10.jpg", "C:\\p4.jpg", "C:\\p3.jpg"],
  );
  assert.deepEqual([...planned.near], ["C:\\p6.jpg"]);
  assert.equal(planned.jobs[0].priority, "p1");
  assert.equal(planned.jobs[1].priority, "p2");
  assert.equal(planned.jobs[5].priority, "p3");
});

test("changing direction rebuilds the forward window", () => {
  const forward = buildNeighborJobs(files, 5, 5, 1, false);
  const backward = buildNeighborJobs(files, 5, 5, -1, false);
  assert.equal(forward.jobs[0].file.path, "C:\\p6.jpg");
  assert.equal(backward.jobs[0].file.path, "C:\\p4.jpg");
  assert.deepEqual(
    backward.jobs.slice(-2).map((job) => job.file.path),
    ["C:\\p6.jpg", "C:\\p7.jpg"],
  );
});

test("thumbVersion-equivalent context stays equal so generation need not bump", () => {
  const left = buildNeighborContext(files, 3, 5, 1, false, "stamp-a");
  const right = buildNeighborContext(files, 3, 5, 1, false, "stamp-a");
  assert.equal(neighborContextEquals(left, right), true);
  assert.equal(neighborContextEquals(left, { ...right, orderStamp: "stamp-b" }), false);
  assert.equal(neighborContextEquals(left, { ...right, openPath: "C:\\other.jpg" }), false);
  assert.equal(neighborContextEquals(left, { ...right, ahead: 12 }), false);
  assert.equal(neighborContextEquals(left, { ...right, direction: -1 }), false);
  assert.equal(neighborContextEquals(left, { ...right, fast: true }), false);
});

test("missing thumbs stay waiting and become ready when a thumb appears", () => {
  assert.equal(resolveNeighborSource({ near: false, thumb: undefined, source: null }).status, "wait");
  const after = resolveNeighborSource({
    near: false,
    thumb: { tier: 256, thumbnailPath: "C:\\cache\\late.jpg" },
    source: null,
  });
  assert.equal(after.status, "ready");
  if (after.status === "ready") {
    assert.equal(after.srcKey, "C:\\cache\\late.jpg");
  }
});

test("a missing source waits instead of finishing", () => {
  assert.deepEqual(resolveNeighborSource({ near: false, thumb: undefined, source: null }), { status: "wait" });
  assert.deepEqual(resolveNeighborSource({ near: true, thumb: undefined, source: { kind: "pending", path: "" } }), {
    status: "wait",
  });
});

test("a late thumbnail becomes a ready preview source", () => {
  assert.deepEqual(
    resolveNeighborSource({
      near: false,
      thumb: { tier: 256, thumbnailPath: "C:\\cache\\a.jpg" },
      source: null,
    }),
    { status: "ready", srcKey: "C:\\cache\\a.jpg", native: false, cacheHit: true },
  );
});

test("ready identical sources skip another decode", () => {
  assert.equal(
    shouldSkipReadyDecode({
      currentSrc: "asset://a",
      currentNative: false,
      currentReady: true,
      nextSrc: "asset://a",
      nextNative: false,
    }),
    true,
  );
  assert.equal(
    shouldSkipReadyDecode({
      currentSrc: "asset://thumb",
      currentNative: false,
      currentReady: true,
      nextSrc: "asset://native",
      nextNative: true,
    }),
    false,
  );
  assert.equal(
    shouldSkipReadyDecode({
      currentSrc: "asset://native",
      currentNative: true,
      currentReady: true,
      nextSrc: "asset://thumb",
      nextNative: false,
    }),
    true,
  );
});

test("a ready Rust frame is accepted only while the hover epoch and folder session match", () => {
  assert.equal(
    shouldAcceptHoverFrame({
      path: "C:\\a.jpg",
      token: 4,
      epoch: 2,
      pendingPath: "C:\\a.jpg",
      pendingToken: 4,
      pendingEpoch: 2,
      pendingFolderSession: 9,
      folderSession: 9,
      eventSession: 9,
    }),
    true,
  );
  assert.equal(
    shouldAcceptHoverFrame({
      path: "C:\\a.jpg",
      token: 4,
      epoch: 3,
      pendingPath: "C:\\a.jpg",
      pendingToken: 4,
      pendingEpoch: 2,
      pendingFolderSession: 9,
      folderSession: 9,
      eventSession: 9,
    }),
    false,
  );
  assert.equal(
    shouldAcceptHoverFrame({
      path: "C:\\a.jpg",
      token: 4,
      epoch: 2,
      pendingPath: "C:\\a.jpg",
      pendingToken: 4,
      pendingEpoch: 2,
      pendingFolderSession: 9,
      folderSession: 9,
      eventSession: 8,
    }),
    false,
  );
  assert.equal(
    shouldAcceptHoverFrame({
      path: "C:\\a.jpg",
      token: 4,
      epoch: 2,
      pendingPath: "C:\\a.jpg",
      pendingToken: 4,
      pendingEpoch: 2,
      pendingFolderSession: 8,
      folderSession: 9,
      eventSession: 9,
    }),
    false,
  );
  assert.equal(
    shouldAcceptHoverFrame({
      path: "C:\\old.jpg",
      token: 4,
      epoch: 2,
      pendingPath: "C:\\a.jpg",
      pendingToken: 4,
      pendingEpoch: 2,
      pendingFolderSession: 9,
      folderSession: 9,
      eventSession: 9,
    }),
    false,
  );
});

test("hover warms native first, then sharp, then preview", () => {
  assert.deepEqual(pickHoverWarmSource({ nativePath: "C:\\a.jpg", sharpPath: "C:\\s.jpg", previewPath: "C:\\p.jpg" }), {
    path: "C:\\a.jpg",
    native: true,
  });
  assert.deepEqual(pickHoverWarmSource({ nativePath: "", sharpPath: "C:\\s.jpg", previewPath: "C:\\p.jpg" }), {
    path: "C:\\s.jpg",
    native: false,
  });
  assert.deepEqual(pickHoverWarmSource({ nativePath: "", sharpPath: "", previewPath: "C:\\p.jpg" }), {
    path: "C:\\p.jpg",
    native: false,
  });
  assert.equal(pickHoverWarmSource({ nativePath: "", sharpPath: "", previewPath: "" }), null);
});

test("fast pace still upgrades the next photo and caps forward at five", () => {
  const planned = buildNeighborJobs(files, 2, 12, 1, true);
  assert.equal(planned.near.size, 1);
  assert.equal(planned.jobs[0].file.path, "C:\\p3.jpg");
  assert.equal(planned.jobs[0].priority, "p1");
  assert.equal(planned.jobs.length, 7);
});
