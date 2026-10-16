import assert from "node:assert/strict";
import test from "node:test";
import {
  clampIndexRange,
  firstGeometryRange,
  firstScreenFileCount,
  SEGMENT_SIZE,
} from "./layout.ts";

test("firstScreenFileCount is a whole number at zoom 1.5", () => {
  const count = firstScreenFileCount(1800, 900, 1.5, 1000);
  assert.equal(count % 1, 0);
  assert.ok(count > 0);
  assert.ok(Number.isInteger(count));
});

test("firstScreenFileCount stays inside the listing and never uses a fixed 64", () => {
  const count = firstScreenFileCount(1920, 900, 4, 5000);
  assert.equal(count, Math.floor(count));
  assert.notEqual(count, SEGMENT_SIZE);
  assert.ok(count > 32);
  assert.ok(count <= 5000);
  assert.equal(firstScreenFileCount(1920, 900, 4, 10), 10);
});

test("firstScreenFileCount rejects empty and invalid viewports", () => {
  assert.equal(firstScreenFileCount(0, 900, 4, 100), 0);
  assert.equal(firstScreenFileCount(1600, 0, 4, 100), 0);
  assert.equal(firstScreenFileCount(1600, 900, 4, 0), 0);
  assert.equal(firstScreenFileCount(Number.NaN, 900, 4, 100), 0);
  assert.equal(firstScreenFileCount(1600, 900, Number.NaN, 100) > 0, true);
  assert.equal(firstScreenFileCount(1600, 900, -2, 100) > 0, true);
});

test("first geometry range does not depend on a published layout", () => {
  const range = firstGeometryRange(1600, 900, 4, 400);
  assert.equal(range.start, 0);
  assert.equal(range.end, firstScreenFileCount(1600, 900, 4, 400));
  assert.ok(range.end > 0);
  assert.ok(range.end <= 400);
});

test("clampIndexRange keeps integer bounds inside the listing", () => {
  assert.deepEqual(clampIndexRange(0, 17.5, 100), { start: 0, end: 17 });
  assert.deepEqual(clampIndexRange(-4, 80, 40), { start: 0, end: 40 });
  assert.deepEqual(clampIndexRange(12, 8, 40), { start: 12, end: 12 });
  assert.deepEqual(clampIndexRange(Number.NaN, Number.POSITIVE_INFINITY, 9), { start: 0, end: 9 });
});
