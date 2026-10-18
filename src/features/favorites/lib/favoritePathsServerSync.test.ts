import test from "node:test";
import assert from "node:assert/strict";
import { applyFavoriteOverlayPending } from "./favoriteOptimisticOverlay.ts";
import {
  beginFavoritePathsFetch,
  bumpFavoritePathsConfirmedRevision,
  buildFavoritePathsFetchTicket,
  diskConfirmedFavoritePaths,
  favoriteNeedsReviewNotice,
  needsFavoritePathsResyncAfterStaleReject,
  resolveFavoritePathsFetch,
  shouldAnnounceFullFavoriteSuccess,
  shouldApplyFavoritePathsFetch,
  type FavoritePathsApplyGuardState,
  type FavoritePathsSyncCounters,
} from "./favoritePathsServerSync.ts";

const DIR = "C:\\Album";
const DIR_KEY = "c:\\album";

function guardState(
  counters: FavoritePathsSyncCounters,
  openDirectoryKey: string | null = DIR_KEY,
): FavoritePathsApplyGuardState {
  return {
    latestRequestId: counters.latestRequestId,
    revision: counters.revision,
    openDirectoryKey,
  };
}

function simulateFetchCompletion(
  counters: FavoritePathsSyncCounters,
  ticket: ReturnType<typeof beginFavoritePathsFetch>,
  serverPaths: readonly string[],
  overlay: ReturnType<typeof applyFavoriteOverlayPending>,
  openDirectoryKey: string | null = DIR_KEY,
) {
  return resolveFavoritePathsFetch(
    ticket,
    guardState(counters, openDirectoryKey),
    serverPaths,
    overlay,
  );
}

test("older request completes after newer — only newer applies", () => {
  const counters: FavoritePathsSyncCounters = {
    latestRequestId: 0,
    revision: 0,
  };
  const overlay = new Map();
  const first = beginFavoritePathsFetch(counters, DIR);
  const second = beginFavoritePathsFetch(counters, DIR);

  const newerFirst = simulateFetchCompletion(
    counters,
    second,
    ["C:\\Album\\b.jpg"],
    overlay,
  );
  assert.equal(newerFirst.applied, true);
  assert.equal(newerFirst.confirmed?.has("c:\\album\\b.jpg"), true);

  const staleLate = simulateFetchCompletion(
    counters,
    first,
    ["C:\\Album\\a.jpg"],
    overlay,
  );
  assert.equal(staleLate.applied, false);
  assert.equal(staleLate.confirmed, null);
});

test("request started before single unfavorite commit is ignored after revision bump", () => {
  const counters: FavoritePathsSyncCounters = { latestRequestId: 0, revision: 0 };
  const ticket = beginFavoritePathsFetch(counters, DIR);
  bumpFavoritePathsConfirmedRevision(counters);

  const stale = simulateFetchCompletion(
    counters,
    ticket,
    ["C:\\Album\\a.jpg"],
    new Map(),
  );
  assert.equal(stale.applied, false);

  const fresh = beginFavoritePathsFetch(counters, DIR);
  const ok = simulateFetchCompletion(counters, fresh, [], new Map());
  assert.equal(ok.applied, true);
  assert.equal(ok.confirmed?.size, 0);
});

test("request started before mass teardown is ignored after revision bump", () => {
  const counters: FavoritePathsSyncCounters = { latestRequestId: 0, revision: 0 };
  const overlay = applyFavoriteOverlayPending(
    new Map(),
    "c:\\album\\a.jpg",
    "mass",
    false,
    1,
  );
  const ticket = beginFavoritePathsFetch(counters, DIR);
  bumpFavoritePathsConfirmedRevision(counters);

  const stale = simulateFetchCompletion(
    counters,
    ticket,
    ["C:\\Album\\a.jpg"],
    new Map(),
  );
  assert.equal(stale.applied, false);
});

test("folder change during request rejects stale directory ticket", () => {
  const counters: FavoritePathsSyncCounters = { latestRequestId: 0, revision: 0 };
  const ticket = beginFavoritePathsFetch(counters, DIR);

  const otherDir = simulateFetchCompletion(
    counters,
    ticket,
    ["C:\\Album\\a.jpg"],
    new Map(),
    "c:\\elsewhere",
  );
  assert.equal(otherDir.applied, false);
});

test("reopening the same folder uses a new request id", () => {
  const counters: FavoritePathsSyncCounters = { latestRequestId: 0, revision: 0 };
  const firstVisit = beginFavoritePathsFetch(counters, DIR);
  const secondVisit = beginFavoritePathsFetch(counters, DIR);

  assert.equal(firstVisit.requestId, 1);
  assert.equal(secondVisit.requestId, 2);

  const staleFromFirstSession = shouldApplyFavoritePathsFetch(
    firstVisit,
    guardState(counters),
  );
  assert.equal(staleFromFirstSession, false);
});

test("pending overlay keeps priority when fetch is still current", () => {
  const counters: FavoritePathsSyncCounters = { latestRequestId: 0, revision: 0 };
  const ticket = beginFavoritePathsFetch(counters, DIR);
  const overlay = applyFavoriteOverlayPending(
    new Map(),
    "c:\\album\\a.jpg",
    "op",
    false,
    1,
  );

  const merged = simulateFetchCompletion(
    counters,
    ticket,
    ["C:\\Album\\a.jpg"],
    overlay,
  );
  assert.equal(merged.applied, true);
  assert.equal(merged.confirmed?.has("c:\\album\\a.jpg"), false);
});

test("failed-request guard does not block a later fetch", () => {
  const counters: FavoritePathsSyncCounters = { latestRequestId: 0, revision: 0 };
  const failed = beginFavoritePathsFetch(counters, DIR);
  const later = beginFavoritePathsFetch(counters, DIR);

  assert.equal(
    shouldApplyFavoritePathsFetch(failed, guardState(counters)),
    false,
  );
  const ok = simulateFetchCompletion(counters, later, [], new Map());
  assert.equal(ok.applied, true);
});

test("after stale reject confirmed state stays unless a current fetch applies", async () => {
  const counters: FavoritePathsSyncCounters = { latestRequestId: 0, revision: 0 };
  let confirmed = new Set(["c:\\album\\keep.jpg"]);

  const slow = beginFavoritePathsFetch(counters, DIR);
  const fast = beginFavoritePathsFetch(counters, DIR);

  const fastResult = resolveFavoritePathsFetch(
    fast,
    guardState(counters),
    ["C:\\Album\\keep.jpg"],
    new Map(),
  );
  if (fastResult.applied && fastResult.confirmed) {
    confirmed = fastResult.confirmed;
  }

  bumpFavoritePathsConfirmedRevision(counters);
  confirmed = new Set(confirmed);
  confirmed.delete("c:\\album\\keep.jpg");

  const slowResult = resolveFavoritePathsFetch(
    slow,
    guardState(counters),
    ["C:\\Album\\keep.jpg"],
    new Map(),
  );
  assert.equal(slowResult.applied, false);
  assert.equal(confirmed.has("c:\\album\\keep.jpg"), false);
  assert.equal(
    needsFavoritePathsResyncAfterStaleReject(slow, guardState(counters)),
    false,
  );
});

test("deterministic promise order: late stale then fresh apply", async () => {
  const counters: FavoritePathsSyncCounters = { latestRequestId: 0, revision: 0 };
  const overlay = new Map();
  const results: string[] = [];

  const p1 = new Promise<readonly string[]>((resolve) => {
    setTimeout(() => resolve(["C:\\Album\\stale.jpg"]), 20);
  });
  const p2 = Promise.resolve<string[]>(["C:\\Album\\fresh.jpg"]);

  const t1 = beginFavoritePathsFetch(counters, DIR);
  const t2 = beginFavoritePathsFetch(counters, DIR);

  const [late, early] = await Promise.all([
    p1.then((paths) => {
      const r = resolveFavoritePathsFetch(
        t1,
        guardState(counters),
        paths,
        overlay,
      );
      if (r.applied) {
        results.push("stale");
      }
      return r;
    }),
    p2.then((paths) => {
      const r = resolveFavoritePathsFetch(
        t2,
        guardState(counters),
        paths,
        overlay,
      );
      if (r.applied) {
        results.push("fresh");
      }
      return r;
    }),
  ]);

  assert.equal(early.applied, true);
  assert.equal(late.applied, false);
  assert.deepEqual(results, ["fresh"]);
});

test("buildFavoritePathsFetchTicket normalizes directory key", () => {
  const ticket = buildFavoritePathsFetchTicket(3, 2, "C:\\Album");
  assert.equal(ticket.directoryKey, DIR_KEY);
  assert.equal(ticket.requestId, 3);
  assert.equal(ticket.revisionAtStart, 2);
});

test("T029 no full-success when journal incomplete or reconcileSuggested", () => {
  assert.equal(shouldAnnounceFullFavoriteSuccess(true), true);
  assert.equal(
    shouldAnnounceFullFavoriteSuccess(true, { journalIncomplete: true }),
    false,
  );
  assert.equal(
    shouldAnnounceFullFavoriteSuccess(true, { needsReconciliation: true }),
    false,
  );
  assert.equal(
    shouldAnnounceFullFavoriteSuccess(true, { reconcileSuggested: true }),
    false,
  );
  assert.equal(shouldAnnounceFullFavoriteSuccess(false), false);
  assert.equal(
    favoriteNeedsReviewNotice({ reconcileSuggested: true }),
    true,
  );
  assert.equal(favoriteNeedsReviewNotice({}), false);
});

test("T026 diskConfirmedFavoritePaths merges server listing with overlay", () => {
  const overlay = applyFavoriteOverlayPending(
    new Map(),
    "c:\\album\\a.jpg",
    "op",
    false,
    1,
  );
  const confirmed = diskConfirmedFavoritePaths(
    ["C:\\Album\\a.jpg", "C:\\Album\\b.jpg"],
    overlay,
  );
  assert.equal(confirmed.has("c:\\album\\a.jpg"), false);
  assert.equal(confirmed.has("c:\\album\\b.jpg"), true);
});
