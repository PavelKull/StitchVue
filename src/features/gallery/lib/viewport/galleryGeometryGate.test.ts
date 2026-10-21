import assert from "node:assert/strict";
import test from "node:test";
import type { ImageMeta } from "../../../../entities/image/types.ts";
import {
  createDeferredVoid,
  listingHasCompleteGeometry,
  listingHasTrustedGeometry,
} from "./galleryGeometryGate.ts";

const images = [
  { path: "C:\\photos\\a.jpg" },
  { path: "C:\\photos\\b.jpg" },
];

test("listingHasTrustedGeometry is false until meta or fail exists", () => {
  const meta = new Map<string, ImageMeta>();
  const failed = new Map<string, string>();
  assert.equal(listingHasTrustedGeometry(images, meta, failed), false);
  meta.set("C:\\photos\\a.jpg", { width: 100, height: 80 });
  assert.equal(listingHasTrustedGeometry(images, meta, failed), true);
  meta.clear();
  failed.set("C:\\photos\\b.jpg", "unsupported");
  assert.equal(listingHasTrustedGeometry(images, meta, failed), true);
});

test("listingHasTrustedGeometry ignores zero-height meta", () => {
  const meta = new Map<string, ImageMeta>([["C:\\photos\\a.jpg", { width: 100, height: 0 }]]);
  assert.equal(listingHasTrustedGeometry(images, meta, new Map()), false);
});

// Mosaic и columns делят одну проводку spacer/jump; разброс аспектов покрыт тем,
// что геометрия complete только когда каждый слот trusted или failed.
test("listingHasCompleteGeometry is true for empty list", () => {
  assert.equal(
    listingHasCompleteGeometry([], new Map(), new Map()),
    true,
  );
});

test("listingHasCompleteGeometry is false when only one of two files has meta", () => {
  const meta = new Map<string, ImageMeta>([
    ["C:\\photos\\a.jpg", { width: 100, height: 80 }],
  ]);
  assert.equal(listingHasCompleteGeometry(images, meta, new Map()), false);
});

test("listingHasCompleteGeometry is true when every file has height>0", () => {
  const meta = new Map<string, ImageMeta>([
    ["C:\\photos\\a.jpg", { width: 100, height: 80 }],
    ["C:\\photos\\b.jpg", { width: 50, height: 90 }],
  ]);
  assert.equal(listingHasCompleteGeometry(images, meta, new Map()), true);
});

test("listingHasCompleteGeometry is true when remaining file is only in failed", () => {
  const meta = new Map<string, ImageMeta>([
    ["C:\\photos\\a.jpg", { width: 100, height: 80 }],
  ]);
  const failed = new Map<string, string>([["C:\\photos\\b.jpg", "unsupported"]]);
  assert.equal(listingHasCompleteGeometry(images, meta, failed), true);
});

test("listingHasCompleteGeometry treats zero-height meta as unknown", () => {
  const meta = new Map<string, ImageMeta>([
    ["C:\\photos\\a.jpg", { width: 100, height: 80 }],
    ["C:\\photos\\b.jpg", { width: 50, height: 0 }],
  ]);
  assert.equal(listingHasCompleteGeometry(images, meta, new Map()), false);
});

test("createDeferredVoid resolves exactly once for awaiters", async () => {
  const gate = createDeferredVoid();
  let ready = false;
  const wait = gate.promise.then(() => {
    ready = true;
  });
  assert.equal(ready, false);
  gate.resolve();
  gate.resolve();
  await wait;
  assert.equal(ready, true);
  await gate.promise;
});
