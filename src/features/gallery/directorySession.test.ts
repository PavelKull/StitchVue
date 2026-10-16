import assert from "node:assert/strict";
import test from "node:test";
import { eventSessionIsCurrent, keepCurrentSession } from "./directorySession.ts";

test("only the live directory session is current", () => {
  assert.equal(eventSessionIsCurrent(4, 4), true);
  assert.equal(eventSessionIsCurrent(3, 4), false);
  assert.equal(eventSessionIsCurrent(undefined, 4), false);
});

test("a delayed batch from a previous open is dropped", () => {
  const kept = keepCurrentSession(
    [
      { session: 1, path: "C:\\old\\a.jpg" },
      { session: 2, path: "C:\\now\\b.jpg" },
      { session: 2, path: "C:\\now\\c.jpg" },
    ],
    2,
  );
  assert.deepEqual(
    kept.map((item) => item.path),
    ["C:\\now\\b.jpg", "C:\\now\\c.jpg"],
  );
});

test("reopening the same folder does not accept the previous session", () => {
  assert.equal(eventSessionIsCurrent(11, 12), false);
  assert.deepEqual(keepCurrentSession([{ session: 11, path: "C:\\same\\a.jpg" }], 12), []);
});
