import assert from "node:assert/strict";
import test from "node:test";
import type { ImageMeta } from "../../../../entities/image/types.ts";
import { createDeferredVoid, listingHasTrustedGeometry } from "./galleryGeometryGate.ts";

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
