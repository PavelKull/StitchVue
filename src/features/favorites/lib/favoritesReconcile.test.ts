import test from "node:test";
import assert from "node:assert/strict";
import {
  createFavoritesReconcileScheduler,
  FAVORITES_RECONCILE_DEBOUNCE_MS,
  FAVORITES_RECONCILE_SKIP_WINDOW_MS,
  type FavoritesReconcileClock,
} from "./favoritesReconcile.ts";

function createFakeClock(start = 0): FavoritesReconcileClock & {
  advance: (ms: number) => void;
  nowMs: () => number;
} {
  let now = start;
  const timers = new Map<number, { fireAt: number; fn: () => void }>();
  let nextId = 1;

  return {
    now: () => now,
    nowMs: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { fireAt: now + ms, fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(id) {
      timers.delete(id as unknown as number);
    },
    advance(ms) {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, t]) => t.fireAt <= now)
        .sort((a, b) => a[1].fireAt - b[1].fireAt);
      for (const [id, t] of due) {
        timers.delete(id);
        t.fn();
      }
    },
  };
}

test("debounce is within 300–500ms", () => {
  assert.ok(FAVORITES_RECONCILE_DEBOUNCE_MS >= 300);
  assert.ok(FAVORITES_RECONCILE_DEBOUNCE_MS <= 500);
  assert.equal(FAVORITES_RECONCILE_SKIP_WINDOW_MS, 2000);
});

test("schedule invokes callback after debounce", () => {
  const clock = createFakeClock();
  const calls: string[] = [];
  const scheduler = createFavoritesReconcileScheduler(
    (key) => calls.push(key),
    clock,
  );

  scheduler.schedule("c:\\album");
  assert.deepEqual(calls, []);
  clock.advance(FAVORITES_RECONCILE_DEBOUNCE_MS - 1);
  assert.deepEqual(calls, []);
  clock.advance(1);
  assert.deepEqual(calls, ["c:\\album"]);
});

test("rapid schedules coalesce to last directoryKey", () => {
  const clock = createFakeClock();
  const calls: string[] = [];
  const scheduler = createFavoritesReconcileScheduler(
    (key) => calls.push(key),
    clock,
  );

  scheduler.schedule("a");
  clock.advance(100);
  scheduler.schedule("b");
  clock.advance(FAVORITES_RECONCILE_DEBOUNCE_MS);
  assert.deepEqual(calls, ["b"]);
});

test("skips same directoryKey within 2s unless force", () => {
  const clock = createFakeClock();
  const calls: string[] = [];
  const scheduler = createFavoritesReconcileScheduler(
    (key) => calls.push(key),
    clock,
  );

  scheduler.schedule("C:\\Album");
  clock.advance(FAVORITES_RECONCILE_DEBOUNCE_MS);
  assert.deepEqual(calls, ["C:\\Album"]);

  // pathKey-equal path must share the skip window
  scheduler.schedule("c:\\album");
  clock.advance(FAVORITES_RECONCILE_DEBOUNCE_MS);
  assert.deepEqual(calls, ["C:\\Album"]);

  clock.advance(FAVORITES_RECONCILE_SKIP_WINDOW_MS);
  scheduler.schedule("c:\\album");
  clock.advance(FAVORITES_RECONCILE_DEBOUNCE_MS);
  assert.deepEqual(calls, ["C:\\Album", "c:\\album"]);
});

test("force bypasses skip window for same directoryKey", () => {
  const clock = createFakeClock();
  const calls: string[] = [];
  const scheduler = createFavoritesReconcileScheduler(
    (key) => calls.push(key),
    clock,
  );

  scheduler.schedule("c:\\album");
  clock.advance(FAVORITES_RECONCILE_DEBOUNCE_MS);
  scheduler.schedule("c:\\album", { force: true });
  clock.advance(FAVORITES_RECONCILE_DEBOUNCE_MS);
  assert.deepEqual(calls, ["c:\\album", "c:\\album"]);
});

test("different directoryKey is not skipped by window", () => {
  const clock = createFakeClock();
  const calls: string[] = [];
  const scheduler = createFavoritesReconcileScheduler(
    (key) => calls.push(key),
    clock,
  );

  scheduler.schedule("a");
  clock.advance(FAVORITES_RECONCILE_DEBOUNCE_MS);
  scheduler.schedule("b");
  clock.advance(FAVORITES_RECONCILE_DEBOUNCE_MS);
  assert.deepEqual(calls, ["a", "b"]);
});

test("cancel drops pending debounce", () => {
  const clock = createFakeClock();
  const calls: string[] = [];
  const scheduler = createFavoritesReconcileScheduler(
    (key) => calls.push(key),
    clock,
  );

  scheduler.schedule("c:\\album");
  scheduler.cancel();
  clock.advance(FAVORITES_RECONCILE_DEBOUNCE_MS);
  assert.deepEqual(calls, []);
});
