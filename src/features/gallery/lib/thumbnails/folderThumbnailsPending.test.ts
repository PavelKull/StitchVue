import assert from "node:assert/strict";
import test from "node:test";
import type { ImageFile, ThumbInfo } from "../../../../entities/image/types.ts";
import {
  folderThumbnailsPending,
  imageIsThumbSettled,
  markThumbSettled,
  seedSettledThumbKeys,
  thumbIsDisplayReady,
} from "./folderThumbnailsPending.ts";

const file = (name: string): ImageFile => ({
  name,
  path: `C:\\photos\\${name}`,
  size: 1,
  modifiedAt: 1,
});

test("display ready requires at least the 256 tier", () => {
  assert.equal(thumbIsDisplayReady(undefined), false);
  assert.equal(thumbIsDisplayReady({ tier: 128, thumbnailPath: "a" }), false);
  assert.equal(thumbIsDisplayReady({ tier: 256, thumbnailPath: "a" }), true);
  assert.equal(thumbIsDisplayReady({ tier: 512, thumbnailPath: "a" }), true);
});

test("failed paths count as settled without a thumb", () => {
  const thumbs = new Map<string, ThumbInfo>();
  const failed = new Map([["C:\\photos\\a.jpg", "unsupported"]]);
  assert.equal(imageIsThumbSettled("C:\\photos\\a.jpg", thumbs, failed), true);
  assert.equal(imageIsThumbSettled("C:\\photos\\b.jpg", thumbs, failed), false);
});

test("seed counts unique ready and failed images", () => {
  const images = [file("a.jpg"), file("b.jpg"), file("c.jpg")];
  const thumbs = new Map<string, ThumbInfo>([
    ["C:\\photos\\a.jpg", { tier: 256, thumbnailPath: "a" }],
    ["C:\\photos\\c.jpg", { tier: 1024, thumbnailPath: "c" }],
  ]);
  const failed = new Map([["C:\\photos\\b.jpg", "corrupted"]]);
  const settled = seedSettledThumbKeys(images, thumbs, failed);
  assert.equal(settled.size, 3);
});

test("markThumbSettled ignores quality-upgrade duplicates", () => {
  const settled = new Set<string>();
  assert.equal(markThumbSettled(settled, "C:\\photos\\A.jpg"), true);
  assert.equal(markThumbSettled(settled, "C:\\photos\\a.jpg"), false);
  assert.equal(settled.size, 1);
});

test("listing keeps pending even when the image list is empty", () => {
  assert.equal(
    folderThumbnailsPending({
      listingBusy: true,
      imageCount: 0,
      settledCount: 0,
      pipelinePending: null,
      pipelinePass: null,
      cacheCapped: false,
    }),
    true,
  );
});

test("empty ready folder is not pending", () => {
  assert.equal(
    folderThumbnailsPending({
      listingBusy: false,
      imageCount: 0,
      settledCount: 0,
      pipelinePending: 0,
      pipelinePass: "idle",
      cacheCapped: false,
    }),
    false,
  );
});

test("pending until every image is settled", () => {
  assert.equal(
    folderThumbnailsPending({
      listingBusy: false,
      imageCount: 10,
      settledCount: 9,
      pipelinePending: 1,
      pipelinePass: "running",
      cacheCapped: false,
    }),
    true,
  );
  assert.equal(
    folderThumbnailsPending({
      listingBusy: false,
      imageCount: 10,
      settledCount: 10,
      pipelinePending: 0,
      pipelinePass: "running",
      cacheCapped: false,
    }),
    false,
  );
});

test("pipeline completed or cache cap stops the spinner before all thumbs arrive", () => {
  assert.equal(
    folderThumbnailsPending({
      listingBusy: false,
      imageCount: 100,
      settledCount: 40,
      pipelinePending: 0,
      pipelinePass: "completed",
      cacheCapped: false,
    }),
    false,
  );
  assert.equal(
    folderThumbnailsPending({
      listingBusy: false,
      imageCount: 100,
      settledCount: 40,
      pipelinePending: 60,
      pipelinePass: "running",
      cacheCapped: true,
    }),
    false,
  );
});

test("idle board before start_indexing does not clear pending", () => {
  assert.equal(
    folderThumbnailsPending({
      listingBusy: false,
      imageCount: 5,
      settledCount: 0,
      pipelinePending: 0,
      pipelinePass: "idle",
      cacheCapped: false,
    }),
    true,
  );
});

test("cancelled pass ends the spinner on session teardown", () => {
  assert.equal(
    folderThumbnailsPending({
      listingBusy: false,
      imageCount: 5,
      settledCount: 1,
      pipelinePending: 4,
      pipelinePass: "cancelled",
      cacheCapped: false,
    }),
    false,
  );
});
