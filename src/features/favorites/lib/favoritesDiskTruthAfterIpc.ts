/**
 * Read-only disk-truth после транспортного сбоя IPC избранного (FR-008 / T044a).
 *
 * Claim::Replay для `run_file_operation` допустим ТОЛЬКО когда:
 * - claim относится к тому же `operationId`, что у исходной операции, и
 * - claim вернул `Replay` (идемпотентный повтор уже завершённой операции),
 * а не новый destructive run (`Started` / иной статус).
 */

import { pathKey } from "../../selection/lib/selection.ts";
import type { FavoriteBatchPathResult } from "../../selection/lib/fileOperation.ts";

export type ClaimReplayDecision = {
  allowReplay: boolean;
  reason:
    | "same_operation_replay"
    | "id_mismatch"
    | "not_replay"
    | "forbidden_new_run";
};

/** Разрешает Claim::Replay только при совпадении operationId и proven Replay. */
export function decideClaimReplay(options: {
  originalOperationId: string;
  claimOperationId: string;
  claim: "Replay" | "Started" | "InFlight" | string;
}): ClaimReplayDecision {
  if (options.originalOperationId !== options.claimOperationId) {
    return { allowReplay: false, reason: "id_mismatch" };
  }
  if (options.claim === "Replay") {
    return { allowReplay: true, reason: "same_operation_replay" };
  }
  if (options.claim === "Started" || options.claim === "InFlight") {
    return { allowReplay: false, reason: "forbidden_new_run" };
  }
  return { allowReplay: false, reason: "not_replay" };
}

export type DiskTruthRefetchResult =
  | { status: "ok"; originPaths: string[] }
  | { status: "stale_session" }
  | { status: "failed"; error: unknown };

/**
 * Refetch `favorite_origin_paths` после IPC failure.
 * `isDirectorySessionCurrent` — guard активной сессии каталога (не применять чужой ответ).
 */
export async function refetchFavoriteOriginPathsAfterIpcFailure(options: {
  directory: string;
  fetchOriginPaths: (directory: string) => Promise<string[]>;
  isDirectorySessionCurrent: () => boolean;
}): Promise<DiskTruthRefetchResult> {
  if (!options.isDirectorySessionCurrent()) {
    return { status: "stale_session" };
  }
  try {
    const originPaths = await options.fetchOriginPaths(options.directory);
    if (!options.isDirectorySessionCurrent()) {
      return { status: "stale_session" };
    }
    return { status: "ok", originPaths };
  } catch (error) {
    return { status: "failed", error };
  }
}

/** Сопоставить попытки batch-add с disk listing избранного. */
export function classifyAttemptedFavoriteAddsAgainstDisk(
  attemptedPaths: readonly string[],
  diskOriginPaths: readonly string[],
): { confirmedOnDisk: string[]; missingOnDisk: string[] } {
  const disk = new Set(diskOriginPaths.map((path) => pathKey(path)));
  const confirmedOnDisk: string[] = [];
  const missingOnDisk: string[] = [];
  for (const path of attemptedPaths) {
    if (disk.has(pathKey(path))) {
      confirmedOnDisk.push(path);
    } else {
      missingOnDisk.push(path);
    }
  }
  return { confirmedOnDisk, missingOnDisk };
}

/**
 * После transport failure batch unfavorite: preview (read-only) говорит,
 * осталась ли копия. Без preview нельзя объявлять «все failed».
 */
export type MassUnfavoriteDiskVerdict =
  | "still_present"
  | "absent"
  | "indeterminate";

export function classifyMassUnfavoriteWorkAfterTransportFailure(
  workPaths: readonly string[],
  postFailurePreviews: readonly FavoriteBatchPathResult[] | null,
): { path: string; verdict: MassUnfavoriteDiskVerdict }[] {
  if (postFailurePreviews === null) {
    return workPaths.map((path) => ({ path, verdict: "indeterminate" as const }));
  }
  const byPath = new Map(
    postFailurePreviews.map((entry) => [pathKey(entry.path), entry] as const),
  );
  return workPaths.map((path) => {
    const entry = byPath.get(pathKey(path));
    if (!entry) {
      // Копии нет в preview — вероятно уже снята с диска/журнала.
      return { path, verdict: "absent" as const };
    }
    const status = entry.result.status;
    if (
      status === "ready" ||
      status === "needs_confirm" ||
      status === "skipped"
    ) {
      return { path, verdict: "still_present" as const };
    }
    if (status === "failed") {
      return { path, verdict: "indeterminate" as const };
    }
    // recycled / relocated / restored_origin в preview не ожидаются — indeterminate.
    return { path, verdict: "indeterminate" as const };
  });
}

/** FR-008: без проверки диска нельзя заявлять полный провал batch. */
export function mayAnnounceAllBatchFailed(diskTruthChecked: boolean): boolean {
  return diskTruthChecked;
}

export type BatchAddDiskTruthNoticeTone =
  | "ok"
  | "partial"
  | "failed"
  | "needs_review";

export function batchAddNoticeToneAfterDiskTruth(options: {
  attempted: number;
  confirmedOnDisk: number;
  diskTruthChecked: boolean;
}): BatchAddDiskTruthNoticeTone {
  if (!options.diskTruthChecked) {
    return "needs_review";
  }
  if (options.confirmedOnDisk <= 0) {
    return "failed";
  }
  if (options.confirmedOnDisk >= options.attempted) {
    return "ok";
  }
  return "partial";
}
