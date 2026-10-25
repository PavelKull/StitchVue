import test from "node:test";
import assert from "node:assert/strict";
import { isVideoPath } from "./isVideo.ts";

test("isVideoPath matches the backend video extensions only", () => {
  assert.equal(isVideoPath("/Users/me/Movies/IMG_0001.MOV"), true);
  assert.equal(isVideoPath("C:\\Clips\\trip.mp4"), true);
  assert.equal(isVideoPath("/a/b.m4v"), true);
  assert.equal(isVideoPath("/a/photo.jpg"), false);
  assert.equal(isVideoPath("/a/mov"), false);
  assert.equal(isVideoPath("/a.mov/photo.heic"), false);
});
