import test from "node:test";
import assert from "node:assert/strict";
import {
  batchAddNoticeToneAfterDiskTruth,
  classifyAttemptedFavoriteAddsAgainstDisk,
  classifyMassUnfavoriteWorkAfterTransportFailure,
  decideClaimReplay,
  mayAnnounceAllBatchFailed,
  refetchFavoriteOriginPathsAfterIpcFailure,
} from "./favoritesDiskTruthAfterIpc.ts";

test("decideClaimReplay allows Replay only for the same operationId", () => {
  assert.deepEqual(
    decideClaimReplay({
      originalOperationId: "op-1",
      claimOperationId: "op-1",
      claim: "Replay",
    }),
    { allowReplay: true, reason: "same_operation_replay" },
  );
  assert.equal(
    decideClaimReplay({
      originalOperationId: "op-1",
      claimOperationId: "op-2",
      claim: "Replay",
    }).allowReplay,
    false,
  );
  assert.equal(
    decideClaimReplay({
      originalOperationId: "op-1",
      claimOperationId: "op-1",
      claim: "Started",
    }).reason,
    "forbidden_new_run",
  );
});

test("refetchFavoriteOriginPathsAfterIpcFailure respects directory session guard", async () => {
  let current = true;
  const result = await refetchFavoriteOriginPathsAfterIpcFailure({
    directory: "C:\\Album",
    fetchOriginPaths: async () => ["C:\\Album\\a.jpg"],
    isDirectorySessionCurrent: () => current,
  });
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.deepEqual(result.originPaths, ["C:\\Album\\a.jpg"]);
  }

  current = false;
  const stale = await refetchFavoriteOriginPathsAfterIpcFailure({
    directory: "C:\\Album",
    fetchOriginPaths: async () => {
      throw new Error("should not fetch");
    },
    isDirectorySessionCurrent: () => current,
  });
  assert.equal(stale.status, "stale_session");
});

test("refetchFavoriteOriginPathsAfterIpcFailure returns failed on invoke error", async () => {
  const result = await refetchFavoriteOriginPathsAfterIpcFailure({
    directory: "C:\\Album",
    fetchOriginPaths: async () => {
      throw new Error("ipc down");
    },
    isDirectorySessionCurrent: () => true,
  });
  assert.equal(result.status, "failed");
});

test("classifyAttemptedFavoriteAddsAgainstDisk splits confirmed vs missing", () => {
  const classified = classifyAttemptedFavoriteAddsAgainstDisk(
    ["C:\\A\\one.jpg", "C:\\A\\two.jpg", "C:\\A\\three.jpg"],
    ["C:\\A\\one.jpg", "\\\\?\\C:\\A\\three.jpg"],
  );
  assert.deepEqual(classified.confirmedOnDisk, [
    "C:\\A\\one.jpg",
    "C:\\A\\three.jpg",
  ]);
  assert.deepEqual(classified.missingOnDisk, ["C:\\A\\two.jpg"]);
});

test("FR-008: mayAnnounceAllBatchFailed requires disk truth first", () => {
  assert.equal(mayAnnounceAllBatchFailed(false), false);
  assert.equal(mayAnnounceAllBatchFailed(true), true);
  assert.equal(
    batchAddNoticeToneAfterDiskTruth({
      attempted: 3,
      confirmedOnDisk: 0,
      diskTruthChecked: false,
    }),
    "needs_review",
  );
  assert.equal(
    batchAddNoticeToneAfterDiskTruth({
      attempted: 3,
      confirmedOnDisk: 2,
      diskTruthChecked: true,
    }),
    "partial",
  );
  assert.equal(
    batchAddNoticeToneAfterDiskTruth({
      attempted: 2,
      confirmedOnDisk: 0,
      diskTruthChecked: true,
    }),
    "failed",
  );
});

test("classifyMassUnfavoriteWorkAfterTransportFailure uses preview presence", () => {
  const work = ["C:\\F\\a.jpg", "C:\\F\\b.jpg", "C:\\F\\c.jpg"];
  const classified = classifyMassUnfavoriteWorkAfterTransportFailure(work, [
    {
      path: "C:\\F\\a.jpg",
      result: { status: "ready" as const, undoId: "" },
    },
    {
      path: "C:\\F\\c.jpg",
      result: {
        status: "needs_confirm" as const,
        confirmKind: "unknown_origin" as const,
        undoId: "",
      },
    },
  ]);
  assert.deepEqual(
    classified.map((row) => row.verdict),
    ["still_present", "absent", "still_present"],
  );
  const indeterminate = classifyMassUnfavoriteWorkAfterTransportFailure(
    work,
    null,
  );
  assert.ok(indeterminate.every((row) => row.verdict === "indeterminate"));
});
