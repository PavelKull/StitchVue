import assert from "node:assert/strict";
import test from "node:test";
import {
  computePhotoFlipMoves,
  createPhotoFlipSession,
  cancelPhotoFlip,
  flipScaleForPlay,
  photoFlipId,
  shouldAbortPhotoFlip,
  shouldStartPhotoFlip,
  skipUnchangedTiles,
  PHOTO_FLIP_MAX_MOVES,
  PHOTO_FLIP_SCROLL_ABORT_PX,
  type PhotoRect,
} from "./photoDeleteFlip.ts";

function rect(id: string, left: number, top: number, width = 100, height = 80): PhotoRect {
  return { id, left, top, width, height };
}

test("FLIP matches remaining tiles by path, not by array index", () => {
  const first = [rect("a", 0, 0), rect("b", 120, 0), rect("c", 240, 0)];
  const last = [rect("b", 0, 0), rect("c", 120, 0)];
  const moves = computePhotoFlipMoves(first, last);
  assert.deepEqual(
    moves.map((move) => move.id),
    ["b", "c"],
  );
  assert.equal(moves[0]?.dx, 120);
  assert.equal(moves[1]?.dx, 120);
});

test("path keys stay stable across Windows slash variants", () => {
  assert.equal(photoFlipId("C:\\photos\\A.jpg"), photoFlipId("C:/photos/A.jpg"));
});

test("unchanged tiles are not animated", () => {
  const first = [rect("keep", 10, 20), rect("move", 10, 120)];
  const last = [rect("keep", 10, 20), rect("move", 10, 40)];
  const moves = computePhotoFlipMoves(first, last);
  assert.deepEqual(
    moves.map((move) => move.id),
    ["move"],
  );
  assert.deepEqual(skipUnchangedTiles(moves).map((move) => move.id), ["move"]);
});

test("size change is recorded as a scale from the new box back to the old box", () => {
  const first = [rect("tile", 0, 0, 200, 100)];
  const last = [rect("tile", 0, 0, 100, 200)];
  const moves = computePhotoFlipMoves(first, last);
  assert.equal(moves.length, 1);
  assert.equal(moves[0]?.sx, 2);
  assert.equal(moves[0]?.sy, 0.5);
});

test("a large mosaic size jump plays as position-only to avoid stretching the bitmap", () => {
  assert.deepEqual(flipScaleForPlay(2, 0.5, false), { sx: 1, sy: 1 });
  assert.deepEqual(flipScaleForPlay(1.05, 0.95, false), { sx: 1.05, sy: 0.95 });
  assert.deepEqual(flipScaleForPlay(1.05, 0.95, true), { sx: 1, sy: 1 });
});

test("a successful single trash move may start FLIP", () => {
  assert.equal(
    shouldStartPhotoFlip({
      action: "move_to_local_trash",
      requestedCount: 1,
      movedCount: 1,
      rustFailed: false,
    }),
    true,
  );
});

test("a Rust failure or bulk move does not start a success FLIP", () => {
  assert.equal(
    shouldStartPhotoFlip({
      action: "move_to_local_trash",
      requestedCount: 1,
      movedCount: 1,
      rustFailed: true,
    }),
    false,
  );
  assert.equal(
    shouldStartPhotoFlip({
      action: "move_to_local_trash",
      requestedCount: 3,
      movedCount: 3,
      rustFailed: false,
    }),
    false,
  );
  assert.equal(
    shouldStartPhotoFlip({
      action: "copy_to_local_favorites",
      requestedCount: 1,
      movedCount: 1,
      rustFailed: false,
    }),
    false,
  );
});

test("a stale generation or folder/zoom/mode change aborts the previous FLIP", () => {
  assert.equal(
    shouldAbortPhotoFlip({
      motionEnabled: true,
      generation: 1,
      sessionGeneration: 2,
      directoryUnchanged: true,
      layoutModeUnchanged: true,
      zoomUnchanged: true,
      scrollDelta: 0,
      moveCount: 3,
    }),
    "stale-generation",
  );
  assert.equal(
    shouldAbortPhotoFlip({
      motionEnabled: true,
      generation: 2,
      sessionGeneration: 2,
      directoryUnchanged: false,
      layoutModeUnchanged: true,
      zoomUnchanged: true,
      scrollDelta: 0,
      moveCount: 3,
    }),
    "directory",
  );
  assert.equal(
    shouldAbortPhotoFlip({
      motionEnabled: true,
      generation: 2,
      sessionGeneration: 2,
      directoryUnchanged: true,
      layoutModeUnchanged: false,
      zoomUnchanged: true,
      scrollDelta: 0,
      moveCount: 3,
    }),
    "layout-version",
  );
  assert.equal(
    shouldAbortPhotoFlip({
      motionEnabled: true,
      generation: 2,
      sessionGeneration: 2,
      directoryUnchanged: true,
      layoutModeUnchanged: true,
      zoomUnchanged: false,
      scrollDelta: 0,
      moveCount: 3,
    }),
    "layout-version",
  );
});

test("the first FLIP generation is not treated as stale", () => {
  assert.equal(
    shouldAbortPhotoFlip({
      motionEnabled: true,
      generation: 1,
      sessionGeneration: 0,
      directoryUnchanged: true,
      layoutModeUnchanged: true,
      zoomUnchanged: true,
      scrollDelta: 0,
      moveCount: 4,
    }),
    null,
  );
});

test("FLIP does not depend on layoutMorph being on", () => {
  assert.equal(
    shouldAbortPhotoFlip({
      motionEnabled: true,
      generation: 1,
      sessionGeneration: 1,
      directoryUnchanged: true,
      layoutModeUnchanged: true,
      zoomUnchanged: true,
      scrollDelta: 0,
      moveCount: 4,
    }),
    null,
  );
});

test("a large scroll jump aborts rather than double-compensating", () => {
  assert.equal(
    shouldAbortPhotoFlip({
      motionEnabled: true,
      generation: 1,
      sessionGeneration: 1,
      directoryUnchanged: true,
      layoutModeUnchanged: true,
      zoomUnchanged: true,
      scrollDelta: PHOTO_FLIP_SCROLL_ABORT_PX + 1,
      moveCount: 4,
    }),
    "scroll",
  );
});

test("reduced motion skips movement", () => {
  assert.equal(
    shouldAbortPhotoFlip({
      motionEnabled: false,
      generation: 1,
      sessionGeneration: 1,
      directoryUnchanged: true,
      layoutModeUnchanged: true,
      zoomUnchanged: true,
      scrollDelta: 0,
      moveCount: 4,
    }),
    "reduced-motion",
  );
});

test("cancelling a session drops tracked animations and does not accumulate them", () => {
  const session = createPhotoFlipSession();
  let cancelled = 0;
  const fake = {
    cancel() {
      cancelled += 1;
    },
  } as unknown as Animation;
  session.generation = 3;
  session.animations.push(fake, fake);
  cancelPhotoFlip(session);
  assert.equal(cancelled, 2);
  assert.equal(session.animations.length, 0);
  cancelPhotoFlip(session);
  assert.equal(cancelled, 2);
});

test("too many movers fall back to the final layout without a mass animation", () => {
  assert.equal(
    shouldAbortPhotoFlip({
      motionEnabled: true,
      generation: 1,
      sessionGeneration: 1,
      directoryUnchanged: true,
      layoutModeUnchanged: true,
      zoomUnchanged: true,
      scrollDelta: 0,
      moveCount: PHOTO_FLIP_MAX_MOVES + 1,
    }),
    "too-many",
  );
});

test("final layout coordinates are the Last rect, not the inverted First rect", () => {
  const first = [rect("tile", 40, 80, 120, 90)];
  const last = [rect("tile", 10, 20, 110, 95)];
  const moves = computePhotoFlipMoves(first, last);
  assert.equal(moves[0]?.dx, 30);
  assert.equal(moves[0]?.dy, 60);
  assert.equal(last[0]?.left, 10);
  assert.equal(last[0]?.top, 20);
  assert.equal(last[0]?.width, 110);
  assert.equal(last[0]?.height, 95);
});
