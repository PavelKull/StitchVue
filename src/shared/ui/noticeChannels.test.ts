import assert from "node:assert/strict";
import test from "node:test";
import {
  bootToastNotice,
  NOTICE_CHANNEL_MAP,
  TOAST_CHANNEL_HOST,
} from "./noticeChannels.ts";

test("NOTICE_CHANNEL_MAP covers toast modal empty", () => {
  const channels = new Set(NOTICE_CHANNEL_MAP.map((row) => row.channel));
  assert.equal(channels.size, 3);
  assert.ok(channels.has("toast"));
  assert.ok(channels.has("modal"));
  assert.ok(channels.has("empty"));
});

test("boot toast routes through OperationNoticeView host", () => {
  const row = NOTICE_CHANNEL_MAP.find((item) => item.channel === "toast");
  assert.equal(row?.host, TOAST_CHANNEL_HOST);
  const notice = bootToastNotice("Folder missing");
  assert.equal(notice.tone, "ok");
  assert.equal(notice.text, "Folder missing");
  assert.deepEqual(notice.details, []);
});
